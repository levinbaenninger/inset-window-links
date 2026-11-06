import { app, BrowserWindow } from "electron";

import type { DraftSnapshot } from "../../shared/dto";
import type { CaptureId } from "../../shared/ids";
import { newDraftId } from "../../shared/ids";
import { SETTLE_MS } from "../../shared/leave";
import type { WindowCapturer } from "../capture/capturer";
import { capturePlatform, screenAccess } from "../capture/capturer";
import type { ImageRef } from "../ipc/image-url";
import type { CaptureStore } from "../store/store";
import type { PopoverWindow } from "../windows/popover-window";
import { shortcutStatus } from "../windows/shortcut";
import type { IdSource } from "./reduce";
import { initialSession, isMeaningful, reduce } from "./reduce";
import { toNewCapture, toSnapshot } from "./snapshot";
import type {
  CaptureOutcome,
  Draft,
  Exit,
  PendingSource,
  QuitChoice,
  SessionEffect,
  SessionEvent,
  SessionState,
} from "./state";

const ids: IdSource = { draftId: newDraftId, token: () => crypto.randomUUID() };

/** Recent Captures, as far as quitting goes. */
export interface QuitGate {
  /** `go` at once unless the page holds words that may not be saved; else what its prompt answers. */
  letQuit: () => Promise<"go" | "stay">;
  /** The app is exiting now: closing the window must not hold, or Electron would cancel the quit. */
  quitting: () => void;
}

export class SessionController {
  readonly #capturer: WindowCapturer;
  readonly #store: CaptureStore;
  readonly #popover: PopoverWindow;
  readonly #savedListeners = new Set<(captureId: CaptureId) => void>();
  readonly #library: QuitGate;
  #state: SessionState = initialSession(newDraftId());
  #exiting = false;
  /** An exit waiting for Recent Captures to let go: a second one joins it rather than run twice. */
  #waiting: Exit | null = null;
  /** Set while the quit is asked for again once Recent Captures let go, so it then exits at once. */
  #released = false;
  /** Ends the wait of a quit or restart for its save; the latest wait replaces any before it. */
  #saveWait: ReturnType<typeof setTimeout> | undefined;

  constructor(
    capturer: WindowCapturer,
    store: CaptureStore,
    popover: PopoverWindow,
    library: QuitGate
  ) {
    this.#capturer = capturer;
    this.#store = store;
    this.#popover = popover;
    this.#library = library;

    // Any way the quit prompt goes away other than its buttons counts as Cancel, so quitting never sticks.
    popover.onHidden(() => {
      const { kind } = this.#state.activity;

      if (kind === "confirmingQuit" || kind === "saveLate") {
        this.chooseQuit("cancel");
      }
    });
  }

  /** The shortcut callback. Focus is sampled synchronously, before any probe or window change. */
  pressShortcut(): void {
    this.dispatch({
      insetFocused: BrowserWindow.getFocusedWindow() !== null,
      type: "shortcutPressed",
    });
  }

  dispatch(event: SessionEvent): void {
    const [next, effects] = reduce(this.#state, event, ids);

    this.#state = next;
    this.#popover.push(this.snapshot());

    for (const effect of effects) {
      this.#run(effect);
    }
  }

  snapshot(): DraftSnapshot {
    return toSnapshot(this.#state, shortcutStatus(), capturePlatform);
  }

  /** before-quit: lets the reducer decide, and only an exitApp effect lets the quit through. */
  interceptQuit(event: Electron.Event): void {
    if (this.#exiting) {
      return;
    }

    event.preventDefault();
    this.dispatch({ type: "quitRequested" });
  }

  onSaved(listener: (captureId: CaptureId) => void): void {
    this.#savedListeners.add(listener);
  }

  hasMeaningfulDraft(): boolean {
    return isMeaningful(this.#state.draft);
  }

  /** File > Save Capture: saves the text the panel last mirrored, as ⌘↵ in the panel would. */
  saveDraft(): void {
    this.dispatch({ text: this.#state.draft.text, type: "saveRequested" });
  }

  /** The answer to the quit prompt in the popover. */
  chooseQuit(choice: QuitChoice): void {
    this.dispatch({ choice, type: "quitChosen" });
  }

  /** macOS applies a new Screen Recording grant only to a fresh process. */
  requestRelaunch(): void {
    this.dispatch({ relaunch: true, type: "quitRequested" });
  }

  recheckPermission(): void {
    this.dispatch({
      granted: screenAccess() === "granted",
      type: "permissionRechecked",
    });
  }

  imageFor(ref: ImageRef): Uint8Array | null {
    if (ref.kind === "draft") {
      return (
        this.#state.draft.views.find((view) => view.id === ref.viewId)?.png ??
        null
      );
    }

    const { activity } = this.#state;

    if (
      ref.kind !== "candidate" ||
      activity.kind !== "choosing" ||
      activity.candidates === "loading"
    ) {
      return null;
    }

    return (
      activity.candidates.find((candidate) => candidate.id === ref.candidateId)
        ?.thumb ?? null
    );
  }

  #run(effect: SessionEffect): void {
    switch (effect.type) {
      case "captureForeground": {
        // Listing sources takes over a second on Windows, so the popover previews the window meanwhile.
        const preview =
          capturePlatform === "windows"
            ? (source: PendingSource, near: Electron.Rectangle) => {
                this.dispatch({
                  near,
                  source,
                  token: effect.token,
                  type: "captureIdentified",
                });

                return this.#popover.painted();
              }
            : undefined;

        void this.#capture(effect.token, () =>
          this.#capturer.captureForeground(preview)
        );
        break;
      }

      case "captureChosen": {
        void this.#capture(effect.token, () =>
          this.#capturer.captureChosen(effect.candidates, effect.reason)
        );
        break;
      }

      case "loadCandidates": {
        void this.#loadCandidates(effect.token);
        break;
      }

      case "showPopover": {
        this.#popover.showAt(effect.anchor);
        break;
      }

      case "previewPopover": {
        this.#popover.preview(effect.anchor);
        break;
      }

      case "togglePopover": {
        this.#popover.toggle();
        break;
      }

      case "hidePopover": {
        this.#popover.hide();
        break;
      }

      case "publish": {
        void this.#publish(effect.draft);
        break;
      }

      case "limitSaveWait": {
        clearTimeout(this.#saveWait);
        this.#saveWait = setTimeout(
          () => this.dispatch({ type: "saveWaitEnded" }),
          SETTLE_MS
        );
        break;
      }

      case "withdraw": {
        this.#store.withdraw(effect.draftId);
        break;
      }

      case "askQuit": {
        this.#popover.showAt({ kind: "keep" });
        break;
      }

      case "exitApp": {
        const exit = effect.relaunch === true ? "relaunch" : "quit";

        if (this.#released) {
          this.#exit(exit);
        } else {
          void this.#holdExit(exit);
        }

        break;
      }

      default: {
        break;
      }
    }
  }

  /**
   * The panel's draft is settled; Recent Captures may still hold words that couldn't be saved.
   * Once it lets go, the quit is asked for again, since a capture may have started meanwhile:
   * the reducer exits at once only when there is still nothing to lose. A Cancel there keeps
   * the panel's choice: a draft saved or discarded stays so.
   */
  async #holdExit(exit: Exit) {
    if (this.#waiting !== null) {
      this.#waiting = exit === "relaunch" ? exit : this.#waiting;

      return;
    }

    this.#waiting = exit;

    const answer = await this.#library.letQuit();
    const wanted = this.#waiting;

    this.#waiting = null;

    if (answer === "stay") {
      return;
    }

    this.#released = true;
    this.dispatch(
      wanted === "relaunch"
        ? { relaunch: true, type: "quitRequested" }
        : { type: "quitRequested" }
    );
    this.#released = false;
  }

  #exit(exit: Exit) {
    if (this.#exiting) {
      return;
    }

    this.#exiting = true;
    this.#popover.allowClose();
    this.#library.quitting();

    if (exit === "relaunch") {
      app.relaunch();
    }

    setImmediate(() => app.quit());
  }

  async #capture(token: string, run: () => Promise<CaptureOutcome>) {
    let outcome: CaptureOutcome;

    try {
      outcome = await run();
    } catch (error) {
      console.error("Capture failed", error);
      outcome = { kind: "needsChoice", near: null, reason: "captureFailed" };
    }

    this.dispatch({ outcome, token, type: "captureFinished" });
  }

  async #loadCandidates(token: string) {
    try {
      const candidates = await this.#capturer.listCandidates();

      this.dispatch({ candidates, token, type: "candidatesReady" });
    } catch (error) {
      console.error("Listing windows failed", error);
      this.dispatch({ candidates: [], token, type: "candidatesReady" });
    }
  }

  async #publish(draft: Draft) {
    const result = await this.#store.publish(toNewCapture(draft, new Date()));

    if (result.kind === "published") {
      for (const listener of this.#savedListeners) {
        listener(draft.id);
      }
    }

    this.dispatch({ draftId: draft.id, result, type: "saveFinished" });
  }
}
