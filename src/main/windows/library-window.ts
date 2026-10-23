import { app, BrowserWindow, nativeTheme } from "electron";

import { pushChannels } from "../../shared/channels";
import { windowIcon } from "./icon";
import type { RendererPage } from "./renderer-page";
import { securePreferences } from "./renderer-page";
import { themeColors, titleBarOverlay } from "./theme";

const windows = process.platform === "win32";

/** On Windows the stock title bar, icon, and File/Edit/View menu give way to caption buttons over the page. */
const chrome = (): Electron.BrowserWindowConstructorOptions =>
  windows
    ? {
        autoHideMenuBar: true,
        icon: windowIcon(),
        titleBarOverlay: titleBarOverlay(),
        titleBarStyle: "hidden",
      }
    : {};

/** The secondary Recent Captures window. Created only on explicit request. */
export class LibraryWindow {
  readonly #page: RendererPage;
  #win: BrowserWindow | null = null;
  /** An open request that arrived while the previous window was still being torn down. */
  #reopen: { route: string | undefined } | null = null;
  #closing = false;

  constructor(page: RendererPage) {
    this.#page = page;

    nativeTheme.on("updated", () => {
      const win = this.window();

      if (win === null) {
        return;
      }

      win.setBackgroundColor(themeColors().background);

      if (windows) {
        win.setTitleBarOverlay(titleBarOverlay());
      }
    });
  }

  get page(): RendererPage {
    return this.#page;
  }

  /** route is a hash path such as "/welcome". Without one an open window keeps its page. */
  open(route?: string): void {
    if (process.platform === "darwin") {
      app.focus({ steal: true });
    }

    // Showing a window that is closing, or creating the next one before the old one's closed event,
    // crashed Electron on Windows. A request in that gap waits for the closed event.
    if (this.#win !== null && (this.#closing || this.#win.isDestroyed())) {
      this.#reopen = { route };

      return;
    }

    if (this.#win !== null) {
      if (route !== undefined) {
        this.#win.webContents.send(pushChannels.navigate, route);
      }

      if (this.#win.isMinimized()) {
        this.#win.restore();
      }

      this.#win.show();
      this.#win.focus();

      return;
    }

    const win = new BrowserWindow({
      backgroundColor: themeColors().background,
      height: 700,
      minHeight: 420,
      minWidth: 560,
      show: false,
      title: "Recent Captures",
      webPreferences: securePreferences("library"),
      width: 960,
      ...chrome(),
    });

    if (windows) {
      win.removeMenu();
    }

    win.once("ready-to-show", () => win.show());
    win.on("close", () => {
      this.#closing = true;
    });
    win.on("closed", () => {
      if (this.#win === win) {
        this.#win = null;
        this.#closing = false;
      }

      const pending = this.#reopen;

      this.#reopen = null;

      if (pending !== null) {
        this.open(pending.route);
      }
    });
    this.#win = win;
    void this.#page.load(win, route);
  }

  window(): BrowserWindow | null {
    return this.#closing || this.#win?.isDestroyed() !== false
      ? null
      : this.#win;
  }

  isVisible(): boolean {
    return this.window()?.isVisible() ?? false;
  }

  notifyChanged(): void {
    this.window()?.webContents.send(pushChannels.libraryChanged);
  }

  mediaSourceId(): string | null {
    return this.window()?.getMediaSourceId() ?? null;
  }
}
