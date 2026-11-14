import type { SpotlightStep } from "@shared/tutorial";
import { describe, expect, it } from "vitest";

import {
  cutOut,
  EDGE,
  firstPresent,
  GAP,
  placeBubble,
  resolveSteps,
} from "./geometry";

const SHELF = { height: 620, width: 340 };
const BUBBLE = { height: 120, width: 260 };

const step = (anchor: string): SpotlightStep => ({
  anchor,
  id: anchor,
  text: "",
  title: anchor,
});

describe(resolveSteps, () => {
  it("skips the steps whose anchor isn't on screen, keeping the order", () => {
    const steps = [
      step("list"),
      step("source"),
      step("composer"),
      step("menu"),
    ];

    const onScreen = new Set(["list", "composer", "menu"]);

    expect(
      resolveSteps(steps, (anchor) => onScreen.has(anchor)).map(
        (each) => each.id
      )
    ).toStrictEqual(["list", "composer", "menu"]);
    expect(resolveSteps(steps, () => false)).toStrictEqual([]);
  });
});

describe(firstPresent, () => {
  it("picks the first hint whose anchor is on screen", () => {
    expect(
      firstPresent(
        [{ anchor: "a" }, { anchor: "b" }, { anchor: "c" }],
        (anchor) => anchor !== "a"
      )
    ).toStrictEqual({ anchor: "b" });
    expect(firstPresent([{ anchor: "a" }], () => false)).toBeNull();
  });
});

describe(placeBubble, () => {
  it("goes below its anchor, pointing at its middle", () => {
    const spot = placeBubble(
      { height: 30, width: 100, x: 40, y: 100 },
      BUBBLE,
      SHELF,
      "below"
    );

    expect(spot).toStrictEqual({
      arrowX: 90 - EDGE,
      side: "below",
      x: EDGE,
      y: 130 + GAP,
    });
  });

  it("goes above when there is no room below", () => {
    expect(
      placeBubble(
        { height: 40, width: 300, x: 20, y: 560 },
        BUBBLE,
        SHELF,
        "below"
      )
    ).toMatchObject({ side: "above", y: 560 - GAP - 120 });
  });

  it("stays inside the window at its sides", () => {
    const spot = placeBubble(
      { height: 20, width: 20, x: 310, y: 50 },
      BUBBLE,
      SHELF,
      "below"
    );

    expect({ arrow: spot.arrowX, x: spot.x }).toStrictEqual({
      arrow: 260 - 14,
      x: 340 - 260 - EDGE,
    });
  });

  it("goes inside an anchor that fills a small window, without an arrow", () => {
    const card = { height: 200, width: 280 };

    expect(
      placeBubble(
        { height: 200, width: 280, x: 0, y: 0 },
        { height: 70, width: 240 },
        card,
        "inside"
      )
    ).toStrictEqual({
      arrowX: null,
      side: "inside",
      x: 20,
      y: 200 - 70 - EDGE,
    });
    expect(
      placeBubble(
        { height: 200, width: 280, x: 0, y: 0 },
        { height: 70, width: 240 },
        card,
        "below"
      )
    ).toMatchObject({ side: "inside" });
  });
});

describe(cutOut, () => {
  it("leaves a little room around the anchor, inside the window", () => {
    expect(
      cutOut({ height: 20, width: 40, x: 2, y: 100 }, SHELF)
    ).toStrictEqual({
      height: 32,
      width: 48,
      x: 0,
      y: 94,
    });
  });
});
