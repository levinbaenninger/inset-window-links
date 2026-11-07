import { describe, expect, it } from "vitest";

import { ViewIdSchema } from "./ids";
import {
  blankText,
  DraftTextSchema,
  hasTyped,
  keptViewDescriptions,
} from "./text";

const A = ViewIdSchema.parse("00000000-0000-4000-8000-00000000000a");

const B = ViewIdSchema.parse("00000000-0000-4000-8000-00000000000b");

describe(hasTyped, () => {
  it("counts a due date or a window's description as something worth keeping", () => {
    expect([
      hasTyped(blankText),
      hasTyped({ ...blankText, due: "2026-11-07" }),
      hasTyped({ ...blankText, viewDescriptions: { [A]: "  " } }),
      hasTyped({ ...blankText, viewDescriptions: { [A]: "The cap" } }),
    ]).toStrictEqual([false, true, false, true]);
  });
});

describe(keptViewDescriptions, () => {
  it("trims each one and orders them by view, so two copies compare equal", () => {
    expect(
      JSON.stringify(keptViewDescriptions({ [B]: " b ", [A]: "a\n" }))
    ).toBe(JSON.stringify({ [A]: "a", [B]: "b" }));
  });
});

describe("the draft text schema", () => {
  it("still takes text from a sender that predates the due date and window descriptions", () => {
    expect(
      DraftTextSchema.parse({ relationship: "A limits B", todos: [] })
    ).toStrictEqual({
      description: "",
      due: null,
      relationship: "A limits B",
      todos: [],
      viewDescriptions: {},
    });
  });

  it("refuses a due date that is not a calendar day, and a description keyed by no view", () => {
    expect([
      DraftTextSchema.safeParse({ ...blankText, due: "2026-02-30" }).success,
      DraftTextSchema.safeParse({
        ...blankText,
        viewDescriptions: { "not-a-view": "x" },
      }).success,
    ]).toStrictEqual([false, false]);
  });
});
