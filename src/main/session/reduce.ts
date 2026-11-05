import type { Notice } from "../../shared/dto";
import type { DraftId } from "../../shared/ids";
import type { DraftText } from "../../shared/text";
import {
  blankText,
  hasTyped,
  isBlank,
  removeViewDescription,
  saveability,
} from "../../shared/text";
import type {
  Activity,
  BackgroundCapture,
  CapturedView,
  CaptureOutcome,
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
  background: [],
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

/** A window capture still running carries on in the background, so what takes over loses nothing. */
const withCaptureParked = (state: SessionState): SessionState => {
  const { activity } = state;

  return activity.kind === "capturing"
    ? {
        ...state,
        background: [
          ...state.background,
          {
            pending: activity.pending,
            token: activity.token,
            via: activity.via,
          },
        ],
      }
    : state;
};

const withViews = (
  state: SessionState,
  views: readonly CapturedView[]
): SessionState => ({
  ...state,
  draft: { ...state.draft, views: [...state.draft.views, ...views] },
});

/**
 * A capture that Add Windows overtook lands in the draft as it would have, but quietly: the
 * chooser or the text being typed keeps focus. A hidden panel shows without taking focus, so the
 * window is seen to arrive. One that could not find its window adds nothing, since the user is
 * already picking from the list.
 */
const onBackgroundFinished = (
  state: SessionState,
  entry: BackgroundCapture,
  outcome: CaptureOutcome
): Transition => {
  const rest: SessionState = {
    ...state,
    background: state.background.filter((item) => item !== entry),
  };

  const shown: readonly SessionEffect[] = [
    { anchor: { kind: "keep" }, type: "previewPopover" },
  ];

  switch (outcome.kind) {
    case "captured": {
      return [withViews(rest, [outcome.view]), shown];
    }

    case "capturedMany": {
      const added = withViews(rest, outcome.views);

      return [
        outcome.missing > 0
          ? { ...added, notice: { kind: "sourceVanished" } }
          : added,
        outcome.views.length > 0 ? shown : [],
      ];
    }

    case "permissionDenied": {
      return [
        { ...rest, notice: { kind: "permissionDenied", stillDenied: false } },
        shown,
      ];
    }

    case "needsChoice": {
      return entry.via === "chosen"
        ? [{ ...rest, notice: { kind: "sourceVanished" } }, shown]
        : unchanged(rest);
    }

    default: {
      return unchanged(rest);
    }
  }
};

/**
 * Once the last window has landed, a save chosen at quit goes ahead. If the draft can still not
 * be saved, say because that window could not be captured, the panel says why and the app stays.
 */
const saveIfLanded = ([state, effects]: Transition): Transition => {
  const { activity } = state;

  if (activity.kind !== "savingWhenLanded" || state.background.length > 0) {
    return [state, effects];
  }

  const check = saveability(state.draft.views.length, state.draft.text);

  if (check.kind === "ok") {
    const [saving, publish] = startSave(state, activity.exit);

    return [saving, [...effects, ...publish]];
  }

  return [
    {
      ...state,
      activity: activity.resumeTo,
      notice: state.notice ?? { kind: check.reason },
    },
    [{ anchor: { kind: "keep" }, type: "showPopover" }],
  ];
};

const onCaptureFinished = (
  state: SessionState,
  event: EventOf<"captureFinished">
): Transition => {
  const { activity } = state;
  const behind = state.background.find((item) => item.token === event.token);

  if (behind !== undefined) {
    return saveIfLanded(onBackgroundFinished(state, behind, event.outcome));
  }

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

  // A window still being captured is unsaved work too. Quitting again while a save waits for one
  // asks again, so Discard can still end a capture that never lands.
  const parked = withCaptureParked(state);

  if (!isMeaningful(parked.draft) && parked.background.length === 0) {
    return [state, [exitApp(exit)]];
  }

  const resumeTo =
    activity.kind === "saveFailed" ? activity : ({ kind: "idle" } as const);

  return [
    { ...parked, activity: { exit, kind: "confirmingQuit", resumeTo } },
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

    // A window still landing counts as one: the save waits for it rather than leave it out.
    case "save": {
      const landing = state.background.length;

      const check = saveability(
        state.draft.views.length + landing,
        state.draft.text
      );

      if (check.kind !== "ok") {
        return [
          { ...resumed, notice: { kind: check.reason } },
          [{ anchor: { kind: "keep" }, type: "showPopover" }],
        ];
      }

      return landing > 0
        ? [
            {
              ...state,
              activity: {
                exit: activity.exit,
                kind: "savingWhenLanded",
                resumeTo: activity.resumeTo,
              },
              notice: null,
            },
            [],
          ]
        : startSave(resumed, activity.exit);
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

  if (state.background.some((item) => item.token === event.token)) {
    return [
      {
        ...state,
        background: state.background.map((item) =>
          item.token === event.token ? { ...item, pending: event.source } : item
        ),
      },
      [],
    ];
  }

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

/**
 * Add Windows opens at once, also while a window is still being captured: that capture carries on
 * behind the list and lands in the draft when it is done, so neither key press is lost.
 */
const onChooserRequested = (state: SessionState, ids: IdSource): Transition => {
  const { activity } = state;

  if (!canEditDraft(activity) && activity.kind !== "capturing") {
    return unchanged(state);
  }

  const token = ids.token();

  return [
    {
      ...withCaptureParked(state),
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

  const viewDescriptions = removeViewDescription(
    state.draft.text.viewDescriptions,
    event.viewId
  );

  return [
    {
      ...state,
      draft: {
        ...state.draft,
        views,
        text: { ...state.draft.text, viewDescriptions },
      },
    },
    [],
  ];
};

const onTextChanged = (
  state: SessionState,
  event: EventOf<"textChanged">
): Transition => {
  // While a quit save waits for a window, edits still count: the save has not been sent yet.
  if (state.activity.kind === "saving") {
    return unchanged(state);
  }

  const next = withText(state, event.text);

  return state.notice?.kind === "needsRelationship" &&
    !isBlank(event.text.relationship)
    ? [{ ...next, notice: null }, []]
    : [next, []];
};

/** A window still landing would be lost to a save, so Save waits for it; the panel says so. */
const onSaveRequested = (
  state: SessionState,
  event: EventOf<"saveRequested">
): Transition => {
  if (!isResumable(state.activity) || state.background.length > 0) {
    return unchanged(state);
  }

  const next = withText(state, event.text);
  const check = saveability(next.draft.views.length, event.text);

  return check.kind === "ok"
    ? startSave(next, "stay")
    : [{ ...next, notice: { kind: check.reason } }, []];
};

/** Discard while a quit save waits for a window ends the quit there, without saving. */
const onDiscard = (state: SessionState, ids: IdSource): Transition => {
  const { activity } = state;

  if (activity.kind === "savingWhenLanded") {
    return restart(ids, exitApp(activity.exit));
  }

  return canEditDraft(activity)
    ? restart(ids, { type: "hidePopover" })
    : unchanged(state);
};

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
