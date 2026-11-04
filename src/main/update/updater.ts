import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import { autoUpdater as squirrel } from "electron";
import electronUpdater from "electron-updater";

import type { UpdateEvent, UpdateState } from "./state";
import { canCheck, reduceUpdate } from "./state";

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

export interface Updater {
  state: () => UpdateState;
  check: () => void;
  install: () => void;
}

export interface UpdaterOptions {
  /** Overrides the feed electron-builder wrote into app-update.yml, for local tests. */
  feedUrl: string | undefined;
  logDir: string;
  onChange: (state: UpdateState, before: UpdateState) => void;
}

const fileLogger = (logDir: string) => {
  const file = path.join(logDir, "updater.log");
  mkdirSync(logDir, { recursive: true });

  const write =
    (level: string) =>
    (message: string): void => {
      const line = `${new Date().toISOString()} ${level} ${message}\n`;
      process.stdout.write(line);

      try {
        appendFileSync(file, line);
      } catch {
        // A full or read-only disk must not stop the update.
      }
    };

  return {
    debug: write("debug"),
    error: write("error"),
    info: write("info"),
    warn: write("warn"),
  };
};

export const updatesOff: Updater = {
  check: (): null => null,
  install: (): null => null,
  state: () => ({ kind: "off" }),
};

/** An update source, such as electron-updater, seen as the lifecycle events it reports. */
export interface UpdateFeed {
  subscribe: (apply: (event: UpdateEvent) => void) => void;
  /** Starts a check. A failure arrives as a failed event. */
  check: () => void;
  install: () => void;
}

export const connectUpdater = (
  feed: UpdateFeed,
  onChange: UpdaterOptions["onChange"]
): Updater => {
  let state: UpdateState = { kind: "idle" };

  feed.subscribe((event) => {
    const before = state;
    state = reduceUpdate(state, event);

    if (state !== before) {
      onChange(state, before);
    }
  });

  const check = () => {
    if (canCheck(state)) {
      feed.check();
    }
  };

  check();
  setInterval(check, CHECK_EVERY_MS).unref();

  return { check, install: feed.install, state: () => state };
};

export const startUpdater = (options: UpdaterOptions): Updater => {
  const { autoUpdater } = electronUpdater;

  autoUpdater.logger = fileLogger(options.logDir);
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  if (options.feedUrl !== undefined) {
    autoUpdater.setFeedURL({ provider: "generic", url: options.feedUrl });
  }

  return connectUpdater(
    {
      check: () => {
        autoUpdater.checkForUpdates().catch((): null => null);
      },
      install: () => autoUpdater.quitAndInstall(),
      subscribe: (apply) => {
        autoUpdater.on("checking-for-update", () =>
          apply({ type: "checking" })
        );
        autoUpdater.on("update-available", (info) =>
          apply({ type: "available", version: info.version })
        );
        autoUpdater.on("update-not-available", () =>
          apply({ type: "notAvailable" })
        );
        autoUpdater.on("download-progress", (progress) =>
          apply({ percent: progress.percent, type: "progress" })
        );
        autoUpdater.on("error", (error) =>
          apply({ message: error.message, type: "failed" })
        );

        // On macOS electron-updater reports the download before Squirrel stages and validates it,
        // and quitAndInstall can only install what Squirrel staged.
        const staged = process.platform === "darwin" ? squirrel : autoUpdater;

        staged.on("update-downloaded", () => apply({ type: "downloaded" }));
      },
    },
    options.onChange
  );
};
