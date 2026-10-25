import type { MenuItemConstructorOptions } from "electron";

export const APP_NAME = "Inset Window Links";

export interface AppMenuState {
  floatOnTop: boolean;
  /** The capture shortcut's label, or null when another app holds it. */
  shortcut: string | null;
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
}

const SEPARATOR: MenuItemConstructorOptions = { type: "separator" };

/**
 * The menu bar of a regular Mac app. The Edit roles stay, so typing, copying and undo
 * work in every text field. macOS only: on Windows the windows keep no menu bar.
 */
export const appMenuTemplate = (
  state: AppMenuState,
  actions: AppMenuActions
): MenuItemConstructorOptions[] => [
  {
    label: APP_NAME,
    submenu: [
      { label: `About ${APP_NAME}`, role: "about" },
      SEPARATOR,
      {
        accelerator: "CommandOrControl+,",
        click: actions.openSettings,
        label: "Settings…",
      },
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
      {
        accelerator: "CommandOrControl+N",
        click: actions.newCapture,
        label: "New Capture",
      },
      {
        accelerator: "Shift+CommandOrControl+N",
        click: actions.addWindows,
        label: "Add Windows…",
      },
      SEPARATOR,
      {
        accelerator: "CommandOrControl+S",
        click: actions.saveCapture,
        label: "Save Capture",
      },
      SEPARATOR,
      {
        accelerator: "CommandOrControl+W",
        click: actions.closeWindow,
        label: "Close Window",
      },
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
      {
        accelerator: "CommandOrControl+F",
        click: actions.find,
        label: "Find Captures…",
      },
    ],
  },
  {
    label: "View",
    submenu: [
      {
        accelerator: "CommandOrControl+1",
        click: actions.newCapture,
        label: "Capture Panel",
      },
      {
        accelerator: "CommandOrControl+2",
        click: actions.openRecent,
        label: "Recent Captures",
      },
      SEPARATOR,
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
        click: (item) => actions.setFloatOnTop(item.checked),
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
      {
        enabled: false,
        label:
          state.shortcut === null
            ? "Capture shortcut is taken by another app"
            : `Add a Window: ${state.shortcut}`,
      },
      SEPARATOR,
      {
        click: actions.openScreenSettings,
        label: "Screen Recording Settings…",
      },
    ],
  },
];
