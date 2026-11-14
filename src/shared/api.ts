import type { CopyOutcome, CopyRequest, CopyTicket } from "./copy";
import type {
  CaptureDetail,
  CapturePlatform,
  CaptureListItem,
  DraftSnapshot,
  MutationOutcome,
  OwedDiscard,
  ShortcutStatus,
} from "./dto";
import type { CandidateId, CaptureId, ViewId } from "./ids";
import type { LeaveAnswer, LeavePush } from "./leave";
import type { HandOffChoice, OnboardingView, PermissionId } from "./onboarding";
import type { SettingsChange, SettingsView } from "./settings";
import type { PageCommand } from "./shortcuts";
import type { StatusRequest } from "./status";
import type { DraftText } from "./text";
import type { TutorialAction, TutorialView } from "./tutorial";

export interface PopoverApi extends TutorialApi {
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
  /** Opens the permission onboarding at Screen Recording; the panel hides, keeping the draft. */
  openSetup: () => Promise<void>;
  recheckPermission: () => Promise<void>;
  /** Quits through the usual unsaved-draft check, then starts again so macOS applies a new grant. */
  relaunch: () => Promise<void>;
}

export interface LibraryApi extends TutorialApi {
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
  /**
   * The Discards main still owes, from a page closed before this one: asked once as the page
   * loads, before it shows anything or reports its count.
   */
  owedDiscards: () => Promise<readonly OwedDiscard[]>;
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
  /**
   * Opens the permission onboarding at Accessibility, which lets captures remember pages and
   * files. Settings closes, so it doesn't float over System Settings.
   */
  allowOrigins: () => Promise<void>;
  fitHeight: (height: number) => void;
  /** As in Recent Captures: main leaves the keys to an open dropdown. */
  menuOpen: (open: boolean) => void;
  /** Reset Tutorial: the checklist and tips start over; the example capture never comes back. */
  resetTutorial: () => void;
  /** Show tips: the tutorial's one-time tips. */
  setTips: (on: boolean) => Promise<void>;
}

/**
 * The permission setup's window (src/main/permissions/, src/renderer/src/onboarding/): the page
 * shows the view main pushes and reports what was pressed. The same actions as Inset Shelf's
 * onboarding contract.
 */
export interface OnboardingApi {
  getView: () => Promise<OnboardingView>;
  /** A row's Allow, or Waiting…, which asks again: macOS's prompt and the exact pane. */
  allow: (id: PermissionId) => void;
  /** Back, or ←. */
  back: () => void;
  /** Done's buttons: start using the app, or start with the walkthrough. */
  finish: (how: HandOffChoice) => void;
  /** The page's height, so the window fits it without empty space. */
  fitHeight: (height: number) => void;
  /** Get Started, Continue, →, or Not now on Allow access. */
  next: () => void;
  /** Reopen to finish, for Screen Recording: quits through the usual unsaved-draft check, then starts again. */
  reopen: () => void;
  /** Not now on Welcome: the whole setup. */
  skip: () => void;
  /** The app's tile, dragged into System Settings' list as the app bundle. */
  startDrag: () => void;
}

/** The in-app tutorial (src/main/tutorial/), in every window that shows a tip: its view, and what the page asks or reports. */
export interface TutorialApi {
  getTutorial: () => Promise<TutorialView>;
  tutorial: (action: TutorialAction) => void;
}

export type OnboardingBridge = OnboardingApi & {
  onView: (listener: (view: OnboardingView) => void) => () => void;
  platform: CapturePlatform;
};

/** What a page with tips hears of the tutorial. */
interface TutorialEvents {
  onTutorial: (listener: (view: TutorialView) => void) => () => void;
}

export type PopoverBridge = PopoverApi &
  TutorialEvents & {
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

export type LibraryBridge = LibraryApi &
  TutorialEvents & {
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
