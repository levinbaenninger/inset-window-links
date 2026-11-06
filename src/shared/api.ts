import type {
  CaptureDetail,
  CapturePlatform,
  CaptureListItem,
  DraftSnapshot,
  MutationOutcome,
  ShortcutStatus,
} from "./dto";
import type { DueDate } from "./due";
import type { CandidateId, CaptureId, ViewId } from "./ids";
import type { SettingsChange, SettingsView } from "./settings";
import type { PageCommand } from "./shortcuts";
import type { StatusRequest } from "./status";
import type { DraftText } from "./text";

export interface PopoverApi {
  getDraft: () => Promise<DraftSnapshot>;
  setText: (text: DraftText) => void;
  /** Carries the text too, so a fast Cmd+Enter cannot race the setText mirror. */
  save: (text: DraftText) => Promise<void>;
  removeView: (viewId: ViewId) => Promise<void>;
  discard: () => Promise<void>;
  dismiss: () => void;
  /** Opens the window list in the panel, to pick several windows at once. */
  addWindows: () => Promise<void>;
  chooseSources: (candidateIds: readonly CandidateId[]) => Promise<void>;
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
  setStatus: (
    captureId: CaptureId,
    status: StatusRequest
  ) => Promise<MutationOutcome>;
  /** Sets or clears the due date, apart from the text. */
  setDue: (
    captureId: CaptureId,
    due: DueDate | null
  ) => Promise<MutationOutcome>;
  /** What ⌘C copies: the stored title and description. */
  copyEntry: (captureId: CaptureId) => Promise<void>;
  copyNote: (captureId: CaptureId) => Promise<void>;
  shortcut: () => Promise<ShortcutStatus>;
  copyImage: (captureId: CaptureId, viewId: ViewId) => Promise<void>;
  /** Starts a native file drag of the saved PNG, for dropping into another app. */
  dragImage: (captureId: CaptureId, viewId: ViewId) => void;
  setTodoDone: (
    captureId: CaptureId,
    todoId: string,
    done: boolean
  ) => Promise<MutationOutcome>;
  /** Opens the page, file or app each view came from. Resolves to how many could not be opened. */
  reopen: (
    captureId: CaptureId,
    viewIds: readonly ViewId[]
  ) => Promise<{ failed: number }>;
  /** Shows the capture panel, to start or continue a capture. */
  newCapture: () => void;
  addWindows: () => void;
  openSettings: () => void;
}

export interface SettingsApi {
  getView: () => Promise<SettingsView>;
  update: (change: SettingsChange) => Promise<void>;
  setOpenAtLogin: (on: boolean) => Promise<void>;
  /** Asks macOS for Accessibility, which lets captures remember pages and files. */
  allowOrigins: () => Promise<void>;
  fitHeight: (height: number) => void;
}

export type PopoverBridge = PopoverApi & {
  onDraft: (listener: (snapshot: DraftSnapshot) => void) => () => void;
  onShown: (listener: () => void) => () => void;
  /** A menu key for the page: a field, the sheet. */
  onCommand: (listener: (command: PageCommand) => void) => () => void;
  platform: CapturePlatform;
};

export type SettingsBridge = SettingsApi & {
  onView: (listener: (view: SettingsView) => void) => () => void;
  platform: CapturePlatform;
};

export type LibraryBridge = LibraryApi & {
  onChanged: (listener: () => void) => () => void;
  /** Main asks the window to show a route, such as a capture that was just saved. */
  onNavigate: (listener: (route: string) => void) => () => void;
  /** A menu key for the page: a field, the open capture, the sidebar, the sheet. */
  onCommand: (listener: (command: PageCommand) => void) => () => void;
  platform: CapturePlatform;
};
