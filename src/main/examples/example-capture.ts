import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";

import { BrowserWindow } from "electron";

import type { DraftId } from "../../shared/ids";
import { newViewId } from "../../shared/ids";
import type { KeyPlatform } from "../../shared/shortcuts";
import type { ExampleWindow } from "../links-tutorial";
import { linksExample } from "../links-tutorial";
import { toNewCapture } from "../session/snapshot";
import type { CapturedView, Draft } from "../session/state";
import type { CaptureStore } from "../store/store";
import notesPicture from "./example-notes.svg?asset";
import pagePicture from "./example-page.svg?asset";

const PICTURES = { notes: notesPicture, page: pagePicture } as const;

/** The pictures' size: a window as a Retina screen would capture it, at half the pixels. */
const WIDTH = 1200;
const HEIGHT = 750;

/** The first offscreen paints can be blank, as scripts/render-icon.mjs found. */
const PAINT_MS = 400;

/**
 * Draws a bundled SVG into a PNG with Electron's own renderer, in a window that never shows and
 * runs no script. Null when nothing was drawn.
 */
const renderPicture = async (file: string): Promise<Uint8Array | null> => {
  const svg = await readFile(file, "utf-8");

  const sized = svg.replace(
    "<svg ",
    `<svg width="${WIDTH}" height="${HEIGHT}" `
  );

  const win = new BrowserWindow({
    backgroundColor: "#ffffff",
    frame: false,
    height: HEIGHT,
    show: false,
    useContentSize: true,
    webPreferences: {
      contextIsolation: true,
      javascript: false,
      nodeIntegration: false,
      offscreen: true,
      sandbox: true,
    },
    width: WIDTH,
  });

  try {
    await win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(`<html><body style="margin:0">${sized}</body></html>`)}`
    );
    await sleep(PAINT_MS);

    const image = await win.webContents.capturePage();

    return image.isEmpty() ? null : image.toPNG();
  } finally {
    win.destroy();
  }
};

const exampleView = async (
  window: ExampleWindow,
  now: Date
): Promise<CapturedView | null> => {
  const png = await renderPicture(PICTURES[window.picture]);

  if (png === null) {
    return null;
  }

  return {
    // Not a real window: it was never captured, so it counts as picked by hand with nothing probed.
    acquisition: {
      kind: "fallback",
      reason: "probeUnavailable",
      windowKeyAtCapture: null,
    },
    appName: window.appName,
    boundsDip: null,
    capturedAt: now,
    height: HEIGHT,
    id: newViewId(),
    origin:
      window.url === null
        ? null
        : { appPath: null, bounds: null, document: null, url: window.url },
    png,
    sampledAt: now,
    title: window.title,
    width: WIDTH,
  };
};

/**
 * Saves the first run's example capture under `id`, the way the capture panel saves one: a draft,
 * turned into a record by toNewCapture and published by the store in one rename. So it has the
 * records' own format and goes through the same write as any capture. False when a picture
 * couldn't be drawn or the save failed; the tutorial then simply has no example.
 */
export const saveExampleCapture = async (deps: {
  readonly id: DraftId;
  readonly platform: KeyPlatform;
  readonly store: CaptureStore;
  readonly now: Date;
}): Promise<boolean> => {
  const example = linksExample(deps.platform);
  const views: CapturedView[] = [];

  for (const window of example.windows) {
    // One after another: each picture has its own hidden window.
    // oxlint-disable-next-line no-await-in-loop -- the pictures are drawn one at a time on purpose.
    const view = await exampleView(window, deps.now);

    if (view === null) {
      return false;
    }

    views.push(view);
  }

  const draft: Draft = {
    id: deps.id,
    text: {
      description: example.description,
      due: null,
      relationship: example.title,
      todos: example.steps.map((text, index) => ({
        done: false,
        id: `example-step-${index + 1}`,
        text,
      })),
      viewDescriptions: Object.fromEntries(
        views.map((view, index) => [
          view.id,
          example.windows[index]?.description ?? "",
        ])
      ),
    },
    views,
  };

  const result = await deps.store.publish(toNewCapture(draft, deps.now));

  return result.kind === "published";
};
