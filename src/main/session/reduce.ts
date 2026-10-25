import type { Notice } from "../../shared/dto";
import type { DraftId } from "../../shared/ids";
import type { DraftText } from "../../shared/text";
import { blankText, hasTyped, isBlank, saveability } from "../../shared/text";
import type {
  Activity,
  CaptureToken,
  Draft,
  Exit,
  SessionEffect,
  SessionEvent,
  SessionState,
} from "./state";

export interface IdSource {
  token: () => CaptureToken;
  draftId: () => DraftId;
}

type Transition = readonly [SessionState, readonly SessionEffect[]];

type EventOf<K extends SessionEvent["type"]> = Extract<
  SessionEvent,
  { type: K }
>;

const freshDraft = (id: DraftId): Draft => ({ id, text: blankText, views: [] });

export const initialSession = (id: DraftId): SessionState => ({
  activity: { kind: "idle" },
  draft: freshDraft(id),
  notice: null,
});

/** Empty is derived, never stored: a draft always exists. */
export const isMeaningful = (draft: Draft): boolean =>
  draft.views.length > 0 || hasTyped(draft.text);

const isResumable = (activity: Activity) =>
  activity.kind === "idle" || activity.kind === "saveFailed";

const canEditDraft = (activity: Activity) =>
  isResumable(activity) || activity.kind === "choosing";

const unchanged = (state: SessionState): Transition => [state, []];

/** Notices describe the last attempt. Only the permission notice still holds when the draft is reopened. */
const lasting = (notice: Notice | null): Notice | null =>
  notice?.kind === "permissionDenied" ? notice : null;

const withText = (state: SessionState, text: DraftText): SessionState => ({
  ...state,
  draft: { ...state.draft, text },
});

const exitApp = (exit: Exit): SessionEffect =>
  exit === "relaunch"
    ? { relaunch: true, type: "exitApp" }
    : { type: "exitApp" };

const startSave = (state: SessionState, after: "stay" | Exit): Transition => [
  { ...state, activity: { after, kind: "saving" }, notice: null },
  [{ draft: state.draft, type: "publish" }],
];

const restart = (ids: IdSource, effect: SessionEffect): Transition => [
  initialSession(ids.draftId()),
  [effect],
];

const onCaptureFinished = (
  state: SessionState,
  event: EventOf<"captureFinished">
): Transition => {
  const { activity } = state;

  if (activity.kind !== "capturing" || activity.token !== event.token) {
    return unchanged(state);
  }

  const { outcome } = event;
  const idle: SessionState = { ...state, activity: { kind: "idle" } };

  switch (outcome.kind) {
    case "captured": {
      const { view } = outcome;

      return [
        {
          ...idle,
          draft: { ...state.draft, views: [...state.draft.views, view] },
          notice: null,
        },
        [
          {
            anchor:
              view.boundsDip === null
                ? { kind: "keep" }
                : { bounds: view.boundsDip, kind: "window" },
            type: "showPopover",
          },
        ],
      ];
    }

    case "capturedMany": {
      return [
        {
          ...idle,
          draft: {
            ...state.draft,
            views: [...state.draft.views, ...outcome.views],
          },
          notice: outcome.missing > 0 ? { kind: "sourceVanished" } : null,
        },
        [{ anchor: { kind: "keep" }, type: "showPopover" }],
      ];
    }

    case "self": {
      return [idle, [{ type: "togglePopover" }]];
    }

    case "permissionDenied": {
      return [
        { ...idle, notice: { kind: "permissionDenied", stillDenied: false } },
        [{ anchor: { kind: "keep" }, type: "showPopover" }],
      ];
    }

    case "needsChoice": {
      if (activity.via === "chosen") {
        return [
          { ...idle, notice: { kind: "sourceVanished" } },
          [{ anchor: { kind: "keep" }, type: "showPopover" }],
        ];
      }

      return [
        {
          ...state,
          activity: {
            candidates: "loading",
            kind: "choosing",
            reason: outcome.reason,
            token: event.token,
          },
        },
        [
          { token: event.token, type: "loadCandidates" },
          {
            anchor:
              outcome.near === null
                ? { kind: "keep" }
                : { bounds: outcome.near, kind: "window" },
            type: "showPopover",
          },
        ],
      ];
    }

    default: {
      return unchanged(state);
    }
  }
};

const onSaveFinished = (
  state: SessionState,
  event: EventOf<"saveFinished">,
  ids: IdSource
): Transition => {
  const { activity } = state;

  if (activity.kind !== "saving" || event.draftId !== state.draft.id) {
    return unchanged(state);
  }

  if (event.result.kind === "failed") {
    return [
      {
        ...state,
        activity: { kind: "saveFailed", message: event.result.message },
      },
      [{ anchor: { kind: "keep" }, type: "showPopover" }],
    ];
  }

  return restart(
    ids,
    activity.after === "stay"
      ? { type: "hidePopover" }
      : exitApp(activity.after)
  );
};

const onQuitRequested = (
  state: SessionState,
  event: EventOf<"quitRequested">
): Transition => {
  const { activity } = state;
  const exit: Exit = event.relaunch === true ? "relaunch" : "quit";

  if (activity.kind === "saving") {
    return activity.after === "stay"
      ? [{ ...state, activity: { after: exit, kind: "saving" } }, []]
      : unchanged(state);
  }

  if (activity.kind === "confirmingQuit") {
    return unchanged(state);
  }

  if (!isMeaningful(state.draft)) {
    return [state, [exitApp(exit)]];
  }

  const resumeTo =
    activity.kind === "saveFailed" ? activity : ({ kind: "idle" } as const);

  return [
    { ...state, activity: { exit, kind: "confirmingQuit", resumeTo } },
    [{ type: "askQuit" }],
  ];
};

const onQuitChosen = (
  state: SessionState,
  event: EventOf<"quitChosen">,
  ids: IdSource
): Transition => {
  const { activity } = state;

  if (activity.kind !== "confirmingQuit") {
    return unchanged(state);
  }

  const resumed: SessionState = { ...state, activity: activity.resumeTo };

  switch (event.choice) {
    case "discard": {
      return restart(ids, exitApp(activity.exit));
    }

    case "cancel": {
      return unchanged(resumed);
    }

    case "save": {
      const check = saveability(state.draft.views.length, state.draft.text);

      return check.kind === "ok"
        ? startSave(resumed, activity.exit)
        : [
            { ...resumed, notice: { kind: check.reason } },
            [{ anchor: { kind: "keep" }, type: "showPopover" }],
          ];
    }

    default: {
      return unchanged(state);
    }
  }
};

const onShortcut = (
  state: SessionState,
  event: EventOf<"shortcutPressed">,
  ids: IdSource
): Transition => {
  if (!canEditDraft(state.activity)) {
    return unchanged(state);
  }

  if (event.insetFocused) {
    return [state, [{ type: "togglePopover" }]];
  }

  const token = ids.token();

  return [
    {
      ...state,
      activity: { kind: "capturing", pending: null, token, via: "direct" },
    },
    [{ token, type: "captureForeground" }],
  ];
};

const onCaptureIdentified = (
  state: SessionState,
  event: EventOf<"captureIdentified">
): Transition => {
  const { activity } = state;

  if (activity.kind !== "capturing" || activity.token !== event.token) {
    return unchanged(state);
  }

  return [
    { ...state, activity: { ...activity, pending: event.source } },
    [
      {
        anchor: { bounds: event.near, kind: "window" },
        type: "previewPopover",
      },
    ],
  ];
};

const onCandidatesReady = (
  state: SessionState,
  event: EventOf<"candidatesReady">
): Transition => {
  const { activity } = state;

  return activity.kind === "choosing" && activity.token === event.token
    ? [
        { ...state, activity: { ...activity, candidates: event.candidates } },
        [],
      ]
    : unchanged(state);
};

const onShowDraft = (state: SessionState): Transition =>
  canEditDraft(state.activity)
    ? [
        { ...state, notice: lasting(state.notice) },
        [{ anchor: { kind: "keep" }, type: "showPopover" }],
      ]
    : unchanged(state);

const onChooserRequested = (state: SessionState, ids: IdSource): Transition => {
  if (!canEditDraft(state.activity)) {
    return unchanged(state);
  }

  const token = ids.token();

  return [
    {
      ...state,
      activity: {
        candidates: "loading",
        kind: "choosing",
        reason: "menu",
        token,
      },
      notice: lasting(state.notice),
    },
    [
      { token, type: "loadCandidates" },
      { anchor: { kind: "keep" }, type: "showPopover" },
    ],
  ];
};

const onSourcesChosen = (
  state: SessionState,
  event: EventOf<"sourcesChosen">,
  ids: IdSource
): Transition => {
  const { activity } = state;

  if (activity.kind !== "choosing" || activity.candidates === "loading") {
    return unchanged(state);
  }

  const chosen = new Set(event.candidateIds);

  // Kept in list order, so views land in the order the windows were shown.
  const candidates = activity.candidates.filter((item) => chosen.has(item.id));

  if (candidates.length === 0) {
    return unchanged(state);
  }

  const token = ids.token();

  return [
    {
      ...state,
      activity: { kind: "capturing", pending: null, token, via: "chosen" },
    },
    [{ candidates, reason: activity.reason, token, type: "captureChosen" }],
  ];
};

const onChoiceCancelled = (state: SessionState): Transition =>
  state.activity.kind === "choosing"
    ? [{ ...state, activity: { kind: "idle" } }, []]
    : unchanged(state);

const onViewRemoved = (
  state: SessionState,
  event: EventOf<"viewRemoved">
): Transition => {
  if (!canEditDraft(state.activity)) {
    return unchanged(state);
  }

  const views = state.draft.views.filter((view) => view.id !== event.viewId);

  return [{ ...state, draft: { ...state.draft, views } }, []];
};

const onTextChanged = (
  state: SessionState,
  event: EventOf<"textChanged">
): Transition => {
  if (state.activity.kind === "saving") {
    return unchanged(state);
  }

  const next = withText(state, event.text);

  return state.notice?.kind === "needsRelationship" &&
    !isBlank(event.text.relationship)
    ? [{ ...next, notice: null }, []]
    : [next, []];
};

const onSaveRequested = (
  state: SessionState,
  event: EventOf<"saveRequested">
): Transition => {
  if (!isResumable(state.activity)) {
    return unchanged(state);
  }

  const next = withText(state, event.text);
  const check = saveability(next.draft.views.length, event.text);

  return check.kind === "ok"
    ? startSave(next, "stay")
    : [{ ...next, notice: { kind: check.reason } }, []];
};

const onDiscard = (state: SessionState, ids: IdSource): Transition =>
  canEditDraft(state.activity)
    ? restart(ids, { type: "hidePopover" })
    : unchanged(state);

const onPermissionRechecked = (
  state: SessionState,
  event: EventOf<"permissionRechecked">
): Transition =>
  event.granted
    ? [{ ...state, notice: null }, [{ type: "hidePopover" }]]
    : [
        { ...state, notice: { kind: "permissionDenied", stillDenied: true } },
        [],
      ];

/** Pure lifecycle policy. The controller runs the effects; popover visibility lives in PopoverWindow. */
export const reduce = (
  state: SessionState,
  event: SessionEvent,
  ids: IdSource
): Transition => {
  switch (event.type) {
    case "shortcutPressed": {
      return onShortcut(state, event, ids);
    }

    case "captureIdentified": {
      return onCaptureIdentified(state, event);
    }

    case "captureFinished": {
      return onCaptureFinished(state, event);
    }

    case "candidatesReady": {
      return onCandidatesReady(state, event);
    }

    case "showDraftRequested": {
      return onShowDraft(state);
    }

    case "chooserRequested": {
      return onChooserRequested(state, ids);
    }

    case "sourcesChosen": {
      return onSourcesChosen(state, event, ids);
    }

    case "choiceCancelled": {
      return onChoiceCancelled(state);
    }

    case "viewRemoved": {
      return onViewRemoved(state, event);
    }

    case "textChanged": {
      return onTextChanged(state, event);
    }

    case "saveRequested": {
      return onSaveRequested(state, event);
    }

    case "saveFinished": {
      return onSaveFinished(state, event, ids);
    }

    case "discardRequested": {
      return onDiscard(state, ids);
    }

    case "quitRequested": {
      return onQuitRequested(state, event);
    }

    case "quitChosen": {
      return onQuitChosen(state, event, ids);
    }

    case "permissionRechecked": {
      return onPermissionRechecked(state, event);
    }

    default: {
      return unchanged(state);
    }
  }
};
