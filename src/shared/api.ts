import type { CopyOutcome, CopyRequest, CopyTicket } from "./copy";
import type {
  CaptureDetail,
  CapturePlatform,
  CaptureListItem,
  DraftSnapshot,
  MutationOutcome,
  ShortcutStatus,
} from "./dto";
import type { CandidateId, CaptureId, ViewId } from "./ids";
import type { LeaveAnswer, LeavePush } from "./leave";
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
  /** Saves a capture's words and due date as the draft's save `rev`. */
  updateText: (
    captureId: CaptureId,
    text: DraftText,
    rev: number
  ) => Promise<MutationOutcome>;
  /**
   * The page gave up its unsaved changes to a capture: saves of them still on their way are
   * dropped, and `rev`, sent but not answered yet, is undone if it landed already. Writes no
   * content. Answers failed when the saved version couldn't be put back.
   */
  discard: (
    captureId: CaptureId,
    rev: number | null
  ) => Promise<MutationOutcome>;
  remove: (captureId: CaptureId) => Promise<MutationOutcome>;
  setStatus: (
    captureId: CaptureId,
    status: StatusRequest
  ) => Promise<MutationOutcome>;
  /**
   * Starts a copy: main takes the capture as it stands once every write sent before this has
   * landed, its due date and windows included, and keeps it under `ticket`.
   */
  beginCopy: (ticket: CopyTicket, captureId: CaptureId) => void;
  /**
   * Copies what `beginCopy` took; only the page's copy gate calls this, once its edits are saved.
   * `text` is the words the copy was asked for, which main copies instead of reading them back;
   * null copies the words main had when the copy began.
   */
  copy: (
    ticket: CopyTicket,
    captureId: CaptureId,
    request: CopyRequest,
    text: DraftText | null
  ) => Promise<CopyOutcome>;
  shortcut: () => Promise<ShortcutStatus>;
  /** Starts a native file drag of the saved PNG, for dropping into another app. */
  dragImage: (captureId: CaptureId, viewId: ViewId) => void;
  /** Checks a step off or on, as the draft's save `rev`. */
  setTodoDone: (
    captureId: CaptureId,
    todoId: string,
    done: boolean,
    rev: number
  ) => Promise<MutationOutcome>;
  /** Opens the page, file or app each view came from. Resolves to how many could not be opened. */
  reopen: (
    captureId: CaptureId,
    viewIds: readonly ViewId[]
  ) => Promise<{ failed: number }>;
  /** Says when the page's first menu opens and its last one closes: main leaves the keys to it meanwhile. */
  menuOpen: (open: boolean) => void;
  /** Says how many captures hold words main does not have, whenever that changes: main holds a close meanwhile. */
  reportUnsaved: (count: number) => void;
  /** Answers main's request to let the window go (onLeave). */
  answerLeave: (answer: LeaveAnswer) => void;
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
  /** As in Recent Captures: main leaves the keys to an open dropdown. */
  menuOpen: (open: boolean) => void;
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
  /**
   * Main asks the page to let its window close, or the app quit, and the page answers with
   * answerLeave; or main says it stopped waiting (`cancel`).
   */
  onLeave: (listener: (push: LeavePush) => void) => () => void;
  platform: CapturePlatform;
};
