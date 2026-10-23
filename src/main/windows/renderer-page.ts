import path from "node:path";
import { pathToFileURL } from "node:url";

import type { BrowserWindow, WebPreferences } from "electron";

import type { WindowRole } from "../../shared/channels";
import { roleArgument } from "../../shared/channels";

const outDir = path.join(import.meta.dirname, "..");

/** How a role's page loads, and the one URL its IPC senders must come from. */
export interface RendererPage {
  /** route is a hash-history path such as "/welcome". */
  load: (win: BrowserWindow, route?: string) => Promise<void>;
  matches: (url: string) => boolean;
}

const withoutFragment = (url: string) => url.split("#")[0]?.split("?")[0] ?? "";

export const rendererPage = (role: WindowRole): RendererPage => {
  const devServer = process.env["ELECTRON_RENDERER_URL"];
  const file = path.join(outDir, "renderer", `${role}.html`);

  const expected =
    devServer === undefined
      ? pathToFileURL(file).href
      : `${devServer}/${role}.html`;

  return {
    load: (win, route) => {
      if (devServer !== undefined) {
        return win.loadURL(
          route === undefined ? expected : `${expected}#${route}`
        );
      }

      return route === undefined
        ? win.loadFile(file)
        : win.loadFile(file, { hash: route });
    },
    matches: (url) => withoutFragment(url) === expected,
  };
};

export const securePreferences = (role: WindowRole): WebPreferences => ({
  additionalArguments: [roleArgument(role)],
  contextIsolation: true,
  nodeIntegration: false,
  preload: path.join(outDir, "preload", "index.cjs"),
  sandbox: true,
  spellcheck: true,
  webSecurity: true,
});
