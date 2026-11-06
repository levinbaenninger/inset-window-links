import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MutationOutcome } from "../../../shared/dto";
import type { CaptureId } from "../../../shared/ids";
import type { DraftText } from "../../../shared/text";
import type { TextStore } from "./drafts";
import { DraftStore } from "./drafts";
import { LeaveFlow } from "./leave";

// SAFETY: CaptureIds are branded UUID strings; the store only passes them through.
const A = "00000000-0000-4000-8000-000000000001" as CaptureId;

// SAFETY: as above.
const B = "00000000-0000-4000-8000-000000000002" as CaptureId;

// SAFETY: as above.
const C = "00000000-0000-4000-8000-000000000003" as CaptureId;

const stored: DraftText = {
  description: "",
  due: null,
  relationship: "A limits B",
  todos: [],
  viewDescriptions: {},
};

const titled = (relationship: string): DraftText => ({
  ...stored,
  relationship,
});

const OK: MutationOutcome = { kind: "ok" };
const DISK_FULL: MutationOutcome = { kind: "failed", message: "disk full" };

/**
 * A page's drafts and its leave flow. Saves answer with `outcomes` in turn, ok after that, and
 * `log` holds what main hears in order: each save, each unsaved report, each answer.
 */
const setup = (outcomes: MutationOutcome[] = []) => {
  const log: string[] = [];
  const held: (() => void)[] = [];
  let holding = false;

  const store: TextStore = {
    setTodoDone: () => Promise.resolve(OK),
    updateText: (_id, text) => {
      log.push(
        `save ${text.relationship}${text.description === "" ? "" : ` / ${text.description}`}`
      );

      const outcome = outcomes.shift() ?? OK;

      if (!holding) {
        return Promise.resolve(outcome);
      }

      const { promise, resolve } = Promise.withResolvers<MutationOutcome>();

      held.push(() => resolve(outcome));

      return promise;
    },
  };

  const drafts = new DraftStore(() => store);

  const flow = new LeaveFlow(drafts, () => ({
    answerLeave: (answer) => log.push(answer),
    reportUnsaved: (unsaved) => log.push(`unsaved ${String(unsaved)}`),
  }));

  /** Types a title into a capture and saves it now. */
  const type = (id: CaptureId, relationship: string) => {
    drafts.edit(id, titled(relationship), stored);
    drafts.flush(id);
  };

  return {
    drafts,
    flow,
    /** Saves wait from now until released. */
    hold: () => {
      holding = true;
    },
    log,
    /** Answers every held save. */
    release: () => {
      holding = false;

      for (const answer of held.splice(0)) {
        answer();
      }
    },
    type,
  };
};

const settled = () => vi.runAllTimersAsync();

describe(LeaveFlow, () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets a page with nothing unsaved go at once, without a prompt", async () => {
    const { flow, log } = setup();

    flow.request("close");
    await settled();

    expect([log, flow.state()]).toStrictEqual([["go"], { kind: "idle" }]);
  });

  it("waits for a save on its way, then goes without a prompt", async () => {
    const { flow, hold, log, release, type } = setup();

    hold();
    type(A, "A limits C");
    flow.request("quit");
    await settled();

    const waiting = [[...log], flow.state()];

    release();
    await settled();

    expect([waiting, log]).toStrictEqual([
      [
        ["unsaved true", "save A limits C"],
        { kind: "waiting", reason: "quit" },
      ],
      ["unsaved true", "save A limits C", "unsaved false", "go"],
    ]);
  });

  it("holds for words that couldn't be saved, with how many and why, and sends nothing again", async () => {
    const { flow, log, type } = setup([DISK_FULL]);

    type(A, "A limits C");
    await settled();
    flow.request("close");
    await settled();

    expect([log, flow.state()]).toStrictEqual([
      ["unsaved true", "save A limits C", "held"],
      {
        kind: "held",
        reason: "close",
        retrying: false,
        unsaved: { count: 1, error: DISK_FULL },
      },
    ]);
  });

  it("counts each capture whose words couldn't be saved, not the ones that were", async () => {
    const { flow, type } = setup([DISK_FULL, DISK_FULL, OK]);

    type(A, "A limits C");
    type(B, "B limits C");
    type(C, "C limits D");
    await settled();
    flow.request("quit");
    await settled();

    expect(flow.state()).toStrictEqual({
      kind: "held",
      reason: "quit",
      retrying: false,
      unsaved: { count: 2, error: DISK_FULL },
    });
  });

  it("sends words still waiting for the pause, and waits again for an edit typed during the wait", async () => {
    const { drafts, flow, hold, log, release, type } = setup();

    hold();
    type(A, "one");
    drafts.edit(B, titled("pausing"), stored);
    flow.request("close");
    drafts.edit(A, titled("two"), stored);
    release();
    await settled();

    expect(log).toStrictEqual([
      "unsaved true",
      "save one",
      "save pausing",
      "save two",
      "unsaved false",
      "go",
    ]);
  });

  it("puts a blank title back to the saved one and saves the rest", async () => {
    const { drafts, flow, log } = setup();

    drafts.edit(
      A,
      { ...stored, description: "more", relationship: " " },
      stored
    );
    flow.request("close");
    await settled();

    expect(log).toStrictEqual([
      "unsaved true",
      "save A limits B / more",
      "unsaved false",
      "go",
    ]);
  });

  it("Retry that fails holds again; Retry that saves lets go", async () => {
    const { flow, log, type } = setup([DISK_FULL, DISK_FULL, OK]);

    type(A, "A limits C");
    await settled();
    flow.request("quit");
    await settled();
    void flow.retry();

    const retrying = flow.state();

    await settled();

    const failedAgain = flow.state();

    void flow.retry();
    await settled();

    expect([retrying, failedAgain, flow.state(), log]).toStrictEqual([
      {
        kind: "held",
        reason: "quit",
        retrying: true,
        unsaved: { count: 1, error: DISK_FULL },
      },
      {
        kind: "held",
        reason: "quit",
        retrying: false,
        unsaved: { count: 1, error: DISK_FULL },
      },
      { kind: "idle" },
      [
        "unsaved true",
        "save A limits C",
        "held",
        "save A limits C",
        "save A limits C",
        "unsaved false",
        "go",
      ],
    ]);
  });

  it("Discard gives up every capture's words, reports that, then lets go", async () => {
    const { drafts, flow, log, type } = setup([DISK_FULL, DISK_FULL]);

    type(A, "A limits C");
    type(B, "B limits C");
    await settled();
    flow.request("close");
    await settled();
    flow.discard();

    expect([
      log.slice(-3),
      drafts.unsaved,
      drafts.shown(A, stored),
    ]).toStrictEqual([["held", "unsaved false", "go"], false, stored]);
  });

  it("Cancel keeps the words and stays; the next close asks again", async () => {
    const { drafts, flow, log, type } = setup([DISK_FULL]);

    type(A, "A limits C");
    await settled();
    flow.request("close");
    await settled();
    flow.cancel();

    const afterCancel = [flow.state(), drafts.draft(A)?.kind, [...log]];

    flow.request("close");
    await settled();

    expect([afterCancel, log]).toStrictEqual([
      [
        { kind: "idle" },
        "failed",
        ["unsaved true", "save A limits C", "held", "stay"],
      ],
      ["unsaved true", "save A limits C", "held", "stay", "held"],
    ]);
  });

  it("turns a close's prompt into a quit's when a quit is asked for, with one answer for both", async () => {
    const { flow, log, type } = setup([DISK_FULL]);

    type(A, "A limits C");
    await settled();
    flow.request("close");
    await settled();
    flow.request("quit");

    const shown = flow.state();

    flow.discard();

    expect([shown, log]).toStrictEqual([
      {
        kind: "held",
        reason: "quit",
        retrying: false,
        unsaved: { count: 1, error: DISK_FULL },
      },
      [
        "unsaved true",
        "save A limits C",
        "held",
        "held",
        "unsaved false",
        "go",
      ],
    ]);
  });

  it("answers a second request during the wait only once", async () => {
    const { flow, hold, log, release, type } = setup();

    hold();
    type(A, "A limits C");
    flow.request("close");
    flow.request("quit");
    release();
    await settled();

    expect(log).toStrictEqual([
      "unsaved true",
      "save A limits C",
      "unsaved false",
      "go",
    ]);
  });
});
