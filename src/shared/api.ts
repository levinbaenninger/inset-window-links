import type {
  CaptureDetail,
  CapturePlatform,
  CaptureListItem,
  DraftSnapshot,
  MutationOutcome,
  ShortcutStatus,
} from "./dto";
import type { CandidateId, CaptureId, ViewId } from "./ids";
import type { DraftText } from "./text";

export interface PopoverApi {
  getDraft: () => Promise<DraftSnapshot>;
  setText: (text: DraftText) => void;
  /** Carries the text too, so a fast Cmd+Enter cannot race the setText mirror. */
  save: (text: DraftText) => Promise<void>;
  removeView: (viewId: ViewId) => Promise<void>;
  discard: () => Promise<void>;
  dismiss: () => void;
  chooseSource: (candidateId: CandidateId) => Promise<void>;
  cancelChoice: () => Promise<void>;
  /** Answers the quit prompt. Hiding the popover any other way counts as cancel. */
  chooseQuit: (choice: "save" | "discard" | "cancel") => Promise<void>;
  reportHeight: (height: number) => void;
  openScreenSettings: () => Promise<void>;
  recheckPermission: () => Promise<void>;
  /** Quits through the usual unsaved-draft check, then starts again so macOS applies a new grant. */
  relaunch: () => Promise<void>;
}

export interface LibraryApi {
  list: () => Promise<readonly CaptureListItem[]>;
  get: (captureId: string) => Promise<CaptureDetail | null>;
  updateText: (
    captureId: CaptureId,
    text: DraftText
  ) => Promise<MutationOutcome>;
  remove: (captureId: CaptureId) => Promise<MutationOutcome>;
  copyNote: (captureId: CaptureId) => Promise<void>;
  shortcut: () => Promise<ShortcutStatus>;
  copyImage: (captureId: CaptureId, viewId: ViewId) => Promise<void>;
  /** Starts a native file drag of the saved PNG, for dropping into another app. */
  dragImage: (captureId: CaptureId, viewId: ViewId) => void;
}

export type PopoverBridge = PopoverApi & {
  onDraft: (listener: (snapshot: DraftSnapshot) => void) => () => void;
  onShown: (listener: () => void) => () => void;
};

export type LibraryBridge = LibraryApi & {
  onChanged: (listener: () => void) => () => void;
  /** Main asks the window to show a route, such as a capture that was just saved. */
  onNavigate: (listener: (route: string) => void) => () => void;
  platform: CapturePlatform;
};
