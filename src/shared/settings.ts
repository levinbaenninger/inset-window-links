import { z } from "zod";

import type { CapturePlatform, ShortcutStatus } from "./dto";

export const ICON_PLACES = ["dockAndMenuBar", "dock", "menuBar"] as const;

export type IconPlace = (typeof ICON_PLACES)[number];

export const SettingsSchema = z.object({
  /** Where the app's icon shows (macOS). Menu bar only makes it an accessory app without its own menu bar. */
  iconIn: z.enum(ICON_PLACES),
  /** The capture panel stays above other windows while it is open. */
  floatOnTop: z.boolean(),
  /** The capture panel hides when another window is clicked, as it did before it stayed open. */
  hideOnClickAway: z.boolean(),
});

export type Settings = z.output<typeof SettingsSchema>;

export const SettingsChangeSchema = SettingsSchema.partial().strict();

/** Some settings to change; the rest stay. */
export type SettingsChange = z.output<typeof SettingsChangeSchema>;

export const withChange = (
  settings: Settings,
  change: SettingsChange
): Settings => ({
  floatOnTop: change.floatOnTop ?? settings.floatOnTop,
  hideOnClickAway: change.hideOnClickAway ?? settings.hideOnClickAway,
  iconIn: change.iconIn ?? settings.iconIn,
});

export const DEFAULT_SETTINGS: Settings = {
  floatOnTop: true,
  hideOnClickAway: false,
  iconIn: "dockAndMenuBar",
};

/** Settings from their file; missing, unknown or damaged values fall back to the defaults. */
export const readSettings = (raw: string | null): Settings => {
  if (raw === null) {
    return DEFAULT_SETTINGS;
  }

  try {
    const parsed = SettingsSchema.partial().safeParse(JSON.parse(raw));

    return parsed.success
      ? withChange(DEFAULT_SETTINGS, parsed.data)
      : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
};

/** What the Settings window shows. */
export interface SettingsView {
  settings: Settings;
  openAtLogin: boolean;
  /** Whether pages and files can be remembered: Accessibility is granted (macOS). */
  originsReadable: boolean;
  shortcut: ShortcutStatus;
  platform: CapturePlatform;
  version: string;
}
