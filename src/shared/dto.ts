import type { CandidateId, CaptureId, DraftId, ViewId } from "./ids";
import type { DraftText, Todo } from "./text";

export type CapturePlatform = "macos" | "windows";

/** Why a view came from the window list instead of direct foreground capture. */
export type FallbackReason =
  | "probeUnavailable"
  | "invalidId"
  | "noMatch"
  | "ambiguous"
  | "vanished"
  | "captureFailed"
  | "menu";

export interface ShortcutStatus {
  kind: "registered" | "unavailable";
  label: string;
}

export type ViewSource =
  | { kind: "direct" }
  | { kind: "fallback"; reason: FallbackReason };

/** What Reopen brings back for a view: the page, the file, or just the app. */
export interface OriginSummary {
  kind: "page" | "document" | "app";
  /** The site's host, the file's name, or the app's name. */
  label: string;
  /** The whole address or path, for a tooltip. */
  detail: string;
}

export interface ViewSummary {
  id: ViewId;
  title: string | null;
  appName: string | null;
  sampledAt: string;
  capturedAt: string;
  width: number;
  height: number;
  imageUrl: string;
  source: ViewSource;
  /** 1-based position of an earlier view of the same live window, so repeats read as intentional. */
  sameWindowAs: number | null;
  origin: OriginSummary | null;
}

export interface CandidateSummary {
  id: CandidateId;
  title: string | null;
  appName: string | null;
  imageUrl: string;
}

export type Notice =
  | { kind: "permissionDenied"; stillDenied: boolean }
  | { kind: "sourceVanished" }
  | { kind: "needsView" }
  | { kind: "needsRelationship" };

export type ActivitySummary =
  | { kind: "idle" | "saving" | "confirmingQuit" }
  | {
      kind: "capturing";
      /** The window being captured, once identified. Shown only where capture is slow (Windows). */
      pending: { title: string | null; appName: string | null } | null;
    }
  | { kind: "saveFailed"; message: string }
  | {
      kind: "choosing";
      reason: FallbackReason;
      candidates: readonly CandidateSummary[] | "loading";
    };

export interface DraftSnapshot {
  draftId: DraftId;
  views: readonly ViewSummary[];
  text: DraftText;
  activity: ActivitySummary;
  notice: Notice | null;
  shortcut: ShortcutStatus;
  platform: CapturePlatform;
}

export interface ListedView {
  id: ViewId;
  title: string | null;
  appName: string | null;
  imageUrl: string;
  width: number;
  height: number;
}

export type CaptureListItem =
  | {
      kind: "current";
      id: CaptureId;
      createdAt: string;
      relationship: string;
      todos: readonly Todo[];
      views: readonly ListedView[];
    }
  | { kind: "unsupported"; id: string; version: number }
  | { kind: "unreadable"; id: string };

export interface CaptureDetail {
  id: CaptureId;
  createdAt: string;
  updatedAt: string;
  relationship: string;
  todos: readonly Todo[];
  views: readonly ViewSummary[];
}

export type MutationOutcome =
  | { kind: "ok" }
  | { kind: "missing" }
  | { kind: "readOnly"; version: number }
  | { kind: "failed"; message: string };
