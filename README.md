# Batman No. 215 — Visual research

Run `npm install` once, then `npm run dev` and open the local address displayed in the terminal. Use `npm run build` to generate the deployable site in `dist`. Serve that directory with a web server; opening the HTML directly from disk does not support JavaScript modules and asset loading reliably.

## Publish on GitHub Pages

The repository is configured to build and deploy through GitHub Actions. Commit and push the project files, including `.github/workflows/deploy.yml` and the image folders, to the `main` branch. In the GitHub repository, open **Settings → Pages**, and under **Build and deployment**, select **GitHub Actions** as the source. Then open the **Actions** tab and run **Deploy website to GitHub Pages** if it has not already started. After the deployment succeeds, the site will be available at https://davisk1ng.github.io/Comic-Research/.

GitHub Pages is public. Before publishing, make sure you have permission to share the comic scans and other artwork online. The generated `dist` folder does not need to be committed.

The reader automatically discovers JPG and JPEG files directly inside `Batman No. 215 (1940) (JPG)` and sorts their filenames naturally (1, 2, …, 10). The first scan is the front cover, and no extra front or back cover is added. Rebuild after adding or changing scans.

Edit the research copy and archive placeholders in `index.html`. The book's reader logic is in `src/main.js` and the exhibition styling is in `src/style.css`.

Drag a page edge to turn it, or drag the middle to change the view. The arrow keys, buttons, and touchscreen gestures also navigate. Use zoom and reset to adjust the view.