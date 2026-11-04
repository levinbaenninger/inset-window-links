import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

import electronUpdater from "electron-updater";

import type { UpdateEvent, UpdateState } from "./state";
import { canCheck, reduceUpdate } from "./state";

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

export interface Updater {
  state: () => UpdateState;
  check: () => void;
  /** Quits and starts the downloaded version. Call only while the state is ready. */
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

/** Checks the feed now and every few hours, downloads in the background, and installs on quit. */
export const startUpdater = (options: UpdaterOptions): Updater => {
  const { autoUpdater } = electronUpdater;
  let state: UpdateState = { kind: "idle" };

  const apply = (event: UpdateEvent) => {
    const before = state;
    state = reduceUpdate(state, event);

    if (state !== before) {
      options.onChange(state, before);
    }
  };

  autoUpdater.logger = fileLogger(options.logDir);
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  if (options.feedUrl !== undefined) {
    autoUpdater.setFeedURL({ provider: "generic", url: options.feedUrl });
  }

  autoUpdater.on("checking-for-update", () => apply({ type: "checking" }));
  autoUpdater.on("update-available", (info) =>
    apply({ type: "available", version: info.version })
  );
  autoUpdater.on("update-not-available", () => apply({ type: "notAvailable" }));
  autoUpdater.on("download-progress", (progress) =>
    apply({ percent: progress.percent, type: "progress" })
  );
  autoUpdater.on("update-downloaded", (info) =>
    apply({ type: "downloaded", version: info.version })
  );
  autoUpdater.on("error", (error) =>
    apply({ message: error.message, type: "failed" })
  );

  const check = () => {
    if (canCheck(state)) {
      // The error event already carries a failure into the state.
      autoUpdater.checkForUpdates().catch((): null => null);
    }
  };

  check();
  setInterval(check, CHECK_EVERY_MS).unref();

  return {
    check,
    install: () => autoUpdater.quitAndInstall(),
    state: () => state,
  };
};
