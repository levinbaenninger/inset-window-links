import { describe, expect, it } from "vitest";

import { DraftIdSchema, ViewIdSchema } from "../../shared/ids";
import { formatNote } from "./note";
import type { CaptureRecord } from "./schema";

const record: CaptureRecord = {
  createdAt: "2026-10-21T14:05:00.000Z",
  id: DraftIdSchema.parse("6f1c2b52-3d4e-4f60-8a71-92b3c4d5e6f7"),
  relationship: "The cap in the budget sheet rules out the quote in this mail.",
  schemaVersion: 2,
  todos: [
    { done: false, id: "a", text: "Ask Dana before Friday" },
    { done: true, id: "b", text: "Find the old quote" },
  ],
  updatedAt: "2026-10-21T14:05:00.000Z",
  views: [
    {
      acquisition: { kind: "direct", windowKeyAtCapture: "macos:1176" },
      appName: "Numbers",
      capturedAt: "2026-10-21T14:02:11.000Z",
      height: 900,
      id: ViewIdSchema.parse("0a000000-0000-4000-8000-000000000001"),
      origin: {
        appPath: "/Applications/Numbers.app",
        bounds: { height: 600, width: 900, x: 40, y: 60 },
        document: "/Users/dana/Budget 2027.numbers",
        url: null,
      },
      sampledAt: "2026-10-21T14:02:10.800Z",
      title: "Budget 2027",
      width: 1200,
    },
    {
      acquisition: {
        kind: "fallback",
        reason: "noMatch",
        windowKeyAtCapture: null,
      },
      appName: null,
      capturedAt: "2026-10-21T14:04:30.000Z",
      height: 700,
      id: ViewIdSchema.parse("0a000000-0000-4000-8000-000000000002"),
      origin: null,
      sampledAt: "2026-10-21T14:04:29.000Z",
      title: null,
      width: 1000,
    },
  ],
};

describe(formatNote, () => {
  it("puts the thought first, then the to-dos and numbered sources", () => {
    expect(formatNote(record, "en-GB", "UTC")).toBe(
      [
        "The cap in the budget sheet rules out the quote in this mail.",
        "",
        "To do:",
        "- [ ] Ask Dana before Friday",
        "- [x] Find the old quote",
        "",
        "Sources:",
        "1. Budget 2027 (Numbers), captured 21 Oct 2026, 14:02",
        "   /Users/dana/Budget 2027.numbers",
        "2. Untitled window, captured 21 Oct 2026, 14:04, chosen from the window list",
      ].join("\n")
    );
  });

  it("omits an empty to-do list", () => {
    expect(
      formatNote(
        { ...record, todos: [], views: record.views.slice(1) },
        "en-GB",
        "UTC"
      )
    ).toBe(
      [
        "The cap in the budget sheet rules out the quote in this mail.",
        "",
        "Sources:",
        "1. Untitled window, captured 21 Oct 2026, 14:04, chosen from the window list",
      ].join("\n")
    );
  });
});
