import { describe, expect, it } from "vitest";

import { formatDay, plural } from "./format";

const now = new Date(2026, 9, 22, 9, 30);

describe(formatDay, () => {
  it("names today and yesterday by local calendar day", () => {
    expect(formatDay(new Date(2026, 9, 22, 0, 5).toISOString(), now)).toBe(
      "Today"
    );
    expect(formatDay(new Date(2026, 9, 21, 23, 55).toISOString(), now)).toBe(
      "Yesterday"
    );
  });

  it("adds the year only outside the current one", () => {
    expect(formatDay(new Date(2026, 9, 1).toISOString(), now)).not.toMatch(
      /2026/u
    );
    expect(formatDay(new Date(2025, 9, 1).toISOString(), now)).toMatch(/2025/u);
  });
});

describe(plural, () => {
  it("adds an s only when the count is not one", () => {
    expect(plural(1, "view")).toBe("1 view");
    expect(plural(0, "view")).toBe("0 views");
    expect(plural(3, "view")).toBe("3 views");
  });
});
