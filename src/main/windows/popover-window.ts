import { setTimeout as sleep } from "node:timers/promises";

import { app, BrowserWindow, nativeTheme, screen } from "electron";

import { pushChannels } from "../../shared/channels";
import type { DraftSnapshot } from "../../shared/dto";
import type { PopoverAnchor } from "../session/state";
import type { Corner } from "./placement";
import { placePopover } from "./placement";
import type { RendererPage } from "./renderer-page";
import { securePreferences } from "./renderer-page";

const WIDTH = 380;
const MIN_HEIGHT = 160;
const MAX_HEIGHT = 560;
const EDGE = 16;
const GAP = 12;
const PAINT_CAP_MS = 200;

/** Without a source window, Windows puts tray popups above the notification area. */
const CORNER: Corner =
  process.platform === "win32" ? "bottom-right" : "top-right";

const workAreaFor = (anchor: PopoverAnchor) =>
  anchor.kind === "window"
    ? screen.getDisplayMatching(anchor.bounds).workArea
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;

/**
 * The one small capture window. It owns shown versus hidden: blur hides it, and hiding never
 * touches the draft.
 */
export class PopoverWindow {
  readonly #win: BrowserWindow;
  readonly #page: RendererPage;
  #height = 280;
  /** Set while shown in the bottom corner, so growing and shrinking keep the bottom edge put. */
  #bottomAnchored = false;
  #hiding = false;
  readonly #otherWindowVisible: () => boolean;
  readonly #hiddenListeners = new Set<() => void>();

  /** otherWindowVisible lets hide() leave focus with the library window when that is open. */
  constructor(page: RendererPage, otherWindowVisible: () => boolean) {
    this.#page = page;
    this.#otherWindowVisible = otherWindowVisible;
    this.#win = new BrowserWindow({
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
      frame: false,
      fullscreenable: false,
      height: this.#height,
      maximizable: false,
      minimizable: false,
      resizable: false,
      roundedCorners: true,
      show: false,
      skipTaskbar: true,
      title: "Inset Window Links",
      webPreferences: securePreferences("popover"),
      width: WIDTH,
    });

    if (process.platform === "darwin") {
      this.#win.setVisibleOnAllWorkspaces(true, {
        skipTransformProcessType: true,
        visibleOnFullScreen: true,
      });
    }

    this.#win.on("blur", () => {
      if (!this.#hiding && this.#win.isVisible()) {
        this.hide();
      }
    });
    this.#win.on("hide", () => {
      for (const listener of this.#hiddenListeners) {
        listener();
      }
    });
  }

  get webContents(): Electron.WebContents {
    return this.#win.webContents;
  }

  get page(): RendererPage {
    return this.#page;
  }

  load(): Promise<void> {
    return this.#page.load(this.#win);
  }

  #clampedHeight(workAreaHeight: number) {
    return Math.max(
      MIN_HEIGHT,
      Math.min(this.#height, MAX_HEIGHT, workAreaHeight - EDGE * 2)
    );
  }

  #place(anchor: PopoverAnchor) {
    const workArea = workAreaFor(anchor);
    const size = { height: this.#clampedHeight(workArea.height), width: WIDTH };

    const source = anchor.kind === "window" ? anchor.bounds : null;

    this.#bottomAnchored = source === null && CORNER === "bottom-right";
    this.#win.setBounds(placePopover(source, size, workArea, CORNER));
  }

  showAt(anchor: PopoverAnchor): void {
    if (!(anchor.kind === "keep" && this.#win.isVisible())) {
      this.#place(anchor);
    }

    this.#activate();
  }

  /** Shows the popover where it will land without taking focus from the window being captured. */
  preview(anchor: PopoverAnchor): void {
    if (this.#win.isVisible()) {
      return;
    }

    this.#place(anchor);
    this.#raise();
    this.#win.showInactive();
    this.#win.moveTop();
  }

  /**
   * Like a tray flyout, the shown popover stays above other always-on-top windows instead of opening
   * under them. It is topmost only while shown, so hiding hands focus to a normal window.
   */
  #raise() {
    if (process.platform === "win32") {
      this.#win.setAlwaysOnTop(true, "pop-up-menu");
    }
  }

  /**
   * Resolves once the page has drawn two frames since now, or after a short cap. A caller about to
   * block the main process waits on this, so the popover is on screen before the wait starts.
   */
  async painted(): Promise<void> {
    if (!this.#win.isVisible()) {
      return;
    }

    const frames = async () => {
      try {
        await this.#win.webContents.executeJavaScript(
          "new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true))))"
        );
      } catch {
        // A reload or a closed page only means there is nothing to wait for.
      }
    };

    await Promise.race([frames(), sleep(PAINT_CAP_MS)]);
  }

  onHidden(listener: () => void): void {
    this.#hiddenListeners.add(listener);
  }

  #activate() {
    if (process.platform === "darwin") {
      app.focus({ steal: true });
    }

    this.#raise();
    this.#win.show();
    this.#win.focus();
    this.#win.webContents.send(pushChannels.focusInput);
  }

  /** Focused hides, visible but unfocused gets focus, hidden shows on the cursor's display. */
  toggle(): void {
    if (this.#win.isFocused()) {
      this.hide();
    } else {
      this.showAt({ kind: "keep" });
    }
  }

  hide(): void {
    if (!this.#win.isVisible()) {
      return;
    }

    // Windows does not hand activation on when the active popover hides, so the user's window would
    // stay inactive until clicked. Blurring first activates the next window in Z-order: the one
    // they were working in.
    if (process.platform === "win32") {
      this.#win.setAlwaysOnTop(false);

      if (this.#win.isFocused()) {
        this.#hiding = true;
        this.#win.blur();
        this.#hiding = false;
      }
    }

    this.#win.hide();

    if (process.platform === "darwin" && !this.#otherWindowVisible()) {
      app.hide();
    }
  }

  fitHeight(height: number): void {
    this.#height = Math.ceil(height);

    if (!this.#win.isVisible()) {
      return;
    }

    const bounds = this.#win.getBounds();
    const { workArea } = screen.getDisplayMatching(bounds);
    const next = this.#clampedHeight(workArea.height);
    const bottom = workArea.y + workArea.height;

    const y = this.#bottomAnchored
      ? bottom - GAP - next
      : Math.min(bounds.y, bottom - next);

    this.#win.setBounds({
      ...bounds,
      height: next,
      y: Math.max(workArea.y, y),
    });
  }

  push(snapshot: DraftSnapshot): void {
    this.#win.webContents.send(pushChannels.draft, snapshot);
  }

  isVisible(): boolean {
    return this.#win.isVisible();
  }

  isFocused(): boolean {
    return this.#win.isFocused();
  }

  bounds(): Electron.Rectangle {
    return this.#win.getBounds();
  }

  mediaSourceId(): string {
    return this.#win.getMediaSourceId();
  }
}
