import type { LibraryApi, OnboardingApi, PopoverApi, SettingsApi } from "./api";

export type WindowRole = "popover" | "library" | "settings" | "onboarding";

type ChannelKind = "invoke" | "send";

export const popoverChannels = {
  addWindows: "invoke",
  cancelChoice: "invoke",
  chooseQuit: "invoke",
  chooseSources: "invoke",
  discard: "invoke",
  dismiss: "send",
  getDraft: "invoke",
  getTutorial: "invoke",
  openSetup: "invoke",
  recheckPermission: "invoke",
  relaunch: "invoke",
  removeView: "invoke",
  reportHeight: "send",
  save: "invoke",
  setText: "send",
  tutorial: "send",
} as const satisfies { [K in keyof PopoverApi]: ChannelKind };

export const libraryChannels = {
  addWindows: "send",
  answerLeave: "send",
  beginCopy: "send",
  copy: "invoke",
  discard: "invoke",
  dragImage: "send",
  get: "invoke",
  getTutorial: "invoke",
  list: "invoke",
  menuOpen: "send",
  newCapture: "send",
  openSettings: "send",
  owedDiscards: "invoke",
  remove: "invoke",
  reopen: "invoke",
  reportUnsaved: "send",
  setStatus: "invoke",
  setTodoDone: "invoke",
  shortcut: "invoke",
  tutorial: "send",
  updateText: "invoke",
} as const satisfies { [K in keyof LibraryApi]: ChannelKind };

export const settingsChannels = {
  allowOrigins: "invoke",
  fitHeight: "send",
  getView: "invoke",
  menuOpen: "send",
  resetTutorial: "send",
  setOpenAtLogin: "invoke",
  setTips: "invoke",
  update: "invoke",
} as const satisfies { [K in keyof SettingsApi]: ChannelKind };

export const onboardingChannels = {
  allow: "send",
  back: "send",
  finish: "send",
  fitHeight: "send",
  getView: "invoke",
  next: "send",
  reopen: "send",
  skip: "send",
  startDrag: "send",
} as const satisfies { [K in keyof OnboardingApi]: ChannelKind };

export const pushChannels = {
  command: "push:command",
  draft: "push:draft",
  focusInput: "push:focus-input",
  leave: "push:leave",
  libraryChanged: "push:library-changed",
  navigate: "push:navigate",
  onboardingView: "push:onboarding-view",
  settingsView: "push:settings-view",
  tutorial: "push:tutorial",
} as const;

export const channelName = (role: WindowRole, method: string): string =>
  `${role}:${method}`;

export const roleArgument = (role: WindowRole): string =>
  `--inset-role=${role}`;
