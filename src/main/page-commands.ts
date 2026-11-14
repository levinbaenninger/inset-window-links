import type { PageCommand } from "../shared/shortcuts";

/** What decides where a menu key for a page goes. */
export interface PageCommandState {
  readonly panelFocused: boolean;
  readonly libraryFocused: boolean;
  /** Recent Captures has a window, shown or not. */
  readonly libraryOpen: boolean;
  /** The walkthrough runs in Recent Captures. */
  readonly walking: boolean;
}

/**
 * Where a menu key for a page goes: the capture panel, the draft (the panel, opened for a field
 * key), Recent Captures, or nowhere.
 */
export type PageCommandTarget = "panel" | "draft" | "library" | null;

/** The keys for a capture's fields: with no Inset window in front, they open the panel. */
const FIELD_KEYS: ReadonlySet<PageCommand> = new Set([
  "focusDescription",
  "focusSteps",
  "setDue",
]);

/**
 * A menu key for a page goes to the Inset window in front. With none in front, the field keys
 * open the panel, and the sheet opens in Recent Captures; the keys for an open capture or the
 * sidebar need Recent Captures to be open already.
 */
export const pageCommandTarget = (
  command: PageCommand,
  state: PageCommandState
): PageCommandTarget => {
  if (state.panelFocused) {
    return "panel";
  }

  // The walkthrough covers Recent Captures. Menu keys reach main before the page sees them (macOS
  // menu accelerators, answerMenuKeys on Windows), so its own key guard can't stop them: they act
  // on nothing behind it.
  const library = state.walking ? null : "library";

  if (state.libraryFocused || command === "showShortcuts") {
    return library;
  }

  if (FIELD_KEYS.has(command)) {
    return "draft";
  }

  return state.libraryOpen ? library : null;
};
