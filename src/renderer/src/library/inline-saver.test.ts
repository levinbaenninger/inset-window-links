import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MutationOutcome } from "../../../shared/dto";
import type { CaptureId } from "../../../shared/ids";
import type { DraftText } from "../../../shared/text";
import type { TextStore } from "./inline-saver";
import { InlineSaver, SAVE_AFTER_MS } from "./inline-saver";

// SAFETY: CaptureId is a branded UUID string; the saver only passes it through.
const ID = "00000000-0000-4000-8000-000000000001" as CaptureId;

const initial: DraftText = {
  description: "",
  relationship: "A limits B",
  todos: [{ done: false, id: "t1", text: "Call" }],
};

const setup = () => {
  const calls: string[] = [];

  const store = {
    setTodoDone: vi.fn<TextStore["setTodoDone"]>((_id, todoId, done) => {
      calls.push(`done ${todoId} ${String(done)}`);

      return Promise.resolve<MutationOutcome>({ kind: "ok" });
    }),
    updateText: vi.fn<TextStore["updateText"]>((_id, text) => {
      calls.push(
        `text ${text.relationship} ${text.todos.map((todo) => `${todo.text}:${String(todo.done)}`).join(",")}`
      );

      return Promise.resolve<MutationOutcome>({ kind: "ok" });
    }),
  };

  const saver = new InlineSaver(ID, store);

  saver.adopt(initial);

  return { calls, saver };
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
});
