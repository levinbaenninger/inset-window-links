import type { FallbackReason, Notice } from "../../shared/dto";
import type { CandidateId, DraftId, ViewId } from "../../shared/ids";
import type { DraftText } from "../../shared/text";
import type { Acquisition, ViewOrigin } from "../store/schema";
import type { PublishResult } from "../store/store";
import type { Bounds } from "../windows/placement";

export interface CapturedView {
  id: ViewId;
  /** When the foreground window was identified. */
  sampledAt: Date;
  /** When the image was taken. This is the time the UI shows. */
  capturedAt: Date;
  title: string | null;
  appName: string | null;
  boundsDip: Bounds | null;
  acquisition: Acquisition;
  origin: ViewOrigin | null;
  png: Uint8Array;
  width: number;
  height: number;
}

export interface FallbackCandidate {
  id: CandidateId;
  sourceId: string;
  title: string | null;
  appName: string | null;
  thumb: Uint8Array;
}

export type CaptureOutcome =
  | { kind: "captured"; view: CapturedView }
  /** Windows picked from the list, captured together; missing ones closed in the meantime. */
  | { kind: "capturedMany"; views: readonly CapturedView[]; missing: number }
  | { kind: "self" }
  | { kind: "permissionDenied" }
  | { kind: "needsChoice"; reason: FallbackReason; near: Bounds | null };

export interface Draft {
  id: DraftId;
  /** Capture order. Repeats of one live window are kept on purpose: the content may have changed. */
  views: readonly CapturedView[];
  /** Mirror of the renderer's text. Only textChanged and saveRequested write it. */
  text: DraftText;
}

export type CaptureToken = string;

/** What the probe found, shown while the slower capture of that window runs. */
export interface PendingSource {
  title: string | null;
  appName: string | null;
}

type Resumable = { kind: "idle" } | { kind: "saveFailed"; message: string };

/** How a confirmed quit ends. Relaunch starts the app again, so macOS applies a new grant. */
export type Exit = "quit" | "relaunch";

export type Activity =
  | Resumable
  | {
      kind: "capturing";
      token: CaptureToken;
      via: "direct" | "chosen";
      pending: PendingSource | null;
    }
  | {
      kind: "choosing";
      token: CaptureToken;
      reason: FallbackReason;
      candidates: readonly FallbackCandidate[] | "loading";
    }
  | { kind: "saving"; after: "stay" | Exit }
  | { kind: "confirmingQuit"; resumeTo: Resumable; exit: Exit };

export interface SessionState {
  draft: Draft;
  activity: Activity;
  notice: Notice | null;
}

export type QuitChoice = "save" | "discard" | "cancel";

export type SessionEvent =
  | { type: "shortcutPressed"; insetFocused: boolean }
  | {
      type: "captureIdentified";
      token: CaptureToken;
      source: PendingSource;
      near: Bounds;
    }
  | { type: "captureFinished"; token: CaptureToken; outcome: CaptureOutcome }
  | {
      type: "candidatesReady";
      token: CaptureToken;
      candidates: readonly FallbackCandidate[];
    }
  | { type: "showDraftRequested" }
  | { type: "chooserRequested" }
  | { type: "sourcesChosen"; candidateIds: readonly CandidateId[] }
  | { type: "choiceCancelled" }
  | { type: "viewRemoved"; viewId: ViewId }
  | { type: "textChanged"; text: DraftText }
  | { type: "saveRequested"; text: DraftText }
  | { type: "saveFinished"; draftId: DraftId; result: PublishResult }
  | { type: "discardRequested" }
  | { type: "quitRequested"; relaunch?: true }
  | { type: "quitChosen"; choice: QuitChoice }
  | { type: "permissionRechecked"; granted: boolean };

/** "keep" shows the popover where it is, or on the cursor's display when hidden. */
export type PopoverAnchor =
  | { kind: "window"; bounds: Bounds }
  | { kind: "keep" };

export type SessionEffect =
  | { type: "captureForeground"; token: CaptureToken }
  | { type: "loadCandidates"; token: CaptureToken }
  | {
      type: "captureChosen";
      token: CaptureToken;
      candidates: readonly FallbackCandidate[];
      reason: FallbackReason;
    }
  | { type: "showPopover"; anchor: PopoverAnchor }
  /** Shows the popover without taking focus, so the window being captured stays as it is. */
  | { type: "previewPopover"; anchor: PopoverAnchor }
  | { type: "togglePopover" }
  | { type: "hidePopover" }
  | { type: "publish"; draft: Draft }
  | { type: "askQuit" }
  | { type: "exitApp"; relaunch?: true };
