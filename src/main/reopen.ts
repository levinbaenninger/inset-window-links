import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { shell } from "electron";

import { appBundle, webPage } from "./capture/origin";
import { isBrowser, windowsApp } from "./capture/windows-origin";
import type { ViewOrigin } from "./store/schema";

const run = promisify(execFile);

const isDirectory = async (file: string): Promise<boolean> => {
  try {
    const entry = await stat(file);

    return entry.isDirectory();
  } catch {
    return false;
  }
};

/** Documents can be packages (a .numbers or .key file is a folder), so any entry counts. */
const exists = async (file: string): Promise<boolean> => {
  try {
    await stat(file);

    return true;
  } catch {
    return false;
  }
};

/** `open -a <app> [target]`, with arguments, never a shell. */
const openWith = async (app: string, target?: string): Promise<boolean> => {
  try {
    await run(
      "/usr/bin/open",
      target === undefined ? ["-a", app] : ["-a", app, target],
      { timeout: 10_000 }
    );

    return true;
  } catch {
    return false;
  }
};

const isFile = async (file: string): Promise<boolean> => {
  try {
    const entry = await stat(file);

    return entry.isFile();
  } catch {
    return false;
  }
};

/** Starts a Windows app with arguments, never through a shell. True once its process runs. */
const launch = async (
  exe: string,
  args: readonly string[]
): Promise<boolean> => {
  try {
    const child = spawn(exe, args, {
      cwd: path.dirname(exe),
      detached: true,
      stdio: "ignore",
    });

    await once(child, "spawn");
    child.unref();

    return true;
  } catch {
    return false;
  }
};

/**
 * Windows: the page in the browser it was in, the file, or the app, from an existing .exe.
 * Starting an .exe opens a new instance, not the running one as `open -a` does on macOS, so an
 * app is started once per request; started holds the ones already started.
 */
const reopenOnWindows = async (
  origin: ViewOrigin,
  started: Set<string>
): Promise<boolean> => {
  const stored = windowsApp(origin.appPath);
  const app = stored !== null && (await isFile(stored)) ? stored : null;
  const url = webPage(origin.url ?? undefined);

  if (url !== null) {
    if (app !== null && isBrowser(app) && (await launch(app, [url]))) {
      return true;
    }

    await shell.openExternal(url);

    return true;
  }

  if (origin.document !== null && (await isFile(origin.document))) {
    if (app !== null && (await launch(app, [origin.document]))) {
      return true;
    }

    return (await shell.openPath(origin.document)) === "";
  }

  if (app === null) {
    return false;
  }

  if (started.has(app.toLowerCase())) {
    return true;
  }

  started.add(app.toLowerCase());

  return launch(app, []);
};

/**
 * Opens what a view came from again: its web page in the app it was in, its file, or its
 * app. Every value is checked here, since it was stored on disk: only http and https pages,
 * only existing files, only .app bundles (or .exe files on Windows). True when something opened.
 */
export const reopenOrigin = async (
  origin: ViewOrigin | null,
  started = new Set<string>()
): Promise<boolean> => {
  if (origin === null) {
    return false;
  }

  if (process.platform === "win32") {
    return reopenOnWindows(origin, started);
  }

  const url = webPage(origin.url ?? undefined);

  if (process.platform !== "darwin") {
    if (url === null) {
      return false;
    }

    await shell.openExternal(url);

    return true;
  }

  const bundle = appBundle(origin.appPath ?? undefined);
  const app = bundle !== null && (await isDirectory(bundle)) ? bundle : null;

  if (url !== null) {
    if (app !== null && (await openWith(app, url))) {
      return true;
    }

    await shell.openExternal(url);

    return true;
  }

  if (origin.document !== null && (await exists(origin.document))) {
    if (app !== null) {
      return openWith(app, origin.document);
    }

    return (await shell.openPath(origin.document)) === "";
  }

  return app === null ? false : openWith(app);
};
