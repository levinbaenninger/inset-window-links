import type { BubblePlacement } from "@shared/tutorial";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";

import { BUBBLE_ATTRIBUTE, boxOf } from "./anchors";
import { placeBubble } from "./geometry";
import type { Box, BubbleSpot } from "./geometry";

const sameBox = (a: Box | null, b: Box): boolean =>
  a !== null &&
  a.x === b.x &&
  a.y === b.y &&
  a.width === b.width &&
  a.height === b.height;

/** Follows an element's place on screen, frame by frame, while the page scrolls, resizes or lays out again. */
export const useBoxOf = (element: HTMLElement | null): Box | null => {
  const [box, setBox] = useState<Box | null>(null);

  useLayoutEffect(() => {
    let frame = 0;

    const measure = (): void => {
      if (element !== null) {
        const next = boxOf(element);

        setBox((last) => (sameBox(last, next) ? last : next));
      }

      frame = requestAnimationFrame(measure);
    };

    frame = requestAnimationFrame(measure);

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [element]);

  return element === null ? null : box;
};

/** Where a bubble waits, laid out but out of sight, until its size is known. */
const OFF_SCREEN = -10_000;

/**
 * The tutorial's one bubble, for hints and the walkthrough alike: a small
 * card beside a real control, with an arrow pointing at it. It sits in a
 * fixed layer above the page, and fades in unless motion is reduced.
 */
export const CoachBubble = ({
  anchor,
  children,
  focusLast = false,
  footer,
  placement,
  refBubble,
  title,
}: {
  readonly anchor: HTMLElement;
  readonly placement: BubblePlacement;
  readonly title: string | null;
  readonly children: ReactNode;
  readonly footer: ReactNode;
  /** Takes focus on its last button (the walkthrough's Next) once placed. */
  readonly focusLast?: boolean;
  readonly refBubble?: RefObject<HTMLDialogElement | null>;
}) => {
  const titleId = useId();
  const own = useRef<HTMLDialogElement>(null);
  const ref = refBubble ?? own;
  const box = useBoxOf(anchor);
  const [spot, setSpot] = useState<BubbleSpot | null>(null);
  const placed = spot !== null;

  useEffect(() => {
    if (placed && focusLast) {
      const buttons = [
        ...(ref.current?.querySelectorAll<HTMLButtonElement>(
          "button:not([disabled])"
        ) ?? []),
      ];

      buttons.at(-1)?.focus();
    }
  }, [focusLast, placed, ref]);

  useLayoutEffect(() => {
    const bubble = ref.current;

    if (box === null || bubble === null) {
      return;
    }

    const next = placeBubble(
      box,
      { height: bubble.offsetHeight, width: bubble.offsetWidth },
      { height: window.innerHeight, width: window.innerWidth },
      placement
    );

    // Placed from the bubble's own measured size, which only exists once it is laid out.
    // oxlint-disable-next-line react/set-state-in-effect -- a layout measurement, not derived state.
    setSpot(next);
  }, [box, placement, ref]);

  return (
    <dialog
      aria-labelledby={title === null ? undefined : titleId}
      className="coach-bubble bg-popover text-popover-foreground ring-foreground/10 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:animation-duration-150 fixed z-50 m-0 flex w-64 flex-col gap-2 rounded-lg border-0 p-3 text-sm shadow-lg ring-1"
      open
      ref={ref}
      // Measured off screen before it is placed, not hidden: its buttons fade visibility in with their own transition, and can't take focus meanwhile.
      style={{
        "--coach-arrow-x": `${(spot?.arrowX ?? 0) - 5}px`,
        "--coach-x": `${spot?.x ?? OFF_SCREEN}px`,
        "--coach-y": `${spot?.y ?? 0}px`,
      }}
      {...{ [BUBBLE_ATTRIBUTE]: "" }}
    >
      {spot === null || spot.arrowX === null ? null : (
        <span
          aria-hidden="true"
          className="coach-arrow"
          data-side={spot.side}
        />
      )}
      {title === null ? null : (
        <p className="font-medium" id={titleId}>
          {title}
        </p>
      )}
      <div className="text-muted-foreground text-xs leading-snug">
        {children}
      </div>
      <div className="flex items-center justify-end gap-1.5">{footer}</div>
    </dialog>
  );
};
