import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";

import { shell } from "electron";

import { appBundle, webPage } from "./capture/origin";
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

/**
 * Opens what a view came from again: its web page in the app it was in, its file, or its
 * app. Every value is checked here, since it was stored on disk: only http and https pages,
 * only existing files, only .app bundles. True when something opened.
 */
export const reopenOrigin = async (
  origin: ViewOrigin | null
): Promise<boolean> => {
  if (origin === null) {
    return false;
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
