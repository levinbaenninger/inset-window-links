import path from "node:path";

import type { Settings, SettingsChange } from "../shared/settings";
import { readSettings, withChange } from "../shared/settings";
import type { StoreFs } from "./store/fs";

export interface SettingsStore {
  current: () => Settings;
  /** Applies a change and writes the whole file. A failed write keeps the change for this run. */
  update: (change: SettingsChange) => Promise<Settings>;
  /** Runs after every change, with the settings before it. */
  onChange: (listener: (before: Settings) => void) => void;
}

/** The app's settings, in settings.json beside the captures folder. */
export const openSettingsStore = async (
  dir: string,
  fs: Pick<StoreFs, "mkdir" | "readText" | "rename" | "writeFileDurable">
): Promise<SettingsStore> => {
  const file = path.join(dir, "settings.json");
  let settings = readSettings(await fs.readText(file).catch((): null => null));
  const listeners = new Set<(before: Settings) => void>();

  return {
    current: () => settings,
    onChange: (listener) => {
      listeners.add(listener);
    },
    update: async (change) => {
      const before = settings;

      settings = withChange(settings, change);

      for (const listener of listeners) {
        listener(before);
      }

      try {
        await fs.mkdir(dir);
        await fs.writeFileDurable(
          `${file}.tmp`,
          `${JSON.stringify(settings, null, 2)}\n`
        );
        await fs.rename(`${file}.tmp`, file);
      } catch (error) {
        console.warn("Settings not saved", error);
      }

      return settings;
    },
  };
};
