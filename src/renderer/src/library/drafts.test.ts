import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MutationOutcome } from "../../../shared/dto";
import type { CaptureId, ViewId } from "../../../shared/ids";
import { SETTLE_MS } from "../../../shared/leave";
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

  it("is removed by Discard changes, which refuses any copy still waiting and tells main nothing of it is on its way", () => {
    expect(
      run([
        edit(1, "A limits C"),
        { kind: "flush" },
        { kind: "answered", outcome: DISK_FULL, rev: 1 },
        { kind: "discard" },
      ]).log.at(-1)
    ).toStrictEqual({
      effects: [
        { kind: "settle", outcome: DISCARDED, upTo: 1 },
        { kind: "discard", rev: null },
      ],
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
      effects: [
        { kind: "settle", outcome: DISCARDED, upTo: 2 },
        { kind: "discard", rev: null },
      ],
      state: "clean",
    });
  });

  it("is discarded at once while an older save is on its way, and names that save for main to drop or undo", () => {
    const { draft, log } = run([
      edit(1, "A limits C"),
      { kind: "flush" },
      edit(2, "A limits D"),
      { kind: "discard" },
    ]);

    expect([log.at(-1), draft]).toStrictEqual([
      {
        effects: [
          { kind: "settle", outcome: DISCARDED, upTo: 2 },
          { kind: "discard", rev: 1 },
        ],
        state: "clean",
      },
      null,
    ]);
  });

  it("never sends anything to undo a discarded save, and ignores its answer, ok or failed", () => {
    const landed = run([
      edit(1, "A limits C"),
      { kind: "flush" },
      { kind: "discard" },
      { kind: "answered", outcome: { kind: "ok" }, rev: 1 },
    ]);

    const failed = run([
      edit(1, "A limits C"),
      { kind: "flush" },
      { kind: "discard" },
      { kind: "answered", outcome: DISK_FULL, rev: 1 },
    ]);

    expect([
      landed.log.slice(2),
      landed.draft,
      failed.log.at(-1),
      failed.draft,
    ]).toStrictEqual([
      [
        {
          effects: [
            { kind: "settle", outcome: DISCARDED, upTo: 1 },
            { kind: "discard", rev: 1 },
          ],
          state: "clean",
        },
        { effects: [], state: "clean" },
      ],
      null,
      { effects: [], state: "clean" },
      null,
    ]);
  });

  it("is clean when words typed back to the saved ones meet a failed save of the others", () => {
    expect(
      run([
        edit(1, "A limits C"),
        { kind: "flush" },
        edit(2, "A limits B"),
        { kind: "answered", outcome: DISK_FULL, rev: 1 },
      ]).log.at(-1)
    ).toStrictEqual({
      effects: [
        { kind: "settle", outcome: DISK_FULL, upTo: 1 },
        { kind: "settle", outcome: { kind: "ok" }, upTo: 2 },
      ],
      state: "clean",
    });
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

  /** The saves main was told to drop or undo, by rev; null when none was on its way. */
  const discards: (number | null)[] = [];

  const store: TextStore = {
    discard: (_id, rev) => {
      discards.push(rev);

      return Promise.resolve({ kind: "ok" });
    },
    setTodoDone: (_id, todoId, done) => {
      calls.push(`done ${todoId} ${String(done)}`);

      return answer();
    },
    updateText: (_id, text) => {
      calls.push(
        `text ${text.relationship} ${text.todos.map((todo) => `${todo.text}:${String(todo.done)}`).join(",")}${text.due === null ? "" : ` due ${text.due}`}`
      );

      return answer();
    },
  };

  const drafts = new DraftStore(() => store);

  return {
    calls,
    discards,
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

  it("saves a picked due date at once, with the words, as part of the draft", () => {
    const { calls, drafts, hold, shown } = setup();

    hold();
    drafts.setDue(ID, "2026-11-07", initial);

    const whileSaving = [drafts.draft(ID)?.kind, shown().due, drafts.count];

    expect([calls, whileSaving]).toStrictEqual([
      ["text A limits B Call:false due 2026-11-07"],
      ["saving", "2026-11-07", 1],
    ]);
  });

  it("keeps a Due that couldn’t be saved as a failed draft, with Retry and Discard", async () => {
    const { calls, discards, drafts, shown } = setup([DISK_FULL]);

    drafts.setDue(ID, "2026-11-07", initial);
    await vi.runAllTimersAsync();

    const failed = [drafts.draft(ID)?.kind, shown().due, drafts.error(ID)];

    drafts.discard(ID);

    expect({
      calls,
      discarded: [drafts.draft(ID), shown().due, drafts.error(ID)],
      discards,
      failed,
    }).toStrictEqual({
      calls: ["text A limits B Call:false due 2026-11-07"],
      discarded: [undefined, null, undefined],
      discards: [null],
      failed: ["failed", "2026-11-07", DISK_FULL],
    });
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

  it("shows the saved words at once on Discard changes, even while their save hangs, and never sends them", async () => {
    const { calls, discards, drafts, hold, release, shown } = setup([
      DISK_FULL,
    ]);

    drafts.edit(ID, titled("FAILED ONCE"), initial);
    drafts.flush(ID);
    await vi.runAllTimersAsync();
    hold();
    void drafts.retry(ID);

    const copy = drafts.snapshot(ID);

    drafts.discard(ID);

    const atDiscard = {
      error: drafts.error(ID),
      shown: shown().relationship,
      unsaved: drafts.count,
    };

    // The discarded words land late, and well: main undoes that, so nothing is sent.
    release();
    await vi.runAllTimersAsync();

    expect({
      atDiscard,
      calls,
      copy: copy.kind === "pending" ? await copy.saved : copy.kind,
      discards,
      draft: drafts.draft(ID),
      shown: shown().relationship,
      unsaved: drafts.count,
    }).toStrictEqual({
      // The Discard is on its way: a close asks about it until main has answered.
      atDiscard: { error: undefined, shown: "A limits B", unsaved: 1 },
      calls: ["text FAILED ONCE Call:false", "text FAILED ONCE Call:false"],
      copy: DISCARDED,
      discards: [1],
      draft: undefined,
      shown: "A limits B",
      unsaved: 0,
    });
  });

  it("never shows discarded words again when their late save fails", async () => {
    const { calls, discards, drafts, hold, shown } = setup();
    const answers: ((outcome: MutationOutcome) => void)[] = [];

    const late = new DraftStore(() => ({
      discard: (_id, rev) => {
        discards.push(rev);

        return Promise.resolve({ kind: "ok" });
      },
      setTodoDone: () => Promise.resolve({ kind: "ok" }),
      updateText: (_id, text) => {
        calls.push(`text ${text.relationship}`);

        const { promise, resolve } = Promise.withResolvers<MutationOutcome>();

        answers.push(resolve);

        return promise;
      },
    }));

    hold();
    late.edit(ID, titled("DISCARD ME"), initial);
    late.flush(ID);
    late.discard(ID);

    const atDiscard = late.shown(ID, initial).relationship;

    answers.shift()?.(DISK_FULL);
    await vi.runAllTimersAsync();

    expect({
      atDiscard,
      calls,
      discards,
      draft: late.draft(ID),
      error: late.error(ID),
      later: late.shown(ID, initial).relationship,
      untouched: [drafts.draft(ID), shown().relationship],
    }).toStrictEqual({
      atDiscard: "A limits B",
      calls: ["text DISCARD ME"],
      discards: [1],
      draft: undefined,
      error: undefined,
      later: "A limits B",
      untouched: [undefined, "A limits B"],
    });
  });

  it("never takes discarded words that landed as the saved baseline, though a stored copy carries them for a while", async () => {
    const { calls, discards, drafts, hold, release } = setup();
    const landed = titled("DISCARD ME");
    const later = titled("Edited elsewhere");

    hold();
    drafts.edit(ID, landed, initial);
    drafts.flush(ID);
    drafts.discard(ID);
    release();
    await vi.runAllTimersAsync();

    const afterAnswer = drafts.shown(ID, landed).relationship;

    // Main told the page the discarded words landed, before it put the saved ones back.
    drafts.adopt(ID, landed);

    const staleCopy = drafts.shown(ID, landed).relationship;

    drafts.adopt(ID, initial);
    drafts.adopt(ID, later);

    expect({
      afterAnswer,
      calls,
      discards,
      fresh: drafts.shown(ID, later).relationship,
      staleCopy,
    }).toStrictEqual({
      afterAnswer: "A limits B",
      calls: ["text DISCARD ME Call:false"],
      discards: [1],
      fresh: "Edited elsewhere",
      staleCopy: "A limits B",
    });
  });

  it("saves an edit made after a discard over the saved baseline", async () => {
    const { calls, drafts, shown } = setup([DISK_FULL]);

    drafts.edit(ID, titled("DISCARD ME"), initial);
    drafts.flush(ID);
    await vi.runAllTimersAsync();
    drafts.discard(ID);
    drafts.edit(ID, titled("A limits E"), shown());
    drafts.flush(ID);
    await vi.runAllTimersAsync();

    expect([calls, drafts.draft(ID), shown().relationship]).toStrictEqual([
      ["text DISCARD ME Call:false", "text A limits E Call:false"],
      undefined,
      "A limits E",
    ]);
  });

  it("keeps edits after a Discard that couldn’t finish in that failed draft, sends nothing until Retry keeps them, and Discard asks main again", () => {
    const failed: Draft = {
      base: initial,
      error: DISK_FULL,
      kind: "failed",
      landed: { rev: 1, words: sent("LANDED") },
      rev: 1,
      values: titled("LANDED"),
    };

    const edited = step(failed, edit(2, "LANDED AND MORE")).draft;
    const flushed = step(edited, { kind: "flush" });
    const again = step(flushed.draft, { kind: "discard" });
    const kept = step(flushed.draft, { kind: "retry" });

    expect({
      again,
      edited,
      flushed: flushed.effects,
      kept,
    }).toStrictEqual({
      again: {
        draft: null,
        effects: [
          { kind: "settle", outcome: DISCARDED, upTo: 2 },
          { kind: "discard", rev: 1 },
        ],
      },
      edited: { ...failed, rev: 2, values: titled("LANDED AND MORE") },
      flushed: [],
      kept: {
        draft: {
          base: sent("LANDED"),
          kind: "saving",
          rev: 2,
          values: titled("LANDED AND MORE"),
        },
        effects: [
          {
            call: { kind: "text", text: sent("LANDED AND MORE") },
            kind: "send",
            rev: 2,
          },
        ],
      },
    });
  });

  it("brings discarded changes back as not saved when main can’t undo their landed save, and the next Discard asks again", async () => {
    const discards: (number | null)[] = [];
    const saved = Promise.withResolvers<MutationOutcome>();

    const undone: MutationOutcome[] = [
      {
        kind: "failed",
        message: "The disk is read-only.",
      },
    ];

    const drafts = new DraftStore(() => ({
      discard: (_id, rev) => {
        discards.push(rev);

        return Promise.resolve(undone.shift() ?? { kind: "ok" });
      },
      setTodoDone: () => Promise.resolve({ kind: "ok" }),
      updateText: () => saved.promise,
    }));

    const seen = () => ({
      error: drafts.error(ID) ?? null,
      shown: drafts.shown(ID, initial).relationship,
      unsaved: drafts.count,
    });

    drafts.edit(ID, titled("DISCARDED"), initial);
    drafts.flush(ID);
    drafts.discard(ID);

    const atOnce = seen();

    await vi.runAllTimersAsync();

    const back = seen();

    saved.resolve({ kind: "ok" });
    await vi.runAllTimersAsync();
    drafts.discard(ID);
    await vi.runAllTimersAsync();

    expect({ atOnce, back, discards, end: seen() }).toStrictEqual({
      // Unsaved until main answers the Discard, which may not put the saved version back.
      atOnce: { error: null, shown: initial.relationship, unsaved: 1 },
      back: {
        error: {
          kind: "failed",
          message: "The disk is read-only.",
        },
        shown: "DISCARDED",
        unsaved: 1,
      },
      discards: [1, 1],
      end: { error: null, shown: initial.relationship, unsaved: 0 },
    });
  });

  it("answers a Retry whose save hangs after SETTLE_MS, keeping the words", async () => {
    const { drafts, hold } = setup([DISK_FULL]);

    drafts.edit(ID, titled("A limits C"), initial);
    drafts.flush(ID);
    await vi.runAllTimersAsync();
    hold();

    const retried = drafts.retry(ID);
    const now = () => Promise.race([retried, Promise.resolve("still waiting")]);

    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);

    const before = await now();

    await vi.advanceTimersByTimeAsync(1);

    expect([
      before,
      await now(),
      drafts.draft(ID)?.values.relationship,
      drafts.error(ID),
    ]).toStrictEqual([
      "still waiting",
      { kind: "failed", message: "Saving didn’t finish in time." },
      "A limits C",
      DISK_FULL,
    ]);
  });

  it("answers Retry with how its save went", async () => {
    const { drafts } = setup([DISK_FULL, DISK_FULL]);

    drafts.edit(ID, titled("A limits C"), initial);
    drafts.flush(ID);
    await vi.runAllTimersAsync();

    const again = drafts.retry(ID);

    await vi.runAllTimersAsync();

    const saved = drafts.retry(ID);

    await vi.runAllTimersAsync();

    expect([await again, await saved, await drafts.retry(ID)]).toStrictEqual([
      DISK_FULL,
      { kind: "ok" },
      { kind: "ok" },
    ]);
  });

  it("stops waiting for a save that never answers after SETTLE_MS, and says so", async () => {
    const drafts = new DraftStore(() => ({
      discard: vi.fn<TextStore["discard"]>(() =>
        Promise.resolve({ kind: "ok" })
      ),
      setTodoDone: () => Promise.resolve({ kind: "ok" }),
      updateText: () => Promise.withResolvers<MutationOutcome>().promise,
    }));

    drafts.edit(ID, titled("HUNG"), initial);

    const settling = drafts.settle();

    const now = () =>
      Promise.race([settling, Promise.resolve("still waiting")]);

    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);

    const before = await now();

    await vi.advanceTimersByTimeAsync(1);

    expect([before, await now()]).toStrictEqual([
      "still waiting",
      {
        count: 1,
        error: null,
        late: true,
        stalled: 0,
        typedSince: false,
        undiscarded: false,
      },
    ]);
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
      discard: vi.fn<TextStore["discard"]>(() =>
        Promise.resolve({ kind: "ok" })
      ),
      setTodoDone: () => Promise.reject(new Error("closed")),
      updateText: () => Promise.reject(new Error("closed")),
    }));

    drafts.edit(ID, titled("A limits C"), initial);
    drafts.flush(ID);
    await vi.runAllTimersAsync();

    expect(drafts.draft(ID)).toMatchObject({
      error: { kind: "failed", message: "Couldn’t save." },
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

/** A page whose main logs every call, and answers each Discard with `discards` in turn. */
const owedPage = (discards: Promise<MutationOutcome>[] = []) => {
  const main: string[] = [];

  const drafts = new DraftStore(() => ({
    discard: (_id, rev) => {
      main.push(`discard ${String(rev)}`);

      return discards.shift() ?? Promise.resolve({ kind: "ok" });
    },
    setTodoDone: () => Promise.resolve({ kind: "ok" }),
    updateText: (_id, text) => {
      main.push(`save ${text.relationship}`);

      return Promise.resolve({ kind: "ok" });
    },
  }));

  return { drafts, main };
};

describe("a Discard main still owes as the page opens", () => {
  const CANT_WRITE = "Inset can’t write to its data folder.";

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows one main couldn’t finish as not discarded, refuses copies, keeps edits in it, and Discard again names main’s save", async () => {
    const { drafts, main } = owedPage();

    drafts.owe([
      {
        captureId: ID,
        message: CANT_WRITE,
        rev: 7,
        saved: initial,
        words: titled("Discarded"),
      },
    ]);

    const atOpen = {
      count: drafts.count,
      error: drafts.error(ID),
      shown: drafts.shown(ID, titled("Discarded")).relationship,
      snapshot: drafts.snapshot(ID).kind,
    };

    drafts.edit(ID, titled("Discarded, edited"), titled("Discarded"));
    await vi.advanceTimersByTimeAsync(SAVE_AFTER_MS + 10);

    const afterEdit = [...main];

    drafts.discard(ID);
    await vi.advanceTimersByTimeAsync(10);

    expect({
      afterEdit,
      atOpen,
      main,
      shown: drafts.shown(ID, titled("Discarded")).relationship,
    }).toStrictEqual({
      afterEdit: [],
      atOpen: {
        count: 1,
        error: { kind: "failed", message: CANT_WRITE },
        shown: "Discarded",
        snapshot: "undiscarded",
      },
      main: ["discard 7"],
      shown: "A limits B",
    });
  });

  it("asks main again for one it hasn’t answered, shows the saved words meanwhile, and holds edits until it answers", async () => {
    const answer = Promise.withResolvers<MutationOutcome>();
    const { drafts, main } = owedPage([answer.promise]);

    drafts.owe([
      {
        captureId: ID,
        message: null,
        rev: 7,
        saved: initial,
        words: titled("Discarded"),
      },
    ]);

    const atOpen = {
      count: drafts.count,
      shown: drafts.shown(ID, titled("Discarded")).relationship,
      unsaved: drafts.unsaved(),
    };

    drafts.edit(ID, titled("Typed meanwhile"), initial);
    await vi.advanceTimersByTimeAsync(SAVE_AFTER_MS + 10);

    const meanwhile = [...main];

    answer.resolve({ kind: "failed", message: CANT_WRITE });
    await vi.advanceTimersByTimeAsync(10);

    expect({
      atOpen,
      main,
      meanwhile,
      now: {
        error: drafts.error(ID),
        shown: drafts.shown(ID, titled("Discarded")).relationship,
        undiscarded: drafts.undiscarded(ID),
      },
    }).toStrictEqual({
      atOpen: {
        count: 1,
        shown: "A limits B",
        unsaved: {
          count: 1,
          error: null,
          late: true,
          stalled: 1,
          typedSince: false,
          undiscarded: true,
        },
      },
      main: ["discard 7"],
      meanwhile: ["discard 7"],
      now: {
        error: { kind: "failed", message: CANT_WRITE },
        shown: "Typed meanwhile",
        undiscarded: true,
      },
    });
  });

  it("sends what was typed once main puts the saved version back", async () => {
    const answer = Promise.withResolvers<MutationOutcome>();
    const { drafts, main } = owedPage([answer.promise]);

    drafts.owe([
      {
        captureId: ID,
        message: null,
        rev: 7,
        saved: initial,
        words: titled("Discarded"),
      },
    ]);
    drafts.edit(ID, titled("Typed meanwhile"), initial);
    await vi.advanceTimersByTimeAsync(SAVE_AFTER_MS + 10);
    answer.resolve({ kind: "ok" });
    await vi.advanceTimersByTimeAsync(10);

    expect({ count: drafts.count, main }).toStrictEqual({
      count: 0,
      main: ["discard 7", "save Typed meanwhile"],
    });
  });
});
