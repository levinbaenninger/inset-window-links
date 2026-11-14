// Rasterizes the bundled SVGs with Electron's own renderer, so they need no image tooling:
// - build/icon.png, which feeds electron-builder and which main imports as a runtime asset;
// - the example capture's two pictures, which a first run saves as they are. Drawing them at
//   launch failed on a locked Windows screen, so the app never renders them itself.
// Run with: pnpm images
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { app, BrowserWindow } from "electron";

const root = path.resolve(import.meta.dirname, "..");

const IMAGES = [
  { background: null, height: 1024, source: "build/icon.svg", width: 1024 },
  {
    background: "#ffffff",
    height: 750,
    source: "src/main/examples/example-page.svg",
    width: 1200,
  },
  {
    background: "#ffffff",
    height: 750,
    source: "src/main/examples/example-notes.svg",
    width: 1200,
  },
];

const render = async (svg, { background, height, width }) => {
  const transparent = background === null;

  const win = new BrowserWindow({
    backgroundColor: transparent ? "#00000000" : background,
    frame: false,
    height,
    show: false,
    transparent,
    useContentSize: true,
    webPreferences: { offscreen: true },
    width,
  });

  const sized = svg.replace(
    "<svg ",
    `<svg width="${width}" height="${height}" `
  );

  const html = `<html><body style="margin:0;background:${transparent ? "transparent" : background}">${sized}</body></html>`;

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  // The first offscreen paints can be blank, so give the SVG a moment to render.
  await sleep(500);

  const image = await win.webContents.capturePage();

  win.destroy();

  return image.toPNG();
};

/** One hidden window at a time, each PNG beside its SVG. */
const renderEach = async ([image, ...rest]) => {
  if (image === undefined) {
    return;
  }

  const source = path.join(root, image.source);
  const svg = await readFile(source, "utf-8");

  await writeFile(source.replace(/\.svg$/u, ".png"), await render(svg, image));
  await renderEach(rest);
};

app.disableHardwareAcceleration();

// Each image closes its own window; the app stays until the last one is written.
app.on("window-all-closed", () => {
  // Keep running: run() quits once every image is written.
});

const run = async () => {
  try {
    await app.whenReady();

    await renderEach(IMAGES);
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
};

// Not awaited: Electron emits ready only after the main module finishes evaluating.
void run();
