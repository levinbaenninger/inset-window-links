// Rasterizes build/icon.svg with Electron's own renderer, so the icon needs no image tooling.
// build/icon.png feeds electron-builder, and main imports it as a runtime asset.
// Run with: pnpm icon
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { app, BrowserWindow } from "electron";

const root = path.resolve(import.meta.dirname, "..");
const SIZE = 1024;

const render = async (svg) => {
  const win = new BrowserWindow({
    backgroundColor: "#00000000",
    frame: false,
    height: SIZE,
    show: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
    width: SIZE,
  });

  const sized = svg.replace("<svg ", `<svg width="${SIZE}" height="${SIZE}" `);
  const html = `<html><body style="margin:0;background:transparent">${sized}</body></html>`;

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

  // The first offscreen paints can be blank, so give the SVG a moment to render.
  await sleep(500);

  const image = await win.webContents.capturePage();

  win.destroy();

  return image.toPNG();
};

app.disableHardwareAcceleration();

const run = async () => {
  try {
    await app.whenReady();

    const svg = await readFile(path.join(root, "build/icon.svg"), "utf-8");

    await writeFile(path.join(root, "build/icon.png"), await render(svg));
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
};

// Not awaited: Electron emits ready only after the main module finishes evaluating.
void run();
