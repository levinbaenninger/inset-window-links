import { useEffect, useEffectEvent } from "react";
import type { RefObject } from "react";

import { keyForMenu } from "@/lib/menu-keys";

import { ROW_SELECTOR } from "./row-keys";

/** What ⌘C runs for each sidebar row and for the open capture's page. */
const copiers = new WeakMap<Element, () => void>();

/** Makes ⌘C on `holder`, or inside it, run `copy`. */
export const useEntryCopy = (
  holder: RefObject<HTMLElement | null>,
  copy: () => void
): void => {
  const run = useEffectEvent(copy);

  useEffect(() => {
    const element = holder.current;

    if (element === null) {
      return;
    }

    copiers.set(element, () => run());

    return () => {
      copiers.delete(element);
    };
  }, [holder]);
};

const editable = (element: Element | null) =>
  element instanceof HTMLInputElement ||
  element instanceof HTMLTextAreaElement ||
  (element instanceof HTMLElement && element.isContentEditable);

/**
 * The copy ⌘C runs: the open menu's, else the row in focus, else the open capture. Nothing while a
 * text field has focus or text is selected, so ⌘C there copies as it always does.
 */
const entryCopier = (): (() => void) | null => {
  if (keyForMenu(null)) {
    return () => keyForMenu("copyEntry");
  }

  const active = document.activeElement;

  if (
    editable(active) ||
    (globalThis.getSelection()?.toString() ?? "") !== ""
  ) {
    return null;
  }

  const holder =
    active?.closest(ROW_SELECTOR) ??
    // The open capture's page.
    document.querySelector("[data-copy-entry]");

  return holder === null ? null : (copiers.get(holder) ?? null);
};

/**
 * ⌘C (Ctrl+C) on a capture copies its title and description, once what is typed in it is saved.
 * Both the Edit menu's Copy and the key run the page's copy command, which fires these events.
 * Chromium runs the command with nothing selected only when beforecopy is cancelled, and then
 * writes nothing itself, so a copy refused for an unsaved edit leaves the clipboard as it was.
 */
export const listenForCopy = (): void => {
  document.addEventListener("beforecopy", (event) => {
    if (entryCopier() !== null) {
      event.preventDefault();
    }
  });

  document.addEventListener("copy", () => {
    entryCopier()?.();
  });
};
