import { app, BrowserWindow } from "electron";

import { pushChannels } from "../../shared/channels";
import type { RendererPage } from "./renderer-page";
import { securePreferences } from "./renderer-page";

/** The secondary Recent Captures window. Created only on explicit request. */
export class LibraryWindow {
  readonly #page: RendererPage;
  #win: BrowserWindow | null = null;

  constructor(page: RendererPage) {
    this.#page = page;
  }

  get page(): RendererPage {
    return this.#page;
  }

  open(): void {
    if (process.platform === "darwin") {
      app.focus({ steal: true });
    }

    if (this.#win !== null) {
      this.#win.show();
      this.#win.focus();

      return;
    }

    const win = new BrowserWindow({
      height: 700,
      minHeight: 420,
      minWidth: 560,
      show: false,
      title: "Recent Captures",
      webPreferences: securePreferences("library"),
      width: 960,
    });

    win.once("ready-to-show", () => win.show());
    win.on("closed", () => {
      this.#win = null;
    });
    this.#win = win;
    void this.#page.load(win);
  }

  window(): BrowserWindow | null {
    return this.#win;
  }

  isVisible(): boolean {
    return this.#win?.isVisible() ?? false;
  }

  notifyChanged(): void {
    this.#win?.webContents.send(pushChannels.libraryChanged);
  }

  mediaSourceId(): string | null {
    return this.#win?.getMediaSourceId() ?? null;
  }
}
