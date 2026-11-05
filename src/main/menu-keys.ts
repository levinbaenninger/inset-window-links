import type { KeyAction, KeyPress } from "./app-menu";
import { keyAction } from "./app-menu";

/** An Electron event, as far as the menu keys use it. */
export interface KeyEvent {
  preventDefault: () => void;
}

/** The part of a WebContents the menu keys need. */
export interface KeyTarget {
  on: (
    event: "before-input-event",
    listener: (event: KeyEvent, input: KeyPress) => void
  ) => void;
}

/** The part of Electron's app that announces new pages. */
export interface KeySource<T extends KeyTarget> {
  on: (
    event: "web-contents-created",
    listener: (event: KeyEvent, contents: T) => void
  ) => void;
}

/**
 * Gives every page of the app the menu's keys, on Windows where there is no menu bar to hold
 * them. It listens on each page's contents, not on its window, so it covers pages created before
 * this ran as well as later ones, and each page is wired once however often it is seen. `answer`
 * is read on every press, so keys pressed before the app's actions exist do nothing.
 */
export const wireMenuKeys = <T extends KeyTarget>(
  source: KeySource<T>,
  existing: readonly T[],
  answer: () => ((action: KeyAction) => void) | null
): void => {
  const wired = new WeakSet<T>();

  const wire = (contents: T) => {
    if (wired.has(contents)) {
      return;
    }

    wired.add(contents);
    contents.on("before-input-event", (event, input) => {
      const action = keyAction(input);
      const run = answer();

      if (action !== null && run !== null) {
        event.preventDefault();
        run(action);
      }
    });
  };

  for (const contents of existing) {
    wire(contents);
  }

  source.on("web-contents-created", (_event, contents) => wire(contents));
};
