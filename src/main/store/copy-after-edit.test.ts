import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, onTestFinished } from "vitest";

import {
  copyAfterSaving,
  InlineSaver,
  savePending,
  trackSaver,
} from "../../renderer/src/library/inline-saver";
import { DraftIdSchema, ViewIdSchema } from "../../shared/ids";
import type { DraftText } from "../../shared/text";
import { failingWrites, nodeStoreFs, slowWrites } from "./fs";
import { formatNote } from "./note";
import type { CaptureRecord } from "./schema";
import { CaptureStore } from "./store";

const ID = DraftIdSchema.parse("6f1c2b52-3d4e-4f60-8a71-92b3c4d5e6f7");
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
 * What Copy as Text does: the page saves what is pending, then main formats the stored record.
 * The writes are slowed, as a busy disk would, so a copy that did not wait would read old text.
 */
const setup = async () => {
  const root = path.join(
    await mkdtemp(path.join(tmpdir(), "iwl-copy-")),
    "captures"
  );

  let failing = false;

  const store = await CaptureStore.open(
    root,
    failingWrites(slowWrites(nodeStoreFs, 30), () => failing)
  );

  await store.publish({
    images: new Map([[VIEW, new Uint8Array([1])]]),
    record,
  });

  const saver = new InlineSaver(ID, {
    setTodoDone: (id, todoId, done) => store.setTodoDone(id, todoId, done),
    updateText: (id, text) => store.updateText(id, text, new Date()),
  });

  saver.adopt(stored);
  onTestFinished(trackSaver(ID, saver));

  const copy = async () => {
    await savePending(ID);
    await store.idle();

    const entry = store.get(ID);

    return entry?.kind === "current"
      ? formatNote(entry.record, "en-GB", "UTC")
      : "";
  };

  const storedNote = () => {
    const entry = store.get(ID);

    return entry?.kind === "current"
      ? formatNote(entry.record, "en-GB", "UTC")
      : "";
  };

  return {
    copy,
    saver,
    setFailing: (on: boolean) => {
      failing = on;
    },
    storedNote,
  };
};

describe("Copy as Text after an edit", () => {
  it("copies a window description typed a moment ago, before its autosave", async () => {
    const { copy, saver } = await setup();

    saver.edit({
      ...stored,
      viewDescriptions: { [VIEW]: "NEW WINDOW DESCRIPTION" },
    });

    const text = await copy();

    expect([
      text.includes("NEW WINDOW DESCRIPTION"),
      text.includes("OLD"),
    ]).toStrictEqual([true, false]);
  });

  it("copies the title and description right after the field was left", async () => {
    const { copy, saver } = await setup();

    saver.edit({
      ...stored,
      description: "New description",
      relationship: "New title",
    });
    saver.flush();

    const text = await copy();

    expect(text.split("\n").slice(0, 3)).toStrictEqual([
      "New title",
      "",
      "New description",
    ]);
  });

  it("copies nothing when the words on screen could not be saved, and says why", async () => {
    const { saver, setFailing, storedNote } = await setup();
    const copied: string[] = [];

    setFailing(true);
    saver.edit({ ...stored, description: "NEW UNSAVED WORDS" });

    const outcome = await copyAfterSaving(ID, () => {
      copied.push(storedNote());

      return Promise.resolve();
    });

    expect({
      copied,
      outcome: outcome.kind,
      reason:
        outcome.kind === "failed" &&
        outcome.message.includes("Injected write failure"),
      shown: saver.state().text?.description,
    }).toStrictEqual({
      copied: [],
      outcome: "failed",
      reason: true,
      shown: "NEW UNSAVED WORDS",
    });
  });

  it("copies the new words once a failed save goes through on the next try", async () => {
    const { saver, setFailing, storedNote } = await setup();

    setFailing(true);
    saver.edit({ ...stored, description: "Second try" });
    await savePending(ID);
    setFailing(false);

    const copied: string[] = [];

    const outcome = await copyAfterSaving(ID, () => {
      copied.push(storedNote());

      return Promise.resolve();
    });

    expect([
      outcome.kind,
      copied.map((note) => note.includes("Second try")),
    ]).toStrictEqual(["ok", [true]]);
  });
});
