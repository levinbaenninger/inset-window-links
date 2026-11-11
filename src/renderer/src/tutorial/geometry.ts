import type { BubblePlacement, SpotlightStep } from "@shared/tutorial";

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Where the bubble goes, and where its arrow points along its edge (null inside the anchor: no arrow). */
export interface BubbleSpot {
  readonly x: number;
  readonly y: number;
  readonly side: BubblePlacement;
  readonly arrowX: number | null;
}

/** Room kept between the bubble and the window's edges, and between it and its anchor (the arrow). */
export const EDGE = 8;
export const GAP = 10;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), Math.max(low, high));

/**
 * Places a bubble beside its anchor: on the side asked for when it fits,
 * else the other side, else inside the anchor at its bottom (an anchor
 * that fills its small window, like the screenshot card). It stays inside
 * the window, and its arrow points at the anchor's middle.
 */
export const placeBubble = (
  anchor: Box,
  bubble: Size,
  viewport: Size,
  prefer: BubblePlacement
): BubbleSpot => {
  const x = clamp(
    anchor.x + anchor.width / 2 - bubble.width / 2,
    EDGE,
    viewport.width - bubble.width - EDGE
  );

  const arrowX = clamp(anchor.x + anchor.width / 2 - x, 14, bubble.width - 14);
  const below = anchor.y + anchor.height + GAP;
  const above = anchor.y - GAP - bubble.height;
  const fitsBelow = below + bubble.height <= viewport.height - EDGE;
  const fitsAbove = above >= EDGE;

  if (prefer !== "inside") {
    const order = prefer === "above" ? ["above", "below"] : ["below", "above"];

    for (const side of order) {
      if (side === "below" && fitsBelow) {
        return { arrowX, side: "below", x, y: below };
      }

      if (side === "above" && fitsAbove) {
        return { arrowX, side: "above", x, y: above };
      }
    }
  }

  return {
    arrowX: null,
    side: "inside",
    x,
    y: clamp(
      anchor.y + anchor.height - bubble.height - EDGE,
      EDGE,
      viewport.height - bubble.height - EDGE
    ),
  };
};

/** The walkthrough's stops whose anchor is on screen; the others are skipped. */
export const resolveSteps = (
  steps: readonly SpotlightStep[],
  present: (anchor: string) => boolean
): readonly SpotlightStep[] => steps.filter((step) => present(step.anchor));

/** The hint to ask for: the first one offered whose anchor is on screen. */
export const firstPresent = <T extends { readonly anchor: string }>(
  candidates: readonly T[],
  present: (anchor: string) => boolean
): T | null =>
  candidates.find((candidate) => present(candidate.anchor)) ?? null;

/** The cut-out around a spotlit anchor: a little room around it, kept inside the window. */
export const cutOut = (anchor: Box, viewport: Size, pad = 6): Box => {
  const x = Math.max(anchor.x - pad, 0);
  const y = Math.max(anchor.y - pad, 0);

  return {
    height: Math.min(anchor.y + anchor.height + pad, viewport.height) - y,
    width: Math.min(anchor.x + anchor.width + pad, viewport.width) - x,
    x,
    y,
  };
};
