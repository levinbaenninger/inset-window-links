import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MutationOutcome } from "../../../shared/dto";
import type { CaptureId, ViewId } from "../../../shared/ids";
import type { DraftText } from "../../../shared/text";
import type { Draft, DraftEvent, Effect, TextStore } from "./drafts";
import { DISCARDED, DraftStore, SAVE_AFTER_MS, step } from "./drafts";

// SAFETY: CaptureId and ViewId are branded UUID strings; the store only passes them through.
const ID = "00000000-0000-4000-8000-000000000001" as CaptureId;

// SAFETY: a fixed UUID, as main gives views.
const VIEW = "00000000-0000-4000-8000-000000000101" as ViewId;

const initial: DraftText = {
  description: "",
  due: null,
  relationship: "A limits B",
  todos: [{ done: false, id: "t1", text: "Call" }],
  viewDescriptions: { [VIEW]: "" },
};

const titled = (relationship: string): DraftText => ({
  ...initial,
  relationship,
});

/** The stored form of a title change, as it is sent to main. */
const sent = (relationship: string): DraftText => ({
  ...initial,
  relationship,
});

const DISK_FULL: MutationOutcome = { kind: "failed", message: "disk full" };

/** Runs events from a clean capture: the last draft, and after each event its state and what it asked for. */
const run = (events: readonly DraftEvent[]) => {
  let draft: Draft | null = null;
  const log: { state: string; effects: Effect[] }[] = [];

  for (const event of events) {
    const next = step(draft, event);

    ({ draft } = next);
    log.push({
      effects: next.effects,
      state: draft === null ? "clean" : `${draft.kind} ${draft.rev}`,
    });
  }

  return { draft, log };
};

const edit = (rev: number, relationship: string): DraftEvent => ({
  base: initial,
  kind: "edit",
  rev,
  values: titled(relationship),
});

describe("a capture's draft", () => {
  it("goes dirty, then saving, then clean once its latest words are saved", () => {
    expect(
      run([
        edit(1, "A limits C"),
        { kind: "flush" },
        { kind: "answered", outcome: { kind: "ok" }, rev: 1 },
      ]).log
    ).toStrictEqual([
      { effects: [], state: "dirty 1" },
      {
        effects: [
          {
            call: { kind: "text", text: sent("A limits C") },
            kind: "send",
            rev: 1,
          },
        ],
        state: "saving 1",
      },
      {
        effects: [{ kind: "settle", outcome: { kind: "ok" }, upTo: 1 }],
        state: "clean",
      },
    ]);
  });

  it("stays dirty when a second edit comes during the save, and sends it once the first answers", () => {
    const { draft, log } = run([
      edit(1, "A limits C"),
      { kind: "flush" },
      edit(2, "A limits D"),
      { kind: "flush" },
      { kind: "answered", outcome: { kind: "ok" }, rev: 1 },
      { kind: "answered", outcome: { kind: "ok" }, rev: 2 },
    ]);

    expect([log, draft]).toStrictEqual([
      [
        { effects: [], state: "dirty 1" },
        {
          effects: [
            {
              call: { kind: "text", text: sent("A limits C") },
              kind: "send",
              rev: 1,
            },
          ],
          state: "saving 1",
        },
        // Rev 1 is still on its way: rev 2 waits for its answer instead of overtaking it.
        { effects: [], state: "dirty 2" },
        { effects: [], state: "dirty 2" },
        {
          effects: [
            { kind: "settle", outcome: { kind: "ok" }, upTo: 1 },
            {
              call: { kind: "text", text: sent("A limits D") },
              kind: "send",
              rev: 2,
            },
          ],
          state: "saving 2",
        },
        {
          effects: [{ kind: "settle", outcome: { kind: "ok" }, upTo: 2 }],
          state: "clean",
        },
      ],
      null,
    ]);
  });

  it("keeps the second edit dirty, on top of the first one's saved words, when nothing asked to send it yet", () => {
    const { draft } = run([
      edit(1, "A limits C"),
      { kind: "flush" },
      edit(2, "A limits D"),
      { kind: "answered", outcome: { kind: "ok" }, rev: 1 },
    ]);

    expect(draft).toStrictEqual({
      base: sent("A limits C"),
      flushWanted: false,
      inFlight: null,
      kind: "dirty",
      rev: 2,
      values: titled("A limits D"),
    });
  });

  it("fails with its latest words when the save before a second edit fails, refusing every copy waiting", () => {
    const { draft, log } = run([
      edit(1, "A limits C"),
      { kind: "flush" },
      edit(2, "A limits D"),
      { kind: "answered", outcome: DISK_FULL, rev: 1 },
    ]);

    expect([log.at(-1), draft]).toStrictEqual([
      {
        effects: [{ kind: "settle", outcome: DISK_FULL, upTo: 2 }],
        state: "failed 2",
      },
      {
        base: initial,
        error: DISK_FULL,
        kind: "failed",
        rev: 2,
        values: titled("A limits D"),
      },
    ]);
  });

  it("keeps failed words until a retry saves them", () => {
    expect(
      run([
        edit(1, "A limits C"),
        { kind: "flush" },
        { kind: "answered", outcome: DISK_FULL, rev: 1 },
        // Nothing is sent again by itself: a flush leaves a failed draft as it is.
        { kind: "flush" },
        { kind: "retry" },
        { kind: "answered", outcome: { kind: "ok" }, rev: 1 },
      ]).log.map((entry) => entry.state)
    ).toStrictEqual([
      "dirty 1",
      "saving 1",
      "failed 1",
      "failed 1",
      "saving 1",
      "clean",
    ]);
  });

  it("goes back to dirty when failed words are edited, and saves them on the next flush", () => {
    const { log } = run([
      edit(1, "A limits C"),
      { kind: "flush" },
      { kind: "answered", outcome: DISK_FULL, rev: 1 },
      edit(2, "A limits CD"),
      { kind: "flush" },
    ]);

    expect(log.slice(-2)).toStrictEqual([
      { effects: [], state: "dirty 2" },
      {
        effects: [
          {
            call: { kind: "text", text: sent("A limits CD") },
            kind: "send",
            rev: 2,
          },
        ],
        state: "saving 2",
      },
    ]);
  });

  it("is removed by Discard changes, which refuses any copy still waiting", () => {
    expect(
      run([
        edit(1, "A limits C"),
        { kind: "flush" },
        { kind: "answered", outcome: DISK_FULL, rev: 1 },
        { kind: "discard" },
      ]).log.at(-1)
    ).toStrictEqual({
      effects: [{ kind: "settle", outcome: DISCARDED, upTo: 1 }],
      state: "clean",
    });
  });

  it("is discarded while still waiting to be sent, as after typing on past a failure", () => {
    expect(
      run([
        edit(1, "A limits C"),
        { kind: "flush" },
        { kind: "answered", outcome: DISK_FULL, rev: 1 },
        edit(2, "A limits CD"),
        { kind: "discard" },
      ]).log.at(-1)
    ).toStrictEqual({
      effects: [{ kind: "settle", outcome: DISCARDED, upTo: 2 }],
      state: "clean",
    });
  });

  it("is not discarded while an older save is still on its way", () => {
    expect(
      run([
        edit(1, "A limits C"),
        { kind: "flush" },
        edit(2, "A limits D"),
        { kind: "discard" },
      ]).log.at(-1)
    ).toStrictEqual({ effects: [], state: "dirty 2" });
  });

  it("is never discarded while it may still be saving", () => {
    expect(
      run([
        edit(1, "A limits C"),
        { kind: "flush" },
        { kind: "discard" },
      ]).log.at(-1)
    ).toStrictEqual({ effects: [], state: "saving 1" });
  });

  it("is clean at once, with nothing sent, when its words are what main holds", () => {
    expect(
      run([edit(1, "A limits B "), { kind: "flush" }]).log.at(-1)
    ).toStrictEqual({
      effects: [{ kind: "settle", outcome: { kind: "ok" }, upTo: 1 }],
      state: "clean",
    });
  });

  it("never sends a blank title", () => {
    expect(run([edit(1, "  "), { kind: "flush" }]).log.at(-1)).toStrictEqual({
      effects: [],
      state: "dirty 1",
    });
  });

  it("sends a checked step as a check, so the edited time stays", () => {
    expect(
      run([
        {
          base: initial,
          kind: "edit",
          rev: 1,
          values: {
            ...initial,
            todos: [{ done: true, id: "t1", text: "Call" }],
          },
        },
        { kind: "flush" },
      ]).log.at(-1)
    ).toStrictEqual({
      effects: [
        {
          call: { done: true, kind: "check", todoId: "t1" },
          kind: "send",
          rev: 1,
        },
      ],
      state: "saving 1",
    });
  });

  it("ignores an answer for words it no longer waits on", () => {
    expect(
      run([
        edit(1, "A limits C"),
        { kind: "flush" },
        { kind: "answered", outcome: { kind: "ok" }, rev: 7 },
      ]).log.at(-1)
    ).toStrictEqual({ effects: [], state: "saving 1" });
  });
});

/** A store whose saves answer with `outcomes` in turn, ok after that; `hold` keeps the next one waiting. */
const setup = (outcomes: MutationOutcome[] = []) => {
  const calls: string[] = [];
  const held: ((outcome: MutationOutcome) => void)[] = [];
  let holding = false;

  const answer = () => {
    if (holding) {
      const { promise, resolve } = Promise.withResolvers<MutationOutcome>();

      held.push(resolve);

      return promise;
    }

    return Promise.resolve<MutationOutcome>(outcomes.shift() ?? { kind: "ok" });
  };

  const store: TextStore = {
    setTodoDone: (_id, todoId, done) => {
      calls.push(`done ${todoId} ${String(done)}`);

      return answer();
    },
    updateText: (_id, text) => {
      calls.push(
        `text ${text.relationship} ${text.todos.map((todo) => `${todo.text}:${String(todo.done)}`).join(",")}`
      );

      return answer();
    },
  };

  const drafts = new DraftStore(() => store);

  return {
    calls,
    drafts,
    /** Saves wait from now until released. */
    hold: () => {
      holding = true;
    },
    /** Answers the oldest held save, ok. */
    release: () => {
      holding = false;
      held.shift()?.({ kind: "ok" });
    },
    shown: () => drafts.shown(ID, initial),
  };
};

describe(DraftStore, () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves once, a while after the last keystroke", async () => {
    const { calls, drafts } = setup();

    drafts.edit(ID, titled("A limits"), initial);
    vi.advanceTimersByTime(SAVE_AFTER_MS / 2);
    drafts.edit(ID, titled("A limits C"), initial);
    await vi.runAllTimersAsync();

    expect([calls, drafts.draft(ID)]).toStrictEqual([
      ["text A limits C Call:false"],
      undefined,
    ]);
  });

  it("sends nothing when a flush finds no change, so the edited time stays", async () => {
    const { calls, drafts } = setup();

    drafts.flush(ID);
    drafts.edit(
      ID,
      {
        ...initial,
        todos: [...initial.todos, { done: false, id: "t2", text: " " }],
      },
      initial
    );
    drafts.flush(ID);
    await vi.runAllTimersAsync();

    expect(calls).toStrictEqual([]);
  });

  it("leaves the due date to its own call, so picking one sends no text", async () => {
    const { calls, drafts } = setup();

    drafts.edit(ID, { ...initial, due: "2026-11-07" }, initial);
    drafts.flush(ID);
    await vi.runAllTimersAsync();

    expect(calls).toStrictEqual([]);
  });

  it("never saves a blank title, and restores the saved one", async () => {
    const { calls, drafts, shown } = setup();

    drafts.edit(ID, titled("  "), initial);
    drafts.flush(ID);
    drafts.restoreBlankTitle(ID);
    await vi.runAllTimersAsync();

    expect([calls, shown().relationship]).toStrictEqual([[], "A limits B"]);
  });

  it("checks a saved step off at once, after any text save before it", async () => {
    const { calls, drafts, shown } = setup();

    drafts.edit(ID, titled("A limits C"), initial);
    drafts.flush(ID);
    await vi.advanceTimersByTimeAsync(0);
    drafts.toggle(ID, "t1", true, shown());
    await vi.runAllTimersAsync();

    expect(calls).toStrictEqual(["text A limits C Call:false", "done t1 true"]);
  });

  it("sends the whole text when a check meets unsaved typing", async () => {
    const { calls, drafts, shown } = setup();

    drafts.edit(
      ID,
      {
        ...initial,
        todos: [...initial.todos, { done: false, id: "t2", text: "Write" }],
      },
      initial
    );
    drafts.toggle(ID, "t2", true, shown());
    await vi.runAllTimersAsync();

    expect(calls).toStrictEqual(["text A limits B Call:false,Write:true"]);
  });

  it("does not check off a step that was still blank at the last save", async () => {
    const { calls, drafts, shown } = setup();
    const call = { done: false, id: "t1", text: "Call Bob" };
    const blank = { done: false, id: "t2", text: "" };

    drafts.edit(ID, { ...initial, todos: [call, blank] }, initial);
    drafts.flush(ID);
    await vi.runAllTimersAsync();
    drafts.toggle(ID, "t2", true, shown());
    await vi.runAllTimersAsync();

    expect(calls).toStrictEqual(["text A limits B Call Bob:false"]);
  });

  it("keeps a trailing space being typed when the trimmed copy comes back", async () => {
    const { drafts, shown } = setup();

    drafts.edit(ID, titled("A limits C "), initial);
    drafts.flush(ID);
    await vi.runAllTimersAsync();
    drafts.adopt(ID, titled("A limits C"));

    expect(shown().relationship).toBe("A limits C ");
  });

  it("shows a fresher stored copy only once nothing is unsaved", async () => {
    const { drafts } = setup();
    const fresher = titled("A limits D");

    drafts.edit(ID, titled("A limits C"), initial);
    drafts.adopt(ID, fresher);

    const whileTyping = drafts.shown(ID, fresher).relationship;

    drafts.flush(ID);
    drafts.adopt(ID, fresher);

    const whileSaving = drafts.shown(ID, fresher).relationship;

    await vi.runAllTimersAsync();
    drafts.adopt(ID, fresher);

    expect([
      whileTyping,
      whileSaving,
      drafts.shown(ID, fresher).relationship,
    ]).toStrictEqual(["A limits C", "A limits C", "A limits D"]);
  });

  it("keeps failed words and their error after the capture is left, until Discard changes", async () => {
    const { calls, drafts, shown } = setup([DISK_FULL]);

    drafts.edit(ID, titled("TYPED, NOT SAVED"), initial);
    // Leaving the capture flushes it; nothing about the draft belongs to the page.
    drafts.flush(ID);
    await vi.runAllTimersAsync();

    const kept = { error: drafts.draft(ID)?.kind, shown: shown().relationship };

    drafts.discard(ID);

    expect({ calls, discarded: shown().relationship, kept }).toStrictEqual({
      calls: ["text TYPED, NOT SAVED Call:false"],
      discarded: "A limits B",
      kept: { error: "failed", shown: "TYPED, NOT SAVED" },
    });
  });

  it("keeps the error on screen while more is typed after a failure, until a save works", async () => {
    const { drafts } = setup([DISK_FULL, DISK_FULL]);

    drafts.edit(ID, titled("A limits C"), initial);
    drafts.flush(ID);
    await vi.runAllTimersAsync();
    drafts.edit(ID, titled("A limits CD"), initial);

    const whileTyping = [drafts.draft(ID)?.kind, drafts.error(ID)];

    await vi.runAllTimersAsync();

    const afterSecondFailure = drafts.error(ID);

    drafts.retry(ID);
    await vi.runAllTimersAsync();

    expect({
      afterSecondFailure,
      saved: [drafts.draft(ID), drafts.error(ID)],
      whileTyping,
    }).toStrictEqual({
      afterSecondFailure: DISK_FULL,
      saved: [undefined, undefined],
      whileTyping: ["dirty", DISK_FULL],
    });
  });

  it("sends failed words again on Retry", async () => {
    const { calls, drafts } = setup([DISK_FULL]);

    drafts.edit(ID, titled("A limits C"), initial);
    drafts.flush(ID);
    await vi.runAllTimersAsync();
    drafts.retry(ID);
    await vi.runAllTimersAsync();

    expect([calls, drafts.draft(ID)]).toStrictEqual([
      ["text A limits C Call:false", "text A limits C Call:false"],
      undefined,
    ]);
  });

  it("reads a rejected call, such as a closed channel, as a failed save", async () => {
    const drafts = new DraftStore(() => ({
      setTodoDone: () => Promise.reject(new Error("closed")),
      updateText: () => Promise.reject(new Error("closed")),
    }));

    drafts.edit(ID, titled("A limits C"), initial);
    drafts.flush(ID);
    await vi.runAllTimersAsync();

    expect(drafts.draft(ID)).toMatchObject({
      error: { kind: "failed", message: "Error: closed" },
      kind: "failed",
    });
  });

  it("sends the latest text at once when the page goes away behind a save still in flight", async () => {
    const { calls, drafts, hold, release } = setup();

    hold();
    drafts.edit(ID, titled("A limits C"), initial);
    drafts.flush(ID);
    drafts.edit(ID, titled("A limits D"), initial);
    drafts.flush(ID);
    drafts.leave();

    const atLeaving = [...calls];

    release();
    await vi.runAllTimersAsync();

    expect([atLeaving, calls]).toStrictEqual([
      ["text A limits C Call:false", "text A limits D Call:false"],
      atLeaving,
    ]);
  });

  it("carries a queued check in that last text", async () => {
    const { calls, drafts, hold, release, shown } = setup();

    hold();
    drafts.edit(ID, titled("A limits C"), initial);
    drafts.flush(ID);
    drafts.toggle(ID, "t1", true, shown());
    drafts.leave();

    const atLeaving = [...calls];

    release();
    await vi.runAllTimersAsync();

    expect([atLeaving, calls]).toStrictEqual([
      ["text A limits C Call:false", "text A limits C Call:true"],
      atLeaving,
    ]);
  });

  it("forgets a deleted capture's words and refuses a copy waiting on them", async () => {
    const { drafts, hold } = setup();

    hold();
    drafts.edit(ID, titled("A limits C"), initial);

    const snapshot = drafts.snapshot(ID);

    drafts.forget(ID);

    expect([
      snapshot.kind === "pending" ? await snapshot.saved : null,
      drafts.draft(ID),
    ]).toStrictEqual([{ kind: "missing" }, undefined]);
  });
});
