import { readFile } from "node:fs/promises";

import type { CopyOutcome, CopyRequest, CopyTicket } from "../../shared/copy";
import { copyProblem } from "../../shared/errors";
import type { CaptureId } from "../../shared/ids";
import { SAVE_LATE, SETTLE_MS } from "../../shared/leave";
import type { DraftText } from "../../shared/text";
import { formatEntry, formatNote } from "./note";
import type { CaptureRecord } from "./schema";
import type { CaptureStore, Snapshot } from "./store";
import { withText } from "./store";

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

/** A page that starts copies it never finishes, when a save fails meanwhile, keeps no more than this. */
const KEPT = 32;

interface Begun {
  captureId: CaptureId;
  /** When the copy began, by Date.now(): what it waits for has until SETTLE_MS after. */
  at: number;
  taken: Promise<Snapshot>;
}

/** What the copy began with, or "late" once SETTLE_MS pass after it began without it. */
const inTime = async ({ at, taken }: Begun): Promise<Snapshot | "late"> => {
  const { promise: late, resolve } = Promise.withResolvers<"late">();

  const timer = setTimeout(
    () => resolve("late"),
    Math.max(0, at + SETTLE_MS - Date.now())
  );

  try {
    return await Promise.race([taken, late]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * The captures copies started with, by ticket: each read in the store's write order, so it holds
 * every write sent before the copy began, and none sent after, a due date picked meanwhile too.
 */
export class CopyStarts {
  readonly #store: CaptureStore;
  readonly #begun = new Map<CopyTicket, Begun>();

  constructor(store: CaptureStore) {
    this.#store = store;
  }

  begin(ticket: CopyTicket, captureId: CaptureId): void {
    if (this.#begun.has(ticket)) {
      return;
    }

    const [oldest] = this.#begun.keys();

    if (oldest !== undefined && this.#begun.size >= KEPT) {
      this.#begun.delete(oldest);
    }

    this.#begun.set(ticket, {
      at: Date.now(),
      captureId,
      taken: this.#store.snapshot(captureId),
    });
  }

  /** What the copy began with, once; null for a ticket of another capture or none at all. */
  take(ticket: CopyTicket, captureId: CaptureId): Begun | null {
    const begun = this.#begun.get(ticket);

    this.#begun.delete(ticket);

    return begun?.captureId === captureId ? begun : null;
  }
}

/**
 * Puts a capture on the clipboard as it stood when its copy began. The page asks only after the
 * words it copies were saved, and sends them along: they are copied as sent. Everything else,
 * the due date and the windows, comes from the capture taken at the start, never from a record a
 * later write may have changed since. A write before it that failed, or that hasn't landed
 * SETTLE_MS after the copy began, refuses it as not saved; one landing later is never copied.
 * Ok means the clipboard holds it; anything else means nothing was written.
 */
export const copyCapture = async (
  store: CaptureStore,
  starts: CopyStarts,
  ticket: CopyTicket,
  id: CaptureId,
  request: CopyRequest,
  text: DraftText | null,
  write: (clip: Clip) => Promise<void>,
  place: NotePlace
): Promise<CopyOutcome> => {
  const begun = starts.take(ticket, id);

  if (begun === null) {
    return { kind: "failed", message: "Couldn't copy. Try again." };
  }

  const taken = await inTime(begun);

  if (taken === "late") {
    return { kind: "notSaved", message: SAVE_LATE };
  }

  if (taken.kind === "failed") {
    return { kind: "notSaved", message: taken.message };
  }

  const { entry } = taken;

  if (entry === undefined) {
    return { kind: "missing" };
  }

  if (entry.kind !== "current") {
    return {
      kind: "readOnly",
      version: entry.kind === "unsupported" ? entry.version : 0,
    };
  }

  const record = text === null ? entry.record : withText(entry.record, text);

  try {
    const clip = await clipOf(store, record, request, place);

    if (clip === null) {
      return { kind: "missing" };
    }

    await write(clip);
  } catch (error) {
    return { kind: "failed", message: copyProblem(error) };
  }

  return { kind: "ok" };
};
