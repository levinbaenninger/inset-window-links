import { app, BrowserWindow, nativeTheme } from "electron";

import { pushChannels } from "../../shared/channels";
import type { PageCommand } from "../../shared/shortcuts";
import { cursorWorkArea } from "./cursor-display";
import { windowIcon } from "./icon";
import { routeShowsCapture } from "./library-route";
import { centerIn } from "./placement";
import type { RendererPage } from "./renderer-page";
import { securePreferences } from "./renderer-page";
import { themeColors, titleBarOverlay } from "./theme";

const windows = process.platform === "win32";
const mac = process.platform === "darwin";

/**
 * On Windows the stock title bar, icon, and File/Edit/View menu give way to caption buttons over
 * the page. On macOS the traffic lights sit in the page's own header, over the system's
 * translucent sidebar material, as in Inset Shelf.
 */
const chrome = (): Electron.BrowserWindowConstructorOptions => {
  if (windows) {
    return {
      autoHideMenuBar: true,
      icon: windowIcon(),
      titleBarOverlay: titleBarOverlay(),
      titleBarStyle: "hidden",
    };
  }

  return mac
    ? {
        titleBarStyle: "hiddenInset",
        // Centred in the page's 44-point header.
        trafficLightPosition: { x: 16, y: 15 },
        vibrancy: "sidebar",
        visualEffectState: "followWindow",
      }
    : {};
};

/** The secondary Recent Captures window. Created only on explicit request. */
export class LibraryWindow {
  readonly #page: RendererPage;
  #win: BrowserWindow | null = null;
  /** An open request that arrived while the previous window was still being torn down. */
  #reopen: { route: string | undefined } | null = null;
  #closing = false;
  readonly #routeListeners = new Set<() => void>();
  /**
   * The page of the latest window, kept while it closes: its last save is sent from pagehide,
   * after close has begun. A closed page sends nothing more, so it is trusted until replaced.
   */
  #contents: Electron.WebContents | null = null;

  constructor(page: RendererPage) {
    this.#page = page;

    nativeTheme.on("updated", () => {
      const win = this.window();

      if (win === null) {
        return;
      }

      if (!mac) {
        win.setBackgroundColor(themeColors().background);
      }

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

    const size = { height: 680, width: 1040 };

    const win = new BrowserWindow({
      backgroundColor: mac ? "#00000000" : themeColors().background,
      minHeight: 440,
      minWidth: 720,
      show: false,
      title: "Recent Captures",
      webPreferences: securePreferences("library"),
      ...(windows ? centerIn(size, cursorWorkArea()) : size),
      ...chrome(),
    });

    if (windows) {
      win.removeMenu();
    }

    win.once("ready-to-show", () => win.show());
    win.webContents.on("did-navigate-in-page", () => this.#routeChanged());
    win.webContents.on("did-finish-load", () => this.#routeChanged());
    win.on("close", () => {
      this.#closing = true;
    });
    win.on("closed", () => {
      if (this.#win === win) {
        this.#win = null;
        this.#closing = false;
        this.#routeChanged();
      }

      const pending = this.#reopen;

      this.#reopen = null;

      if (pending !== null) {
        this.open(pending.route);
      }
    });
    this.#win = win;
    this.#contents = win.webContents;
    void this.#page.load(win, route);
  }

  window(): BrowserWindow | null {
    return this.#closing || this.#win?.isDestroyed() !== false
      ? null
      : this.#win;
  }

  /** The page IPC is accepted from, including while its window closes. */
  contents(): Electron.WebContents | null {
    return this.#contents;
  }

  isFocused(): boolean {
    return this.window()?.isFocused() ?? false;
  }

  /** Whether the window shows a capture's page, which the Capture menu's capture items act on. */
  showsCapture(): boolean {
    const win = this.window();

    return win !== null && routeShowsCapture(win.webContents.getURL());
  }

  /** Runs when the window opens, closes, or moves to another page. */
  onRouteChange(listener: () => void): void {
    this.#routeListeners.add(listener);
  }

  #routeChanged() {
    for (const listener of this.#routeListeners) {
      listener();
    }
  }

  notifyChanged(): void {
    this.window()?.webContents.send(pushChannels.libraryChanged);
  }

  /**
   * A menu key for the page, such as the open capture's due date or the shortcut sheet. It opens
   * the window when needed; a page still loading subscribes before it has loaded, and holds the
   * command until something on it listens.
   */
  command(command: PageCommand): void {
    this.open();

    const win = this.window();

    if (win === null) {
      return;
    }

    if (win.webContents.isLoading()) {
      win.webContents.once("did-finish-load", () =>
        win.webContents.send(pushChannels.command, command)
      );
    } else {
      win.webContents.send(pushChannels.command, command);
    }
  }

  /** Asks the page to focus its search field. */
  find(): void {
    this.command("find");
  }

  close(): void {
    this.window()?.close();
  }

  mediaSourceId(): string | null {
    return this.window()?.getMediaSourceId() ?? null;
  }
}
