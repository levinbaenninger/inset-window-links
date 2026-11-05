import { useEffect, useEffectEvent } from "react";

import type { PageCommand } from "../../../shared/shortcuts";
import { PageCommandSchema } from "../../../shared/shortcuts";

/** Takes a command by returning true, or passes it on to an older listener with false. */
type Listener = (command: PageCommand) => boolean;

const listeners = new Set<Listener>();

/** A command that came before anything listened, such as the sheet for a window still opening. */
let waiting: PageCommand | null = null;

/**
 * Hands a command to the listeners, newest first, until one takes it. Commands received before
 * the page mounts wait for its first listener.
 */
export const runCommand = (command: PageCommand): void => {
  for (const listener of [...listeners].toReversed()) {
    if (listener(command)) {
      return;
    }
  }

  if (listeners.size === 0) {
    waiting = command;
  }
};

/**
 * Takes main's menu commands for this page. Called once when the page starts, before React has
 * mounted, so a command sent as the page loads is held rather than lost.
 */
export const listenForCommands = (
  subscribe: (listener: (command: PageCommand) => void) => () => void
): void => {
  subscribe((raw) => {
    const parsed = PageCommandSchema.safeParse(raw);

    if (parsed.success) {
      runCommand(parsed.data);
    }
  });
};

/** Listens while mounted, newest first; return false from the handler to pass a command on. */
export const useCommands = (handler: Listener): void => {
  const onCommand = useEffectEvent(handler);

  useEffect(() => {
    const listener: Listener = (command) => onCommand(command);

    listeners.add(listener);

    if (waiting !== null) {
      const held = waiting;

      waiting = null;
      runCommand(held);
    }

    return () => {
      listeners.delete(listener);
    };
  }, []);
};
