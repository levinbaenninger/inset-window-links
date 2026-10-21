import type {
  CaptureDetail,
  CaptureListItem,
  DraftSnapshot,
  MutationOutcome,
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
  reportHeight: (height: number) => void;
  openScreenSettings: () => Promise<void>;
  recheckPermission: () => Promise<void>;
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
}

export type PopoverBridge = PopoverApi & {
  onDraft: (listener: (snapshot: DraftSnapshot) => void) => () => void;
};

export type LibraryBridge = LibraryApi & {
  onChanged: (listener: () => void) => () => void;
};
