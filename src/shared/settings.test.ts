import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, readSettings } from "./settings";

describe(readSettings, () => {
  it("falls back to the defaults for a missing or damaged file", () => {
    expect([readSettings(null), readSettings("{not json")]).toStrictEqual([
      DEFAULT_SETTINGS,
      DEFAULT_SETTINGS,
    ]);
  });

  it("keeps stored values and fills in the rest", () => {
    expect(readSettings(JSON.stringify({ iconIn: "menuBar" }))).toStrictEqual({
      ...DEFAULT_SETTINGS,
      iconIn: "menuBar",
    });
  });

  it("ignores a file with a value of the wrong kind", () => {
    expect(readSettings(JSON.stringify({ iconIn: "taskbar" }))).toStrictEqual(
      DEFAULT_SETTINGS
    );
  });
});
