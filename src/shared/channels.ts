import type { LibraryApi, PopoverApi, SettingsApi } from "./api";

export type WindowRole = "popover" | "library" | "settings";

type ChannelKind = "invoke" | "send";

export const popoverChannels = {
  addWindows: "invoke",
  cancelChoice: "invoke",
  chooseQuit: "invoke",
  chooseSources: "invoke",
  discard: "invoke",
  dismiss: "send",
  getDraft: "invoke",
  openRecent: "send",
  openScreenSettings: "invoke",
  openSettings: "send",
  recheckPermission: "invoke",
  relaunch: "invoke",
  removeView: "invoke",
  reportHeight: "send",
  save: "invoke",
  setText: "send",
} as const satisfies { [K in keyof PopoverApi]: ChannelKind };

export const libraryChannels = {
  addWindows: "send",
  copyImage: "invoke",
  copyNote: "invoke",
  dragImage: "send",
  get: "invoke",
  list: "invoke",
  newCapture: "send",
  openSettings: "send",
  remove: "invoke",
  reopen: "invoke",
  setTodoDone: "invoke",
  shortcut: "invoke",
  updateText: "invoke",
} as const satisfies { [K in keyof LibraryApi]: ChannelKind };

export const settingsChannels = {
  allowOrigins: "invoke",
  fitHeight: "send",
  getView: "invoke",
  setOpenAtLogin: "invoke",
  update: "invoke",
} as const satisfies { [K in keyof SettingsApi]: ChannelKind };

export const pushChannels = {
  draft: "push:draft",
  find: "push:find",
  focusInput: "push:focus-input",
  libraryChanged: "push:library-changed",
  navigate: "push:navigate",
  settingsView: "push:settings-view",
} as const;

export const channelName = (role: WindowRole, method: string): string =>
  `${role}:${method}`;

export const roleArgument = (role: WindowRole): string =>
  `--inset-role=${role}`;
