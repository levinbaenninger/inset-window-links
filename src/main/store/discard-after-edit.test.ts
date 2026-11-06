import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DraftStore } from "../../renderer/src/library/drafts";
import { LeaveFlow } from "../../renderer/src/library/leave";
import { DraftIdSchema, ViewIdSchema } from "../../shared/ids";
import { SETTLE_MS } from "../../shared/leave";
import type { DraftText } from "../../shared/text";
import { failingWrites, heldWrites, nodeStoreFs } from "./fs";
import type { CaptureRecord } from "./schema";
import { CaptureStore } from "./store";

const ID = DraftIdSchema.parse("6f1c2b52-3d4e-4f60-8a71-92b3c4d5e6f7");
const VIEW = ViewIdSchema.parse("0a000000-0000-4000-8000-000000000001");

const record: CaptureRecord = {
  createdAt: "2026-11-05T09:00:00.000Z",
  description: "SAVED description",
  due: null,
  id: ID,
  relationship: "SAVED title",
  schemaVersion: 5,
  status: { kind: "active" },
  todos: [],
  updatedAt: "2026-11-05T09:00:00.000Z",
  views: [
    {
      acquisition: { kind: "direct", windowKeyAtCapture: "macos:1" },
      appName: "Numbers",
      capturedAt: "2026-11-05T08:59:00.000Z",
      description: "",
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
  viewDescriptions: {},
};

const until = async (done: () => boolean, left = 400): Promise<void> => {
  if (done() || left === 0) {
    return;
  }

  await sleep(5);
  await until(done, left - 1);
};

describe("Discard and close during a held save", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves the saved words on disk, though the discarded ones land late and the disk then fills", async () => {
    const root = path.join(
      await mkdtemp(path.join(tmpdir(), "iwl-discard-")),
      "captures"
    );

    let failing = false;

    const disk = heldWrites(nodeStoreFs);

    const store = await CaptureStore.open(
      root,
      failingWrites(disk.fs, () => failing)
    );

    await store.publish({
      images: new Map([[VIEW, new Uint8Array([1])]]),
      record,
    });

    const drafts = new DraftStore(() => ({
      setTodoDone: (id, todoId, done) => store.setTodoDone(id, todoId, done),
      updateText: (id, text) => store.updateText(id, text, new Date()),
    }));

    /** What main hears from the page, in order. */
    const heard: string[] = [];

    const flow = new LeaveFlow(drafts, () => ({
      answerLeave: (answer) => heard.push(answer),
      reportUnsaved: (count) => heard.push(`unsaved ${String(count)}`),
    }));

    disk.hold();
    drafts.edit(ID, { ...stored, relationship: "DISCARDED TEXT" }, stored);
    drafts.flush(ID);
    await until(() => disk.waiting() > 0);

    vi.useFakeTimers();
    flow.request("close");
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    // The disk is full from now on: putting the saved words back can't be written.
    failing = true;
    flow.discard();
    // The page goes away, as on pagehide.
    drafts.leave();
    disk.release();
    vi.useRealTimers();
    await store.idle();

    const reopened = await CaptureStore.open(root, nodeStoreFs);
    const entry = reopened.get(ID);

    expect({
      heard,
      reopened: entry?.kind === "current" ? entry.record.relationship : null,
      shown: drafts.shown(ID, stored).relationship,
    }).toStrictEqual({
      heard: ["unsaved 1", "waiting", "held", "go"],
      reopened: "SAVED title",
      shown: "SAVED title",
    });
  });
});

describe("Discard in the panel while its save hangs", () => {
  it("withdraws the capture, so it never lands once the disk answers", async () => {
    const root = path.join(
      await mkdtemp(path.join(tmpdir(), "iwl-withdraw-")),
      "captures"
    );

    const disk = heldWrites(nodeStoreFs);
    const store = await CaptureStore.open(root, disk.fs);

    disk.hold();

    const publishing = store.publish({
      images: new Map([[VIEW, new Uint8Array([1])]]),
      record,
    });

    await until(() => disk.waiting() > 0);
    store.withdraw(ID);
    disk.release();

    const result = await publishing;
    const reopened = await CaptureStore.open(root, nodeStoreFs);

    expect({
      listed: store.list().length,
      reopened: reopened.list().length,
      result,
    }).toStrictEqual({ listed: 0, reopened: 0, result: { kind: "withdrawn" } });
  });
});
