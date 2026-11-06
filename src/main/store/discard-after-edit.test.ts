import { existsSync } from "node:fs";
import { cp, mkdtemp, readdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { afterEach, describe, expect, it, vi } from "vitest";

import { DraftStore, reasonOf } from "../../renderer/src/library/drafts";
import { LeaveFlow } from "../../renderer/src/library/leave";
import type { MutationOutcome } from "../../shared/dto";
import { DraftIdSchema, ViewIdSchema } from "../../shared/ids";
import { SETTLE_MS } from "../../shared/leave";
import type { DraftText } from "../../shared/text";
import type { StoreFs } from "./fs";
import { heldWrites, nodeStoreFs } from "./fs";
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
      heard: ["unsaved 1", "waiting", "held", "unsaved 0", "go"],
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
      heard: ["unsaved 1", "waiting", "held", "unsaved 0", "go"],
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

  const drafts = new DraftStore(() => ({
    discard: (id, rev) => store.discard(id, rev),
    setTodoDone: (id, todoId, done, rev) =>
      late(store.setTodoDone(id, todoId, done, rev)),
    updateText: (id, text, rev) =>
      late(store.updateText(id, text, new Date(), rev)),
  }));

  const reopened = async () => {
    const started = await CaptureStore.open(root, nodeStoreFs);
    const entry = started.get(ID);

    return entry?.kind === "current"
      ? [entry.record.relationship, entry.record.status.kind]
      : null;
  };

  const marker = path.join(root, ID, "record.json.discard");

  return { answers, disk, drafts, marker, reopened, root, store };
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

    await until(() => drafts.count > 0, 40);

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
        error:
          "Couldn’t discard the changes. Inset can’t write to its data folder.",
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

  it("fails a status change whose backup can't be renamed in, so a later Discard still puts the saved words back", async () => {
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

    healed();
    drafts.discard(ID);
    await store.idle();

    expect({ done, reopened: await reopened() }).toStrictEqual({
      done: { kind: "failed", message: "Couldn’t save (EBUSY)." },
      reopened: ["SAVED title", "active"],
    });
  });
});
