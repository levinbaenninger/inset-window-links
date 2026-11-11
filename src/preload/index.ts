import { contextBridge, ipcRenderer } from "electron";

import type { WindowRole } from "../shared/channels";
import {
  channelName,
  libraryChannels,
  onboardingChannels,
  popoverChannels,
  pushChannels,
  roleArgument,
  settingsChannels,
} from "../shared/channels";

const roles: readonly WindowRole[] = [
  "popover",
  "library",
  "settings",
  "onboarding",
];

const platform = process.platform === "win32" ? "windows" : "macos";
const role = roles.find((name) => process.argv.includes(roleArgument(name)));

/** Builds only the methods named in the role's channel table. Main validates every argument. */
const bridge = (
  name: WindowRole,
  channels: Readonly<Partial<{ [method: string]: "invoke" | "send" }>>
) =>
  Object.fromEntries(
    Object.entries(channels).map(([method, kind]) => {
      const channel = channelName(name, method);

      return [
        method,
        kind === "send"
          ? (...args: readonly unknown[]) => ipcRenderer.send(channel, ...args)
          : (...args: readonly unknown[]) =>
              ipcRenderer.invoke(channel, ...args),
      ];
    })
  );

const subscribe = (
  channel: string,
  listener: (...args: readonly unknown[]) => void
) => {
  const handler = (
    _event: Electron.IpcRendererEvent,
    ...args: readonly unknown[]
  ) => listener(...args);

  ipcRenderer.on(channel, handler);

  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
};

if (role === "popover") {
  contextBridge.exposeInMainWorld("inset", {
    ...bridge("popover", popoverChannels),
    onDraft: (listener: (...args: readonly unknown[]) => void) =>
      subscribe(pushChannels.draft, listener),
    onCommand: (listener: (...args: readonly unknown[]) => void) =>
      subscribe(pushChannels.command, listener),
    onShown: (listener: () => void) =>
      subscribe(pushChannels.focusInput, () => listener()),
    onTutorial: (listener: (...args: readonly unknown[]) => void) =>
      subscribe(pushChannels.tutorial, listener),
    platform,
  });
}

if (role === "library") {
  contextBridge.exposeInMainWorld("inset", {
    ...bridge("library", libraryChannels),
    onChanged: (listener: () => void) =>
      subscribe(pushChannels.libraryChanged, () => listener()),
    onCommand: (listener: (...args: readonly unknown[]) => void) =>
      subscribe(pushChannels.command, listener),
    onLeave: (listener: (...args: readonly unknown[]) => void) =>
      subscribe(pushChannels.leave, listener),
    onNavigate: (listener: (...args: readonly unknown[]) => void) =>
      subscribe(pushChannels.navigate, listener),
    onTutorial: (listener: (...args: readonly unknown[]) => void) =>
      subscribe(pushChannels.tutorial, listener),
    platform,
  });
}

if (role === "onboarding") {
  contextBridge.exposeInMainWorld("inset", {
    ...bridge("onboarding", onboardingChannels),
    onView: (listener: (...args: readonly unknown[]) => void) =>
      subscribe(pushChannels.onboardingView, listener),
    platform,
  });
}

if (role === "settings") {
  contextBridge.exposeInMainWorld("inset", {
    ...bridge("settings", settingsChannels),
    onView: (listener: (...args: readonly unknown[]) => void) =>
      subscribe(pushChannels.settingsView, listener),
    platform,
  });
}
