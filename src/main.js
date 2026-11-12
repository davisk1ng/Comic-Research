import * as THREE from 'three';

// Vite discovers every JPG at build time and emits production-safe asset URLs.
const scanModules = import.meta.glob('../Batman No. 215 */*.{jpg,jpeg,JPG,JPEG}', { eager: true, query: '?url', import: 'default' });
const scanEntries = Object.entries(scanModules).filter(([path]) => path.startsWith('../Batman No. 215 (1940) (JPG)/')).sort(([a], [b]) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
);
const $ = (id) => document.getElementById(id);
const stage = $('stage');
const loading = $('loading');
const loadingDetail = $('loading-detail');
const buttons = ['previous', 'next', 'cover', 'open-book', 'fullscreen', 'reset'];
const PAGE_WIDTH = 1.35;
const PAGE_HEIGHT = 2;
const SEGMENTS_X = 36;
const SEGMENTS_Y = 10;
const paperColor = 0xe7ddc6;
let renderer, scene, camera, book, observer;
let sheets = [];
let textures = [];
let turnCount = 0;
let activeTurn = null;
let pointer = null;
let cameraX = 0;
let cameraY = 0;
let zoom = 1;
let disposed = false;
let raf = 0;
let openRequested = false;
$('hero-open').addEventListener('click', () => {
  if (!sheets.length) openRequested = true;
  else if (turnCount === 0 && !activeTurn) startTurn(1);
});

function showError(message) {
  loading.classList.add('error');
  loading.querySelector('strong').textContent = 'THE ARCHIVE IS UNAVAILABLE';
  loadingDetail.textContent = message;
  for (const id of buttons) $(id).disabled = true;
  $('zoom').disabled = true;
}

function loadScan(url) {
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(url, (texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      textures.push(texture);
      resolve({ texture, aspect: texture.image.width / texture.image.height });
    }, undefined, () => reject(new Error(`Could not load ${decodeURIComponent(url.split('/').pop())}.`)));
  });
}

// Each side has a paper surface plus a separately fitted original image surface.
// This preserves the scan's aspect ratio without cropping or modifying its pixels.
function makeSurface(back, image, isCover) {
  const geometry = new THREE.BufferGeometry();
  const coords = [], uvs = [], indices = [];
  let xMin = 0, xMax = 1, yMin = 0, yMax = 1;
  if (image) {
    const aspect = PAGE_WIDTH / PAGE_HEIGHT;
    if (image.aspect < aspect) {
      const fraction = image.aspect / aspect;
      xMin = (1 - fraction) / 2; xMax = 1 - xMin;
    } else {
      const fraction = aspect / image.aspect;
      yMin = (1 - fraction) / 2; yMax = 1 - yMin;
    }
  }
  for (let y = 0; y <= SEGMENTS_Y; y++) {
    for (let x = 0; x <= SEGMENTS_X; x++) {
      const u = x / SEGMENTS_X, v = y / SEGMENTS_Y;
      coords.push(xMin + u * (xMax - xMin), yMin + v * (yMax - yMin));
      uvs.push(back ? 1 - u : u, v);
    }
  }
  for (let y = 0; y < SEGMENTS_Y; y++) {
    for (let x = 0; x < SEGMENTS_X; x++) {
      const a = y * (SEGMENTS_X + 1) + x, b = a + 1, d = a + SEGMENTS_X + 1, c = d + 1;
      if (back) indices.push(a, c, b, a, d, c);
      else indices.push(a, b, c, a, c, d);
    }
  }
  geometry.setIndex(indices);
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(coords.length / 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const material = image
    ? new THREE.MeshBasicMaterial({ map: image.texture, side: THREE.FrontSide })
    : new THREE.MeshStandardMaterial({ color: isCover ? 0xaaa18b : paperColor, roughness: 1, side: THREE.FrontSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.castShadow = !image;
  mesh.receiveShadow = !image;
  return { mesh, coords, back, image: !!image };
}

function createSheet(front, back, cover = false) {
  const surfaces = [makeSurface(false, null, cover), makeSurface(true, null, cover)];
  if (front) surfaces.push(makeSurface(false, front, cover));
  if (back) surfaces.push(makeSurface(true, back, cover));
  // Join the two faces with a narrow, flexible paper edge.
  const edgeGeometry = new THREE.BufferGeometry();
  const edgeCoords = [], edgeSides = [], edgeIndices = [];
  function edge(points) {
    const start = edgeCoords.length / 2;
    points.forEach(([u, v]) => { edgeCoords.push(u, v, u, v); edgeSides.push(1, -1); });
    for (let i = 0; i < points.length - 1; i++) {
      const a = start + i * 2;
      edgeIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  edge(Array.from({ length: SEGMENTS_X + 1 }, (_, i) => [i / SEGMENTS_X, 0]));
  edge(Array.from({ length: SEGMENTS_X + 1 }, (_, i) => [i / SEGMENTS_X, 1]));
  edge(Array.from({ length: SEGMENTS_Y + 1 }, (_, i) => [1, i / SEGMENTS_Y]));
  edgeGeometry.setIndex(edgeIndices);
  edgeGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(edgeSides.length * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const edgeMesh = new THREE.Mesh(edgeGeometry, new THREE.MeshStandardMaterial({ color: cover ? 0xaaa18b : 0xd5c8ae, roughness: 1, side: THREE.DoubleSide }));
  edgeMesh.frustumCulled = false;
  surfaces.push({ mesh: edgeMesh, coords: edgeCoords, edgeSides, image: false });
  const group = new THREE.Group();
  for (const surface of surfaces) group.add(surface.mesh);
  book.add(group);
  return { surfaces, group, cover };
}

function shapeSheet(sheet, progress, z, corner = 0) {
  const theta = progress * Math.PI;
  const flex = Math.sin(theta);
  for (const surface of sheet.surfaces) {
    const positions = surface.mesh.geometry.attributes.position;
    for (let i = 0; i < surface.coords.length / 2; i++) {
      const u = surface.coords[i * 2], v = surface.coords[i * 2 + 1];
      const halfThickness = sheet.cover ? .003 : .0025;
      const offset = (surface.edgeSides ? surface.edgeSides[i] : surface.back ? -1 : 1) * (halfThickness + (surface.image ? .0012 : 0));
      // Vary the turning angle along the page and across its height: the free
      // edge leads the binding, making a genuine curved, corner-sensitive mesh.
      const angle = theta + Math.sin(Math.PI * u) * flex * (sheet.cover ? .18 : .48) + corner * (v - .5) * u * flex * .22;
      const radius = PAGE_WIDTH * u;
      const bindingCurve = .025 * (1 - Math.exp(-u * 12));
      positions.setXYZ(i,
        radius * Math.cos(angle) - offset * Math.sin(angle),
        (v - .5) * PAGE_HEIGHT + corner * flex * u * .045,
        z + radius * Math.sin(angle) + bindingCurve + Math.sin(Math.PI * u) * flex * .10 + offset * Math.cos(angle));
    }
    positions.needsUpdate = true;
    if (!surface.image) surface.mesh.geometry.computeVertexNormals();
  }
}

function layoutSheets() {
  sheets.forEach((sheet, i) => {
    if (activeTurn && i === activeTurn.index) {
      shapeSheet(sheet, activeTurn.progress, .12, activeTurn.corner || 0);
    } else {
      const turned = i < turnCount;
      shapeSheet(sheet, turned ? 1 : 0, turned ? i * .004 : (sheets.length - i) * .004);
    }
  });
}

function updateUI() {
  const total = scanEntries.length;
  const maxTurns = Math.floor(total / 2);
  let label = 'COVER', visiblePage = 1;
  if (turnCount > 0) {
    const left = turnCount * 2;
    const right = left + 1;
    label = right <= total ? `PAGES ${String(left).padStart(2, '0')}–${String(right).padStart(2, '0')}` : `PAGE ${String(left).padStart(2, '0')}`;
    visiblePage = Math.min(right, total);
  }
  $('page-label').textContent = label;
  $('page-count').textContent = `${visiblePage} / ${total}`;
  $('progress').style.width = `${visiblePage / total * 100}%`;
  $('previous').disabled = turnCount === 0 || !!activeTurn;
  $('next').disabled = turnCount >= maxTurns || !!activeTurn;
  $('cover').disabled = turnCount === 0 || !!activeTurn;
  $('open-book').disabled = maxTurns === 0 || turnCount === 1 || !!activeTurn;
}

function startTurn(direction, manual = false, corner = 0) {
  if (activeTurn || (direction > 0 && turnCount >= Math.floor(scanEntries.length / 2)) || (direction < 0 && turnCount <= 0)) return false;
  activeTurn = { direction, index: direction > 0 ? turnCount : turnCount - 1, progress: direction > 0 ? 0 : 1, corner, manual, start: 0, target: direction > 0 ? 1 : 0 };
  if (!manual) animateTurn(activeTurn.target);
  updateUI();
  return true;
}

function animateTurn(target) {
  if (!activeTurn) return;
  activeTurn.manual = false;
  activeTurn.start = activeTurn.progress;
  activeTurn.target = target;
  activeTurn.started = performance.now();
  activeTurn.duration = Math.max(150, 650 * Math.abs(target - activeTurn.start));
}

function finishTurn() {
  if (activeTurn.target === 1 && activeTurn.direction > 0) turnCount++;
  if (activeTurn.target === 0 && activeTurn.direction < 0) turnCount--;
  activeTurn = null;
  layoutSheets();
  updateUI();
}

function resize() {
  if (!renderer) return;
  const width = stage.clientWidth, height = stage.clientHeight;
  if (!width || !height) return;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  // Fit the whole two-page spread, including on narrow screens.
  const visibleHeight = Math.max(2.65, 3.35 / camera.aspect);
  camera.left = -visibleHeight * camera.aspect / 2;
  camera.right = visibleHeight * camera.aspect / 2;
  camera.top = visibleHeight / 2; camera.bottom = -visibleHeight / 2;
  camera.zoom = zoom; camera.updateProjectionMatrix();
}

function render(time) {
  if (disposed) return;
  if (activeTurn && !activeTurn.manual) {
    const t = Math.min(1, (time - activeTurn.started) / activeTurn.duration);
    const eased = t * t * (3 - 2 * t);
    activeTurn.progress = THREE.MathUtils.lerp(activeTurn.start, activeTurn.target, eased);
    shapeSheet(sheets[activeTurn.index], activeTurn.progress, .12, activeTurn.corner || 0);
    if (t >= 1) finishTurn();
  }
  camera.position.set(cameraX, cameraY, 6);
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
  raf = requestAnimationFrame(render);
}

function getBookPoint(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
  const raycaster = new THREE.Raycaster(); raycaster.setFromCamera(mouse, camera);
  const point = new THREE.Vector3();
  return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -.1), point) ? point : null;
}

function setupInteractions() {
  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', (event) => {
    if (pointer || activeTurn || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const point = getBookPoint(event);
    if (!point) return;
    const withinBook = Math.abs(point.x) < PAGE_WIDTH + .15 && Math.abs(point.y) < PAGE_HEIGHT / 2 + .2;
    const edge = withinBook && Math.abs(point.x) > PAGE_WIDTH * .55;
    const direction = point.x > 0 ? 1 : -1;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, point, mode: 'rotate', moved: false, cameraX, cameraY };
    if (edge && startTurn(direction, true, Math.sign(point.y))) pointer.mode = 'turn';
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    if (Math.hypot(dx, dy) > 5) pointer.moved = true;
    if (pointer.mode === 'turn' && activeTurn) {
      const point = getBookPoint(event);
      if (point) {
        const distance = (pointer.point.x - point.x) / (PAGE_WIDTH * 2);
        activeTurn.progress = THREE.MathUtils.clamp(activeTurn.direction > 0 ? distance : 1 + distance, 0, 1);
        shapeSheet(sheets[activeTurn.index], activeTurn.progress, .12, activeTurn.corner || 0);
      }
    } else {
      cameraX = THREE.MathUtils.clamp(pointer.cameraX - dx * .004, -.8, .8);
      cameraY = THREE.MathUtils.clamp(pointer.cameraY + dy * .004, -.55, .55);
    }
  });
  function release(event, canceled = false) {
    if (!pointer || pointer.id !== event.pointerId) return;
    if (pointer.mode === 'turn' && activeTurn) {
      const target = canceled ? (activeTurn.direction > 0 ? 0 : 1) : !pointer.moved ? (activeTurn.direction > 0 ? 1 : 0) : (activeTurn.progress > .5 ? 1 : 0);
      animateTurn(target);
    } else if (!canceled && event.pointerType !== 'mouse' && pointer.moved && Math.abs(event.clientX - pointer.x) > 55 && Math.abs(event.clientX - pointer.x) > Math.abs(event.clientY - pointer.y) * 1.3) {
      startTurn(event.clientX < pointer.x ? 1 : -1);
    }
    pointer = null;
  }
  canvas.addEventListener('pointerup', (event) => release(event));
  canvas.addEventListener('pointercancel', (event) => release(event, true));
  $('previous').addEventListener('click', () => startTurn(-1));
  $('next').addEventListener('click', () => startTurn(1));
  $('cover').addEventListener('click', () => { if (!activeTurn) { turnCount = 0; layoutSheets(); updateUI(); } });
  $('open-book').addEventListener('click', () => { if (!activeTurn) { if (turnCount === 0) startTurn(1); else { turnCount = 1; layoutSheets(); updateUI(); } } });
  $('zoom').addEventListener('input', (event) => { zoom = Number(event.target.value); resize(); });
  $('reset').addEventListener('click', () => { cameraX = 0; cameraY = 0; zoom = 1; $('zoom').value = '1'; resize(); });
  $('fullscreen').addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('reader-shell').requestFullscreen(); }
    catch { loadingDetail.textContent = 'Fullscreen is not available in this browser.'; }
  });
  document.addEventListener('fullscreenchange', () => {
    $('fullscreen').innerHTML = document.fullscreenElement ? 'EXIT FULLSCREEN <span>↙</span>' : 'FULLSCREEN <span>↗</span>';
    $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen');
    resize();
  });
  document.addEventListener('keydown', (event) => {
    if (event.altKey || event.ctrlKey || event.metaKey || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) return;
    const rect = $('reader-shell').getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > innerHeight) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); startTurn(event.key === 'ArrowRight' ? 1 : -1); }
  });
}

async function init() {
  if (!scanEntries.length) { showError('No JPG scans were found in the comic image folder. Add scans and rebuild the site.'); return; }
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    stage.prepend(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-2, 2, 2, -2, .1, 50);
    camera.position.set(0, 0, 6);
    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const light = new THREE.DirectionalLight(0xffeed6, 2);
    light.position.set(-3, 5, 6); light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024); light.shadow.camera.left = -4; light.shadow.camera.right = 4; light.shadow.camera.top = 4; light.shadow.camera.bottom = -4;
    scene.add(light);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: .24 }));
    ground.position.z = -.09; ground.receiveShadow = true; scene.add(ground);
    book = new THREE.Group(); scene.add(book);
    const spine = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, PAGE_HEIGHT + .03, 12), new THREE.MeshStandardMaterial({ color: 0xb5a98e, roughness: 1 }));
    spine.position.z = .025; book.add(spine);
    const scans = new Array(scanEntries.length);
    let completed = 0;
    // A small loading pool avoids decoding all large scans simultaneously.
    let next = 0;
    async function worker() {
      while (next < scanEntries.length) {
        const i = next++;
        scans[i] = await loadScan(scanEntries[i][1]);
        completed++;
        loadingDetail.textContent = `Preparing scan ${completed} of ${scanEntries.length}…`;
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, scanEntries.length) }, worker));
    // The first supplied scan is the front cover; no extra cover art is added.
    for (let i = 0; i < scans.length; i += 2) sheets.push(createSheet(scans[i], scans[i + 1] || null, i === 0));
    layoutSheets(); updateUI(); setupInteractions();
    observer = new ResizeObserver(resize); observer.observe(stage); resize();
    loading.hidden = true;
    raf = requestAnimationFrame(render);
    if (openRequested) startTurn(1);
  } catch (error) {
    console.error('Unable to prepare the comic:', error);
    showError(`${error.message || 'WebGL could not be initialized.'} Please check the files and browser support.`);
  }
}

window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  disposed = true; cancelAnimationFrame(raf); observer?.disconnect();
  scene?.traverse((object) => {
    object.geometry?.dispose();
    if (Array.isArray(object.material)) object.material.forEach((material) => material.dispose());
    else object.material?.dispose();
  });
  textures.forEach((texture) => texture.dispose());
  renderer?.dispose();
}, { once: true });

init();