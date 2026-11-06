import { readFile } from "node:fs/promises";

import type { CopyRequest } from "../../shared/copy";
import type { MutationOutcome } from "../../shared/dto";
import type { CaptureId } from "../../shared/ids";
import { formatEntry, formatNote } from "./note";
import type { CaptureRecord } from "./schema";
import type { CaptureStore } from "./store";

/** What goes on the clipboard: text, or a window's PNG. */
export type Clip =
  | { kind: "text"; text: string }
  | { kind: "png"; png: Uint8Array<ArrayBuffer> };

/** Where the note's dates are written for. */
export interface NotePlace {
  locale: string;
  timeZone: string;
}

const clipOf = async (
  store: CaptureStore,
  record: CaptureRecord,
  request: CopyRequest,
  place: NotePlace
): Promise<Clip | null> => {
  switch (request.kind) {
    case "entry": {
      return { kind: "text", text: formatEntry(record) };
    }

    case "note": {
      return {
        kind: "text",
        text: formatNote(record, place.locale, place.timeZone),
      };
    }

    default: {
      const file = store.imagePath(record.id, request.viewId);

      return file === null
        ? null
        : { kind: "png", png: new Uint8Array(await readFile(file)) };
    }
  }
};

/**
 * Puts a stored capture on the clipboard once every write queued before it has landed. The page
 * asks only after its own edits were saved. Ok means the clipboard holds it; anything else means
 * nothing was written.
 */
export const copyCapture = async (
  store: CaptureStore,
  id: CaptureId,
  request: CopyRequest,
  write: (clip: Clip) => Promise<void>,
  place: NotePlace
): Promise<MutationOutcome> => {
  await store.idle();

  const entry = store.get(id);

  if (entry === undefined) {
    return { kind: "missing" };
  }

  if (entry.kind !== "current") {
    return {
      kind: "readOnly",
      version: entry.kind === "unsupported" ? entry.version : 0,
    };
  }

  try {
    const clip = await clipOf(store, entry.record, request, place);

    if (clip === null) {
      return { kind: "missing" };
    }

    await write(clip);
  } catch (error) {
    return { kind: "failed", message: String(error) };
  }

  return { kind: "ok" };
};
