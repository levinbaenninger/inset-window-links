import { describe, expect, it } from "vitest";

import { placePopover } from "./placement";

const size = { height: 300, width: 380 };
const primary = { height: 1080, width: 1920, x: 0, y: 25 };

describe(placePopover, () => {
  it("sits right of a source that leaves room", () => {
    expect(
      placePopover({ height: 500, width: 600, x: 100, y: 200 }, size, primary)
    ).toStrictEqual({
      height: 300,
      width: 380,
      x: 712,
      y: 200,
    });
  });

  it("falls back to the left of a source near the right edge", () => {
    expect(
      placePopover({ height: 500, width: 600, x: 1300, y: 200 }, size, primary)
    ).toStrictEqual({
      height: 300,
      width: 380,
      x: 908,
      y: 200,
    });
  });

  it("goes inside the top-right corner of a full-width source", () => {
    expect(
      placePopover({ height: 1080, width: 1920, x: 0, y: 25 }, size, primary)
    ).toStrictEqual({
      height: 300,
      width: 380,
      x: 1528,
      y: 25,
    });
  });

  it("clamps a source hanging below the work area", () => {
    expect(
      placePopover({ height: 400, width: 300, x: 50, y: 1000 }, size, primary)
    ).toStrictEqual({
      height: 300,
      width: 380,
      x: 362,
      y: 805,
    });
  });

  it("stays on a display with a negative origin", () => {
    const left = { height: 1415, width: 2560, x: -2560, y: -300 };

    expect(
      placePopover({ height: 600, width: 800, x: -2500, y: -400 }, size, left)
    ).toStrictEqual({
      height: 300,
      width: 380,
      x: -1688,
      y: -300,
    });
    expect(
      placePopover({ height: 600, width: 400, x: -400, y: 0 }, size, left)
    ).toStrictEqual({
      height: 300,
      width: 380,
      x: -792,
      y: 0,
    });
  });

  it("uses the top-right of the work area without a source", () => {
    expect(placePopover(null, size, primary)).toStrictEqual({
      height: 300,
      width: 380,
      x: 1528,
      y: 37,
    });
  });
});
