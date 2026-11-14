import { describe, expect, it } from "vitest";

import type { PageCommand } from "../shared/shortcuts";
import type { PageCommandState } from "./page-commands";
import { pageCommandTarget } from "./page-commands";

const state = (change: Partial<PageCommandState> = {}): PageCommandState => ({
  libraryFocused: false,
  libraryOpen: true,
  panelFocused: false,
  walking: false,
  ...change,
});

const LIBRARY_KEYS: readonly PageCommand[] = [
  "copyNote",
  "focusDescription",
  "reopen",
  "setDue",
  "showShortcuts",
  "toggleDone",
  "toggleSidebar",
];

describe(pageCommandTarget, () => {
  it("sends a menu key to the Inset window in front", () => {
    expect([
      pageCommandTarget("reopen", state({ panelFocused: true })),
      pageCommandTarget("reopen", state({ libraryFocused: true })),
    ]).toStrictEqual(["panel", "library"]);
  });

  it("with none in front, opens the panel for a field key and goes to an open Recent Captures for the rest", () => {
    expect([
      pageCommandTarget("setDue", state()),
      pageCommandTarget("toggleDone", state()),
      pageCommandTarget("toggleDone", state({ libraryOpen: false })),
      pageCommandTarget("showShortcuts", state({ libraryOpen: false })),
    ]).toStrictEqual(["draft", "library", null, "library"]);
  });

  it("acts on nothing behind the walkthrough: Recent Captures takes no menu key while it runs", () => {
    expect(
      LIBRARY_KEYS.map((command) =>
        pageCommandTarget(
          command,
          state({ libraryFocused: true, walking: true })
        )
      )
    ).toStrictEqual(LIBRARY_KEYS.map(() => null));
  });

  it("still lets the capture panel take its keys during the walkthrough", () => {
    expect([
      pageCommandTarget(
        "saveCapture",
        state({ panelFocused: true, walking: true })
      ),
      pageCommandTarget("setDue", state({ walking: true })),
    ]).toStrictEqual(["panel", "draft"]);
  });
});
