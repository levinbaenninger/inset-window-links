import { app, BrowserWindow, nativeTheme } from "electron";

import { pushChannels } from "../../shared/channels";
import type { SettingsView } from "../../shared/settings";
import { windowIcon } from "./icon";
import type { RendererPage } from "./renderer-page";
import { securePreferences } from "./renderer-page";
import { themeColors, titleBarOverlay } from "./theme";

const WIDTH = 440;
const FIRST_HEIGHT = 320;

const mac = process.platform === "darwin";
const windows = process.platform === "win32";

/** The title strip: the page draws it under the traffic lights, or under the Windows caption buttons. */
const chrome = (): Electron.BrowserWindowConstructorOptions => {
  if (mac) {
    return {
      titleBarStyle: "hiddenInset",
      // Centred in the page's 40-point title strip.
      trafficLightPosition: { x: 14, y: 13 },
      vibrancy: "sidebar",
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

/**
 * A small Settings window, like a Mac app's: as tall as its content, the system's translucent
 * material behind it on macOS, and its own title under the traffic lights. It sits one level
 * above the capture panel, which floats.
 */
export class SettingsWindow {
  readonly #page: RendererPage;
  #win: BrowserWindow | null = null;
  #height = FIRST_HEIGHT;

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

  isFocused(): boolean {
    return this.window()?.isFocused() ?? false;
  }

  open(): void {
    if (mac) {
      app.focus({ steal: true });
    }

    const existing = this.window();

    if (existing !== null) {
      existing.show();
      existing.focus();

      return;
    }

    const win = new BrowserWindow({
      backgroundColor: mac ? "#00000000" : themeColors().background,
      fullscreenable: false,
      height: this.#height,
      maximizable: false,
      minimizable: false,
      resizable: false,
      show: false,
      title: "Settings",
      useContentSize: true,
      webPreferences: securePreferences("settings"),
      width: WIDTH,
      ...chrome(),
    });

    if (windows) {
      win.removeMenu();
    }

    win.setAlwaysOnTop(true, "floating", 1);
    win.once("ready-to-show", () => {
      win.center();
      win.show();
    });
    this.#win = win;
    void this.#page.load(win);
  }

  close(): void {
    this.window()?.close();
  }

  /** Sizes the window to the page. */
  fitHeight(height: number): void {
    this.#height = Math.ceil(height);
    this.window()?.setContentSize(WIDTH, this.#height);
  }

  pushView(view: SettingsView): void {
    this.window()?.webContents.send(pushChannels.settingsView, view);
  }
}
