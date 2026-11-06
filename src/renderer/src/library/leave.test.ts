import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MutationOutcome } from "../../../shared/dto";
import type { CaptureId } from "../../../shared/ids";
import { SETTLE_MS } from "../../../shared/leave";
import type { DraftText } from "../../../shared/text";
import type { TextStore } from "./drafts";
import { DraftStore, SAVE_AFTER_MS } from "./drafts";
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
    discard: (_id, rev) => {
      log.push(`discard ${rev === null ? "none" : "sent"}`);

      return Promise.resolve(OK);
    },
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
    reportUnsaved: (count) => log.push(`unsaved ${String(count)}`),
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

/** Past the pause before a save, well short of the wait's limit. */
const settled = () => vi.advanceTimersByTimeAsync(SAVE_AFTER_MS + 10);

const held = (
  reason: "close" | "quit",
  unsaved: { count: number; error: MutationOutcome | null; late: boolean },
  retrying = false
) => ({ kind: "held", reason, retrying, unsaved });

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

    expect([log, flow.state()]).toStrictEqual([
      ["waiting", "go"],
      { kind: "idle" },
    ]);
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
        ["unsaved 1", "save A limits C", "waiting"],
        { kind: "waiting", reason: "quit" },
      ],
      ["unsaved 1", "save A limits C", "waiting", "unsaved 0", "go"],
    ]);
  });

  it("holds for words that couldn’t be saved, with how many and why, and sends nothing again", async () => {
    const { flow, log, type } = setup([DISK_FULL]);

    type(A, "A limits C");
    await settled();
    flow.request("close");
    await settled();

    expect([log, flow.state()]).toStrictEqual([
      ["unsaved 1", "save A limits C", "waiting", "held"],
      held("close", { count: 1, error: DISK_FULL, late: false }),
    ]);
  });

  it("counts each capture whose words couldn’t be saved, not the ones that were", async () => {
    const { flow, type } = setup([DISK_FULL, DISK_FULL, OK]);

    type(A, "A limits C");
    type(B, "B limits C");
    type(C, "C limits D");
    await settled();
    flow.request("quit");
    await settled();

    expect(flow.state()).toStrictEqual(
      held("quit", { count: 2, error: DISK_FULL, late: false })
    );
  });

  it("holds after SETTLE_MS when a save never answers, saying it didn’t finish in time, never going", async () => {
    const { flow, hold, log, type } = setup();

    hold();
    type(A, "A limits C");
    flow.request("close");
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);

    const before = flow.state();

    await vi.advanceTimersByTimeAsync(1);

    const after = flow.state();

    await vi.advanceTimersByTimeAsync(10 * SETTLE_MS);

    expect([before, after, flow.state(), log]).toStrictEqual([
      { kind: "waiting", reason: "close" },
      held("close", { count: 1, error: null, late: true }),
      after,
      ["unsaved 1", "save A limits C", "waiting", "held"],
    ]);
  });

  it("Retry that hangs holds again after SETTLE_MS", async () => {
    const { flow, hold, log, type } = setup([DISK_FULL]);

    type(A, "A limits C");
    await settled();
    flow.request("quit");
    await settled();
    hold();
    flow.retry();
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect([flow.state(), log.slice(-2)]).toStrictEqual([
      held("quit", { count: 1, error: null, late: true }),
      ["held", "save A limits C"],
    ]);
  });

  it("Discard works at once while Retry is still saving, and the late answer brings nothing back", async () => {
    const { drafts, flow, hold, log, release, type } = setup([DISK_FULL]);

    type(A, "A limits C");
    await settled();
    flow.request("close");
    await settled();
    hold();
    flow.retry();
    flow.discard();

    const atDiscard = [flow.state(), drafts.shown(A, stored), [...log]];

    release();
    await settled();

    expect([
      atDiscard,
      drafts.shown(A, stored),
      drafts.count,
      log,
    ]).toStrictEqual([
      [
        { kind: "idle" },
        stored,
        [
          "unsaved 1",
          "save A limits C",
          "waiting",
          "held",
          "save A limits C",
          "discard sent",
          "unsaved 0",
          "go",
        ],
      ],
      stored,
      0,
      // Nothing is sent to put the saved words back: main drops or undoes the discarded save.
      [
        "unsaved 1",
        "save A limits C",
        "waiting",
        "held",
        "save A limits C",
        "discard sent",
        "unsaved 0",
        "go",
      ],
    ]);
  });

  it("Cancel works at once while Retry is still saving; that Retry's answer then changes nothing", async () => {
    const { flow, hold, log, release, type } = setup([DISK_FULL]);

    type(A, "A limits C");
    await settled();
    flow.request("close");
    await settled();
    hold();
    flow.retry();
    flow.cancel();
    // A new close, while the cancelled Retry's save is still out.
    flow.request("close");
    release();
    await settled();

    expect([flow.state(), log]).toStrictEqual([
      { kind: "idle" },
      [
        "unsaved 1",
        "save A limits C",
        "waiting",
        "held",
        "save A limits C",
        "stay",
        "waiting",
        "unsaved 0",
        "go",
      ],
    ]);
  });

  it("follows a save that lands late while the prompt shows, and goes once nothing is left", async () => {
    const { flow, hold, log, release, type } = setup();

    hold();
    type(A, "A limits C");
    flow.request("quit");
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    const prompt = flow.state();

    release();
    await settled();

    expect([prompt, flow.state(), log.slice(-3)]).toStrictEqual([
      held("quit", { count: 1, error: null, late: true }),
      { kind: "idle" },
      ["held", "unsaved 0", "go"],
    ]);
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
      "unsaved 1",
      "save one",
      "unsaved 2",
      "waiting",
      "save pausing",
      "save two",
      "unsaved 1",
      "unsaved 0",
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
      "unsaved 1",
      "waiting",
      "save A limits B / more",
      "unsaved 0",
      "go",
    ]);
  });

  it("Retry that fails holds again; Retry that saves lets go", async () => {
    const { flow, log, type } = setup([DISK_FULL, DISK_FULL, OK]);

    type(A, "A limits C");
    await settled();
    flow.request("quit");
    await settled();
    flow.retry();

    const retrying = flow.state();

    await settled();

    const failedAgain = flow.state();

    flow.retry();
    await settled();

    expect([retrying, failedAgain, flow.state(), log]).toStrictEqual([
      held("quit", { count: 1, error: DISK_FULL, late: false }, true),
      held("quit", { count: 1, error: DISK_FULL, late: false }),
      { kind: "idle" },
      [
        "unsaved 1",
        "save A limits C",
        "waiting",
        "held",
        "save A limits C",
        "save A limits C",
        "unsaved 0",
        "go",
      ],
    ]);
  });

  it("tells main its count as the page loads, 0 included, so a count left by a crashed page is cleared only then", () => {
    const { drafts, flow, log } = setup();

    flow.announce();
    drafts.edit(A, titled("A limits C"), stored);
    flow.announce();

    expect(log).toStrictEqual(["unsaved 0", "unsaved 1", "unsaved 1"]);
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
      log.slice(-6),
      drafts.count,
      drafts.shown(A, stored),
    ]).toStrictEqual([
      ["held", "discard none", "unsaved 1", "discard none", "unsaved 0", "go"],
      0,
      stored,
    ]);
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
        ["unsaved 1", "save A limits C", "waiting", "held", "stay"],
      ],
      [
        "unsaved 1",
        "save A limits C",
        "waiting",
        "held",
        "stay",
        "waiting",
        "held",
      ],
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
      held("quit", { count: 1, error: DISK_FULL, late: false }),
      [
        "unsaved 1",
        "save A limits C",
        "waiting",
        "held",
        "held",
        "discard none",
        "unsaved 0",
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
      "unsaved 1",
      "save A limits C",
      "waiting",
      "waiting",
      "unsaved 0",
      "go",
    ]);
  });

  it("drops the request without an answer once main stopped waiting for one", async () => {
    const { flow, log, type } = setup([DISK_FULL]);

    type(A, "A limits C");
    await settled();
    flow.request("close");
    flow.dismiss();
    await settled();

    expect([flow.state(), log]).toStrictEqual([
      { kind: "idle" },
      ["unsaved 1", "save A limits C", "waiting"],
    ]);
  });
});
