import { z } from "zod";

/**
 * Every key the app answers, in one place. The Mac menu takes its accelerators from MENU_KEYS,
 * Windows' windows answer the same keys through keyAction in main, and the Keyboard Shortcuts
 * sheet, the tooltips and the guide print them from here, so the three can't drift apart.
 */

export type KeyPlatform = "macos" | "windows";

/** What a menu key does. Main maps each to an action; the field and capture ones reach the page. */
export const MENU_ACTIONS = [
  "addWindows",
  "closeWindow",
  "copyNote",
  "find",
  "focusDescription",
  "focusSteps",
  "newCapture",
  "openRecent",
  "openSettings",
  "reopen",
  "saveCapture",
  "setDue",
  "showShortcuts",
  "toggleDone",
  "toggleSidebar",
] as const;

export type MenuKeyAction = (typeof MENU_ACTIONS)[number];

export interface MenuKey {
  action: MenuKeyAction;
  /** Electron's accelerator, as the Mac menu shows it. */
  accelerator: string;
  /** The Windows key when it is not the same with Ctrl for ⌘. */
  windows?: string;
}

/** Ctrl+⌘S toggles the sidebar on a Mac, as in Finder and Mail; Ctrl+B on Windows. */
export const MENU_KEYS = {
  addWindows: { accelerator: "Shift+CommandOrControl+N", action: "addWindows" },
  capturePanel: { accelerator: "CommandOrControl+1", action: "newCapture" },
  closeWindow: { accelerator: "CommandOrControl+W", action: "closeWindow" },
  copyNote: { accelerator: "Shift+CommandOrControl+C", action: "copyNote" },
  find: { accelerator: "CommandOrControl+F", action: "find" },
  focusDescription: {
    accelerator: "CommandOrControl+D",
    action: "focusDescription",
  },
  focusSteps: { accelerator: "Shift+CommandOrControl+S", action: "focusSteps" },
  newCapture: { accelerator: "CommandOrControl+N", action: "newCapture" },
  openRecent: { accelerator: "CommandOrControl+2", action: "openRecent" },
  openSettings: { accelerator: "CommandOrControl+,", action: "openSettings" },
  reopen: { accelerator: "CommandOrControl+O", action: "reopen" },
  saveCapture: { accelerator: "CommandOrControl+S", action: "saveCapture" },
  setDue: { accelerator: "Shift+CommandOrControl+D", action: "setDue" },
  showShortcuts: { accelerator: "CommandOrControl+/", action: "showShortcuts" },
  toggleDone: { accelerator: "CommandOrControl+K", action: "toggleDone" },
  toggleSidebar: {
    accelerator: "Control+Command+S",
    action: "toggleSidebar",
    windows: "Control+B",
  },
} as const satisfies Record<string, MenuKey>;

export type MenuKeyId = keyof typeof MENU_KEYS;

/** The accelerator a platform uses for a menu key. */
export const acceleratorFor = (key: MenuKey, platform: KeyPlatform): string =>
  platform === "windows" ? (key.windows ?? key.accelerator) : key.accelerator;

const MAC_MODIFIERS = new Map([
  ["Alt", "⌥"],
  ["Command", "⌘"],
  ["CommandOrControl", "⌘"],
  ["Control", "⌃"],
  ["Option", "⌥"],
  ["Shift", "⇧"],
]);

const WIN_MODIFIERS = new Map([
  ["Alt", "Alt"],
  ["CommandOrControl", "Ctrl"],
  ["Control", "Ctrl"],
  ["Option", "Alt"],
  ["Shift", "Shift"],
]);

/** The Mac order of modifier symbols, and Windows' order of modifier names. */
const MAC_ORDER = ["⌃", "⌥", "⇧", "⌘"];
const WIN_ORDER = ["Ctrl", "Alt", "Shift"];

const MAC_KEYS = new Map([
  ["Backspace", "⌫"],
  ["Down", "↓"],
  ["Enter", "↵"],
  ["Escape", "Esc"],
  ["Left", "←"],
  ["Return", "↵"],
  ["Right", "→"],
  ["Up", "↑"],
]);

const WIN_KEYS = new Map([
  ["Backspace", "Backspace"],
  ["Down", "↓"],
  ["Enter", "Enter"],
  ["Escape", "Esc"],
  ["Left", "←"],
  ["Return", "Enter"],
  ["Right", "→"],
  ["Up", "↑"],
]);

/** "Shift+CommandOrControl+N" as ⇧⌘N on a Mac and as Ctrl+Shift+N on Windows. */
export const keyLabel = (
  accelerator: string,
  platform: KeyPlatform
): string => {
  const parts = accelerator.split("+");
  const key = parts.at(-1) ?? "";
  const mac = platform === "macos";
  const names = mac ? MAC_MODIFIERS : WIN_MODIFIERS;
  const order = mac ? MAC_ORDER : WIN_ORDER;

  const shown = parts
    .slice(0, -1)
    .map((modifier) => names.get(modifier) ?? modifier)
    .toSorted((a, b) => order.indexOf(a) - order.indexOf(b));

  const keyName = (mac ? MAC_KEYS : WIN_KEYS).get(key) ?? key.toUpperCase();

  return mac ? [...shown, keyName].join("") : [...shown, keyName].join("+");
};

/** The label of a menu key on a platform, such as ⌘D or Ctrl+D. */
export const menuKeyLabel = (id: MenuKeyId, platform: KeyPlatform): string =>
  keyLabel(acceleratorFor(MENU_KEYS[id], platform), platform);

/**
 * What main asks the focused page to do for a menu key: the page owns the fields, the open
 * capture and the sidebar. Validated where it arrives.
 */
export const PageCommandSchema = z.enum([
  "copyNote",
  "find",
  "focusDescription",
  "focusSteps",
  "reopen",
  "setDue",
  "showShortcuts",
  "toggleDone",
  "toggleSidebar",
]);

export type PageCommand = z.infer<typeof PageCommandSchema>;

/** A row of the sheet: a menu key, a key that only a page answers, or the global shortcut. */
export type SheetKeys =
  | { kind: "menu"; id: MenuKeyId }
  | { kind: "page"; macos: string; windows: string }
  | { kind: "global" };

export interface SheetRow {
  label: string;
  keys: readonly SheetKeys[];
}

export interface SheetGroup {
  title: string;
  /** Where the keys work, in a few words. */
  where: string;
  rows: readonly SheetRow[];
}

const menu = (id: MenuKeyId): SheetKeys => ({ id, kind: "menu" });

const page = (macos: string, windows: string = macos): SheetKeys => ({
  kind: "page",
  macos,
  windows,
});

/** Every key, grouped by where it works. A test checks that every menu key is here. */
export const SHEET: readonly SheetGroup[] = [
  {
    rows: [{ keys: [{ kind: "global" }], label: "Add the window in front" }],
    title: "From any app",
    where: "Works while another app is in front",
  },
  {
    rows: [
      {
        keys: [menu("newCapture"), menu("capturePanel")],
        label: "Show the capture panel",
      },
      { keys: [menu("addWindows")], label: "Pick windows from a list" },
      { keys: [page("⌘↵", "Ctrl+Enter"), menu("saveCapture")], label: "Save" },
      { keys: [page("Esc")], label: "Hide the panel, keeping the draft" },
    ],
    title: "Capture panel",
    where: "While an Inset window is in front",
  },
  {
    rows: [
      { keys: [menu("focusDescription")], label: "Description" },
      { keys: [menu("setDue")], label: "Due date" },
      { keys: [menu("focusSteps")], label: "Next steps" },
      {
        keys: [page("↵", "Enter")],
        label: "From the title to the description",
      },
      { keys: [page("↵", "Enter")], label: "New step, in a step" },
      { keys: [page("⌫", "Backspace")], label: "Remove an empty step" },
      { keys: [page("↑"), page("↓")], label: "Move between steps" },
      { keys: [page("Esc")], label: "Leave the field" },
    ],
    title: "Fields",
    where: "In the panel and in Recent Captures",
  },
  {
    rows: [
      { keys: [menu("openRecent")], label: "Recent Captures" },
      { keys: [menu("find")], label: "Search" },
      { keys: [menu("toggleSidebar")], label: "Show or hide the sidebar" },
      {
        keys: [menu("toggleDone")],
        label: "Mark as done, or back to the list",
      },
      { keys: [menu("copyNote")], label: "Copy as text" },
      { keys: [menu("reopen")], label: "Reopen the windows" },
    ],
    title: "Recent Captures",
    where: "On the open capture",
  },
  {
    rows: [
      { keys: [page("⌘A", "Ctrl+A")], label: "Pick every window" },
      { keys: [page("⌘↵", "Ctrl+Enter")], label: "Add the picked windows" },
      { keys: [page("←"), page("→")], label: "Previous or next image" },
      { keys: [page("Z")], label: "Actual size or fit" },
      { keys: [page("Esc")], label: "Back" },
    ],
    title: "Window list and image view",
    where: "While they are open",
  },
  {
    rows: [
      { keys: [menu("showShortcuts")], label: "Keyboard shortcuts" },
      { keys: [menu("openSettings")], label: "Settings" },
      {
        keys: [menu("closeWindow")],
        label: "Close the window or hide the panel",
      },
    ],
    title: "App",
    where: "In any Inset window",
  },
];

/** The labels a sheet row shows on a platform; the global shortcut's comes from main. */
export const sheetKeyLabels = (
  row: SheetRow,
  platform: KeyPlatform,
  globalLabel: string | null
): string[] =>
  row.keys.flatMap((keys) => {
    switch (keys.kind) {
      case "menu": {
        return [menuKeyLabel(keys.id, platform)];
      }

      case "page": {
        return [keys[platform]];
      }

      default: {
        return globalLabel === null ? [] : [globalLabel];
      }
    }
  });
