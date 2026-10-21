import type { LibraryApi, PopoverApi } from "./api";

export type WindowRole = "popover" | "library";

type ChannelKind = "invoke" | "send";

export const popoverChannels = {
  cancelChoice: "invoke",
  chooseSource: "invoke",
  discard: "invoke",
  dismiss: "send",
  getDraft: "invoke",
  openScreenSettings: "invoke",
  recheckPermission: "invoke",
  removeView: "invoke",
  reportHeight: "send",
  save: "invoke",
  setText: "send",
} as const satisfies { [K in keyof PopoverApi]: ChannelKind };

export const libraryChannels = {
  copyNote: "invoke",
  get: "invoke",
  list: "invoke",
  remove: "invoke",
  updateText: "invoke",
} as const satisfies { [K in keyof LibraryApi]: ChannelKind };

export const pushChannels = {
  draft: "push:draft",
  libraryChanged: "push:library-changed",
} as const;

export const channelName = (role: WindowRole, method: string): string =>
  `${role}:${method}`;

export const roleArgument = (role: WindowRole): string =>
  `--inset-role=${role}`;
