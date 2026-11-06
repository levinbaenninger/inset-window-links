import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MutationOutcome } from "../../../shared/dto";
import type { CaptureId, ViewId } from "../../../shared/ids";
import type { DraftText } from "../../../shared/text";
import type { TextStore } from "./inline-saver";
import {
  InlineSaver,
  SAVE_AFTER_MS,
  savePending,
  saverFor,
  trackSaver,
} from "./inline-saver";

// SAFETY: CaptureId and ViewId are branded UUID strings; the saver only passes them through.
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

const setup = (
  outcomes: MutationOutcome[] = [],
  { holdFirst = false }: { holdFirst?: boolean } = {}
) => {
  const calls: string[] = [];
  let resolveHeld: ((outcome: MutationOutcome) => void) | null = null;
  let held = holdFirst;

  const store = {
    setTodoDone: vi.fn<TextStore["setTodoDone"]>((_id, todoId, done) => {
      calls.push(`done ${todoId} ${String(done)}`);

      return Promise.resolve<MutationOutcome>({ kind: "ok" });
    }),
    updateText: vi.fn<TextStore["updateText"]>((_id, text) => {
      calls.push(
        `text ${text.relationship} ${text.todos.map((todo) => `${todo.text}:${String(todo.done)}`).join(",")}`
      );

      if (held) {
        held = false;

        const { promise, resolve } = Promise.withResolvers<MutationOutcome>();

        resolveHeld = resolve;

        return promise;
      }

      return Promise.resolve<MutationOutcome>(
        outcomes.shift() ?? { kind: "ok" }
      );
    }),
  };

  const saver = new InlineSaver(ID, store);

  saver.adopt(initial);

  return { calls, release: () => resolveHeld?.({ kind: "ok" }), saver };
};

describe(InlineSaver, () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves once, a while after the last keystroke", async () => {
    const { calls, saver } = setup();

    saver.edit({ ...initial, relationship: "A limits" });
    vi.advanceTimersByTime(SAVE_AFTER_MS / 2);
    saver.edit({ ...initial, relationship: "A limits C" });
    vi.advanceTimersByTime(SAVE_AFTER_MS);
    await vi.runAllTimersAsync();

    expect(calls).toStrictEqual(["text A limits C Call:false"]);
  });

  it("sends nothing when a flush finds no change, so the edited time stays", async () => {
    const { calls, saver } = setup();

    saver.flush();
    saver.edit({
      ...initial,
      todos: [...initial.todos, { done: false, id: "t2", text: " " }],
    });
    saver.flush();
    await vi.runAllTimersAsync();

    expect(calls).toStrictEqual([]);
  });

  it("saves a window's description, and ignores only spaces around it", async () => {
    const { calls, saver } = setup();

    saver.edit({ ...initial, viewDescriptions: { [VIEW]: "  " } });
    saver.flush();
    saver.edit({ ...initial, viewDescriptions: { [VIEW]: "The cap " } });
    saver.flush();
    await vi.runAllTimersAsync();

    expect(calls).toStrictEqual(["text A limits B Call:false"]);
  });

  it("leaves the due date to its own call, so picking one sends no text", async () => {
    const { calls, saver } = setup();

    saver.edit({ ...initial, due: "2026-11-07" });
    saver.flush();
    await vi.runAllTimersAsync();

    expect(calls).toStrictEqual([]);
  });

  it("never saves a blank title, and restores the saved one", async () => {
    const { calls, saver } = setup();

    saver.edit({ ...initial, relationship: "  " });
    saver.flush();
    saver.restoreBlankTitle();
    await vi.runAllTimersAsync();

    expect([calls, saver.state().text?.relationship]).toStrictEqual([
      [],
      "A limits B",
    ]);
  });

  it("checks a saved step off at once, after any text save before it", async () => {
    const { calls, saver } = setup();

    saver.edit({ ...initial, relationship: "A limits C" });
    saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    saver.toggle("t1", true);
    await vi.runAllTimersAsync();

    expect(calls).toStrictEqual(["text A limits C Call:false", "done t1 true"]);
  });

  it("sends the whole text when a check meets unsaved typing", async () => {
    const { calls, saver } = setup();

    saver.edit({
      ...initial,
      todos: [...initial.todos, { done: false, id: "t2", text: "Write" }],
    });
    saver.toggle("t2", true);
    await vi.runAllTimersAsync();

    expect(calls).toStrictEqual(["text A limits B Call:false,Write:true"]);
  });

  it("adopts a fresher stored copy only when nothing is unsaved or in flight", async () => {
    const { saver } = setup();
    const fresher = { ...initial, relationship: "A limits D" };

    saver.edit({ ...initial, relationship: "A limits C" });
    saver.adopt(fresher);

    const whileTyping = saver.state().text?.relationship;

    saver.flush();
    saver.adopt(fresher);

    const whileSaving = saver.state().text?.relationship;

    await vi.runAllTimersAsync();
    saver.adopt(fresher);

    expect([
      whileTyping,
      whileSaving,
      saver.state().text?.relationship,
    ]).toStrictEqual(["A limits C", "A limits C", "A limits D"]);
  });

  it("reports a failed call", async () => {
    const outcomes: (string | undefined)[] = [];

    const saver = new InlineSaver(ID, {
      setTodoDone: () => Promise.reject(new Error("disk full")),
      updateText: () => Promise.resolve({ kind: "readOnly", version: 9 }),
    });

    saver.adopt(initial);
    saver.subscribe(() => outcomes.push(saver.state().outcome?.kind));
    saver.edit({ ...initial, relationship: "A limits C" });
    saver.flush();
    saver.toggle("t1", true);
    await vi.runAllTimersAsync();

    expect(outcomes.filter((kind) => kind !== undefined)).toStrictEqual([
      "readOnly",
      "failed",
    ]);
  });

  it("keeps a trailing space being typed when the trimmed copy comes back", async () => {
    const { saver } = setup();

    saver.edit({ ...initial, relationship: "A limits C " });
    saver.flush();
    await vi.runAllTimersAsync();
    saver.adopt({ ...initial, relationship: "A limits C" });

    expect(saver.state().text?.relationship).toBe("A limits C ");
  });

  it("does not check off a step that was still blank at the last save", async () => {
    const { calls, saver } = setup();
    const call = { done: false, id: "t1", text: "Call Bob" };
    const blank = { done: false, id: "t2", text: "" };

    saver.edit({ ...initial, todos: [call, blank] });
    saver.flush();
    await vi.runAllTimersAsync();
    saver.toggle("t2", true);
    await vi.runAllTimersAsync();

    expect(calls).toStrictEqual(["text A limits B Call Bob:false"]);
  });

  it("sends a failed save again on the next flush", async () => {
    const { calls, saver } = setup([{ kind: "failed", message: "disk full" }]);

    saver.edit({ ...initial, relationship: "A limits C" });
    saver.flush();
    await vi.runAllTimersAsync();
    saver.flush();
    await vi.runAllTimersAsync();

    expect(calls).toStrictEqual([
      "text A limits C Call:false",
      "text A limits C Call:false",
    ]);
    expect(saver.state().outcome).toBeNull();
  });

  it("sends the latest text at once when the page goes away behind a save still in flight", async () => {
    const { calls, release, saver } = setup([], { holdFirst: true });

    saver.edit({ ...initial, relationship: "A limits C" });
    saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    saver.edit({ ...initial, relationship: "A limits D" });
    saver.flush();
    saver.flush({ leaving: true });
    const atLeaving = [...calls];

    release();
    await vi.runAllTimersAsync();

    expect(atLeaving).toStrictEqual([
      "text A limits C Call:false",
      "text A limits D Call:false",
    ]);
    expect(calls).toStrictEqual(atLeaving);
  });

  it("carries a queued check in that last text", async () => {
    const { calls, release, saver } = setup([], { holdFirst: true });

    saver.edit({ ...initial, relationship: "A limits C" });
    saver.flush();
    await vi.advanceTimersByTimeAsync(0);
    saver.toggle("t1", true);
    saver.flush({ leaving: true });
    const atLeaving = [...calls];

    release();
    await vi.runAllTimersAsync();

    expect(atLeaving).toStrictEqual([
      "text A limits C Call:false",
      "text A limits C Call:true",
    ]);
    expect(calls).toStrictEqual(atLeaving);
  });

  it("keeps unsaved words when the page mounts again, as on the way to its viewer", async () => {
    const failed: MutationOutcome = { kind: "failed", message: "Disk full" };

    const store = {
      setTodoDone: vi.fn<TextStore["setTodoDone"]>(() =>
        Promise.resolve(failed)
      ),
      updateText: vi.fn<TextStore["updateText"]>(() => Promise.resolve(failed)),
    };

    const first = saverFor(ID, store);
    const leave = trackSaver(ID, first);

    first.adopt(initial);
    first.edit({ ...initial, relationship: "TYPED, NOT SAVED" });
    first.flush();

    // The page mounts again before the old one has let its saver go.
    const again = saverFor(ID, store);
    const stay = trackSaver(ID, again);

    leave();
    again.adopt(initial);
    await vi.runAllTimersAsync();

    const outcome = await savePending(ID);

    stay();
    await vi.runAllTimersAsync();

    expect({
      outcome: outcome.kind,
      same: again === first,
      shown: again.state().text?.relationship,
      thenLetGo: saverFor(ID, store) === first,
    }).toStrictEqual({
      outcome: "failed",
      same: true,
      shown: "TYPED, NOT SAVED",
      thenLetGo: false,
    });
  });
});
