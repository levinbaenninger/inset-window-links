/** A capture's own words, title then description: what ⌘C copies when no text is selected. */
export const entryText = (title: string, description: string): string =>
  [title.trim(), description.trim()].filter((part) => part !== "").join("\n\n");

const editable = (element: Element | null) =>
  element instanceof HTMLInputElement ||
  element instanceof HTMLTextAreaElement ||
  (element instanceof HTMLElement && element.isContentEditable);

/**
 * The entry ⌘C copies: the row in focus, else the open capture. Nothing while a text field has
 * focus or text is selected, so ⌘C there copies as it always does.
 */
const entryToCopy = (): string | null => {
  const active = document.activeElement;

  if (
    editable(active) ||
    (globalThis.getSelection()?.toString() ?? "") !== ""
  ) {
    return null;
  }

  const holder =
    active?.closest<HTMLElement>("[data-copy]") ??
    document.querySelector<HTMLElement>("main[data-copy]");

  return holder?.dataset["copy"] ?? null;
};

/**
 * ⌘C (Ctrl+C) on a capture copies its title and description. Both the Edit menu's Copy and the
 * key run the page's copy command, which fires these events whatever is selected. Chromium runs
 * the command with nothing selected only when beforecopy is cancelled.
 */
export const listenForCopy = (): void => {
  document.addEventListener("beforecopy", (event) => {
    if (entryToCopy() !== null) {
      event.preventDefault();
    }
  });

  document.addEventListener("copy", (event) => {
    const text = entryToCopy();

    if (text !== null && event.clipboardData !== null) {
      event.preventDefault();
      event.clipboardData.setData("text/plain", text);
    }
  });
};
