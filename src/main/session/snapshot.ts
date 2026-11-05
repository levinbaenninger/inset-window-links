import path from "node:path";

import type {
  ActivitySummary,
  CapturePlatform,
  DraftSnapshot,
  OriginSummary,
  ShortcutStatus,
  ViewSummary,
} from "../../shared/dto";
import { ACTIVE } from "../../shared/status";
import { keptTodos } from "../../shared/text";
import { imageUrl } from "../ipc/image-url";
import type { SavedView } from "../store/schema";
import { CURRENT_SCHEMA_VERSION } from "../store/schema";
import type { NewCapture } from "../store/store";
import type { CapturedView, Draft, SessionState } from "./state";

export const toSavedView = (
  view: CapturedView,
  description = ""
): SavedView => ({
  acquisition: view.acquisition,
  appName: view.appName,
  capturedAt: view.capturedAt.toISOString(),
  description,
  height: view.height,
  id: view.id,
  origin: view.origin,
  sampledAt: view.sampledAt.toISOString(),
  title: view.title,
  width: view.width,
});

/**
 * The record a saved draft becomes. Blank to-dos are dropped, and the descriptions are trimmed.
 * A description typed for a window that was removed again is left behind.
 */
export const toNewCapture = (draft: Draft, now: Date): NewCapture => ({
  images: new Map(draft.views.map((view) => [view.id, view.png])),
  record: {
    createdAt: now.toISOString(),
    description: draft.text.description.trim(),
    due: draft.text.due,
    id: draft.id,
    relationship: draft.text.relationship,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    status: ACTIVE,
    todos: keptTodos(draft.text.todos),
    updatedAt: now.toISOString(),
    views: draft.views.map((view) =>
      toSavedView(view, (draft.text.viewDescriptions[view.id] ?? "").trim())
    ),
  },
});

const host = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./u, "");
  } catch {
    return url;
  }
};

/** The most specific thing Reopen can bring back: the page, else the file, else the app. */
export const originSummary = (view: SavedView): OriginSummary | null => {
  const { origin } = view;

  if (origin === null) {
    return null;
  }

  if (origin.url !== null) {
    return { detail: origin.url, kind: "page", label: host(origin.url) };
  }

  if (origin.document !== null) {
    return {
      detail: origin.document,
      kind: "document",
      label: path.basename(origin.document),
    };
  }

  return origin.appPath === null
    ? null
    : {
        detail: origin.appPath,
        kind: "app",
        // "Safari" for /Applications/Safari.app, "chrome" for C:\…\chrome.exe.
        label: view.appName ?? path.parse(origin.appPath).name,
      };
};

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
      description: view.description,
      height: view.height,
      id: view.id,
      imageUrl: urlFor(view),
      origin: originSummary(view),
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
                appName: candidate.appName,
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

    case "capturing": {
      return { kind: "capturing", pending: activity.pending };
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
  landing: state.background.map((item) => item.pending),
  notice: state.notice,
  platform,
  shortcut,
  text: state.draft.text,
  views: summarizeViews(
    state.draft.views.map((view) => toSavedView(view)),
    (view) => imageUrl({ kind: "draft", viewId: view.id })
  ),
});
