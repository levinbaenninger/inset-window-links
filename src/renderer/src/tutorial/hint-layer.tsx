import type { ShownHint, TutorialAction, TutorialView } from "@shared/tutorial";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { anchorPresent, findAnchor, somethingOpen } from "./anchors";
import { CoachBubble } from "./bubble";
import { firstPresent } from "./geometry";
import { useTutorial } from "./use-tutorial";

const nothing = (): void => undefined;

/** How often a page looks for a hint's anchor, and for a menu or drag that holds hints back. */
const LOOK_MS = 300;

/** A drag in progress anywhere on the page: hints wait for it. */
const useDragging = () => {
  const dragging = useRef(false);

  useEffect(() => {
    const start = (): void => {
      dragging.current = true;
    };

    const end = (): void => {
      dragging.current = false;
    };

    document.addEventListener("dragstart", start, true);
    document.addEventListener("dragend", end, true);
    document.addEventListener("drop", end, true);
    document.addEventListener("pointerup", end, true);

    return () => {
      document.removeEventListener("dragstart", start, true);
      document.removeEventListener("dragend", end, true);
      document.removeEventListener("drop", end, true);
      document.removeEventListener("pointerup", end, true);
    };
  }, []);

  return dragging;
};

/** Finds the bubble's anchor as the page lays out, and notices a menu or dialog that holds it back. */
const useAnchor = (id: string) => {
  const [state, setState] = useState<{
    readonly anchor: HTMLElement | null;
    readonly held: boolean;
  }>(() => ({ anchor: findAnchor(id), held: somethingOpen() }));

  useEffect(() => {
    const look = (): void => {
      const anchor = findAnchor(id);
      const held = somethingOpen();

      setState((last) =>
        last.anchor === anchor && last.held === held ? last : { anchor, held }
      );
    };

    look();

    const timer = setInterval(look, LOOK_MS);

    return () => {
      clearInterval(timer);
    };
  }, [id]);

  return state;
};

const Shown = ({
  act,
  hint,
}: {
  readonly hint: ShownHint;
  readonly act: (action: TutorialAction) => void;
}) => {
  const { anchor, held } = useAnchor(hint.anchor);
  const bubble = useRef<HTMLDialogElement>(null);
  const reported = useRef(false);
  const visible = anchor !== null && !held;

  const dismiss = (): void => {
    act({ id: hint.id, kind: "dismissHint" });
  };

  // Drawn: a one-time hint is seen from now on.
  useEffect(() => {
    if (visible && hint.kind === "hint" && !reported.current) {
      reported.current = true;
      act({ id: hint.id, kind: "hintShown" });
    }
  }, [act, hint.id, hint.kind, visible]);

  // Escape, a click elsewhere, or using the control itself puts it away.
  useEffect(() => {
    if (!visible) {
      return nothing;
    }

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        act({ id: hint.id, kind: "dismissHint" });
      }
    };

    const onPointer = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        bubble.current?.contains(event.target) !== true
      ) {
        act({ id: hint.id, kind: "dismissHint" });
      }
    };

    // A bubble inside its control covers it: pointing at the control, to use it, puts the bubble away.
    const inside = hint.placement === "inside" ? anchor : null;

    const onMove = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        bubble.current?.contains(event.target) !== true
      ) {
        act({ id: hint.id, kind: "dismissHint" });
      }
    };

    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    inside?.addEventListener("pointermove", onMove);

    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
      inside?.removeEventListener("pointermove", onMove);
    };
  }, [act, anchor, hint.id, hint.placement, visible]);

  return visible ? (
    <CoachBubble
      anchor={anchor}
      footer={
        <Button onClick={dismiss} size="xs">
          Got it
        </Button>
      }
      placement={hint.placement}
      refBubble={bubble}
      title={hint.title}
    >
      {hint.text}
    </CoachBubble>
  ) : null;
};

/**
 * A page's one-time hints. While nothing shows anywhere, it asks for the
 * first hint whose control is on screen, unless a menu, dialog or drag is
 * open; main grants at most one at a time, across every window. The
 * granted one shows here as a bubble beside its control until it is put
 * away, and never comes back.
 */
export const HintLayer = ({
  act,
  view,
}: {
  readonly view: TutorialView;
  readonly act: (action: TutorialAction) => void;
}) => {
  const dragging = useDragging();
  const { active, busy, hints } = view;

  useEffect(() => {
    if (active !== null || busy || hints.length === 0) {
      return nothing;
    }

    const look = (): void => {
      if (dragging.current || somethingOpen()) {
        return;
      }

      const hint = firstPresent(hints, anchorPresent);

      if (hint !== null) {
        act({ id: hint.id, kind: "requestHint" });
      }
    };

    look();

    const timer = setInterval(look, LOOK_MS);

    return () => {
      clearInterval(timer);
    };
  }, [act, active, busy, dragging, hints]);

  return active === null ? null : (
    <Shown act={act} hint={active} key={`${active.kind}-${active.id}`} />
  );
};

/** A window whose only part in the tutorial is its hints: loads its view and shows them. */
export const PageHints = ({
  act,
  source,
}: {
  readonly source: Parameters<typeof useTutorial>[0];
  readonly act: (action: TutorialAction) => void;
}) => {
  const view = useTutorial(source);

  return <HintLayer act={act} view={view} />;
};
