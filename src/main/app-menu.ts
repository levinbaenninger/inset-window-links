import type { MenuItemConstructorOptions } from "electron";

import type { MenuKeyAction, MenuKeyId } from "../shared/shortcuts";
import { acceleratorFor, MENU_KEYS } from "../shared/shortcuts";
import type { UpdateState } from "./update/state";
import { updateMenuItems } from "./update/state";

export const APP_NAME = "Inset Window Links";

export interface AppMenuState {
  floatOnTop: boolean;
  /** The capture shortcut's label, or null when another app holds it. */
  shortcut: string | null;
  update: UpdateState;
}

export interface AppMenuActions {
  newCapture: () => void;
  addWindows: () => void;
  saveCapture: () => void;
  closeWindow: () => void;
  find: () => void;
  openRecent: () => void;
  openSettings: () => void;
  openHelp: () => void;
  openScreenSettings: () => void;
  setFloatOnTop: (on: boolean) => void;
  checkForUpdates: () => void;
  restartToUpdate: () => void;
  focusDescription: () => void;
  setDue: () => void;
  focusSteps: () => void;
  toggleDone: () => void;
  copyNote: () => void;
  reopen: () => void;
  toggleSidebar: () => void;
  showShortcuts: () => void;
}

const SEPARATOR: MenuItemConstructorOptions = { type: "separator" };

/** The menu items that have a key of their own. */
export type KeyAction = MenuKeyAction;

/** The parts of a key press that pick a menu key, as Electron's before-input-event reports them. */
export interface KeyPress {
  type: string;
  key: string;
  /** The physical key, such as "KeyN" or "Digit1"; absent from older senders. */
  code?: string;
  control: boolean;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  isAutoRepeat: boolean;
}

/** "Shift+CommandOrControl+N" as "ctrl+shift+n", the form a key press is looked up by. */
const comboOf = (accelerator: string): string => {
  const parts = accelerator.split("+");
  const key = (parts.at(-1) ?? "").toLowerCase();
  const shift = parts.includes("Shift") ? "shift+" : "";

  return `ctrl+${shift}${key}`;
};

/** The menu's keys on Windows, where Ctrl stands for ⌘. */
const KEY_ACTIONS = new Map<string, KeyAction>(
  Object.values(MENU_KEYS).map((key) => [
    comboOf(acceleratorFor(key, "windows")),
    key.action,
  ])
);

const PLAIN_KEY = /^[a-z0-9]$/u;

/** The letter or digit a physical key carries on a US layout, for layouts that type something else. */
const keyFromCode = (code: string | undefined): string | null => {
  const found = /^(?:Key(?<letter>[A-Z])|Digit(?<digit>\d))$/u.exec(code ?? "");

  return (
    found?.groups?.["letter"]?.toLowerCase() ?? found?.groups?.["digit"] ?? null
  );
};

/**
 * Windows has no menu bar, so Inset's windows answer the menu's keys themselves. Alt is never
 * part of them: Ctrl+Alt is AltGr on many layouts, and Ctrl+Alt+W is the capture shortcut.
 *
 * The typed character decides first, so a Dvorak or AZERTY user presses the letter the menu
 * names. When it is no plain letter or digit (Cyrillic, Greek, or AZERTY's "&" on the 1 key),
 * the physical key decides. A punctuation key such as "/" matches with or without Shift,
 * because some layouts need Shift to type it (Shift+7 on German keyboards).
 */
export const keyAction = (press: KeyPress): KeyAction | null => {
  if (
    press.type !== "keyDown" ||
    press.isAutoRepeat ||
    !press.control ||
    press.alt ||
    press.meta
  ) {
    return null;
  }

  const shift = press.shift ? "shift+" : "";
  const key = press.key.toLowerCase();
  const typed = KEY_ACTIONS.get(`ctrl+${shift}${key}`);

  if (typed !== undefined) {
    return typed;
  }

  if (key.length === 1 && !PLAIN_KEY.test(key)) {
    const unshifted = press.shift ? KEY_ACTIONS.get(`ctrl+${key}`) : undefined;

    if (unshifted !== undefined) {
      return unshifted;
    }

    const physical = keyFromCode(press.code);

    if (physical !== null) {
      return KEY_ACTIONS.get(`ctrl+${shift}${physical}`) ?? null;
    }
  }

  return null;
};

const item = (
  id: MenuKeyId,
  label: string,
  click: () => void
): MenuItemConstructorOptions => ({
  accelerator: MENU_KEYS[id].accelerator,
  click,
  label,
});

/**
 * The menu bar of a regular Mac app. The Edit roles stay, so typing, copying and undo
 * work in every text field. macOS only: on Windows the windows keep no menu bar, and
 * keyAction gives them the same keys.
 */
export const appMenuTemplate = (
  state: AppMenuState,
  actions: AppMenuActions
): MenuItemConstructorOptions[] => [
  {
    label: APP_NAME,
    submenu: [
      { label: `About ${APP_NAME}`, role: "about" },
      ...updateMenuItems(state.update, {
        check: actions.checkForUpdates,
        restart: actions.restartToUpdate,
      }),
      SEPARATOR,
      item("openSettings", "Settings…", actions.openSettings),
      SEPARATOR,
      { role: "services" },
      SEPARATOR,
      { role: "hide" },
      { role: "hideOthers" },
      { role: "unhide" },
      SEPARATOR,
      { role: "quit" },
    ],
  },
  {
    label: "File",
    submenu: [
      item("newCapture", "New Capture", actions.newCapture),
      item("addWindows", "Add Windows…", actions.addWindows),
      SEPARATOR,
      item("saveCapture", "Save Capture", actions.saveCapture),
      SEPARATOR,
      item("closeWindow", "Close Window", actions.closeWindow),
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      SEPARATOR,
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "pasteAndMatchStyle" },
      { role: "delete" },
      { role: "selectAll" },
      SEPARATOR,
      item("find", "Find Captures…", actions.find),
    ],
  },
  {
    label: "Capture",
    submenu: [
      item("focusDescription", "Description", actions.focusDescription),
      item("setDue", "Due Date…", actions.setDue),
      item("focusSteps", "Next Steps", actions.focusSteps),
      SEPARATOR,
      item("toggleDone", "Mark as Done", actions.toggleDone),
      item("copyNote", "Copy as Text", actions.copyNote),
      item("reopen", "Reopen Windows", actions.reopen),
    ],
  },
  {
    label: "View",
    submenu: [
      item("capturePanel", "Capture Panel", actions.newCapture),
      item("openRecent", "Recent Captures", actions.openRecent),
      SEPARATOR,
      item("toggleSidebar", "Show or Hide Sidebar", actions.toggleSidebar),
      { role: "togglefullscreen" },
    ],
  },
  {
    role: "windowMenu",
    submenu: [
      { role: "minimize" },
      { role: "zoom" },
      SEPARATOR,
      {
        checked: state.floatOnTop,
        click: (menuItem) => actions.setFloatOnTop(menuItem.checked),
        label: "Keep Capture Panel on Top",
        type: "checkbox",
      },
      SEPARATOR,
      { role: "front" },
    ],
  },
  {
    role: "help",
    submenu: [
      { click: actions.openHelp, label: `${APP_NAME} Help` },
      item("showShortcuts", "Keyboard Shortcuts", actions.showShortcuts),
      SEPARATOR,
      {
        enabled: false,
        label:
          state.shortcut === null
            ? "Capture Shortcut Is Taken by Another App"
            : `Add a Window: ${state.shortcut}`,
      },
      {
        click: actions.openScreenSettings,
        label: "Screen Recording Settings…",
      },
    ],
  },
];
