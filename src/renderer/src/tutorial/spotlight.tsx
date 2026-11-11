import type { SpotlightStep, TutorialView } from "@shared/tutorial";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { anchorPresent, findAnchor } from "./anchors";
import { CoachBubble, useBoxOf } from "./bubble";
import { cutOut, resolveSteps } from "./geometry";

/** The dimmed page with a hole around the spotlit control, drawn with an SVG mask. */
const Dimmer = ({ anchor }: { readonly anchor: HTMLElement }) => {
  const box = useBoxOf(anchor);
  const mask = useId();

  if (box === null) {
    return null;
  }

  const hole = cutOut(box, {
    height: window.innerHeight,
    width: window.innerWidth,
  });

  return (
    <svg
      aria-hidden="true"
      className="fixed inset-0 z-40 size-full"
      data-spotlight-dimmer
    >
      <defs>
        <mask id={mask}>
          <rect className="spotlight-show" height="100%" width="100%" />
          <rect
            className="spotlight-hole motion-safe:transition-all motion-safe:duration-200"
            height={hole.height}
            rx="8"
            width={hole.width}
            x={hole.x}
            y={hole.y}
          />
        </mask>
      </defs>
      <rect
        className="spotlight-dim"
        height="100%"
        mask={`url(#${mask})`}
        width="100%"
      />
    </svg>
  );
};

const ignore = (): void => undefined;

const buttonsIn = (root: HTMLElement | null): HTMLButtonElement[] =>
  root === null
    ? []
    : [...root.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];

/** Moves focus to the next or previous button in the bubble, round and round. */
const cycleFocus = (root: HTMLElement | null, back: boolean): void => {
  const buttons = buttonsIn(root);
  const { activeElement } = document;

  const at =
    activeElement instanceof HTMLButtonElement
      ? buttons.indexOf(activeElement)
      : -1;

  const to = (at + (back ? -1 : 1) + buttons.length) % buttons.length;

  buttons[to]?.focus();
};

const Walk = ({
  onDone,
  steps,
}: {
  readonly steps: readonly SpotlightStep[];
  readonly onDone: () => void;
}) => {
  const [asked, setAsked] = useState(0);
  const bubble = useRef<HTMLDialogElement>(null);

  // A control gone since the walk started is passed by: the first stop from here whose control is still on screen.
  const index = steps.findIndex(
    (each, at) => at >= asked && findAnchor(each.anchor) !== null
  );

  const step = steps[index];
  const anchor = step === undefined ? null : findAnchor(step.anchor);
  const last = index === steps.length - 1;

  const next = (): void => {
    if (last) {
      onDone();
    } else {
      setAsked(index + 1);
    }
  };

  const back = (): void => {
    setAsked(Math.max(index - 1, 0));
  };

  useEffect(() => {
    if (index === -1) {
      onDone();
    }
  }, [index, onDone]);

  useEffect(() => {
    anchor?.scrollIntoView({ block: "nearest" });

    // Focus stays in the bubble, on its way forward.
    const frame = requestAnimationFrame(() => {
      buttonsIn(bubble.current).at(-1)?.focus();
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [anchor]);

  const latest = useRef({ back, next, onDone });

  useEffect(() => {
    latest.current = { back, next, onDone };
  });

  // The walk takes every key: ← → Return Esc move it, Tab stays in the bubble, and nothing reaches the page behind.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const onButton =
        event.target instanceof HTMLButtonElement &&
        bubble.current?.contains(event.target) === true;

      // A focused button in the bubble presses itself with Return or Space.
      if ((event.key === "Enter" || event.key === " ") && onButton) {
        event.stopPropagation();

        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key === "Escape") {
        latest.current.onDone();
      } else if (event.key === "ArrowRight" || event.key === "Enter") {
        latest.current.next();
      } else if (event.key === "ArrowLeft") {
        latest.current.back();
      } else if (event.key === "Tab") {
        cycleFocus(bubble.current, event.shiftKey);
      }
    };

    window.addEventListener("keydown", onKey, true);

    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, []);

  if (step === undefined || anchor === null) {
    return null;
  }

  return (
    <>
      <Dimmer anchor={anchor} />
      <CoachBubble
        anchor={anchor}
        footer={
          <>
            <span className="text-muted-foreground mr-auto text-xs tabular-nums">
              {index + 1} of {steps.length}
            </span>
            <Button onClick={onDone} size="xs" variant="ghost">
              Close
            </Button>
            {index === 0 ? null : (
              <Button onClick={back} size="xs" variant="outline">
                Back
              </Button>
            )}
            <Button onClick={next} size="xs">
              {last ? "Done" : "Next"}
            </Button>
          </>
        }
        key={step.id}
        placement="below"
        refBubble={bubble}
        title={step.title}
      >
        {step.text}
      </CoachBubble>
    </>
  );
};

/**
 * The walkthrough, shown only when asked for: the page dims except for one
 * real control at a time, with a bubble saying what it does, step n of m.
 * A step whose control isn't on screen is skipped. ← → Return and Esc move
 * through it; nothing behind it takes a key or a click meanwhile.
 */
export const Spotlight = ({
  onDone,
  run,
}: {
  readonly run: TutorialView["spotlight"];
  readonly onDone: () => void;
}) => {
  const [resolved, setResolved] = useState<{
    readonly seq: number;
    readonly steps: readonly SpotlightStep[];
  } | null>(null);

  const seq = run?.seq ?? null;
  const latest = useRef({ onDone, run });

  useEffect(() => {
    latest.current = { onDone, run };
  });

  // Resolved once the page has settled (details closed, the list laid out), two frames after the start.
  useEffect(() => {
    if (seq === null) {
      return ignore;
    }

    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const found = resolveSteps(
          latest.current.run?.steps ?? [],
          anchorPresent
        );

        if (found.length === 0) {
          latest.current.onDone();
        } else {
          setResolved({ seq, steps: found });
        }
      });
    });

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [seq]);

  if (seq === null || resolved?.seq !== seq) {
    return null;
  }

  return (
    <>
      {/* Takes every click on the page behind the walk. */}
      <div aria-hidden="true" className="fixed inset-0 z-40" />
      <Walk key={seq} onDone={onDone} steps={resolved.steps} />
    </>
  );
};
