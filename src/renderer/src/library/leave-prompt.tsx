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
import { leaving } from "./page-drafts";

/** Why the words aren't saved: the first failure, and saves that didn't finish in time. */
const why = ({ error, late }: Unsaved): string =>
  [error === null ? null : reasonOf(error), late ? SAVE_LATE : null]
    .filter((part) => part !== null)
    .join(" ");

type Held = LeaveState & { kind: "held" };

/**
 * Shown when the window closes, or the app quits, with words that could not be saved, or not in
 * time. Return always retries, whichever button has focus, and closes once they are saved;
 * Escape cancels; Space presses the focused button, so Discard stays a deliberate choice.
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

  const { count } = shown.unsaved;

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
            leaving.retry();
          }
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          retry.current?.focus({ focusVisible: true });
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {count === 1
              ? "1 change couldn't be saved"
              : `${count} changes couldn't be saved`}
          </AlertDialogTitle>
          <AlertDialogDescription>{why(shown.unsaved)}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button onClick={() => leaving.discard()} variant="destructive">
            {shown.reason === "quit" ? "Discard and quit" : "Discard and close"}
          </Button>
          <Button
            disabled={shown.retrying}
            onClick={() => leaving.retry()}
            ref={retry}
          >
            Retry
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
