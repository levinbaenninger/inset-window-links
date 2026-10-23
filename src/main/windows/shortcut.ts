import { globalShortcut } from "electron";

import type { ShortcutStatus } from "../../shared/dto";
import { capturePlatform } from "../capture/capturer";

export const CAPTURE_ACCELERATOR = "CommandOrControl+Alt+W";

const label = capturePlatform === "macos" ? "⌥⌘W" : "Ctrl+Alt+W";

/** Read live, so the tray and the popover always agree with the OS registration. */
export const shortcutStatus = (): ShortcutStatus => ({
  kind: globalShortcut.isRegistered(CAPTURE_ACCELERATOR)
    ? "registered"
    : "unavailable",
  label,
});

/** Unavailable when the OS refuses the combination. The tray then says so and keeps the list fallback. */
export const registerCaptureShortcut = (
  onPress: () => void
): ShortcutStatus => {
  globalShortcut.register(CAPTURE_ACCELERATOR, onPress);

  return shortcutStatus();
};
