import type { MenuItemConstructorOptions } from "electron";

export type UpdateState =
  | { kind: "off" }
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "available"; version: string }
  | { kind: "downloading"; version: string; percent: number }
  | { kind: "ready"; version: string }
  | { kind: "upToDate" }
  | { kind: "error"; message: string };

/** What electron-updater reports, one event per autoUpdater event. */
export type UpdateEvent =
  | { type: "checking" }
  | { type: "available"; version: string }
  | { type: "notAvailable" }
  | { type: "progress"; percent: number }
  | { type: "downloaded"; version: string }
  | { type: "failed"; message: string };

/**
 * Off never changes. A downloaded update stays ready until the app quits, because it installs then
 * whatever a later check says. Returns the same object when nothing changed, so menus rebuild only
 * on a real change.
 */
export const reduceUpdate = (
  state: UpdateState,
  event: UpdateEvent
): UpdateState => {
  if (state.kind === "off") {
    return state;
  }

  if (state.kind === "ready") {
    return event.type === "downloaded" && event.version !== state.version
      ? { kind: "ready", version: event.version }
      : state;
  }

  switch (event.type) {
    case "checking": {
      return state.kind === "checking" ? state : { kind: "checking" };
    }

    case "available": {
      return { kind: "available", version: event.version };
    }

    case "notAvailable": {
      return { kind: "upToDate" };
    }

    case "progress": {
      if (state.kind !== "available" && state.kind !== "downloading") {
        return state;
      }

      const percent = Math.floor(event.percent);

      return state.kind === "downloading" && state.percent === percent
        ? state
        : { kind: "downloading", percent, version: state.version };
    }

    case "downloaded": {
      return { kind: "ready", version: event.version };
    }

    case "failed": {
      return { kind: "error", message: event.message };
    }

    default: {
      return state;
    }
  }
};

/** A check is worth starting only when none is running and nothing is waiting to install. */
export const canCheck = (state: UpdateState): boolean =>
  state.kind === "idle" || state.kind === "upToDate" || state.kind === "error";

const statusLabel = (state: UpdateState): string | null => {
  switch (state.kind) {
    case "checking": {
      return "Checking for Updates…";
    }

    case "available": {
      return `Downloading v${state.version}…`;
    }

    case "downloading": {
      return `Downloading v${state.version}… ${state.percent}%`;
    }

    case "upToDate": {
      return "Up to Date";
    }

    case "error": {
      return "Update Failed";
    }

    default: {
      return null;
    }
  }
};

export interface UpdateActions {
  check: () => void;
  restart: () => void;
}

/** The update items both the menu-bar icon's menu and the app menu show. */
export const updateMenuItems = (
  state: UpdateState,
  actions: UpdateActions
): MenuItemConstructorOptions[] => {
  const status = statusLabel(state);

  return [
    ...(state.kind === "ready"
      ? [
          {
            click: actions.restart,
            label: `Restart to Update to v${state.version}`,
          },
        ]
      : []),
    ...(status === null ? [] : [{ enabled: false, label: status }]),
    {
      click: actions.check,
      enabled: canCheck(state),
      label: "Check for Updates…",
    },
  ];
};
