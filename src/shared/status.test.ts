import { beforeAll, describe, expect, it, vi } from "vitest";

import { snoozePresets } from "./status";

const offered = (now: string) =>
  snoozePresets(new Date(now)).map((preset) => [
    preset.id,
    preset.until.toISOString(),
  ]);

describe(snoozePresets, () => {
  beforeAll(() => {
    vi.stubEnv("TZ", "Europe/Zurich");
  });

  it("offers this evening on a Tuesday afternoon, and next week is the coming Monday", () => {
    expect(offered("2026-11-03T13:30:00.000Z")).toStrictEqual([
      ["hour", "2026-11-03T14:30:00.000Z"],
      ["evening", "2026-11-03T17:00:00.000Z"],
      ["tomorrow", "2026-11-04T08:00:00.000Z"],
      ["nextWeek", "2026-11-09T08:00:00.000Z"],
    ]);
  });

  it("drops this evening once less than an hour is left, and a Monday's next week is a week on", () => {
    expect(offered("2026-11-02T16:30:00.000Z")).toStrictEqual([
      ["hour", "2026-11-02T17:30:00.000Z"],
      ["tomorrow", "2026-11-03T08:00:00.000Z"],
      ["nextWeek", "2026-11-09T08:00:00.000Z"],
    ]);
  });

  it("keeps tomorrow at 9:00 local across the change to winter time", () => {
    expect(offered("2026-10-24T20:00:00.000Z")).toStrictEqual([
      ["hour", "2026-10-24T21:00:00.000Z"],
      ["tomorrow", "2026-10-25T08:00:00.000Z"],
      ["nextWeek", "2026-10-26T08:00:00.000Z"],
    ]);
  });
});
