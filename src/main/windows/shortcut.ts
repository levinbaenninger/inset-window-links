import { globalShortcut } from "electron";

import type { ShortcutStatus } from "../../shared/dto";
import { CAPTURE_ACCELERATOR, keyLabel } from "../../shared/shortcuts";
import { capturePlatform } from "../capture/capturer";

export { CAPTURE_ACCELERATOR } from "../../shared/shortcuts";

/** ⌥⌘W on a Mac, Ctrl+Alt+W on Windows. */
const label = keyLabel(CAPTURE_ACCELERATOR, capturePlatform);

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
