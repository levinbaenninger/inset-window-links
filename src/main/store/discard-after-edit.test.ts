import { existsSync } from "node:fs";
import { cp, mkdtemp, readdir, readFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  copyCapture as copyThroughGate,
  retryOf,
} from "../../renderer/src/library/copy-gate";
import { DraftStore, reasonOf } from "../../renderer/src/library/drafts";
import { LeaveFlow } from "../../renderer/src/library/leave";
import type { MutationOutcome } from "../../shared/dto";
import { DraftIdSchema, ViewIdSchema } from "../../shared/ids";
import { SETTLE_MS } from "../../shared/leave";
import type { DraftText } from "../../shared/text";
import { LeaveGate } from "../leave-gate";
import type { Clip } from "./copy";
import { copyCapture, CopyStarts } from "./copy";
import type { StoreFs } from "./fs";
import { heldWrites, nodeStoreFs } from "./fs";
import type { CaptureRecord } from "./schema";
import { readVersioned } from "./schema";
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

const readdirSorted = async (dir: string) => {
  const names = await readdir(dir);

  return names.toSorted();
};

const until = async (done: () => boolean, left = 400): Promise<void> => {
  if (done() || left === 0) {
    return;
  }

  await sleep(5);
  await until(done, left - 1);
};

/**
 * A disk for the capture store: it logs every durable write, fails them all while `full`, holds
 * them while `holdWrites`, and holds the rename of a record's temp file into place while
 * `holdRename`. Released holds go on.
 */
const testDisk = () => {
  const writes: string[] = [];
  const held: (() => void)[] = [];
  const state = { full: false, holdRename: false, holdWrites: false };

  const wait = async () => {
    const { promise, resolve } = Promise.withResolvers<undefined>();

    held.push(() => resolve(undefined));
    await promise;
  };

  const fs: StoreFs = {
    ...nodeStoreFs,
    rename: async (from, to) => {
      if (state.holdRename && from.endsWith("record.json.tmp")) {
        await wait();
      }

      await nodeStoreFs.rename(from, to);
    },
    writeFileDurable: async (file, data) => {
      writes.push(path.basename(file));

      if (state.holdWrites) {
        await wait();
      }

      if (state.full) {
        throw Object.assign(new Error(`ENOSPC, write '${file}'`), {
          code: "ENOSPC",
        });
      }

      await nodeStoreFs.writeFileDurable(file, data);
    },
  };

  return {
    fs,
    held: () => held.length,
    release: () => {
      state.holdRename = false;
      state.holdWrites = false;

      for (const go of held.splice(0)) {
        go();
      }
    },
    state,
    writes,
  };
};

/**
 * A published capture, the page's drafts and leave flow over the real store, and what main hears
 * from the page. `answers` holds main's answers to the page's saves while `answers.hold` is set,
 * as an answer still on its way back over IPC.
 */
const setup = async () => {
  const root = path.join(
    await mkdtemp(path.join(tmpdir(), "iwl-discard-")),
    "captures"
  );

  const disk = testDisk();
  const store = await CaptureStore.open(root, disk.fs);

  await store.publish({
    images: new Map([[VIEW, new Uint8Array([1])]]),
    record,
  });

  const held: (() => void)[] = [];
  const answers = { held, hold: false };

  const late = async (
    outcome: Promise<MutationOutcome>
  ): Promise<MutationOutcome> => {
    const result = await outcome;

    if (answers.hold) {
      const { promise, resolve } = Promise.withResolvers<undefined>();

      answers.held.push(() => resolve(undefined));
      await promise;
    }

    return result;
  };

  const drafts = new DraftStore(() => ({
    discard: (id, rev) => store.discard(id, rev),
    setTodoDone: (id, todoId, done, rev) =>
      late(store.setTodoDone(id, todoId, done, rev)),
    updateText: (id, text, rev) =>
      late(store.updateText(id, text, new Date(), rev)),
  }));

  /** What main hears from the page, in order. */
  const heard: string[] = [];

  const flow = new LeaveFlow(drafts, () => ({
    answerLeave: (answer) => heard.push(answer),
    reportUnsaved: (count) => heard.push(`unsaved ${String(count)}`),
  }));

  /** The capture as a fresh start reads it from disk. */
  const reopened = async () => {
    const fresh = await CaptureStore.open(root, nodeStoreFs);
    const entry = fresh.get(ID);

    return entry?.kind === "current" ? entry.record : null;
  };

  /** The capture's title as a fresh start reads it from disk. */
  const reopenedTitle = async () => {
    const back = await reopened();

    return back?.relationship;
  };

  /** Types a title as the capture's page does, over what it shows, and saves it now. */
  const type = (relationship: string) => {
    const shown = drafts.shown(ID, stored);

    drafts.edit(ID, { ...shown, relationship }, shown);
    drafts.flush(ID);
  };

  return {
    answers,
    disk,
    drafts,
    flow,
    heard,
    reopened,
    reopenedTitle,
    root,
    store,
    type,
  };
};

describe("Discard never writes content to undo a save", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves the saved words on disk, though the discarded ones were being written and the disk then fills", async () => {
    const { disk, drafts, flow, heard, reopenedTitle, store, type } =
      await setup();

    disk.state.holdWrites = true;
    type("DISCARDED TEXT");
    await until(() => disk.held() > 0);

    vi.useFakeTimers();
    flow.request("close");
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    const writesBefore = disk.writes.length;

    disk.state.full = true;
    flow.discard();
    // The page goes away, as on pagehide.
    drafts.leave();
    disk.state.full = false;
    disk.release();
    vi.useRealTimers();
    await store.idle();

    expect({
      heard,
      reopened: await reopenedTitle(),
      shown: drafts.shown(ID, stored).relationship,
      writesAfterDiscard: disk.writes.slice(writesBefore),
    }).toStrictEqual({
      // Discard lets go at once; the count drops once main has answered it.
      heard: ["unsaved 1", "waiting", "held", "go", "unsaved 0"],
      reopened: "SAVED title",
      shown: "SAVED title",
      writesAfterDiscard: [],
    });
  });

  it("puts the saved version back by a rename when the discarded save's rename was on its way, though the disk is full", async () => {
    const { disk, drafts, flow, heard, reopenedTitle, store, type } =
      await setup();

    disk.state.holdRename = true;
    type("DISCARDED TEXT");
    await until(() => disk.held() > 0);

    vi.useFakeTimers();
    flow.request("close");
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    const writesBefore = disk.writes.length;

    disk.state.full = true;
    flow.discard();
    drafts.leave();
    disk.release();
    vi.useRealTimers();
    await store.idle();

    const entry = store.get(ID);

    expect({
      heard,
      index: entry?.kind === "current" ? entry.record.relationship : null,
      reopened: await reopenedTitle(),
      shown: drafts.shown(ID, stored).relationship,
      writesAfterDiscard: disk.writes.slice(writesBefore),
    }).toStrictEqual({
      // Discard lets go at once; the count drops once main has answered it.
      heard: ["unsaved 1", "waiting", "held", "go", "unsaved 0"],
      index: "SAVED title",
      reopened: "SAVED title",
      shown: "SAVED title",
      // The empty marker that lets a start after a crash finish the Discard; the full disk refused it.
      writesAfterDiscard: ["record.json.discard"],
    });
  });

  it("undoes a save that landed before the page heard back, by a rename, on a full disk", async () => {
    const { answers, disk, drafts, reopened, reopenedTitle, store, type } =
      await setup();

    answers.hold = true;
    type("DISCARDED TEXT");
    await until(() => answers.held.length > 0);

    const landed = await reopened();
    const writesBefore = disk.writes.length;

    disk.state.full = true;
    drafts.discard(ID);
    await store.idle();
    answers.hold = false;

    for (const go of answers.held.splice(0)) {
      go();
    }

    await until(() => false, 2);

    expect({
      landed: landed?.relationship,
      reopened: await reopenedTitle(),
      shown: drafts.shown(ID, stored).relationship,
      unsaved: drafts.count,
      writesAfterDiscard: disk.writes.slice(writesBefore),
    }).toStrictEqual({
      landed: "DISCARDED TEXT",
      reopened: "SAVED title",
      shown: "SAVED title",
      unsaved: 0,
      writesAfterDiscard: ["record.json.discard"],
    });
  });

  it("goes back to the last confirmed save, not to the version first opened", async () => {
    const { disk, drafts, reopenedTitle, store, type } = await setup();

    type("CONFIRMED title");
    await store.idle();
    await until(() => drafts.count === 0);

    disk.state.holdWrites = true;
    type("DISCARDED TEXT");
    await until(() => disk.held() > 0);
    drafts.discard(ID);
    disk.release();
    await store.idle();

    expect({
      reopened: await reopenedTitle(),
      shown: drafts.shown(ID, stored).relationship,
    }).toStrictEqual({
      reopened: "CONFIRMED title",
      shown: "CONFIRMED title",
    });
  });

  it("keeps a status change made after the discarded save landed, when it puts the saved words back", async () => {
    const { answers, disk, drafts, reopened, store, type } = await setup();

    answers.hold = true;
    type("DISCARDED TEXT");
    await until(() => answers.held.length > 0);

    const done = await store.setStatus(ID, {
      at: "2026-11-05T10:00:00.000Z",
      kind: "done",
    });

    disk.state.full = true;
    drafts.discard(ID);
    await store.idle();

    const back = await reopened();

    expect({
      done,
      reopened: [back?.relationship, back?.status.kind],
    }).toStrictEqual({
      done: { kind: "ok" },
      reopened: ["SAVED title", "done"],
    });
  });

  it("drops a discarded save still queued, and the next edit saves normally", async () => {
    const { disk, drafts, reopenedTitle, store, type } = await setup();

    disk.state.holdWrites = true;
    type("DISCARDED TEXT");
    await until(() => disk.held() > 0);
    drafts.discard(ID);
    disk.release();
    await store.idle();
    type("Typed after the discard");
    await store.idle();
    await until(() => drafts.count === 0);

    await expect(reopenedTitle()).resolves.toBe("Typed after the discard");
  });

  it("never undoes a save an earlier Recent Captures window confirmed, though the next window's revs start over", async () => {
    const { disk, drafts, reopenedTitle, store, type } = await setup();

    type("CONFIRMED by the first window");
    await store.idle();
    await until(() => drafts.count === 0);

    // The window closes and opens again: a new page, whose revs count from the start once more.
    const next = new DraftStore(() => ({
      discard: (id, rev) => store.discard(id, rev),
      setTodoDone: (id, todoId, done, rev) =>
        store.setTodoDone(id, todoId, done, rev),
      updateText: (id, text, rev) =>
        store.updateText(id, text, new Date(), rev),
    }));

    const shown = { ...stored, relationship: "CONFIRMED by the first window" };

    disk.state.holdWrites = true;
    next.edit(ID, { ...shown, relationship: "DISCARDED TEXT" }, shown);
    next.flush(ID);
    await until(() => disk.held() > 0);
    next.discard(ID);
    disk.release();
    await store.idle();

    await expect(reopenedTitle()).resolves.toBe(
      "CONFIRMED by the first window"
    );
  });

  it("reads the backup when a save stopped between moving the record aside and renaming the new one in", async () => {
    const { reopenedTitle, root } = await setup();
    const file = path.join(root, ID, "record.json");

    await rename(file, `${file}.prev`);

    expect([
      await reopenedTitle(),
      await readdirSorted(path.join(root, ID)),
    ]).toStrictEqual(["SAVED title", ["record.json", "views"]]);
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

/** A fault the crash disk injects: a Node error with this code. */
const fault = (code: string) =>
  Object.assign(new Error(`Injected ${code}`), { code });

/**
 * A disk that keeps every state a crash could leave. Once `armed`, it copies the whole capture
 * folder after each write, rename and removal lands, one operation at a time so every copy falls
 * between two of them. `hold` stops the first operation it matches until released; `fail` makes
 * the operations it matches throw while set.
 */
const crashDisk = (root: string) => {
  const crashes: string[] = [];
  /** The operation each crash copy was taken after. */
  const ops: string[] = [];
  const renames: string[] = [];
  const state = { armed: false };
  const failing = new Map<(op: string) => boolean, string>();

  const holds: {
    match: (op: string) => boolean;
    gate: PromiseWithResolvers<undefined>;
    reached: PromiseWithResolvers<undefined>;
    used: boolean;
  }[] = [];

  let turn: Promise<undefined> = Promise.resolve(undefined);

  const run = async (op: string, act: () => Promise<void>): Promise<void> => {
    const hold = holds.find((each) => !each.used && each.match(op));

    if (hold !== undefined) {
      hold.used = true;
      hold.reached.resolve(undefined);
      await hold.gate.promise;
    }

    const previous = turn;
    const done = Promise.withResolvers<undefined>();

    turn = done.promise;
    await previous;

    try {
      const code = [...failing].find(([match]) => match(op))?.[1];

      if (code !== undefined) {
        throw fault(code);
      }

      await act();

      if (state.armed) {
        if (op.startsWith("rename ")) {
          renames.push(op);
        }

        const copy = await mkdtemp(path.join(tmpdir(), "iwl-crash-"));

        await cp(root, copy, { recursive: true });
        crashes.push(copy);
        ops.push(op);
      }
    } finally {
      done.resolve(undefined);
    }
  };

  const name = (file: string) => path.relative(root, file);

  const fs: StoreFs = {
    ...nodeStoreFs,
    rename: (from, to) =>
      run(`rename ${name(from)} -> ${name(to)}`, () =>
        nodeStoreFs.rename(from, to)
      ),
    rmrf: (file) => run(`rmrf ${name(file)}`, () => nodeStoreFs.rmrf(file)),
    writeFileDurable: (file, data) =>
      run(`write ${name(file)}`, () =>
        nodeStoreFs.writeFileDurable(file, data)
      ),
  };

  return {
    crashes,
    ops,
    fail: (match: (op: string) => boolean, code: string) => {
      failing.set(match, code);

      return () => failing.delete(match);
    },
    fs,
    hold: (match: (op: string) => boolean) => {
      const hold = {
        gate: Promise.withResolvers<undefined>(),
        match,
        reached: Promise.withResolvers<undefined>(),
        used: false,
      };

      holds.push(hold);

      return {
        reached: hold.reached.promise,
        release: () => hold.gate.resolve(undefined),
      };
    },
    renames,
    state,
  };
};

const OTHER = DraftIdSchema.parse("7a2d3c63-4e5f-4a71-9b82-a3c4d5e6f708");

/** What each crash copy holds once a fresh start has opened it: the capture's title, or "gone". */
const afterCrashes = async (crashes: readonly string[]) => {
  const titles = await Promise.all(
    crashes.map(async (copy) => {
      const started = await CaptureStore.open(copy, nodeStoreFs);
      const entry = started.get(ID);

      return entry?.kind === "current" ? entry.record.relationship : "gone";
    })
  );

  return { crashes: crashes.length > 0, titles: [...new Set(titles)] };
};

/** Each different title/status a fresh start reads from these crash copies. */
const statesAfterCrashes = async (crashes: readonly string[]) => {
  const states = await Promise.all(
    crashes.map(async (copy) => {
      const started = await CaptureStore.open(copy, nodeStoreFs);
      const entry = started.get(ID);

      return entry?.kind === "current"
        ? `${entry.record.relationship}/${entry.record.status.kind}`
        : "gone";
    })
  );

  return [...new Set(states)];
};

/** Two published captures on a crash disk, and the page's drafts with main's answers held when asked. */
const crashSetup = async () => {
  const root = path.join(
    await mkdtemp(path.join(tmpdir(), "iwl-crash-root-")),
    "captures"
  );

  const disk = crashDisk(root);
  const store = await CaptureStore.open(root, disk.fs);

  const captures = [
    { id: ID, view: VIEW },
    {
      id: OTHER,
      view: ViewIdSchema.parse("0a000000-0000-4000-8000-000000000002"),
    },
  ];

  await Promise.all(
    captures.map(({ id, view }) =>
      store.publish({
        images: new Map([[view, new Uint8Array([1])]]),
        record: {
          ...record,
          id,
          views: record.views.map((each) => ({ ...each, id: view })),
        },
      })
    )
  );

  const held: (() => void)[] = [];
  const answers = { held, hold: false };

  const late = async (outcome: Promise<MutationOutcome>) => {
    const result = await outcome;

    if (answers.hold) {
      const { promise, resolve } = Promise.withResolvers<undefined>();

      answers.held.push(() => resolve(undefined));
      await promise;
    }

    return result;
  };

  /** Each save main heard from the page: its title and description. */
  const sent: string[] = [];

  const drafts = new DraftStore(() => ({
    discard: (id, rev) => store.discard(id, rev),
    setTodoDone: (id, todoId, done, rev) =>
      late(store.setTodoDone(id, todoId, done, rev)),
    updateText: (id, text, rev) => {
      sent.push(`${text.relationship} | ${text.description}`);

      return late(store.updateText(id, text, new Date(), rev));
    },
  }));

  const reopened = async () => {
    const started = await CaptureStore.open(root, nodeStoreFs);
    const entry = started.get(ID);

    return entry?.kind === "current"
      ? [entry.record.relationship, entry.record.status.kind]
      : null;
  };

  const marker = path.join(root, ID, "record.json.discard");

  /** The capture's fields as a fresh start reads them from disk. */
  const reopenedFields = async () => {
    const started = await CaptureStore.open(root, nodeStoreFs);
    const entry = started.get(ID);

    return entry?.kind === "current"
      ? {
          description: entry.record.description,
          due: entry.record.due,
          status: entry.record.status.kind,
          title: entry.record.relationship,
        }
      : null;
  };

  return {
    answers,
    disk,
    drafts,
    marker,
    reopened,
    reopenedFields,
    root,
    sent,
    store,
  };
};

const DISCARDED_TEXT: DraftText = { ...stored, relationship: "DISCARDED TEXT" };

describe("Discard survives a crash at any step", () => {
  it("never renames the discarded save in when Discard arrives while the record is moved aside", async () => {
    const { disk, reopened, store } = await crashSetup();

    const aside = disk.hold(
      (op) => op === `rename ${ID}/record.json -> ${ID}/record.json.prev`
    );

    const saving = store.updateText(ID, DISCARDED_TEXT, new Date(), 1);

    await aside.reached;
    disk.state.armed = true;

    const discarded = store.discard(ID, 1);

    aside.release();
    await saving;
    await discarded;
    await store.idle();

    expect({
      ...(await afterCrashes(disk.crashes)),
      now: await reopened(),
      renamedIn: disk.renames.filter((op) => op.includes("record.json.tmp ->")),
    }).toStrictEqual({
      crashes: true,
      now: ["SAVED title", "active"],
      renamedIn: [],
      titles: ["SAVED title"],
    });
  });

  it("comes back to the saved words when Discard arrives while the discarded save is renamed in", async () => {
    const { disk, marker, reopened, store } = await crashSetup();

    const renamingIn = disk.hold(
      (op) => op === `rename ${ID}/record.json.tmp -> ${ID}/record.json`
    );

    const saving = store.updateText(ID, DISCARDED_TEXT, new Date(), 1);

    await renamingIn.reached;
    disk.state.armed = true;

    const discarded = store.discard(ID, 1);

    await until(() => existsSync(marker), 40);
    renamingIn.release();
    await saving;
    await discarded;
    await store.idle();

    expect({
      ...(await afterCrashes(disk.crashes)),
      now: await reopened(),
    }).toStrictEqual({
      crashes: true,
      now: ["SAVED title", "active"],
      titles: ["SAVED title"],
    });
  });

  it("comes back to the saved words when Discard of a landed save waits behind another capture's write", async () => {
    const { disk, marker, reopened, store } = await crashSetup();

    await store.updateText(ID, DISCARDED_TEXT, new Date(), 1);

    const other = disk.hold((op) => op === `write ${OTHER}/record.json.tmp`);

    const otherDone = store.setStatus(OTHER, {
      at: "2026-11-05T10:00:00.000Z",
      kind: "done",
    });

    await other.reached;
    disk.state.armed = true;

    const discarded = store.discard(ID, 1);

    await until(() => existsSync(marker), 40);
    other.release();
    await otherDone;
    await discarded;
    await store.idle();

    expect({
      ...(await afterCrashes(disk.crashes)),
      now: await reopened(),
    }).toStrictEqual({
      crashes: true,
      now: ["SAVED title", "active"],
      titles: ["SAVED title"],
    });
  });

  it("keeps a status change renamed in before a crash, when a Discard waits behind it", async () => {
    const { answers, disk, drafts, store } = await crashSetup();

    answers.hold = true;
    drafts.edit(ID, DISCARDED_TEXT, stored);
    drafts.flush(ID);
    await until(() => answers.held.length > 0);
    disk.state.armed = true;

    const done = store.setStatus(ID, {
      at: "2026-11-05T10:00:00.000Z",
      kind: "done",
    });

    drafts.discard(ID);
    await done;
    await store.idle();
    disk.state.armed = false;

    const installed = disk.ops.indexOf(
      `rename ${ID}/record.json.tmp -> ${ID}/record.json`
    );

    expect({
      afterInstall: await statesAfterCrashes(disk.crashes.slice(installed)),
      beforeInstall: await statesAfterCrashes(disk.crashes.slice(0, installed)),
      installed: installed > 0,
    }).toStrictEqual({
      afterInstall: ["SAVED title/done"],
      beforeInstall: ["SAVED title/active"],
      installed: true,
    });
  });

  it("never puts back a status backup left from before a later save, when that save is discarded", async () => {
    const { answers, disk, drafts, store } = await crashSetup();

    answers.hold = true;
    drafts.edit(ID, DISCARDED_TEXT, stored);
    drafts.flush(ID);
    await until(() => answers.held.length > 0);

    const healed = disk.fail(
      (op) =>
        op === `rename ${ID}/record.json.prev.tmp -> ${ID}/record.json.prev`,
      "EBUSY"
    );

    const done = await store.setStatus(ID, {
      at: "2026-11-05T10:00:00.000Z",
      kind: "done",
    });

    healed();
    answers.hold = false;

    for (const go of answers.held.splice(0)) {
      go();
    }

    await until(() => drafts.count === 0, 40);
    answers.hold = true;

    const shown = drafts.shown(ID, stored);

    drafts.edit(ID, { ...shown, relationship: "LATER TEXT" }, shown);
    drafts.flush(ID);
    await until(() => answers.held.length > 0);
    disk.state.armed = true;
    drafts.discard(ID);
    await store.idle();
    disk.state.armed = false;

    expect({
      done,
      everyState: await statesAfterCrashes(disk.crashes),
    }).toStrictEqual({
      done: { kind: "ok" },
      everyState: ["DISCARDED TEXT/done"],
    });
  });

  it("never lists a capture the panel withdrew while its folder was renamed into place", async () => {
    const root = path.join(
      await mkdtemp(path.join(tmpdir(), "iwl-crash-root-")),
      "captures"
    );

    const disk = crashDisk(root);
    const store = await CaptureStore.open(root, disk.fs);
    const placing = disk.hold((op) => op.startsWith("rename .staging/"));

    const publishing = store.publish({
      images: new Map([[VIEW, new Uint8Array([1])]]),
      record,
    });

    await placing.reached;
    disk.state.armed = true;
    store.withdraw(ID);
    placing.release();

    const result = await publishing;

    await store.idle();

    const started = await CaptureStore.open(root, nodeStoreFs);

    expect({
      ...(await afterCrashes(disk.crashes)),
      listed: store.list().length,
      reopened: started.list().length,
      result,
    }).toStrictEqual({
      crashes: true,
      listed: 0,
      reopened: 0,
      result: { kind: "withdrawn" },
      titles: ["gone"],
    });
  });
});

describe("A Discard that can't put the saved version back", () => {
  it("shows the changes again as not discarded, comes back saved after a restart, and a second Discard finishes it", async () => {
    const { answers, disk, drafts, reopened, root, store } = await crashSetup();

    answers.hold = true;
    drafts.edit(ID, DISCARDED_TEXT, stored);
    drafts.flush(ID);
    await until(() => answers.held.length > 0);

    const healed = disk.fail(
      (op) => op === `rename ${ID}/record.json.prev -> ${ID}/record.json`,
      "EPERM"
    );

    drafts.discard(ID);
    await store.idle();
    answers.hold = false;

    for (const go of answers.held.splice(0)) {
      go();
    }

    await until(() => drafts.undiscarded(ID), 40);

    const restart = await mkdtemp(path.join(tmpdir(), "iwl-restart-"));

    await cp(root, restart, { recursive: true });

    const failed = drafts.error(ID);

    const restarted = await afterCrashes([restart]);

    const first = {
      error: failed === undefined ? null : reasonOf(failed),
      restarted: restarted.titles,
      shown: drafts.shown(ID, stored).relationship,
      unsaved: drafts.count,
    };

    healed();
    drafts.discard(ID);
    await store.idle();
    await until(() => false, 2);

    expect({
      first,
      second: {
        reopened: await reopened(),
        shown: drafts.shown(ID, stored).relationship,
        unsaved: drafts.count,
      },
    }).toStrictEqual({
      first: {
        error: "Inset can’t write to its data folder.",
        restarted: ["SAVED title"],
        shown: "DISCARDED TEXT",
        unsaved: 1,
      },
      second: {
        reopened: ["SAVED title", "active"],
        shown: "SAVED title",
        unsaved: 0,
      },
    });
  });

  it("keeps a status change whose backup can't be renamed in at once, and a later Discard puts the saved words back with it", async () => {
    const { answers, disk, drafts, reopened, store } = await crashSetup();

    answers.hold = true;
    drafts.edit(ID, DISCARDED_TEXT, stored);
    drafts.flush(ID);
    await until(() => answers.held.length > 0);

    const healed = disk.fail(
      (op) =>
        op === `rename ${ID}/record.json.prev.tmp -> ${ID}/record.json.prev`,
      "EBUSY"
    );

    const done = await store.setStatus(ID, {
      at: "2026-11-05T10:00:00.000Z",
      kind: "done",
    });

    const snoozed = await store.setStatus(ID, {
      kind: "snoozed",
      until: "2026-11-07T09:00:00.000Z",
    });

    healed();
    drafts.discard(ID);
    await store.idle();

    expect({ done, reopened: await reopened(), snoozed }).toStrictEqual({
      done: { kind: "ok" },
      reopened: ["SAVED title", "done"],
      snoozed: { kind: "failed", message: "Couldn’t save (EBUSY)." },
    });
  });

  it("leaves the backup alone when a status change can't be renamed in, so a later Discard keeps the capture in the list", async () => {
    const { answers, disk, drafts, reopened, store } = await crashSetup();

    answers.hold = true;
    drafts.edit(ID, DISCARDED_TEXT, stored);
    drafts.flush(ID);
    await until(() => answers.held.length > 0);

    const healed = disk.fail(
      (op) => op === `rename ${ID}/record.json.tmp -> ${ID}/record.json`,
      "EPERM"
    );

    const done = await store.setStatus(ID, {
      at: "2026-11-05T10:00:00.000Z",
      kind: "done",
    });

    healed();
    drafts.discard(ID);
    await store.idle();

    const listed = store.get(ID);

    expect({
      done,
      listed: listed?.kind === "current" ? listed.record.status.kind : null,
      reopened: await reopened(),
    }).toStrictEqual({
      done: {
        kind: "failed",
        message: "Inset can’t write to its data folder.",
      },
      listed: "active",
      reopened: ["SAVED title", "active"],
    });
  });

  it.each([
    ["the record", "record.json", 1],
    ["the status change's backup", "record.json.prev.tmp", 2],
  ] as const)(
    "leaves the Discard for a later start when %s can’t be read, so a status change that landed is never rolled back",
    async (_what, file, failing) => {
      const { answers, disk, drafts, marker, root, store } = await crashSetup();

      answers.hold = true;
      drafts.edit(ID, DISCARDED_TEXT, stored);
      drafts.flush(ID);
      await until(() => answers.held.length > 0);

      disk.fail(
        (op) =>
          op === `rename ${ID}/record.json.prev.tmp -> ${ID}/record.json.prev`,
        "EPERM"
      );

      const done = await store.setStatus(ID, {
        at: "2026-11-05T10:00:00.000Z",
        kind: "done",
      });

      disk.fail(
        (op) => op === `rename ${ID}/record.json.prev -> ${ID}/record.json`,
        "EPERM"
      );
      drafts.discard(ID);
      await store.idle();

      const crash = path.join(
        await mkdtemp(path.join(tmpdir(), "iwl-read-fault-")),
        "captures"
      );

      await cp(root, crash, { recursive: true });

      const unreadable = path.join(crash, ID, file);
      let reads = 0;

      // One read of that file fails once, as a disk that answers EIO for a moment.
      const flaky: StoreFs = {
        ...nodeStoreFs,
        readText: (name) => {
          if (name === unreadable) {
            reads += 1;

            if (reads === failing) {
              return Promise.reject(fault("EIO"));
            }
          }

          return nodeStoreFs.readText(name);
        },
      };

      const opened = await CaptureStore.open(crash, flaky);
      const first = opened.get(ID);
      const left = path.join(crash, ID, "record.json");

      const kept = {
        marked: existsSync(`${left}.discard`),
        pending: existsSync(`${left}.prev.tmp`),
      };

      expect({
        done,
        first: first?.kind,
        kept,
        later: await statesAfterCrashes([crash]),
        marked: existsSync(marker),
      }).toStrictEqual({
        done: { kind: "ok" },
        first: "unreadable",
        kept: { marked: true, pending: true },
        later: ["SAVED title/done"],
        marked: true,
      });
    }
  );
});

/**
 * A save of DISCARDED TEXT that landed before the page heard back, and a Discard of it whose
 * rename back fails with EPERM until `healed` is called.
 */
const failedDiscard = async () => {
  const crashed = await crashSetup();
  const { answers, disk, drafts, store } = crashed;

  answers.hold = true;
  drafts.edit(ID, DISCARDED_TEXT, stored);
  drafts.flush(ID);
  await until(() => answers.held.length > 0);

  const healed = disk.fail(
    (op) => op === `rename ${ID}/record.json.prev -> ${ID}/record.json`,
    "EPERM"
  );

  drafts.discard(ID);
  await store.idle();
  answers.hold = false;

  for (const go of answers.held.splice(0)) {
    go();
  }

  await until(() => drafts.undiscarded(ID), 40);

  return { ...crashed, healed };
};

/**
 * A save of DISCARDED TEXT that landed before the page heard back, a Discard of it whose rename
 * back is held, then fails or works, and a ⌘C through the page's gate and main's copy, started
 * while that Discard is on its way, after a description is typed when `typed`. Answers what the
 * copy put on the clipboard (each copy's first line), how it went, and what Retry it offers.
 */
const copyDuringDiscard = async ({
  fails,
  typed,
}: {
  fails: boolean;
  typed: boolean;
}) => {
  const { answers, disk, drafts, store } = await crashSetup();

  answers.hold = true;
  drafts.edit(ID, DISCARDED_TEXT, stored);
  drafts.flush(ID);
  await until(() => answers.held.length > 0);

  const putBack = `rename ${ID}/record.json.prev -> ${ID}/record.json`;
  const back = disk.hold((op) => op === putBack);

  if (fails) {
    disk.fail((op) => op === putBack, "EPERM");
  }

  drafts.discard(ID);
  await back.reached;

  if (typed) {
    const shown = drafts.shown(ID, stored);

    drafts.edit(ID, { ...shown, description: "TYPED meanwhile" }, shown);
  }

  const clipboard: string[] = [];
  const starts = new CopyStarts(store);

  const copying = copyThroughGate(
    ID,
    { kind: "entry" },
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
              clip.kind === "text" ? (clip.text.split("\n")[0] ?? "") : "PNG"
            );

            return Promise.resolve();
          },
          { locale: "en-GB", timeZone: "UTC" }
        ),
    },
    drafts
  );

  answers.hold = false;

  for (const go of answers.held.splice(0)) {
    go();
  }

  back.release();

  const copied = await copying;

  await store.idle();

  return { clipboard, copied, retry: retryOf(copied, ID, drafts) };
};

const SAVED_FIELDS = {
  description: "SAVED description",
  due: null,
  status: "active",
  title: "SAVED title",
};

/** Main's answer to a Discard that couldn't put the saved version back. */
const CAUSE = {
  kind: "failed",
  message: "Inset can’t write to its data folder.",
} as const;

/** Lets answers on their way settle. */
const settled = () => until(() => false, 2);

/** The page's leave flow over `drafts`, what main hears from it, and whether its prompt waits for the user. */
const leaveFlow = (drafts: DraftStore) => {
  const heard: string[] = [];

  const flow = new LeaveFlow(drafts, () => ({
    answerLeave: (answer) => heard.push(answer),
    reportUnsaved: (count) => heard.push(`unsaved ${String(count)}`),
  }));

  const asking = () => {
    const state = flow.state();

    return state.kind === "held" && !state.retrying;
  };

  return { asking, flow, heard };
};

describe("After a Discard that couldn't put the saved version back", () => {
  it("keeps the saved version to put back while the user edits, and the next Discard puts it back", async () => {
    const { drafts, healed, reopenedFields, sent, store } =
      await failedDiscard();

    healed();

    const shown = drafts.shown(ID, stored);

    drafts.edit(ID, { ...shown, description: "SECOND edit" }, shown);
    drafts.flush(ID);
    await store.idle();
    await settled();

    const failed = drafts.error(ID);
    const editedShown = drafts.shown(ID, stored);

    const edited = {
      error: failed === undefined ? null : reasonOf(failed),
      shown: [editedShown.relationship, editedShown.description],
      unsaved: drafts.count,
    };

    drafts.discard(ID);
    await store.idle();
    await settled();

    const end = drafts.shown(ID, stored);

    expect({
      edited,
      end: {
        reopened: await reopenedFields(),
        shown: [end.relationship, end.description],
        unsaved: drafts.count,
      },
      sent,
    }).toStrictEqual({
      edited: {
        error: CAUSE.message,
        shown: ["DISCARDED TEXT", "SECOND edit"],
        unsaved: 1,
      },
      end: {
        reopened: SAVED_FIELDS,
        shown: ["SAVED title", "SAVED description"],
        unsaved: 0,
      },
      sent: ["DISCARDED TEXT | SAVED description"],
    });
  });

  it("sends no edit made while the Discard is on its way, and keeps it on screen as the changes when the Discard fails", async () => {
    const { answers, disk, drafts, reopenedFields, sent, store } =
      await crashSetup();

    answers.hold = true;
    drafts.edit(ID, DISCARDED_TEXT, stored);
    drafts.flush(ID);
    await until(() => answers.held.length > 0);

    const putBack = `rename ${ID}/record.json.prev -> ${ID}/record.json`;
    const back = disk.hold((op) => op === putBack);
    const healed = disk.fail((op) => op === putBack, "EPERM");

    drafts.discard(ID);
    await back.reached;
    drafts.setDue(ID, "2026-12-01", drafts.shown(ID, stored));
    answers.hold = false;

    for (const go of answers.held.splice(0)) {
      go();
    }

    await settled();

    const whileDiscarding = [...sent];

    back.release();
    await store.idle();
    await until(() => drafts.undiscarded(ID), 40);

    const failed = drafts.error(ID);
    const back1 = drafts.shown(ID, stored);

    const folded = {
      due: back1.due,
      error: failed === undefined ? null : reasonOf(failed),
      title: back1.relationship,
    };

    healed();
    drafts.discard(ID);
    await store.idle();
    await settled();

    const end = drafts.shown(ID, stored);

    expect({
      end: {
        reopened: await reopenedFields(),
        shown: [end.relationship, end.due],
        unsaved: drafts.count,
      },
      folded,
      sent,
      whileDiscarding,
    }).toStrictEqual({
      end: {
        reopened: SAVED_FIELDS,
        shown: ["SAVED title", null],
        unsaved: 0,
      },
      folded: {
        due: "2026-12-01",
        error: CAUSE.message,
        title: "SAVED title",
      },
      sent: ["DISCARDED TEXT | SAVED description"],
      whileDiscarding: ["DISCARDED TEXT | SAVED description"],
    });
  });

  it("tries the Discard again on Discard again, toward the saved version, and never saves the words the user discarded", async () => {
    const { drafts, healed, reopenedFields, sent, store } =
      await failedDiscard();

    drafts.discard(ID);
    await store.idle();
    await until(() => drafts.undiscarded(ID), 40);

    const failed = drafts.error(ID);

    const first = {
      error: failed === undefined ? null : reasonOf(failed),
      shown: drafts.shown(ID, stored).relationship,
    };

    healed();
    drafts.discard(ID);
    await store.idle();
    await settled();

    expect({
      first,
      second: {
        reopened: await reopenedFields(),
        shown: drafts.shown(ID, stored).relationship,
        unsaved: drafts.count,
      },
      sent,
    }).toStrictEqual({
      first: {
        error: CAUSE.message,
        shown: "DISCARDED TEXT",
      },
      second: {
        reopened: SAVED_FIELDS,
        shown: "SAVED title",
        unsaved: 0,
      },
      sent: ["DISCARDED TEXT | SAVED description"],
    });
  });

  it("saves the words on screen on Keep changes (Retry), though the rename back still fails, and a restart keeps them", async () => {
    const { drafts, reopenedFields, sent, store } = await failedDiscard();

    const shown = drafts.shown(ID, stored);

    drafts.edit(ID, { ...shown, description: "KEPT edit" }, shown);
    void drafts.retry(ID);
    await store.idle();
    await until(() => drafts.count === 0, 40);

    const end = drafts.shown(ID, stored);

    expect({
      error: drafts.error(ID) ?? null,
      reopened: await reopenedFields(),
      sent,
      shown: [end.relationship, end.description],
      unsaved: drafts.count,
    }).toStrictEqual({
      error: null,
      reopened: {
        ...SAVED_FIELDS,
        description: "KEPT edit",
        title: "DISCARDED TEXT",
      },
      sent: [
        "DISCARDED TEXT | SAVED description",
        "DISCARDED TEXT | KEPT edit",
      ],
      shown: ["DISCARDED TEXT", "KEPT edit"],
      unsaved: 0,
    });
  });

  it("takes the Discard's marker away on Keep changes (Retry) with nothing typed since, so a restart keeps the words", async () => {
    const { drafts, marker, reopenedFields, store } = await failedDiscard();

    void drafts.retry(ID);
    await store.idle();
    await until(() => drafts.count === 0, 40);

    expect({
      marker: existsSync(marker),
      reopened: await reopenedFields(),
      shown: drafts.shown(ID, stored).relationship,
      unsaved: drafts.count,
    }).toStrictEqual({
      marker: false,
      reopened: { ...SAVED_FIELDS, title: "DISCARDED TEXT" },
      shown: "DISCARDED TEXT",
      unsaved: 0,
    });
  });

  it("never saves the changes as the page goes away, so a restart finishes the Discard", async () => {
    const { drafts, reopenedFields, sent, store } = await failedDiscard();

    drafts.leave();
    await store.idle();

    expect({ reopened: await reopenedFields(), sent }).toStrictEqual({
      reopened: SAVED_FIELDS,
      sent: ["DISCARDED TEXT | SAVED description"],
    });
  });

  it("copies nothing, with no Retry, when a copy starts while a Discard that then fails is on its way", async () => {
    await expect(
      copyDuringDiscard({ fails: true, typed: false })
    ).resolves.toStrictEqual({
      clipboard: [],
      copied: {
        kind: "notDiscarded",
        outcome: CAUSE,
      },
      retry: null,
    });
  });

  it("copies nothing, with no Retry, when words typed during a Discard that then fails are copied", async () => {
    await expect(
      copyDuringDiscard({ fails: true, typed: true })
    ).resolves.toStrictEqual({
      clipboard: [],
      copied: {
        kind: "notDiscarded",
        outcome: CAUSE,
      },
      retry: null,
    });
  });

  it("copies the saved words when a copy starts while a Discard that then works is on its way", async () => {
    await expect(
      copyDuringDiscard({ fails: false, typed: false })
    ).resolves.toStrictEqual({
      clipboard: ["SAVED title"],
      copied: { kind: "copied" },
      retry: null,
    });
  });

  it.each(["close", "quit"] as const)(
    "keeps the words on screen, those typed since too, on Return in the %s prompt, and never sends the Discard again",
    async (reason) => {
      const { drafts, healed, reopenedFields, sent, store } =
        await failedDiscard();

      const { asking, flow, heard } = leaveFlow(drafts);
      const shown = drafts.shown(ID, stored);

      drafts.edit(ID, { ...shown, description: "TYPED since" }, shown);
      drafts.flush(ID);
      flow.request(reason);
      await until(asking, 40);

      const asked = flow.state();

      // Main could put the saved version back now: Return still keeps.
      healed();
      flow.retry();
      await store.idle();
      await until(() => heard.includes("go"), 40);

      expect({
        asked: asked.kind === "held" ? asked.unsaved : null,
        heard,
        reopened: await reopenedFields(),
        sent,
        unsaved: drafts.count,
      }).toStrictEqual({
        asked: { count: 1, error: CAUSE, late: false, undiscarded: true },
        heard: ["waiting", "held", "unsaved 0", "go"],
        reopened: {
          ...SAVED_FIELDS,
          description: "TYPED since",
          title: "DISCARDED TEXT",
        },
        sent: [
          "DISCARDED TEXT | SAVED description",
          "DISCARDED TEXT | TYPED since",
        ],
        unsaved: 0,
      });
    }
  );

  it("asks before a close while a Discard is on its way, says it couldn’t be discarded once it fails, and Discard again holds the close until main puts the saved version back", async () => {
    const { answers, disk, drafts, reopenedFields, store } = await crashSetup();

    answers.hold = true;
    drafts.edit(ID, DISCARDED_TEXT, stored);
    drafts.flush(ID);
    await until(() => answers.held.length > 0);

    const putBack = `rename ${ID}/record.json.prev -> ${ID}/record.json`;
    const back = disk.hold((op) => op === putBack);
    const healed = disk.fail((op) => op === putBack, "EPERM");

    drafts.discard(ID);
    await back.reached;
    answers.hold = false;

    for (const go of answers.held.splice(0)) {
      go();
    }

    const { asking, flow, heard } = leaveFlow(drafts);

    flow.request("close");
    await settled();

    const waiting = { heard: [...heard], state: flow.state().kind };

    back.release();
    await store.idle();
    await until(asking, 40);

    const asked = flow.state();

    flow.discard();
    await store.idle();
    await until(asking, 40);

    const again = { heard: [...heard], state: flow.state().kind };

    healed();
    flow.discard();
    await store.idle();
    await until(() => heard.includes("go"), 40);

    expect({
      again,
      asked: asked.kind === "held" ? asked.unsaved : null,
      end: heard.slice(again.heard.length),
      reopened: await reopenedFields(),
      waiting,
    }).toStrictEqual({
      again: { heard: ["waiting", "held"], state: "held" },
      asked: { count: 1, error: CAUSE, late: false, undiscarded: true },
      end: ["unsaved 0", "go"],
      reopened: SAVED_FIELDS,
      waiting: { heard: ["waiting"], state: "waiting" },
    });
  });

  it("asks rather than closing when a Discard on its way doesn’t answer within SETTLE_MS, and lets go once it does", async () => {
    const { answers, disk, drafts, reopenedFields, store } = await crashSetup();

    answers.hold = true;
    drafts.edit(ID, DISCARDED_TEXT, stored);
    drafts.flush(ID);
    await until(() => answers.held.length > 0);

    const back = disk.hold(
      (op) => op === `rename ${ID}/record.json.prev -> ${ID}/record.json`
    );

    drafts.discard(ID);
    await back.reached;
    answers.hold = false;

    for (const go of answers.held.splice(0)) {
      go();
    }

    await settled();

    const { flow, heard } = leaveFlow(drafts);

    vi.useFakeTimers();
    flow.request("quit");
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 1);
    vi.useRealTimers();

    const asked = flow.state();
    const atLimit = [...heard];

    back.release();
    await store.idle();
    await until(() => heard.includes("go"), 40);

    expect({
      asked: asked.kind === "held" ? asked.unsaved : null,
      atLimit,
      heard,
      reopened: await reopenedFields(),
    }).toStrictEqual({
      asked: { count: 1, error: null, late: true, undiscarded: true },
      atLimit: ["waiting", "held"],
      heard: ["waiting", "held", "unsaved 0", "go"],
      reopened: SAVED_FIELDS,
    });
  });

  it("lets go at once on Discard again when the prompt holds only a Discard still on its way, so a write that hangs can’t keep the window open", async () => {
    const { answers, disk, drafts, marker, reopenedFields, store } =
      await crashSetup();

    answers.hold = true;
    drafts.edit(ID, DISCARDED_TEXT, stored);
    drafts.flush(ID);
    await until(() => answers.held.length > 0);

    const back = disk.hold(
      (op) => op === `rename ${ID}/record.json.prev -> ${ID}/record.json`
    );

    drafts.discard(ID);
    await back.reached;
    answers.hold = false;

    for (const go of answers.held.splice(0)) {
      go();
    }

    await settled();

    const { flow, heard } = leaveFlow(drafts);

    vi.useFakeTimers();
    flow.request("close");
    await vi.advanceTimersByTimeAsync(SETTLE_MS + 1);
    vi.useRealTimers();
    flow.discard();

    const atDiscard = { heard: [...heard], marked: existsSync(marker) };

    back.release();
    await store.idle();

    expect({ atDiscard, reopened: await reopenedFields() }).toStrictEqual({
      atDiscard: { heard: ["waiting", "held", "go"], marked: true },
      reopened: SAVED_FIELDS,
    });
  });

  it("holds the close while a Discard is on its way, and pagehide sends nothing typed meanwhile, so the version it puts back stays", async () => {
    const { answers, disk, drafts, marker, reopenedFields, root, sent, store } =
      await crashSetup();

    answers.hold = true;
    drafts.edit(ID, DISCARDED_TEXT, stored);
    drafts.flush(ID);
    await until(() => answers.held.length > 0);

    const putBack = `rename ${ID}/record.json.prev -> ${ID}/record.json`;
    const back = disk.hold((op) => op === putBack);

    disk.fail((op) => op === putBack, "EPERM");

    const page = { isDestroyed: () => false, on: vi.fn<() => void>() };

    const gate = new LeaveGate<typeof page>({
      ask: vi.fn<() => void>(),
      cancel: vi.fn<() => void>(),
      confirm: () => Promise.withResolvers<"cancel">().promise,
      show: vi.fn<() => void>(),
    });

    /** Counts the page reported that main hasn't received yet, as over IPC. */
    const reports: number[] = [];

    const deliver = () => {
      for (const count of reports.splice(0)) {
        gate.report(page, count);
      }
    };

    const flow = new LeaveFlow(drafts, () => ({
      answerLeave: (answer) => gate.answer(page, answer),
      reportUnsaved: (count) => reports.push(count),
    }));

    gate.attach(page);
    flow.announce();
    deliver();
    drafts.discard(ID);
    await back.reached;
    answers.hold = false;

    for (const go of answers.held.splice(0)) {
      go();
    }

    await settled();
    deliver();

    // Typed while the Discard is on its way; the close comes before any count this edit reports.
    const shown = drafts.shown(ID, stored);

    drafts.edit(ID, { ...shown, description: "TYPED meanwhile" }, shown);

    const heldClose = gate.holdClose(page, vi.fn<() => void>());

    drafts.leave();
    back.release();
    await store.idle();
    await until(() => drafts.undiscarded(ID), 40);

    const backup = readVersioned(
      await readFile(path.join(root, ID, "record.json.prev"), "utf-8")
    );

    expect({
      backup: backup.kind === "current" ? backup.record.relationship : null,
      heldClose,
      marked: existsSync(marker),
      reopened: await reopenedFields(),
      sent,
    }).toStrictEqual({
      backup: "SAVED title",
      heldClose: true,
      marked: true,
      reopened: SAVED_FIELDS,
      sent: ["DISCARDED TEXT | SAVED description"],
    });
  });
});
