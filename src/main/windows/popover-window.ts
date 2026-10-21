import { app, BrowserWindow, nativeTheme, screen } from "electron";

import { pushChannels } from "../../shared/channels";
import type { DraftSnapshot } from "../../shared/dto";
import type { PopoverAnchor } from "../session/state";
import { placePopover } from "./placement";
import type { RendererPage } from "./renderer-page";
import { securePreferences } from "./renderer-page";

const WIDTH = 380;
const MIN_HEIGHT = 160;
const MAX_HEIGHT = 560;
const EDGE = 16;

const workAreaFor = (anchor: PopoverAnchor) =>
  anchor.kind === "window"
    ? screen.getDisplayMatching(anchor.bounds).workArea
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;

/**
 * The one small capture window. It owns shown versus hidden: blur hides it unless one of
 * its own native dialogs is open, and hiding never touches the draft.
 */
export class PopoverWindow {
  readonly #win: BrowserWindow;
  readonly #page: RendererPage;
  #height = 280;
  #dialogDepth = 0;
  readonly #otherWindowVisible: () => boolean;

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
      if (this.#dialogDepth === 0 && this.#win.isVisible()) {
        this.hide();
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

  showAt(anchor: PopoverAnchor): void {
    if (anchor.kind === "keep" && this.#win.isVisible()) {
      this.#activate();

      return;
    }

    const workArea = workAreaFor(anchor);
    const size = { height: this.#clampedHeight(workArea.height), width: WIDTH };

    this.#win.setBounds(
      placePopover(
        anchor.kind === "window" ? anchor.bounds : null,
        size,
        workArea
      )
    );
    this.#activate();
  }

  #activate() {
    if (process.platform === "darwin") {
      app.focus({ steal: true });
    }

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

    this.#win.hide();

    if (process.platform === "darwin" && !this.#otherWindowVisible()) {
      app.hide();
    }
  }

  async withDialog<T>(run: () => Promise<T>): Promise<T> {
    this.#dialogDepth += 1;

    try {
      return await run();
    } finally {
      this.#dialogDepth -= 1;
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
    const y = Math.min(bounds.y, workArea.y + workArea.height - next);

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
