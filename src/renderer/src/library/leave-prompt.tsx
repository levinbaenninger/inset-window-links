import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

import { SAVE_LATE } from "../../../shared/leave";
import type { Unsaved } from "./drafts";
import { reasonOf } from "./drafts";
import type { LeaveState } from "./leave";
import { promptKind } from "./leave";
import { leaving } from "./page-drafts";

/** Why the words aren't saved: the first failure, and saves that didn't finish in time. */
const why = ({ error, late }: Unsaved): string =>
  [error === null ? null : reasonOf(error), late ? SAVE_LATE : null]
    .filter((part) => part !== null)
    .join(" ");

type Held = LeaveState & { kind: "held" };

/**
 * The title, the description and the two answers. A Discard that couldn't finish asks to keep the
 * changes or discard again; one main hasn't answered in time asks to wait for it or leave anyway.
 */
const wordsOf = ({ reason, retrying, unsaved }: Held) => {
  const { count } = unsaved;
  const changes = count === 1 ? "1 change" : `${String(count)} changes`;

  switch (promptKind(unsaved)) {
    case "stalled": {
      // Wait is disabled while it waits, so the words say what it is doing.
      const state = retrying
        ? "Waiting for Inset to put the earlier version back…"
        : "Discarding didn’t finish in time.";

      const finishes =
        reason === "quit"
          ? "If you quit now, Inset finishes discarding the next time it starts"
          : "If you close now, Inset finishes discarding in the background";

      return {
        description: `${state} ${finishes}${unsaved.typedSince ? ", and what you typed since is lost." : "."}`,
        discard: reason === "quit" ? "Quit anyway" : "Close anyway",
        retry: "Wait",
        title:
          count === 1
            ? "1 change isn’t discarded yet"
            : `${changes} aren’t discarded yet`,
      };
    }

    case "undiscarded": {
      return {
        description: why(unsaved),
        discard: "Discard again",
        retry: "Keep changes",
        title: `${changes} couldn’t be discarded`,
      };
    }

    default: {
      return {
        description: why(unsaved),
        discard: reason === "quit" ? "Discard and quit" : "Discard and close",
        retry: "Retry",
        title: `${changes} couldn’t be saved`,
      };
    }
  }
};

/**
 * Shown when the window closes, or the app quits, with words that could not be saved or
 * discarded, or not in time. Return always takes the safe answer, whichever button has focus:
 * Retry, Keep changes after a Discard that couldn't finish, or Wait for one main hasn't answered.
 * Escape cancels; Space presses the focused button, so Discard and leaving anyway stay deliberate.
 */
export const LeavePrompt = () => {
  const state = useSyncExternalStore(leaving.subscribe, leaving.state);
  const held = state.kind === "held" ? state : null;
  const retry = useRef<HTMLButtonElement>(null);
  // The last prompt stays on screen while it fades out.
  const [shown, setShown] = useState<Held | null>(held);

  if (held !== null && held !== shown) {
    setShown(held);
  }

  const ready = held !== null && !held.retrying;

  // Disabled while it retries, the button loses focus; it gets it back for the next Return. Its
  // ring shows however focus got there, so it is clear what Return does.
  useEffect(() => {
    if (ready) {
      retry.current?.focus({ focusVisible: true });
    }
  }, [ready]);

  if (shown === null) {
    return null;
  }

  const words = wordsOf(shown);
  const stalled = promptKind(shown.unsaved) === "stalled";

  const safe = () => {
    if (stalled) {
      leaving.wait();
    } else {
      leaving.retry();
    }
  };

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          leaving.cancel();
        }
      }}
      open={held !== null}
    >
      <AlertDialogContent
        data-testid="leave-prompt"
        // Before the focused button sees it: Return must not press Discard or Cancel.
        onKeyDownCapture={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            safe();
          }
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          retry.current?.focus({ focusVisible: true });
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{words.title}</AlertDialogTitle>
          <AlertDialogDescription>{words.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            onClick={() => {
              if (stalled) {
                leaving.leaveNow();
              } else {
                leaving.discard();
              }
            }}
            variant="destructive"
          >
            {words.discard}
          </Button>
          <Button disabled={shown.retrying} onClick={safe} ref={retry}>
            {words.retry}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
