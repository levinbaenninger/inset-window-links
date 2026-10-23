import { contextBridge, ipcRenderer } from "electron";

import type { WindowRole } from "../shared/channels";
import {
  channelName,
  libraryChannels,
  popoverChannels,
  pushChannels,
  roleArgument,
} from "../shared/channels";

const roles: readonly WindowRole[] = ["popover", "library"];
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
    onShown: (listener: () => void) =>
      subscribe(pushChannels.focusInput, () => listener()),
  });
}

if (role === "library") {
  contextBridge.exposeInMainWorld("inset", {
    ...bridge("library", libraryChannels),
    onChanged: (listener: () => void) =>
      subscribe(pushChannels.libraryChanged, () => listener()),
    onNavigate: (listener: (...args: readonly unknown[]) => void) =>
      subscribe(pushChannels.navigate, listener),
    platform: process.platform === "win32" ? "windows" : "macos",
  });
}
