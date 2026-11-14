import type { KeyPlatform } from "../shared/shortcuts.ts";
import {
  CAPTURE_ACCELERATOR,
  keyLabel,
  menuKeyLabel,
} from "../shared/shortcuts.ts";
import type {
  SpotlightStep,
  TutorialHint,
  TutorialTask,
} from "../shared/tutorial";

/**
 * Inset Window Links' part of the in-app tutorial kit (src/main/tutorial/): its checklist,
 * one-time hints, walkthrough and example capture, as plain data. Keys come from the same tables
 * as the menus and the Keyboard Shortcuts sheet, written for the system: ⇧⌘N on a Mac,
 * Ctrl+Shift+N on Windows.
 */

/** Recent Captures, which holds the checklist and runs the walkthrough. */
export const HOME_PAGE = "library";

/** The capture panel, where the tips on adding windows and the title show. */
export const PANEL_PAGE = "popover";

export const CHECKLIST_TITLE = "Getting started";

/** Where the example capture's first window opens again: harmless, and about the app itself. */
export const EXAMPLE_URL =
  "https://github.com/levinbaenninger/inset-window-links";

/** What the checklist says once every task is done: where it comes back from, on this system. */
export const checklistDoneText = (platform: KeyPlatform): string =>
  platform === "macos"
    ? "That’s the whole loop. Help › Getting Started, or the menu bar icon’s menu, brings this back."
    : "That’s the whole loop. Getting Started in the notification area icon’s menu brings this back.";

export const LINKS_TASK_IDS = {
  addSeveral: "add-several",
  addWindow: "add-window",
  checkStep: "check-step",
  reopen: "reopen",
  save: "save",
} as const;

/** The keys the tutorial names, as the Keyboard Shortcuts sheet writes them for the system. */
export const tutorialKeys = (platform: KeyPlatform) => ({
  addWindow: keyLabel(CAPTURE_ACCELERATOR, platform),
  addWindows: menuKeyLabel("addWindows", platform),
  find: menuKeyLabel("find", platform),
  newCapture: menuKeyLabel("newCapture", platform),
  reopen: menuKeyLabel("reopen", platform),
  save: platform === "macos" ? "⌘↵" : "Ctrl+Enter",
  shortcuts: menuKeyLabel("showShortcuts", platform),
});

export const linksTasks = (platform: KeyPlatform): readonly TutorialTask[] => {
  const keys = tutorialKeys(platform);

  return [
    {
      anchor: null,
      how: `Click any window you’re working in, then press ${keys.addWindow}. A picture of it lands in the capture panel.`,
      id: LINKS_TASK_IDS.addWindow,
      keys: keys.addWindow,
      title: "Add a window",
    },
    {
      anchor: null,
      how: `Press ${keys.addWindows}, or click Add windows in the capture panel. Click the windows you want, then Add.`,
      id: LINKS_TASK_IDS.addSeveral,
      keys: keys.addWindows,
      title: "Add several from the list",
    },
    {
      anchor: null,
      how: `In the capture panel, write what connects the windows as the title, then press ${keys.save}.`,
      id: LINKS_TASK_IDS.save,
      keys: keys.save,
      title: "Save a capture with a title",
    },
    {
      // With no capture open there's no Reopen all; the how-to then points at its own row.
      anchor: "reopen-all",
      how: `Open a capture here and click Reopen all, or press ${keys.reopen}. Each window’s page, file or app opens again.`,
      id: LINKS_TASK_IDS.reopen,
      keys: keys.reopen,
      title: "Reopen a capture",
    },
    {
      anchor: "capture-steps",
      how: "Next steps have a box: click it when the step is done. The capture stays until you mark it done.",
      id: LINKS_TASK_IDS.checkStep,
      keys: null,
      title: "Check off a next step",
    },
  ];
};

export const linksHints = (platform: KeyPlatform): readonly TutorialHint[] => {
  const keys = tutorialKeys(platform);

  return [
    {
      anchor: "add-windows",
      id: "add-windows",
      page: PANEL_PAGE,
      placement: "below",
      task: LINKS_TASK_IDS.addSeveral,
      text: `Click here, or press ${keys.addWindows}, to pick several windows from a list. ${keys.addWindow} in any window adds just that one.`,
      title: "Add windows",
    },
    {
      anchor: "capture-title",
      id: "capture-title",
      page: PANEL_PAGE,
      // Above: below it are the description and steps, which Return moves on to while it shows.
      placement: "above",
      task: LINKS_TASK_IDS.save,
      text: `Say what connects these windows. Return moves on to the description, and ${keys.save} saves.`,
      title: null,
    },
    {
      anchor: "recent-list",
      id: "recent-list",
      page: HOME_PAGE,
      placement: "inside",
      task: null,
      text: "Every capture you save, by day. Snoozed and Done wait at the foot of the list.",
      title: "Recent Captures",
    },
    {
      // The field, marked only once Getting started is closed: the tip would cover the checklist.
      anchor: "search-tip",
      id: "search",
      page: HOME_PAGE,
      placement: "below",
      task: null,
      text: "Search titles, descriptions, steps and window titles. Type due:today, due:overdue or due:week to see what’s due.",
      title: "Search, and what’s due",
    },
    {
      anchor: "reopen-all",
      id: "reopen-all",
      page: HOME_PAGE,
      placement: "below",
      task: LINKS_TASK_IDS.reopen,
      text: `Opens the page, file or app each window showed (${keys.reopen}).`,
      title: null,
    },
  ];
};

export const linksSpotlight = (
  platform: KeyPlatform
): readonly SpotlightStep[] => {
  const keys = tutorialKeys(platform);

  return [
    {
      anchor: "recent-list",
      id: "list",
      text: "Every capture you save lands here, by day. Snoozed and Done sit at the foot.",
      title: "Your captures",
    },
    {
      anchor: "search",
      id: "search",
      text: `Search what you wrote and every window title (${keys.find}). due:today, due:overdue and due:week filter by Due.`,
      title: "Search and Due",
    },
    {
      anchor: "capture-windows",
      id: "windows",
      text: "Each window keeps its picture, its app, and the page or file it showed. Click a picture to see it full size.",
      title: "The windows",
    },
    {
      anchor: "reopen-all",
      id: "reopen",
      text: `Opens every window’s page, file or app again (${keys.reopen}).`,
      title: "Reopen",
    },
    {
      anchor: "capture-steps",
      id: "steps",
      text: "Check steps off as you go. The capture stays in the list until you mark it done.",
      title: "Next steps",
    },
    {
      anchor: "settings",
      id: "settings",
      text: `Settings and Keyboard Shortcuts (${keys.shortcuts}) are down here.`,
      title: "Settings and keys",
    },
  ];
};

export interface ExampleWindow {
  readonly title: string;
  readonly appName: string | null;
  /** What the window's description says. */
  readonly description: string;
  /** The page Reopen opens; null for a window with nothing to reopen. */
  readonly url: string | null;
  /** Which bundled placeholder picture it shows. */
  readonly picture: "page" | "notes";
}

export interface ExampleCapture {
  readonly title: string;
  readonly description: string;
  readonly steps: readonly string[];
  readonly windows: readonly ExampleWindow[];
}

/** The first run's example capture: its title, description and steps are things to try. */
export const linksExample = (platform: KeyPlatform): ExampleCapture => {
  const keys = tutorialKeys(platform);

  return {
    description: `A capture keeps windows with the thought that connects them. Start your own with ${keys.addWindow} in any window. Remove Examples, in the Getting started menu, takes this one away.`,
    steps: [
      "Click Reopen window to open this capture’s page again",
      "Check this step off: click its box",
      `Press ${keys.addWindow} in another window to start your own capture`,
    ],
    title: "Try me: an example capture with two windows",
    windows: [
      {
        appName: null,
        description: "Reopen opens this page in your browser.",
        picture: "page",
        title: "Inset Window Links on GitHub",
        url: EXAMPLE_URL,
      },
      {
        appName: null,
        description:
          "A window you add keeps its picture, its app and, where it can, its page or file.",
        picture: "notes",
        title: "A window of your own",
        url: null,
      },
    ],
  };
};
