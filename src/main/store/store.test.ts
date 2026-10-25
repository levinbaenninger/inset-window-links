import { mkdtemp, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import type { CaptureId, ViewId } from "../../shared/ids";
import { DraftIdSchema, ViewIdSchema } from "../../shared/ids";
import type { StoreFs } from "./fs";
import { failingWrites, nodeStoreFs } from "./fs";
import type { CaptureRecord } from "./schema";
import type { NewCapture } from "./store";
import { CaptureStore } from "./store";

const CAPTURE_ID: CaptureId = DraftIdSchema.parse(
  "6f1c2b52-3d4e-4f60-8a71-92b3c4d5e6f7"
);

const VIEW_IDS: readonly ViewId[] = [
  ViewIdSchema.parse("0a000000-0000-4000-8000-000000000001"),
  ViewIdSchema.parse("0a000000-0000-4000-8000-000000000002"),
  ViewIdSchema.parse("0a000000-0000-4000-8000-000000000003"),
];

const png = (seed: number) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, seed, seed + 1, seed + 2]);

const newCapture = (): NewCapture => {
  const record: CaptureRecord = {
    createdAt: "2026-10-21T12:00:00.000Z",
    id: CAPTURE_ID,
    relationship: "The budget cap in the sheet limits the quote in the mail.",
    schemaVersion: 2,
    todos: [{ done: false, id: "t1", text: "Ask Dana" }],
    updatedAt: "2026-10-21T12:00:00.000Z",
    views: VIEW_IDS.map((id, index) => ({
      acquisition: {
        kind: "direct",
        windowKeyAtCapture: `macos:${1175 + index}`,
      },
      appName: "TextEdit",
      capturedAt: `2026-10-21T11:5${index}:00.000Z`,
      height: 505,
      id,
      origin: null,
      sampledAt: `2026-10-21T11:5${index}:00.000Z`,
      title: `Untitled ${index + 1}`,
      width: 603,
    })),
  };

  return {
    images: new Map(VIEW_IDS.map((id, index) => [id, png(index * 10)])),
    record,
  };
};

const listNames = async (dir: string) => {
  const names = await readdir(dir);

  return names.toSorted();
};

const reopen = (root: string) => CaptureStore.open(root, nodeStoreFs);

describe(CaptureStore, () => {
  let root = "";

  const recordDirs = async () => {
    const names = await listNames(root);

    return names.filter((name) => !name.startsWith("."));
  };

  beforeEach(async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "iwl-store-"));

    root = path.join(scratch, "captures");
  });

  it("saves three PNGs and reads them back byte for byte after reopening", async () => {
    const store = await CaptureStore.open(root, nodeStoreFs);

    await expect(store.publish(newCapture())).resolves.toStrictEqual({
      kind: "published",
    });

    const reopened = await reopen(root);
    const entry = reopened.get(CAPTURE_ID);

    const files = VIEW_IDS.map(
      (viewId) => reopened.imagePath(CAPTURE_ID, viewId) ?? ""
    );

    const bytes = await Promise.all(
      files.map(async (file) => [...(await readFile(file))])
    );

    expect(entry?.kind === "current" && entry.record.relationship).toBe(
      "The budget cap in the sheet limits the quote in the mail."
    );
    await expect(recordDirs()).resolves.toStrictEqual([CAPTURE_ID]);
    expect(bytes).toStrictEqual([[...png(0)], [...png(10)], [...png(20)]]);
  });

  it("publishes nothing when a write fails", async () => {
    const store = await CaptureStore.open(
      root,
      failingWrites(nodeStoreFs, (file) => file.endsWith("record.json"))
    );

    const capture = newCapture();
    const failed = await store.publish(capture);

    expect(failed.kind).toBe("failed");
    await expect(recordDirs()).resolves.toStrictEqual([]);
    expect(store.list()).toStrictEqual([]);
    expect(capture.record.views).toHaveLength(3);
  });

  it("succeeds when the same capture is retried after a failed write", async () => {
    let failing = true;

    const store = await CaptureStore.open(
      root,
      failingWrites(nodeStoreFs, (file) => failing && file.endsWith(".png"))
    );

    const capture = newCapture();

    await expect(store.publish(capture)).resolves.toMatchObject({
      kind: "failed",
    });

    failing = false;

    await expect(store.publish(capture)).resolves.toStrictEqual({
      kind: "published",
    });
    await expect(store.publish(capture)).resolves.toStrictEqual({
      kind: "alreadyPublished",
    });
    await expect(recordDirs()).resolves.toStrictEqual([CAPTURE_ID]);
  });

  it("persists edited text across a restart", async () => {
    const store = await CaptureStore.open(root, nodeStoreFs);

    await store.publish(newCapture());

    const outcome = await store.updateText(
      CAPTURE_ID,
      {
        relationship: "Edited thought",
        todos: [
          { done: false, id: "t1", text: " Ask Dana today " },
          { done: false, id: "t2", text: "  " },
        ],
      },
      new Date("2026-10-22T08:00:00.000Z")
    );

    const reopened = await reopen(root);
    const entry = reopened.get(CAPTURE_ID);

    expect(outcome).toStrictEqual({ kind: "ok" });
    expect(
      entry?.kind === "current" && [
        entry.record.relationship,
        entry.record.todos,
        entry.record.updatedAt,
      ]
    ).toStrictEqual([
      "Edited thought",
      [{ done: false, id: "t1", text: "Ask Dana today" }],
      "2026-10-22T08:00:00.000Z",
    ]);
  });

  it("checks a to-do off without touching the edit time", async () => {
    const store = await CaptureStore.open(root, nodeStoreFs);

    await store.publish(newCapture());

    const outcomes = [
      await store.setTodoDone(CAPTURE_ID, "t1", true),
      await store.setTodoDone(CAPTURE_ID, "nope", true),
    ];

    const reopened = await reopen(root);
    const entry = reopened.get(CAPTURE_ID);

    expect(outcomes).toStrictEqual([{ kind: "ok" }, { kind: "missing" }]);
    expect(
      entry?.kind === "current" && [entry.record.todos, entry.record.updatedAt]
    ).toStrictEqual([
      [{ done: true, id: "t1", text: "Ask Dana" }],
      "2026-10-21T12:00:00.000Z",
    ]);
  });

  it("reads a version 1 record, turning its next step into to-dos, and writes version 2 on edit", async () => {
    const { record } = newCapture();
    const { todos: _todos, ...rest } = record;

    const v1 = {
      ...rest,
      nextStep: "- [ ] Ask Dana\n\n- [x] Find the old quote\nCall the vendor",
      schemaVersion: 1,
      views: record.views.map(({ origin: _origin, ...view }) => view),
    };

    await mkdir(path.join(root, CAPTURE_ID, "views"), { recursive: true });
    await writeFile(
      path.join(root, CAPTURE_ID, "record.json"),
      JSON.stringify(v1)
    );

    const store = await CaptureStore.open(root, nodeStoreFs);
    const entry = store.get(CAPTURE_ID);

    expect(entry?.kind === "current" && entry.record.todos).toStrictEqual([
      { done: false, id: "v1-1", text: "Ask Dana" },
      { done: true, id: "v1-2", text: "Find the old quote" },
      { done: false, id: "v1-3", text: "Call the vendor" },
    ]);
    expect(
      entry?.kind === "current" && entry.record.views[0]?.origin
    ).toBeNull();

    await store.setTodoDone(CAPTURE_ID, "v1-1", true);

    const written: unknown = JSON.parse(
      await readFile(path.join(root, CAPTURE_ID, "record.json"), "utf-8")
    );

    expect(written).toMatchObject({ schemaVersion: 2 });
    expect(written).not.toHaveProperty("nextStep");
  });

  it("deletes by moving into the trash, and the record stays gone after a restart", async () => {
    const keepTrash: StoreFs = {
      ...nodeStoreFs,
      rmrf: (target) =>
        target.endsWith(".trash")
          ? Promise.resolve()
          : nodeStoreFs.rmrf(target),
    };

    const store = await CaptureStore.open(root, keepTrash);

    await store.publish(newCapture());

    const outcomes = [
      await store.remove(CAPTURE_ID),
      await store.remove(CAPTURE_ID),
    ];

    const trashed = await listNames(path.join(root, ".trash"));
    const reopened = await reopen(root);

    expect(outcomes).toStrictEqual([{ kind: "ok" }, { kind: "missing" }]);
    await expect(recordDirs()).resolves.toStrictEqual([]);
    expect(
      trashed.map((name) => name.slice(0, CAPTURE_ID.length))
    ).toStrictEqual([CAPTURE_ID]);
    expect(reopened.list()).toStrictEqual([]);
  });

  it("leaves a record from a newer schema version untouched", async () => {
    const id = "7f1c2b52-3d4e-4f60-8a71-92b3c4d5e6f7";

    const futureJson = JSON.stringify({
      id,
      schemaVersion: 3,
      thought: "from the future",
    });

    await mkdir(path.join(root, id), { recursive: true });
    await writeFile(path.join(root, id, "record.json"), futureJson);

    const store = await CaptureStore.open(root, nodeStoreFs);
    const futureId = DraftIdSchema.parse(id);

    const outcomes = [
      await store.updateText(
        futureId,
        { relationship: "x", todos: [] },
        new Date()
      ),
      await store.remove(futureId),
    ];

    expect(store.list()).toStrictEqual([
      { id, kind: "unsupported", version: 3 },
    ]);
    expect(outcomes).toStrictEqual([
      { kind: "readOnly", version: 3 },
      { kind: "readOnly", version: 3 },
    ]);
    await expect(
      readFile(path.join(root, id, "record.json"), "utf-8")
    ).resolves.toBe(futureJson);
    expect(store.imagePath(id, VIEW_IDS[0] ?? "")).toBeNull();
  });

  it("serves image paths only for views the record lists", async () => {
    const store = await CaptureStore.open(root, nodeStoreFs);

    await store.publish(newCapture());

    expect([
      store.imagePath(CAPTURE_ID, "0a000000-0000-4000-8000-000000000009"),
      store.imagePath(CAPTURE_ID, "../record"),
      store.imagePath("not-a-capture", VIEW_IDS[0] ?? ""),
    ]).toStrictEqual([null, null, null]);
    expect(store.imagePath(CAPTURE_ID, VIEW_IDS[1] ?? "")).toBe(
      path.join(root, CAPTURE_ID, "views", `${VIEW_IDS[1]}.png`)
    );
  });
});
