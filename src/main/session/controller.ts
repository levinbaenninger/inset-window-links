import { app, BrowserWindow, dialog } from "electron";

import type { DraftSnapshot } from "../../shared/dto";
import { newDraftId } from "../../shared/ids";
import type { WindowCapturer } from "../capture/capturer";
import { capturePlatform, screenAccess } from "../capture/capturer";
import type { ImageRef } from "../ipc/image-url";
import type { CaptureStore, NewCapture } from "../store/store";
import type { PopoverWindow } from "../windows/popover-window";
import { shortcutStatus } from "../windows/shortcut";
import type { IdSource } from "./reduce";
import { initialSession, reduce } from "./reduce";
import { toSavedView, toSnapshot } from "./snapshot";
import type {
  CaptureOutcome,
  Draft,
  QuitChoice,
  SessionEffect,
  SessionEvent,
  SessionState,
} from "./state";

const QUIT_CHOICES: readonly QuitChoice[] = ["save", "discard", "cancel"];

const ids: IdSource = { draftId: newDraftId, token: () => crypto.randomUUID() };

const toNewCapture = (draft: Draft, now: Date): NewCapture => ({
  images: new Map(draft.views.map((view) => [view.id, view.png])),
  record: {
    createdAt: now.toISOString(),
    id: draft.id,
    nextStep: draft.text.nextStep,
    relationship: draft.text.relationship,
    schemaVersion: 1,
    updatedAt: now.toISOString(),
    views: draft.views.map(toSavedView),
  },
});

/** Runs the reducer and interprets its effects against Electron. */
export class SessionController {
  readonly #capturer: WindowCapturer;
  readonly #store: CaptureStore;
  readonly #popover: PopoverWindow;
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
        void this.#capture(effect.token, () =>
          this.#capturer.captureForeground()
        );
        break;
      }

      case "captureChosen": {
        void this.#capture(effect.token, () =>
          this.#capturer.captureChosen(effect.candidate, effect.reason)
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
        void this.#askQuit();
        break;
      }

      case "exitApp": {
        this.#exiting = true;
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

    this.dispatch({ draftId: draft.id, result, type: "saveFinished" });
  }

  async #askQuit() {
    const { response } = await this.#popover.withDialog(() =>
      dialog.showMessageBox({
        buttons: ["Save", "Discard", "Cancel"],
        cancelId: 2,
        defaultId: 0,
        detail: "Your unsaved views and text will be lost if you discard them.",
        message: "Save this capture before quitting?",
        noLink: true,
        type: "question",
      })
    );

    this.dispatch({
      choice: QUIT_CHOICES[response] ?? "cancel",
      type: "quitChosen",
    });
  }
}
