import { app, BrowserWindow, dialog, nativeTheme } from "electron";

import { pushChannels } from "../../shared/channels";
import type { LeaveAnswer, LeaveReason } from "../../shared/leave";
import type { PageCommand } from "../../shared/shortcuts";
import type { TutorialView } from "../../shared/tutorial";
import type { LateChoice, LateWhy } from "../leave-gate";
import { LeaveGate, lateDialog } from "../leave-gate";
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

/** The page can't answer for its words: a native dialog asks, over its window when there is one. */
const confirmLate = async (
  contents: Electron.WebContents | null,
  reason: LeaveReason,
  count: number,
  why: LateWhy,
  signal: AbortSignal
): Promise<LateChoice> => {
  const { choices, ...shown } = lateDialog(app.getName(), reason, count, why);
  const options = { ...shown, noLink: true, signal, type: "warning" as const };

  const win =
    contents === null || contents.isDestroyed()
      ? null
      : BrowserWindow.fromWebContents(contents);

  const { response } =
    win === null
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(win, options);

  return choices[response] ?? "cancel";
};

/** The secondary Recent Captures window. Created only on explicit request. */
export class LibraryWindow {
  readonly #page: RendererPage;
  #win: BrowserWindow | null = null;
  /** An open request that arrived while the previous window was still being torn down. */
  #reopen: { route: string | undefined } | null = null;
  #closing = false;
  readonly #hiddenListeners = new Set<() => void>();
  /**
   * Set once the app exits. Words reported after Recent Captures let the quit go are sent from
   * pagehide, and will-quit waits for them to be written.
   */
  #quitting = false;
  readonly #routeListeners = new Set<() => void>();
  /**
   * The page of the latest window, kept while it closes: its last save is sent from pagehide,
   * after close has begun. A closed page sends nothing more, so it is trusted until replaced.
   */
  #contents: Electron.WebContents | null = null;

  /** Holds the window's close, and the app's quit, while the page has words that can't be saved. */
  readonly #leaving = new LeaveGate<Electron.WebContents>({
    ask: (contents, reason) => contents.send(pushChannels.leave, reason),
    cancel: (contents) => {
      if (!contents.isDestroyed()) {
        contents.send(pushChannels.leave, "cancel");
      }
    },
    confirm: confirmLate,
    show: () => this.open(),
  });

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

  /** Runs when the window hides or closes: the tutorial lets go of a tip it showed there. */
  onHidden(listener: () => void): void {
    this.#hiddenListeners.add(listener);
  }

  #hidden(): void {
    for (const listener of this.#hiddenListeners) {
      listener();
    }
  }

  isVisible(): boolean {
    return this.window()?.isVisible() ?? false;
  }

  /** The tutorial's part for Recent Captures: the checklist, tips and the walkthrough. */
  pushTutorial(view: TutorialView): void {
    this.contents()?.send(pushChannels.tutorial, view);
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
    win.on("hide", () => this.#hidden());
    win.webContents.on("did-navigate-in-page", () => this.#routeChanged());
    win.webContents.on("did-finish-load", () => this.#routeChanged());
    // A held close leaves the window open and usable, so its prompt shows and the menus still reach it.
    win.on("close", (event) => {
      const again = () => {
        if (!win.isDestroyed()) {
          win.close();
        }
      };

      if (!this.#quitting && this.#leaving.holdClose(win.webContents, again)) {
        event.preventDefault();

        return;
      }

      this.#closing = true;
    });
    win.on("closed", () => {
      if (this.#win === win) {
        this.#win = null;
        this.#closing = false;
        this.#routeChanged();
        this.#hidden();
      }

      const pending = this.#reopen;

      this.#reopen = null;

      if (pending !== null) {
        this.open(pending.route);
      }
    });
    this.#win = win;
    this.#contents = win.webContents;
    this.#leaving.attach(win.webContents);
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

  /** The page says how many captures hold words main does not have. */
  reportUnsaved(count: number): void {
    if (this.#contents !== null) {
      this.#leaving.report(this.#contents, count);
    }
  }

  answerLeave(answer: LeaveAnswer): void {
    if (this.#contents !== null) {
      this.#leaving.answer(this.#contents, answer);
    }
  }

  /** Before the app quits: `go` at once unless the page holds, or last held, words it may not be able to save. */
  letQuit(): Promise<"go" | "stay"> {
    return this.#leaving.request("quit");
  }

  quitting(): void {
    this.#quitting = true;
  }

  mediaSourceId(): string | null {
    return this.window()?.getMediaSourceId() ?? null;
  }
}
