import { readFile } from "node:fs/promises";

import type { DraftId } from "../../shared/ids";
import { newViewId } from "../../shared/ids";
import type { KeyPlatform } from "../../shared/shortcuts";
import type { ExampleWindow } from "../links-tutorial";
import { linksExample } from "../links-tutorial";
import { toNewCapture } from "../session/snapshot";
import type { CapturedView, Draft } from "../session/state";
import type { CaptureStore } from "../store/store";
import notesPicture from "./example-notes.png?asset";
import pagePicture from "./example-page.png?asset";

/**
 * The example's pictures, drawn ahead of time from the SVGs beside them (pnpm images). Drawing
 * them at launch failed on a locked Windows screen, and the first run then had no example.
 */
const PICTURES = { notes: notesPicture, page: pagePicture } as const;

/** The pictures' size: a window as a Retina screen would capture it, at half the pixels. */
const WIDTH = 1200;
const HEIGHT = 750;

const exampleView = async (
  window: ExampleWindow,
  now: Date
): Promise<CapturedView> => {
  const png = new Uint8Array(await readFile(PICTURES[window.picture]));

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
 * couldn't be read or the save failed; the tutorial then simply has no example.
 */
export const saveExampleCapture = async (deps: {
  readonly id: DraftId;
  readonly platform: KeyPlatform;
  readonly store: CaptureStore;
  readonly now: Date;
}): Promise<boolean> => {
  const example = linksExample(deps.platform);
  const views: CapturedView[] = [];

  try {
    views.push(
      ...(await Promise.all(
        example.windows.map(
          async (window) => await exampleView(window, deps.now)
        )
      ))
    );
  } catch {
    return false;
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
