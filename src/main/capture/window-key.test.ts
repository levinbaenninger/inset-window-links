import { describe, expect, it } from "vitest";

import type { CapturePlatform } from "../../shared/dto";
import {
  matchWindowSource,
  nativeWindowKey,
  parseWindowSourceId,
} from "./window-key";

const match = (
  platform: CapturePlatform,
  native: number,
  sourceIds: readonly string[]
) => {
  const key = nativeWindowKey(platform, native);

  return key === null
    ? { kind: "invalidId" }
    : matchWindowSource(platform, key, sourceIds);
};

describe("source mapping", () => {
  it.each([
    [
      "macos",
      1176,
      ["window:1175:0", "window:1176:0", "screen:1:0"],
      { kind: "exact", sourceId: "window:1176:0" },
    ],
    [
      "macos",
      1176,
      ["window:1176:3"],
      { kind: "exact", sourceId: "window:1176:3" },
    ],
    [
      "macos",
      4_294_967_295,
      ["window:4294967295:0"],
      { kind: "exact", sourceId: "window:4294967295:0" },
    ],
    ["macos", 2_147_942_402, ["window:-2147024894:0"], { kind: "none" }],
    [
      "windows",
      655_794,
      ["window:655794:0"],
      { kind: "exact", sourceId: "window:655794:0" },
    ],
    [
      "windows",
      -2_147_024_894,
      ["window:2147942402:0"],
      { kind: "exact", sourceId: "window:2147942402:0" },
    ],
    [
      "windows",
      2_147_942_402,
      ["window:-2147024894:0"],
      { kind: "exact", sourceId: "window:-2147024894:0" },
    ],
    [
      "windows",
      -2_147_024_894,
      ["window:18446744071562526722:0"],
      { kind: "exact", sourceId: "window:18446744071562526722:0" },
    ],
    [
      "windows",
      3_000_000_000,
      ["window:3000000000:0"],
      { kind: "exact", sourceId: "window:3000000000:0" },
    ],
    [
      "windows",
      -2_147_483_647,
      ["window:2147483649:0"],
      { kind: "exact", sourceId: "window:2147483649:0" },
    ],
    [
      "windows",
      2_147_483_649,
      ["window:-2147483647:0"],
      { kind: "exact", sourceId: "window:-2147483647:0" },
    ],
    [
      "windows",
      -2_147_483_647,
      ["window:18446744071562067969:0"],
      { kind: "exact", sourceId: "window:18446744071562067969:0" },
    ],
    [
      "windows",
      -1,
      ["window:4294967295:0", "window:-1:0"],
      { kind: "ambiguous", sourceIds: ["window:4294967295:0", "window:-1:0"] },
    ],
    ["windows", 1, ["window:4294967297:0"], { kind: "none" }],
    [
      "windows",
      1176,
      ["window:1176:0", "window:1176:1"],
      { kind: "ambiguous", sourceIds: ["window:1176:0", "window:1176:1"] },
    ],
    ["macos", 1176, ["window:1175:0"], { kind: "none" }],
    [
      "macos",
      1176,
      [
        "screen:1176:0",
        "window::0",
        "window:abc:0",
        "window:1176",
        "win:1176:0",
        "window:01176x:0",
      ],
      { kind: "none" },
    ],
    ["windows", 1176, ["screen:0:0"], { kind: "none" }],
  ] as const)(
    "%s native %d against %j",
    (platform, native, sourceIds, expected) => {
      expect(match(platform, native, sourceIds)).toStrictEqual(expected);
    }
  );

  it.each([
    ["macos", -1],
    ["macos", -5],
    ["macos", 1.5],
    ["macos", 2 ** 32],
    ["macos", 0],
    ["windows", 0],
    ["windows", Number.MAX_SAFE_INTEGER + 1],
    ["windows", -(2 ** 31) - 1],
    ["windows", 2 ** 32],
  ] as const)("rejects %s native id %d", (platform, native) => {
    expect(nativeWindowKey(platform, native)).toBeNull();
  });

  it("keeps platforms apart", () => {
    expect(nativeWindowKey("macos", 1176)).toBe("macos:1176");
    expect(parseWindowSourceId("windows", "window:1176:0")).toBe(
      "windows:1176"
    );
    expect(parseWindowSourceId("windows", "window:0:0")).toBeNull();
    expect(
      parseWindowSourceId("macos", "window:18446744071562526722:0")
    ).toBeNull();
  });
});
