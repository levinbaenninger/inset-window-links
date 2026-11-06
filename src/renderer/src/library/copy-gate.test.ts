import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MutationOutcome } from "../../../shared/dto";
import type { CaptureId } from "../../../shared/ids";
import { SETTLE_MS } from "../../../shared/leave";
import type { DraftText } from "../../../shared/text";
import { canRetry, copyCapture, notCopiedText } from "./copy-gate";
import { DraftStore } from "./drafts";

// SAFETY: CaptureId is a branded UUID string; the gate only passes it through.
const ID = "00000000-0000-4000-8000-000000000001" as CaptureId;

const stored: DraftText = {
  description: "",
  due: null,
  relationship: "A limits B",
  todos: [],
  viewDescriptions: {},
};

/** A page whose text saves answer with `answer`, and a main that logs what it was asked. */
const setup = (answer: () => Promise<MutationOutcome>) => {
  const main: string[] = [];

  const drafts = new DraftStore(() => ({
    discard: (_id, rev) => {
      main.push(`discard ${String(rev)}`);

      return Promise.resolve({ kind: "ok" });
    },
    setTodoDone: () => Promise.resolve({ kind: "ok" }),
    updateText: (_id, text) => {
      main.push(`save ${text.relationship}`);

      return answer();
    },
  }));

  const copy = () =>
    copyCapture(
      ID,
      { kind: "entry" },
      {
        beginCopy: () => main.push("begin"),
        copy: () => {
          main.push("copy");

          return Promise.resolve({ kind: "ok" });
        },
      },
      drafts
    );

  return { copy, drafts, main };
};

describe(copyCapture, () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refuses a copy whose save hangs once SETTLE_MS pass, offering Retry, and copies nothing", async () => {
    const { copy, drafts, main } = setup(
      () => Promise.withResolvers<MutationOutcome>().promise
    );

    drafts.edit(ID, { ...stored, relationship: "A limits C" }, stored);

    const copying = copy();
    const now = () => Promise.race([copying, Promise.resolve("still waiting")]);

    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);

    const before = await now();

    await vi.advanceTimersByTimeAsync(1);

    const result = await copying;

    expect({
      before,
      main,
      result,
      retry: canRetry(result),
      says: result.kind === "copied" ? "" : notCopiedText(result, "page"),
    }).toStrictEqual({
      before: "still waiting",
      main: ["save A limits C", "begin"],
      result: {
        kind: "notSaved",
        outcome: { kind: "failed", message: "Saving didn’t finish in time." },
      },
      retry: true,
      says: "Not copied. Saving didn’t finish in time.",
    });
  });

  it("refuses a failed draft at once: nothing is saved again and main never begins a copy", async () => {
    const { copy, drafts, main } = setup(() =>
      Promise.resolve({ kind: "failed", message: "The disk is full." })
    );

    drafts.edit(ID, { ...stored, relationship: "A limits C" }, stored);
    drafts.flush(ID);
    await vi.advanceTimersByTimeAsync(0);

    const result = await copy();

    expect({ main, result, retry: canRetry(result) }).toStrictEqual({
      main: ["save A limits C"],
      result: {
        kind: "notSaved",
        outcome: { kind: "failed", message: "The disk is full." },
      },
      retry: true,
    });
  });
});
