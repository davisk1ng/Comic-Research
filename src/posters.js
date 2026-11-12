// Vite rewrites image sources for production; use those same URLs for the links.
document.querySelectorAll('.poster-item a').forEach((link) => {
  const image = link.querySelector('img');
  if (image) link.href = image.src;
});