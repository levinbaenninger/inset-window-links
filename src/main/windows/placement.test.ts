import { describe, expect, it } from "vitest";

import { centerPanel, contains, keepInside } from "./placement";

const laptop = { height: 875, width: 1512, x: 0, y: 25 };
const left = { height: 1055, width: 1920, x: -1920, y: 0 };
const size = { height: 420, width: 520 };

describe(centerPanel, () => {
  it("centres across the work area, a little above the middle", () => {
    expect(centerPanel(size, laptop)).toStrictEqual({
      ...size,
      x: 496,
      y: 165,
    });
  });

  it("stays on a display with a negative origin", () => {
    const placed = centerPanel(size, left);

    expect([placed.x, contains(left, placed)]).toStrictEqual([-1220, true]);
  });

  it("moves up when the panel is too tall to sit lower", () => {
    const tall = { height: 820, width: 520 };

    expect(centerPanel(tall, laptop).y).toBe(64);
  });
});

describe(keepInside, () => {
  it("keeps a position that fits", () => {
    expect(keepInside({ x: 100, y: 200 }, size, laptop)).toStrictEqual({
      ...size,
      x: 100,
      y: 200,
    });
  });

  it("pulls a position back when the panel grew past the bottom edge", () => {
    expect(keepInside({ x: 1400, y: 700 }, size, laptop)).toStrictEqual({
      ...size,
      x: 992,
      y: 480,
    });
  });
});

describe(contains, () => {
  it("counts the top-left edge and not the far edge", () => {
    expect([
      contains(laptop, { x: 0, y: 25 }),
      contains(laptop, { x: 1512, y: 100 }),
    ]).toStrictEqual([true, false]);
  });
});
