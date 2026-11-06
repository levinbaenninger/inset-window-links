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

import type { SaveError } from "./drafts";
import type { LeaveState } from "./leave";
import { leaving } from "./page-drafts";

const reasonOf = (error: SaveError): string => {
  switch (error.kind) {
    case "missing": {
      return "The capture was deleted.";
    }

    case "readOnly": {
      return "The capture can't be changed.";
    }

    default: {
      return error.message;
    }
  }
};

type Held = LeaveState & { kind: "held" };

/**
 * Shown when the window closes, or the app quits, with words that could not be saved. Return
 * retries, and closes once they are saved; Escape cancels.
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

  // Disabled while it retries, the button loses focus; it gets it back for the next Return.
  useEffect(() => {
    if (ready) {
      retry.current?.focus();
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
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !(event.target instanceof HTMLButtonElement)
          ) {
            event.preventDefault();
            void leaving.retry();
          }
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          retry.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>
            {count === 1
              ? "1 change couldn't be saved"
              : `${count} changes couldn't be saved`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {reasonOf(shown.unsaved.error)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            disabled={shown.retrying}
            onClick={() => leaving.discard()}
            variant="destructive"
          >
            {shown.reason === "quit" ? "Discard and quit" : "Discard and close"}
          </Button>
          <Button
            disabled={shown.retrying}
            onClick={() => {
              void leaving.retry();
            }}
            ref={retry}
          >
            Retry
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
