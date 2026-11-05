import { describe, expect, it } from "vitest";

import type { CaptureListItem } from "./dto";
import { parseQuery } from "./due";
import { DraftIdSchema, ViewIdSchema } from "./ids";
import { matchesCapture } from "./search";

const item: CaptureListItem = {
  kind: "current",
  id: DraftIdSchema.parse("00000000-0000-4000-8000-000000000001"),
  createdAt: "2026-11-05T10:00:00Z",
  relationship: "Furniture budget",
  description: "Delivery needs approval",
  due: "2026-11-05",
  status: { kind: "active" },
  todos: [{ id: "step-1", text: "Call Marco", done: false }],
  reopenable: [],
  views: [
    {
      id: ViewIdSchema.parse("00000000-0000-4000-8000-000000000002"),
      appName: "Numbers",
      title: "Cost estimate",
      description: "The total is in cell C7",
      width: 100,
      height: 100,
      imageUrl: "fixture.png",
    },
  ],
};

const now = new Date(2026, 10, 5, 12);

describe(matchesCapture, () => {
  it("finds titles, descriptions, steps and window descriptions with due filters", () => {
    expect(
      [
        "furniture",
        "approval",
        "marco",
        "numbers",
        "estimate",
        "CELL C7",
        "due:today cell c7",
        "due:week approval",
        "due:overdue",
        "due:soon",
        "missing",
      ].map((query) => matchesCapture(item, parseQuery(query), now))
    ).toStrictEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it("keeps unreadable records visible only in an unfiltered list", () => {
    const unreadable: CaptureListItem = { kind: "unreadable", id: "old" };

    expect(
      ["", "due:week", "text", "due:unknown"].map((query) =>
        matchesCapture(unreadable, parseQuery(query), now)
      )
    ).toStrictEqual([true, false, false, false]);
  });
});
