import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CaptureId } from "../shared/ids";
import { DraftIdSchema, ViewIdSchema } from "../shared/ids";
import { RETRY_MS, startSnoozeClock } from "./snooze-clock";
import type { Timers } from "./snooze-clock";
import { nodeStoreFs } from "./store/fs";
import type { CaptureRecord } from "./store/schema";
import { CaptureStore } from "./store/store";

const DUE = DraftIdSchema.parse("6f1c2b52-3d4e-4f60-8a71-92b3c4d5e6f1");
const LATER = DraftIdSchema.parse("6f1c2b52-3d4e-4f60-8a71-92b3c4d5e6f2");

const viewId = ViewIdSchema.parse("0a000000-0000-4000-8000-000000000001");

const publish = async (store: CaptureStore, id: CaptureId, title: string) => {
  const record: CaptureRecord = {
    createdAt: "2026-11-01T10:00:00.000Z",
    description: "",
    id,
    relationship: title,
    due: null,
    schemaVersion: 5,
    status: { kind: "active" },
    todos: [],
    updatedAt: "2026-11-01T10:00:00.000Z",
    views: [
      {
        acquisition: { kind: "direct", windowKeyAtCapture: "macos:1" },
        appName: null,
        capturedAt: "2026-11-01T10:00:00.000Z",
        description: "",
        height: 10,
        id: viewId,
        origin: null,
        sampledAt: "2026-11-01T10:00:00.000Z",
        title: null,
        width: 10,
      },
    ],
  };

  await store.publish({
    images: new Map([[viewId, new Uint8Array([1])]]),
    record,
  });
};

/** Timers that record what was asked of them and run only when told to. */
const manualTimers = () => {
  const pending = new Map<number, { run: () => void; ms: number }>();
  let next = 0;

  const timers: Timers<number> = {
    clear: (handle) => pending.delete(handle),
    set: (run, ms) => {
      next += 1;
      pending.set(next, { ms, run });

      return next;
    },
  };

  return { pending, timers };
};

const statuses = (store: CaptureStore) =>
  store
    .list()
    .map((entry) =>
      entry.kind === "current"
        ? [entry.record.relationship, entry.record.status.kind]
        : []
    )
    .toSorted();

describe(startSnoozeClock, () => {
  let store: CaptureStore;

  beforeEach(async () => {
    store = await CaptureStore.open(
      await mkdtemp(path.join(tmpdir(), "inset-snooze-")),
      nodeStoreFs
    );
    await publish(store, DUE, "Due");
    await publish(store, LATER, "Later");
  });

  it("wakes what came due while the app was off, and announces it once across overlapping sweeps", async () => {
    await store.setStatus(DUE, {
      kind: "snoozed",
      until: "2026-11-03T08:00:00.000Z",
    });
    await store.setStatus(LATER, {
      kind: "snoozed",
      until: "2026-11-09T08:00:00.000Z",
    });

    const announced: string[][] = [];
    const { pending, timers } = manualTimers();

    const clock = startSnoozeClock({
      notify: (woken) =>
        announced.push(woken.map((record) => record.relationship)),
      now: () => new Date("2026-11-03T09:00:00.000Z"),
      store,
      timers,
    });

    await Promise.all([clock.sweep(), clock.sweep()]);
    clock.stop();

    expect(announced).toStrictEqual([["Due"]]);
    expect(statuses(store)).toStrictEqual([
      ["Due", "active"],
      ["Later", "snoozed"],
    ]);
    expect([...pending.values()].map(({ ms }) => ms)).toStrictEqual([]);
  });

  it("waits for the nearest snooze, in steps no longer than setTimeout allows", async () => {
    const { pending, timers } = manualTimers();
    const announced: string[][] = [];
    let now = new Date("2026-11-03T09:00:00.000Z");

    const clock = startSnoozeClock({
      notify: (woken) =>
        announced.push(woken.map((record) => record.relationship)),
      now: () => now,
      store,
      timers,
    });

    await store.setStatus(LATER, {
      kind: "snoozed",
      until: "2027-01-01T00:00:00.000Z",
    });
    const far = [...pending.values()].map(({ ms }) => ms);

    await store.setStatus(DUE, {
      kind: "snoozed",
      until: "2026-11-03T10:00:00.000Z",
    });
    const near = [...pending.values()];

    now = new Date("2026-11-03T10:00:00.000Z");
    near[0]?.run();
    await vi.waitFor(() => expect(announced).toStrictEqual([["Due"]]));
    clock.stop();

    expect(far).toStrictEqual([2 ** 31 - 1]);
    expect(near.map(({ ms }) => ms)).toStrictEqual([60 * 60 * 1000]);
  });

  it("waits a minute after a wake that could not be written, then tries again", async () => {
    await store.setStatus(DUE, {
      kind: "snoozed",
      until: "2026-11-03T08:00:00.000Z",
    });
    await store.setStatus(LATER, {
      kind: "snoozed",
      until: "2026-11-03T09:00:30.000Z",
    });

    const failing = { left: 2 };

    const { pending, timers } = manualTimers();
    const announced: string[][] = [];
    let now = new Date("2026-11-03T09:00:00.000Z");

    const clock = startSnoozeClock({
      notify: (woken) =>
        announced.push(woken.map((record) => record.relationship)),
      now: () => now,
      store: {
        list: () => store.list(),
        onChange: (listener) => store.onChange(listener),
        wake: (id, until) => {
          if (id === DUE && failing.left > 0) {
            failing.left -= 1;

            return Promise.resolve({ kind: "failed", message: "disk full" });
          }

          return store.wake(id, until);
        },
      },
      timers,
    });

    const delays: number[] = [];

    await clock.sweep();
    delays.push(...[...pending.values()].map(({ ms }) => ms));

    now = new Date("2026-11-03T09:01:00.000Z");
    await clock.sweep();
    delays.push(...[...pending.values()].map(({ ms }) => ms));

    now = new Date("2026-11-03T09:02:00.000Z");
    await clock.sweep();
    clock.stop();

    expect(delays).toStrictEqual([30_000, RETRY_MS]);
    expect(announced).toStrictEqual([["Later"], ["Due"]]);
  });
});
