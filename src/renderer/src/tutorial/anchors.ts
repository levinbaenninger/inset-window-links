import type { Box } from "./geometry";

/**
 * The tutorial's anchors: real controls marked `data-coach="<id>"`, which
 * hints and the walkthrough point at. `{...coach("add-button")}` on an
 * element marks it.
 */
export const coach = (id: string) => ({ "data-coach": id }) as const;

/** Laid out and visible: not hidden, not inside something hidden, with a size. */
const onScreen = (element: Element): boolean => {
  if (element.closest("[hidden], [aria-hidden=true]") !== null) {
    return false;
  }

  const box = element.getBoundingClientRect();

  return box.width > 0 && box.height > 0;
};

/** The first element marked with this anchor that is on screen, or null. */
export const findAnchor = (id: string): HTMLElement | null => {
  for (const element of document.querySelectorAll<HTMLElement>(
    `[data-coach="${CSS.escape(id)}"]`
  )) {
    if (onScreen(element)) {
      return element;
    }
  }

  return null;
};

export const anchorPresent = (id: string): boolean => findAnchor(id) !== null;

export const boxOf = (element: Element): Box => {
  const box = element.getBoundingClientRect();

  return { height: box.height, width: box.width, x: box.left, y: box.top };
};

/** The tutorial's own bubbles, which never count as something else being open. */
export const BUBBLE_ATTRIBUTE = "data-coach-bubble";

/**
 * Something the user is in the middle of: an open menu, dialog or list of
 * choices. A hint waits until it is closed.
 */
export const somethingOpen = (): boolean =>
  document.querySelector(
    `[role=menu], [role=listbox], [role=alertdialog], [role=dialog]:not([${BUBBLE_ATTRIBUTE}])`
  ) !== null;
