import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canRetry,
  copyCapture as copyThroughGate,
} from "../../renderer/src/library/copy-gate";
import { DraftStore } from "../../renderer/src/library/drafts";
import type { CopyRequest } from "../../shared/copy";
import { newCopyTicket } from "../../shared/copy";
import type { MutationOutcome } from "../../shared/dto";
import { DraftIdSchema, ViewIdSchema } from "../../shared/ids";
import { SETTLE_MS } from "../../shared/leave";
import type { DraftText } from "../../shared/text";
import type { Clip } from "./copy";
import { copyCapture, CopyStarts } from "./copy";
import { failingWrites, heldWrites, nodeStoreFs, slowWrites } from "./fs";
import { formatEntry } from "./note";
import type { CaptureRecord } from "./schema";
import { CaptureStore } from "./store";

const ID = DraftIdSchema.parse("6f1c2b52-3d4e-4f60-8a71-92b3c4d5e6f7");
const OTHER = DraftIdSchema.parse("6f1c2b52-3d4e-4f60-8a71-92b3c4d5e6f8");
const VIEW = ViewIdSchema.parse("0a000000-0000-4000-8000-000000000001");

const record: CaptureRecord = {
  createdAt: "2026-11-05T09:00:00.000Z",
  description: "Old description",
  due: null,
  id: ID,
  relationship: "Old title",
  schemaVersion: 5,
  status: { kind: "active" },
  todos: [],
  updatedAt: "2026-11-05T09:00:00.000Z",
  views: [
    {
      acquisition: { kind: "direct", windowKeyAtCapture: "macos:1" },
      appName: "Numbers",
      capturedAt: "2026-11-05T08:59:00.000Z",
      description: "OLD WINDOW DESCRIPTION",
      height: 10,
      id: VIEW,
      origin: null,
      sampledAt: "2026-11-05T08:59:00.000Z",
      title: "Budget",
      width: 10,
    },
  ],
};

const stored: DraftText = {
  description: record.description,
  due: null,
  relationship: record.relationship,
  todos: [],
  viewDescriptions: { [VIEW]: "OLD WINDOW DESCRIPTION" },
};

/**
 * What the copies do: the page's gate waits for the words on screen to be saved, then main copies
 * them. The writes are slowed, as a busy disk would, so a copy that did not wait would read old
 * text. `hold()` keeps the next text saves waiting until `release()` answers them, so a test can
 * type, switch captures or copy while a save is on its way.
 */
const setup = async () => {
  const root = path.join(
    await mkdtemp(path.join(tmpdir(), "iwl-copy-")),
    "captures"
  );

  let failing = false;

  // A held write fails as it is let go when the disk filled meanwhile.
  const disk = heldWrites(
    failingWrites(slowWrites(nodeStoreFs, 30), () => failing)
  );

  const store = await CaptureStore.open(root, disk.fs);

  await store.publish({
    images: new Map([[VIEW, new Uint8Array([1])]]),
    record,
  });
  await store.publish({
    images: new Map([[VIEW, new Uint8Array([2])]]),
    record: { ...record, id: OTHER, relationship: "Other capture" },
  });

  const held: (() => void)[] = [];
  let holding = false;

  const drafts = new DraftStore(() => ({
    discard: (id, rev) => store.discard(id, rev),
    setTodoDone: (id, todoId, done, rev) =>
      store.setTodoDone(id, todoId, done, rev),
    updateText: async (id, text, rev): Promise<MutationOutcome> => {
      if (holding) {
        const { promise, resolve } = Promise.withResolvers<undefined>();

        held.push(() => resolve(undefined));
        await promise;
      }

      return store.updateText(id, text, new Date(), rev);
    },
  }));

  /** The clipboard main writes, as plain text or as "PNG <bytes>" for an image. */
  const clipboard: string[] = [];
  const starts = new CopyStarts(store);

  /** What the page's copy gate does, against the real store and main's copy. */
  const gate = (request: CopyRequest, id = ID) =>
    copyThroughGate(
      id,
      request,
      {
        beginCopy: (ticket, captureId) => starts.begin(ticket, captureId),
        copy: (ticket, captureId, asked, text) =>
          copyCapture(
            store,
            starts,
            ticket,
            captureId,
            asked,
            text,
            (clip: Clip) => {
              clipboard.push(
                clip.kind === "text" ? clip.text : `PNG ${clip.png.join(",")}`
              );

              return Promise.resolve();
            },
            { locale: "en-GB", timeZone: "UTC" }
          ),
      },
      drafts
    );

  /** Copy as text through the gate; what landed on the clipboard, or "" when nothing did. */
  const copy = async () => {
    await gate({ kind: "note" });

    return clipboard.at(-1) ?? "";
  };

  const storedEntry = (id = ID) => {
    const entry = store.get(id);

    return entry?.kind === "current" ? formatEntry(entry.record) : "";
  };

  /** Types into capture `id`, as its page does. */
  const type = (text: DraftText, id = ID) =>
    drafts.edit(id, text, drafts.shown(id, stored));

  /** Picks a due date for capture `id`, as its page or its row's menu does. */
  const pickDue = (due: DraftText["due"], id = ID) =>
    drafts.setDue(id, due, stored);

  return {
    clipboard,
    copy,
    disk,
    drafts,
    gate,
    pickDue,
    store,
    hold: () => {
      holding = true;
    },
    release: () => {
      holding = false;

      for (const resolve of held.splice(0)) {
        resolve();
      }
    },
    setFailing: (on: boolean) => {
      failing = on;
    },
    storedEntry,
    type,
  };
};

/** Waits, a few milliseconds at a time, until `done` holds. */
const until = async (done: () => boolean, left = 400): Promise<void> => {
  if (done() || left === 0) {
    return;
  }

  await sleep(5);
  await until(done, left - 1);
};

describe("Copy as Text after an edit", () => {
  it("copies a window description typed a moment ago, before its autosave", async () => {
    const { copy, type } = await setup();

    type({ ...stored, viewDescriptions: { [VIEW]: "NEW WINDOW DESCRIPTION" } });

    const text = await copy();

    expect([
      text.includes("NEW WINDOW DESCRIPTION"),
      text.includes("OLD"),
    ]).toStrictEqual([true, false]);
  });

  it("copies the title and description right after the field was left", async () => {
    const { copy, drafts, type } = await setup();

    type({
      ...stored,
      description: "New description",
      relationship: "New title",
    });
    drafts.flush(ID);

    const text = await copy();

    expect(text.split("\n").slice(0, 3)).toStrictEqual([
      "New title",
      "",
      "New description",
    ]);
  });

  it("copies nothing when the words on screen could not be saved, and says why", async () => {
    const { clipboard, drafts, gate, setFailing, type } = await setup();

    setFailing(true);
    type({ ...stored, description: "NEW UNSAVED WORDS" });

    const result = await gate({ kind: "note" });

    expect({
      clipboard,
      result,
      shown: drafts.shown(ID, stored).description,
    }).toStrictEqual({
      clipboard: [],
      result: {
        kind: "notSaved",
        outcome: { kind: "failed", message: "The disk is full." },
      },
      shown: "NEW UNSAVED WORDS",
    });
  });

  it("copies the new words once Retry saves them", async () => {
    const { clipboard, drafts, gate, setFailing, type } = await setup();

    setFailing(true);
    type({ ...stored, description: "Second try" });
    await gate({ kind: "note" });
    setFailing(false);
    drafts.retry(ID);

    const result = await gate({ kind: "note" });

    expect([
      result.kind,
      clipboard.map((note) => note.includes("Second try")),
    ]).toStrictEqual(["copied", [true]]);
  });
});

/** ⌘C, from a row or the page: the same wait, then main copies the title and description. */
describe("Copy (⌘C) after an edit", () => {
  it("copies the title still being typed, not the one the list last showed", async () => {
    const { clipboard, gate, type } = await setup();

    type({ ...stored, relationship: "NEW TITLE" });

    const result = await gate({ kind: "entry" });

    expect([result.kind, clipboard]).toStrictEqual([
      "copied",
      ["NEW TITLE\n\nOld description"],
    ]);
  });

  it("copies nothing when the title on screen could not be saved", async () => {
    const { clipboard, drafts, gate, setFailing, storedEntry, type } =
      await setup();

    setFailing(true);
    type({ ...stored, relationship: "NEW UNSAVED TITLE" });
    drafts.flush(ID);
    await until(() => drafts.draft(ID)?.kind === "failed");

    const result = await gate({ kind: "entry" });

    expect({
      clipboard,
      result: result.kind,
      shown: drafts.shown(ID, stored).relationship,
      stored: storedEntry(),
    }).toStrictEqual({
      clipboard: [],
      result: "notSaved",
      shown: "NEW UNSAVED TITLE",
      stored: "Old title\n\nOld description",
    });
  });

  it("copies nothing, and returns at once, while the title is blank", async () => {
    const { clipboard, gate, type } = await setup();

    type({ ...stored, relationship: "  " });

    const result = await gate({ kind: "entry" });

    expect([result.kind, clipboard]).toStrictEqual(["untitled", []]);
  });
});

/** The image buttons go through the same gate as the text copies. */
describe("Copy image after an edit", () => {
  it("copies the window's image once the edits are saved", async () => {
    const { clipboard, gate, type } = await setup();

    type({ ...stored, relationship: "New title" });

    const result = await gate({ kind: "image", viewId: VIEW });

    expect([result.kind, clipboard]).toStrictEqual(["copied", ["PNG 1"]]);
  });

  it("copies nothing, by any copy, while the words on screen could not be saved", async () => {
    const { clipboard, gate, setFailing, type } = await setup();

    setFailing(true);
    type({ ...stored, relationship: "NEW UNSAVED TITLE" });

    const results = [
      await gate({ kind: "entry" }),
      await gate({ kind: "note" }),
      await gate({ kind: "image", viewId: VIEW }),
    ];

    expect([results.map((result) => result.kind), clipboard]).toStrictEqual([
      ["notSaved", "notSaved", "notSaved"],
      [],
    ]);
  });
});

/** Each copy copies the words as they were when it started, with a save held on its way to disk. */
describe("A copy during a held save", () => {
  it("copies the words from when it started, though more are typed and saved during the wait", async () => {
    const { clipboard, drafts, gate, hold, release, storedEntry, type } =
      await setup();

    hold();
    type({ ...stored, relationship: "FIRST" });

    const copying = gate({ kind: "entry" });

    type({ ...stored, relationship: "FIRST AND SECOND" });
    // Sent the moment the first save answers, so it is on disk before main copies.
    drafts.flush(ID);
    release();

    const result = await copying;

    await until(() => drafts.draft(ID) === undefined);

    expect([result.kind, clipboard, storedEntry()]).toStrictEqual([
      "copied",
      ["FIRST\n\nOld description"],
      "FIRST AND SECOND\n\nOld description",
    ]);
  });

  it("waits for a capture just left, while another capture copies at once", async () => {
    const { clipboard, drafts, gate, hold, release, type } = await setup();

    hold();
    type({ ...stored, relationship: "TYPED IN A" });
    // Opening B leaves A: its words go out, and stay in the store while they are on their way.
    drafts.flush(ID);

    const copyB = await gate({ kind: "entry" }, OTHER);
    const copyingA = gate({ kind: "entry" });

    release();

    const copyA = await copyingA;

    expect([copyB.kind, copyA.kind, clipboard]).toStrictEqual([
      "copied",
      "copied",
      ["Other capture\n\nOld description", "TYPED IN A\n\nOld description"],
    ]);
  });

  it("refuses a capture left after its save failed, even long after, and keeps its words", async () => {
    const { clipboard, drafts, gate, setFailing, storedEntry, type } =
      await setup();

    setFailing(true);
    type({ ...stored, relationship: "NEW UNSAVED TITLE" });
    drafts.flush(ID);
    await until(() => drafts.draft(ID)?.kind === "failed");
    // The disk has room again, but nothing has sent the words since.
    setFailing(false);
    await sleep(100);

    const fromRow = await gate({ kind: "entry" });
    const reopened = drafts.shown(ID, stored).relationship;

    drafts.retry(ID);
    await until(() => drafts.draft(ID) === undefined);

    const afterRetry = await gate({ kind: "entry" });

    expect({
      afterRetry: afterRetry.kind,
      clipboard,
      fromRow: fromRow.kind,
      reopened,
      stored: storedEntry(),
    }).toStrictEqual({
      afterRetry: "copied",
      clipboard: ["NEW UNSAVED TITLE\n\nOld description"],
      fromRow: "notSaved",
      reopened: "NEW UNSAVED TITLE",
      stored: "NEW UNSAVED TITLE\n\nOld description",
    });
  });

  it("refuses a copy waiting on words whose save fails", async () => {
    const { clipboard, gate, hold, release, setFailing, type } = await setup();

    hold();
    type({ ...stored, relationship: "WILL FAIL" });

    const copying = gate({ kind: "entry" });

    setFailing(true);
    release();

    const result = await copying;

    expect([result.kind, clipboard]).toStrictEqual(["notSaved", []]);
  });
});

/** The due date goes with the words, in the capture's draft, so a copy takes it as it was when it started. */
describe("The due date in a copy", () => {
  it("is the one from when the copy began, though Due changes during the held save", async () => {
    const { clipboard, drafts, gate, hold, pickDue, release, store, type } =
      await setup();

    pickDue("2026-11-06");
    await store.idle();
    await until(() => drafts.count === 0);
    hold();
    type({ ...drafts.shown(ID, stored), relationship: "FIRST" });

    const copying = gate({ kind: "note" });

    pickDue("2026-12-20");
    release();

    expect([await copying, clipboard]).toStrictEqual([
      { kind: "copied" },
      [
        [
          "FIRST",
          "",
          "Old description",
          "",
          "Due: Friday, 6 November 2026",
          "",
          "Windows:",
          "1. Budget (Numbers), captured 5 Nov 2026, 08:59",
          "   OLD WINDOW DESCRIPTION",
        ].join("\n"),
      ],
    ]);
  });

  it("is one picked a moment before the copy, still being written, and not one picked after it began", async () => {
    const { clipboard, gate, pickDue, store } = await setup();

    pickDue("2026-11-09");

    const copying = gate({ kind: "note" });

    pickDue("2026-12-20");

    const result = await copying;

    await store.idle();

    expect([
      result,
      clipboard.map((note) =>
        note.split("\n").find((line) => line.startsWith("Due:"))
      ),
    ]).toStrictEqual([{ kind: "copied" }, ["Due: Monday, 9 November 2026"]]);
  });

  it("refuses while a Due that can't be written stays unsaved, and copies it once Retry saves it", async () => {
    const { clipboard, disk, drafts, gate, pickDue, setFailing } =
      await setup();

    disk.hold();
    pickDue("2026-12-20");
    await until(() => disk.waiting() > 0);

    const copying = gate({ kind: "note" });

    setFailing(true);
    disk.release();

    const first = await copying;

    const failed = {
      due: drafts.shown(ID, stored).due,
      error: drafts.error(ID),
      unsaved: drafts.count,
    };

    const again = await gate({ kind: "note" });

    setFailing(false);

    const retried = await drafts.retry(ID);
    const copied = await gate({ kind: "note" });

    expect({
      again: again.kind,
      clipboard: clipboard.map((note) =>
        note.split("\n").find((line) => line.startsWith("Due:"))
      ),
      copied,
      failed,
      first,
      retried,
      retry: canRetry(first),
    }).toStrictEqual({
      again: "notSaved",
      clipboard: ["Due: Sunday, 20 December 2026"],
      copied: { kind: "copied" },
      failed: {
        due: "2026-12-20",
        error: { kind: "failed", message: "The disk is full." },
        unsaved: 1,
      },
      first: {
        kind: "notSaved",
        outcome: { kind: "failed", message: "The disk is full." },
      },
      retried: { kind: "ok" },
      retry: true,
    });
  });

  it("goes back to the saved Due when a failed one is discarded, and copies that", async () => {
    const { clipboard, drafts, gate, pickDue, setFailing } = await setup();

    setFailing(true);
    pickDue("2026-12-20");
    await until(() => drafts.error(ID) !== undefined);
    setFailing(false);
    drafts.discard(ID);

    const result = await gate({ kind: "note" });

    expect([
      drafts.shown(ID, stored).due,
      result,
      clipboard.map((note) =>
        note.split("\n").find((line) => line.startsWith("Due:"))
      ),
    ]).toStrictEqual([null, { kind: "copied" }, [undefined]]);
  });
});

describe("A copy behind a write that hangs", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("is refused once SETTLE_MS pass, with Retry, and never copies when the write lands later", async () => {
    const { clipboard, disk, gate, store } = await setup();

    disk.hold();

    // A write sent before the copy, such as Mark as done, that the disk holds.
    const picking = store.setStatus(ID, {
      at: "2026-11-05T10:00:00.000Z",
      kind: "done",
    });

    await until(() => disk.waiting() > 0);
    vi.useFakeTimers();

    const copying = gate({ kind: "note" });

    const now = () =>
      Promise.race([copying, Promise.resolve("still waiting" as const)]);

    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);

    const before = await now();

    await vi.advanceTimersByTimeAsync(1);

    const result = await now();

    vi.useRealTimers();
    disk.release();
    await picking;
    await store.idle();
    await sleep(20);

    expect({
      before,
      clipboard,
      result,
      retry: result === "still waiting" ? false : canRetry(result),
    }).toStrictEqual({
      before: "still waiting",
      clipboard: [],
      result: {
        kind: "notSaved",
        outcome: { kind: "failed", message: "Saving didn’t finish in time." },
      },
      retry: true,
    });
  });
});

describe("Main's copy", () => {
  it("reports a capture that is gone instead of saying it copied", async () => {
    const { clipboard } = await setup();

    const root = path.join(
      await mkdtemp(path.join(tmpdir(), "iwl-copy-empty-")),
      "captures"
    );

    const empty = await CaptureStore.open(root, nodeStoreFs);
    const starts = new CopyStarts(empty);
    const ticket = newCopyTicket();

    starts.begin(ticket, ID);

    const outcome = await copyCapture(
      empty,
      starts,
      ticket,
      ID,
      { kind: "entry" },
      null,
      (clip) => {
        clipboard.push(clip.kind);

        return Promise.resolve();
      },
      { locale: "en-GB", timeZone: "UTC" }
    );

    expect([outcome, clipboard]).toStrictEqual([{ kind: "missing" }, []]);
  });

  it("copies nothing for a copy it never saw begin, or one begun for another capture", async () => {
    const { clipboard, store } = await setup();
    const starts = new CopyStarts(store);
    const ticket = newCopyTicket();

    starts.begin(ticket, OTHER);

    const write = (clip: Clip) => {
      clipboard.push(clip.kind);

      return Promise.resolve();
    };

    const place = { locale: "en-GB", timeZone: "UTC" };

    expect([
      await copyCapture(
        store,
        starts,
        ticket,
        ID,
        { kind: "entry" },
        null,
        write,
        place
      ),
      await copyCapture(
        store,
        starts,
        newCopyTicket(),
        ID,
        { kind: "entry" },
        null,
        write,
        place
      ),
      clipboard,
    ]).toStrictEqual([
      { kind: "failed", message: "Couldn’t copy. Try again." },
      { kind: "failed", message: "Couldn’t copy. Try again." },
      [],
    ]);
  });
});
