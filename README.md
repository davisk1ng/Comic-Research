# Batman No. 215 — Visual research

Run `npm install` once, then `npm run dev` and open the local address displayed in the terminal. Use `npm run build` to generate the deployable site in `dist`. Serve that directory with a web server; opening the HTML directly from disk does not support JavaScript modules and asset loading reliably.

The reader automatically discovers JPG and JPEG files directly inside `Batman No. 215 (1940) (JPG)` and sorts their filenames naturally (1, 2, …, 10). The first scan is the front cover, and no extra front or back cover is added. Rebuild after adding or changing scans.

Edit the research copy and archive placeholders in `index.html`. The book's reader logic is in `src/main.js` and the exhibition styling is in `src/style.css`.

Drag a page edge to turn it, or drag the middle to change the view. The arrow keys, buttons, and touchscreen gestures also navigate. Use zoom and reset to adjust the view.