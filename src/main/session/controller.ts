import { app, BrowserWindow } from "electron";

import type { DraftSnapshot } from "../../shared/dto";
import type { CaptureId } from "../../shared/ids";
import { newDraftId } from "../../shared/ids";
import { keptTodos } from "../../shared/text";
import type { WindowCapturer } from "../capture/capturer";
import { capturePlatform, screenAccess } from "../capture/capturer";
import type { ImageRef } from "../ipc/image-url";
import { CURRENT_SCHEMA_VERSION } from "../store/schema";
import type { CaptureStore, NewCapture } from "../store/store";
import type { PopoverWindow } from "../windows/popover-window";
import { shortcutStatus } from "../windows/shortcut";
import type { IdSource } from "./reduce";
import { initialSession, isMeaningful, reduce } from "./reduce";
import { toSavedView, toSnapshot } from "./snapshot";
import type {
  CaptureOutcome,
  Draft,
  PendingSource,
  QuitChoice,
  SessionEffect,
  SessionEvent,
  SessionState,
} from "./state";

const ids: IdSource = { draftId: newDraftId, token: () => crypto.randomUUID() };

const toNewCapture = (draft: Draft, now: Date): NewCapture => ({
  images: new Map(draft.views.map((view) => [view.id, view.png])),
  record: {
    createdAt: now.toISOString(),
    id: draft.id,
    relationship: draft.text.relationship,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    todos: keptTodos(draft.text.todos),
    updatedAt: now.toISOString(),
    views: draft.views.map(toSavedView),
  },
});

export class SessionController {
  readonly #capturer: WindowCapturer;
  readonly #store: CaptureStore;
  readonly #popover: PopoverWindow;
  readonly #savedListeners = new Set<(captureId: CaptureId) => void>();
  #state: SessionState = initialSession(newDraftId());
  #exiting = false;

  constructor(
    capturer: WindowCapturer,
    store: CaptureStore,
    popover: PopoverWindow
  ) {
    this.#capturer = capturer;
    this.#store = store;
    this.#popover = popover;

    // Any way the quit prompt goes away other than its buttons counts as Cancel, so quitting never sticks.
    popover.onHidden(() => {
      if (this.#state.activity.kind === "confirmingQuit") {
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

      case "askQuit": {
        this.#popover.showAt({ kind: "keep" });
        break;
      }

      case "exitApp": {
        this.#exiting = true;

        if (effect.relaunch === true) {
          app.relaunch();
        }

        setImmediate(() => app.quit());
        break;
      }

      default: {
        break;
      }
    }
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
