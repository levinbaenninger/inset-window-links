import { setTimeout as sleep } from "node:timers/promises";

import { app, BrowserWindow, nativeTheme, screen } from "electron";

import { pushChannels } from "../../shared/channels";
import type { DraftSnapshot } from "../../shared/dto";
import type { Settings } from "../../shared/settings";
import type { PopoverAnchor } from "../session/state";
import type { Point } from "./placement";
import { centerPanel, contains, keepInside } from "./placement";
import type { RendererPage } from "./renderer-page";
import { securePreferences } from "./renderer-page";
import { themeColors } from "./theme";

const WIDTH = 520;
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 720;
const EDGE = 16;
const PAINT_CAP_MS = 200;

const mac = process.platform === "darwin";

const workAreaFor = (anchor: PopoverAnchor) =>
  anchor.kind === "window"
    ? screen.getDisplayMatching(anchor.bounds).workArea
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;

export interface PanelOptions {
  /**
   * Read just before a hidden panel shows, and again on hide. When the library window has
   * focus at either point, hide() leaves focus with it. Otherwise hide() hides the app, so
   * the app the user was in becomes active again, even with the library open behind it.
   */
  otherWindowFocused: () => boolean;
  settings: () => Settings;
}

/**
 * The capture panel. It opens centred on the screen being worked on, stays open when another
 * window is clicked (unless the setting says otherwise), floats above other windows while
 * shown, and can be dragged by its header; it reopens where it was dragged to. Hiding never
 * touches the draft.
 */
export class PopoverWindow {
  readonly #win: BrowserWindow;
  readonly #page: RendererPage;
  readonly #options: PanelOptions;
  #height = 360;
  #hiding = false;
  #placing = false;
  #returnToOtherWindow = false;
  /** Where the user dragged the panel, kept for this run. */
  #dragged: Point | null = null;
  readonly #hiddenListeners = new Set<() => void>();

  constructor(page: RendererPage, options: PanelOptions) {
    this.#page = page;
    this.#options = options;

    const window: Electron.BrowserWindowConstructorOptions = {
      // macOS draws the window's translucent material behind the page, as in Inset Shelf.
      backgroundColor: mac ? "#00000000" : themeColors().background,
      frame: false,
      fullscreenable: false,
      hasShadow: true,
      height: this.#height,
      maximizable: false,
      minimizable: false,
      resizable: false,
      roundedCorners: true,
      show: false,
      skipTaskbar: true,
      title: "Inset Window Links",
      transparent: mac,
      webPreferences: securePreferences("popover"),
      width: WIDTH,
    };

    if (mac) {
      window.vibrancy = "sidebar";
      // Stays clear rather than grey while another app has focus, since the panel stays open.
      window.visualEffectState = "active";
    }

    this.#win = new BrowserWindow(window);

    if (mac) {
      this.#win.setVisibleOnAllWorkspaces(true, {
        skipTransformProcessType: true,
        visibleOnFullScreen: true,
      });
    }

    nativeTheme.on("updated", () => {
      if (!mac) {
        this.#win.setBackgroundColor(themeColors().background);
      }
    });

    this.#win.on("moved", () => {
      if (!this.#placing && this.#win.isVisible()) {
        const { x, y } = this.#win.getBounds();

        this.#dragged = { x, y };
      }
    });

    this.#win.on("blur", () => {
      if (!this.#options.settings().hideOnClickAway) {
        return;
      }

      const hideIfStillBlurred = () => {
        if (!this.#hiding && this.#win.isVisible() && !this.#win.isFocused()) {
          this.hide();
        }
      };

      // On macOS a click into the library window has made it key one tick later, and hide() asks.
      if (mac) {
        setImmediate(hideIfStillBlurred);
      } else {
        hideIfStillBlurred();
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

  #setBounds(bounds: Electron.Rectangle) {
    this.#placing = true;
    this.#win.setBounds(bounds);
    this.#placing = false;
  }

  #place(anchor: PopoverAnchor) {
    if (!this.#win.isVisible()) {
      this.#returnToOtherWindow = this.#options.otherWindowFocused();
    }

    const workArea = workAreaFor(anchor);
    const size = { height: this.#clampedHeight(workArea.height), width: WIDTH };
    const dragged = this.#dragged;

    this.#setBounds(
      dragged !== null && contains(workArea, dragged)
        ? keepInside(dragged, size, workArea)
        : centerPanel(size, workArea)
    );
  }

  showAt(anchor: PopoverAnchor): void {
    // A shown panel stays where it is: it is not chasing the window just added.
    if (!this.#win.isVisible()) {
      this.#place(anchor);
    }

    this.#activate();
  }

  /** Shows the panel where it will land without taking focus from the window being captured. */
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
   * Floats above other windows while shown, when the setting allows; on Windows it also stays
   * above the taskbar's flyouts, like a tray flyout. Hiding hands focus to a normal window.
   */
  #raise() {
    const { floatOnTop } = this.#options.settings();

    this.#win.setAlwaysOnTop(
      floatOnTop,
      process.platform === "win32" ? "pop-up-menu" : "floating"
    );
  }

  /** Applies a changed float setting to a shown panel. */
  refreshFloat(): void {
    if (this.#win.isVisible()) {
      this.#raise();
    }
  }

  /**
   * Resolves once the page has drawn two frames since now, or after a short cap. A caller about to
   * block the main process waits on this, so the panel is on screen before the wait starts.
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
    if (mac) {
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

    // Windows does not hand activation on when the active panel hides, so the user's window would
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

    const hadFocus = this.#win.isFocused();

    this.#win.hide();

    // Only a panel the user was in hands focus back; one left open behind their work does not.
    if (
      mac &&
      hadFocus &&
      !this.#returnToOtherWindow &&
      !this.#options.otherWindowFocused()
    ) {
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
    const bottom = workArea.y + workArea.height - EDGE;

    // The top edge stays put while the panel grows, unless that would run it off the screen.
    this.#setBounds({
      ...bounds,
      height: next,
      y: Math.max(workArea.y, Math.min(bounds.y, bottom - next)),
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
