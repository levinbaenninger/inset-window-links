import type {
  ActivitySummary,
  CapturePlatform,
  DraftSnapshot,
  ShortcutStatus,
  ViewSummary,
} from "../../shared/dto";
import { imageUrl } from "../ipc/image-url";
import type { SavedView } from "../store/schema";
import type { CapturedView, SessionState } from "./state";

export const toSavedView = (view: CapturedView): SavedView => ({
  acquisition: view.acquisition,
  appName: view.appName,
  capturedAt: view.capturedAt.toISOString(),
  height: view.height,
  id: view.id,
  sampledAt: view.sampledAt.toISOString(),
  title: view.title,
  width: view.width,
});

export const summarizeViews = (
  views: readonly SavedView[],
  urlFor: (view: SavedView) => string
): ViewSummary[] =>
  views.map((view, index) => {
    const key = view.acquisition.windowKeyAtCapture;

    const earlier =
      key === null
        ? -1
        : views.findIndex(
            (other) => other.acquisition.windowKeyAtCapture === key
          );

    return {
      appName: view.appName,
      capturedAt: view.capturedAt,
      height: view.height,
      id: view.id,
      imageUrl: urlFor(view),
      sameWindowAs: earlier >= 0 && earlier < index ? earlier + 1 : null,
      sampledAt: view.sampledAt,
      source:
        view.acquisition.kind === "direct"
          ? { kind: "direct" }
          : { kind: "fallback", reason: view.acquisition.reason },
      title: view.title,
      width: view.width,
    };
  });

const activitySummary = (state: SessionState): ActivitySummary => {
  const { activity } = state;

  switch (activity.kind) {
    case "saveFailed": {
      return { kind: "saveFailed", message: activity.message };
    }

    case "choosing": {
      return {
        candidates:
          activity.candidates === "loading"
            ? "loading"
            : activity.candidates.map((candidate) => ({
                id: candidate.id,
                imageUrl: imageUrl({
                  candidateId: candidate.id,
                  kind: "candidate",
                }),
                title: candidate.title,
              })),
        kind: "choosing",
        reason: activity.reason,
      };
    }

    default: {
      return { kind: activity.kind };
    }
  }
};

export const toSnapshot = (
  state: SessionState,
  shortcut: ShortcutStatus,
  platform: CapturePlatform
): DraftSnapshot => ({
  activity: activitySummary(state),
  draftId: state.draft.id,
  notice: state.notice,
  platform,
  shortcut,
  text: state.draft.text,
  views: summarizeViews(state.draft.views.map(toSavedView), (view) =>
    imageUrl({ kind: "draft", viewId: view.id })
  ),
});
