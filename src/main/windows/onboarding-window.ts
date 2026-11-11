import { app, BrowserWindow, nativeTheme } from "electron";

import { pushChannels } from "../../shared/channels";
import type { OnboardingView } from "../../shared/onboarding";
import type { Presentation } from "../permissions/onboarding";
import { cursorWorkArea } from "./cursor-display";
import { windowIcon } from "./icon";
import type { RendererPage } from "./renderer-page";
import { securePreferences } from "./renderer-page";
import { themeColors, titleBarOverlay } from "./theme";

/** As wide as Inset Shelf's setup window. */
const WIDTH = 460;

/** Until the page reports its own height (fitHeight). */
const FIRST_HEIGHT = 320;

/** Off the screen's edge, beside System Settings. */
const EDGE_GAP = 16;

const mac = process.platform === "darwin";
const windows = process.platform === "win32";

/** The title strip, as in Settings: under the traffic lights, or under the Windows caption buttons. */
const chrome = (): Electron.BrowserWindowConstructorOptions => {
  if (mac) {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 15 },
      vibrancy: "sidebar",
      // Beside System Settings the window is never key, and its material stays clear.
      visualEffectState: "active",
    };
  }

  return windows
    ? {
        autoHideMenuBar: true,
        icon: windowIcon(),
        titleBarOverlay: titleBarOverlay(),
        titleBarStyle: "hidden",
      }
    : {};
};

/** Floats one level above the floating capture panel, as Settings does, on every Space; or not at all. */
const float = (win: BrowserWindow, on: boolean): void => {
  if (on) {
    win.setAlwaysOnTop(true, "floating", 1);
  } else {
    win.setAlwaysOnTop(false);
  }

  if (mac) {
    // Without skipTransformProcessType the app would lose its Dock icon and menu bar.
    win.setVisibleOnAllWorkspaces(on, {
      skipTransformProcessType: true,
      visibleOnFullScreen: on,
    });
  }
};

/**
 * The permission setup's small window (macOS), as in Inset Shelf: a role of its own rather than a
 * page of Recent Captures. While it asks for a permission it floats one level above the capture
 * panel, on every Space and over full-screen apps, so it stays beside System Settings; once
 * System Settings is open it moves to the screen's right edge and shows without the keyboard.
 */
export class OnboardingWindow {
  readonly #page: RendererPage;
  #onClose: (() => void) | null = null;
  #win: BrowserWindow | null = null;
  #height = FIRST_HEIGHT;
  /** Set once the app exits: closing then is not Not now, so the saved step survives a reopen. */
  #quitting = false;
  /** The page has drawn once; until then a presentation waits for it. */
  #ready = false;
  #waiting: Presentation | null = null;

  constructor(page: RendererPage) {
    this.#page = page;

    nativeTheme.on("updated", () => {
      const win = this.window();

      if (win !== null && !mac) {
        win.setBackgroundColor(themeColors().background);
      }

      if (win !== null && windows) {
        win.setTitleBarOverlay(titleBarOverlay());
      }
    });
  }

  get page(): RendererPage {
    return this.#page;
  }

  window(): BrowserWindow | null {
    return this.#win === null || this.#win.isDestroyed() ? null : this.#win;
  }

  isVisible(): boolean {
    return this.window()?.isVisible() ?? false;
  }

  isFocused(): boolean {
    return this.window()?.isFocused() ?? false;
  }

  mediaSourceId(): string | null {
    return this.window()?.getMediaSourceId() ?? null;
  }

  quitting(): void {
    this.#quitting = true;
  }

  /** The close button or ⌘W, which the setup takes as Done or Not now. */
  onClose(listener: () => void): void {
    this.#onClose = listener;
  }

  #create(): BrowserWindow {
    const win = new BrowserWindow({
      backgroundColor: mac ? "#00000000" : themeColors().background,
      fullscreenable: false,
      height: this.#height,
      maximizable: false,
      minimizable: false,
      resizable: false,
      show: false,
      title: "Inset Window Links Setup",
      useContentSize: true,
      webPreferences: securePreferences("onboarding"),
      width: WIDTH,
      ...chrome(),
    });

    if (windows) {
      win.removeMenu();
    }

    // A close is the setup's to decide (Done or Not now), except while the app quits.
    win.on("close", (event) => {
      if (!this.#quitting) {
        event.preventDefault();
        this.#onClose?.();
      }
    });
    win.on("closed", () => {
      if (this.#win === win) {
        this.#win = null;
      }
    });
    win.once("ready-to-show", () => {
      this.#ready = true;

      const waiting = this.#waiting;

      this.#waiting = null;

      if (waiting !== null && !win.isDestroyed()) {
        this.#show(win, waiting);
      }
    });
    this.#win = win;
    this.#ready = false;
    void this.#page.load(win);

    return win;
  }

  #center(win: BrowserWindow): void {
    const area = cursorWorkArea();

    win.setContentBounds({
      height: this.#height,
      width: WIDTH,
      x: Math.round(area.x + (area.width - WIDTH) / 2),
      y: Math.round(area.y + (area.height - this.#height) / 3),
    });
  }

  /** System Settings opens near the middle of the screen: the right edge of the work area is clear of it. */
  #toEdge(win: BrowserWindow): void {
    const area = cursorWorkArea();

    win.setContentBounds({
      height: this.#height,
      width: WIDTH,
      x: Math.round(area.x + area.width - WIDTH - EDGE_GAP),
      y: Math.round(area.y + (area.height - this.#height) / 2),
    });
  }

  #show(win: BrowserWindow, { floating, focus, place }: Presentation): void {
    float(win, floating);

    if (place === "center" || (place === "keep" && !win.isVisible())) {
      this.#center(win);
    } else if (place === "edge") {
      this.#toEdge(win);
    }

    if (!focus) {
      // Beside System Settings, which keeps the keyboard.
      win.showInactive();

      return;
    }

    if (mac) {
      app.show();
      // After a grant the user is still in System Settings: the next step comes forward.
      app.focus({ steal: true });
    }

    win.show();
    win.focus();
  }

  /** Shows the window as the step asks; a new window shows once its page has drawn, as asked last. */
  present(presentation: Presentation): void {
    const win = this.window() ?? this.#create();

    if (this.#ready) {
      this.#show(win, presentation);
    } else {
      this.#waiting = presentation;
    }
  }

  hide(): void {
    this.#waiting = null;

    const win = this.window();

    if (win !== null) {
      float(win, false);
      win.hide();
    }
  }

  /** Sizes the window to its page, keeping its middle where it was. */
  fitHeight(height: number): void {
    if (height === this.#height) {
      return;
    }

    this.#height = height;

    const win = this.window();

    if (win === null) {
      return;
    }

    const bounds = win.getContentBounds();
    const middle = bounds.y + bounds.height / 2;

    win.setContentBounds({
      ...bounds,
      height,
      y: Math.round(middle - height / 2),
    });
  }

  pushView(view: OnboardingView): void {
    this.window()?.webContents.send(pushChannels.onboardingView, view);
  }

  /** Drags the app's bundle out of the page, for dropping into a System Settings list. */
  startDrag(item: {
    readonly file: string;
    readonly icon: Electron.NativeImage;
  }): void {
    this.window()?.webContents.startDrag(item);
  }
}
