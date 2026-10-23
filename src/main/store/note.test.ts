import { describe, expect, it } from "vitest";

import { DraftIdSchema, ViewIdSchema } from "../../shared/ids";
import { formatNote } from "./note";
import type { CaptureRecord } from "./schema";

const record: CaptureRecord = {
  createdAt: "2026-10-21T14:05:00.000Z",
  id: DraftIdSchema.parse("6f1c2b52-3d4e-4f60-8a71-92b3c4d5e6f7"),
  nextStep: "  Ask Dana before Friday ",
  relationship: "The cap in the budget sheet rules out the quote in this mail.",
  schemaVersion: 1,
  updatedAt: "2026-10-21T14:05:00.000Z",
  views: [
    {
      acquisition: { kind: "direct", windowKeyAtCapture: "macos:1176" },
      appName: "Numbers",
      capturedAt: "2026-10-21T14:02:11.000Z",
      height: 900,
      id: ViewIdSchema.parse("0a000000-0000-4000-8000-000000000001"),
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
      sampledAt: "2026-10-21T14:04:29.000Z",
      title: null,
      width: 1000,
    },
  ],
};

describe(formatNote, () => {
  it("puts the thought first, then the next step and numbered sources", () => {
    expect(formatNote(record, "en-GB", "UTC")).toBe(
      [
        "The cap in the budget sheet rules out the quote in this mail.",
        "",
        "Next step: Ask Dana before Friday",
        "",
        "Sources:",
        "1. Budget 2027 (Numbers), captured 21 Oct 2026, 14:02",
        "2. Untitled window, captured 21 Oct 2026, 14:04, chosen from the window list",
      ].join("\n")
    );
  });

  it("omits a blank next step", () => {
    expect(
      formatNote(
        { ...record, nextStep: " ", views: record.views.slice(0, 1) },
        "en-GB",
        "UTC"
      )
    ).toBe(
      [
        "The cap in the budget sheet rules out the quote in this mail.",
        "",
        "Sources:",
        "1. Budget 2027 (Numbers), captured 21 Oct 2026, 14:02",
      ].join("\n")
    );
  });
});
