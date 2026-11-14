import type { PermissionId } from "@shared/onboarding";

/**
 * The parts of Electron the kit uses, described by their shape, so the kit
 * never imports Electron and its tests pass plain fakes. Electron's own
 * `systemPreferences`, `shell` and `desktopCapturer` fit these as they are.
 */
export interface SystemPreferencesLike {
  readonly isTrustedAccessibilityClient: (prompt: boolean) => boolean;
  readonly getMediaAccessStatus: (mediaType: "screen") => string;
}

export interface ShellLike {
  readonly openExternal: (url: string) => Promise<void>;
}

export interface DesktopCapturerLike {
  readonly getSources: (options: {
    types: ("screen" | "window")[];
    thumbnailSize: { width: number; height: number };
  }) => Promise<readonly object[]>;
}

export interface PermissionSystem {
  /** `process.platform`: every permission is granted off macOS, where none is needed. */
  readonly platform: string;
  /** The macOS major version, from `process.getSystemVersion()`: macOS 27 renamed the Accessibility list. */
  readonly osMajor: number;
  readonly systemPreferences: SystemPreferencesLike;
  readonly shell: ShellLike;
  readonly desktopCapturer: DesktopCapturerLike;
  readonly setTimer: (run: () => void, ms: number) => () => void;
}

/** Each permission's pane in System Settings. Fixed constants: never built from page input. */
export const PANE_URLS: Readonly<Record<PermissionId, string>> = {
  accessibility:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  screen:
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
};

/**
 * Whether the app sees a grant while it runs. Accessibility does; Screen
 * Recording keeps the answer it had at launch, so it takes a reopen.
 */
export const SEEN_LIVE: Readonly<Record<PermissionId, boolean>> = {
  accessibility: true,
  screen: false,
};

export const DEFAULT_TITLES: Readonly<Record<PermissionId, string>> = {
  accessibility: "Accessibility",
  screen: "Screen Recording",
};

const RENAMED_ACCESSIBILITY = 27;

/** The Privacy & Security list each permission is turned on in, as System Settings names it. */
export const listName = (id: PermissionId, osMajor: number): string => {
  if (id === "screen") {
    return "Screen & System Audio Recording";
  }

  return osMajor >= RENAMED_ACCESSIBILITY
    ? "Device Control and Data Access"
    : "Accessibility";
};

/**
 * System Settings opened cold can drop the pane in the link and show the
 * one it showed last, so the link is opened once more after a moment.
 */
export const PANE_RETRY_MS = 1500;

const ignore = (): void => undefined;

export interface PermissionChecks {
  /** Whether the app has it now; Screen Recording as it was at launch. */
  readonly granted: (id: PermissionId) => boolean;
  /** Asks macOS for it: the system's own prompt, which also lists the app in System Settings. */
  readonly prompt: (id: PermissionId) => void;
  /** Opens its pane in System Settings. */
  readonly openPane: (id: PermissionId) => void;
}

export const createPermissionChecks = (
  system: PermissionSystem
): PermissionChecks => {
  const mac = system.platform === "darwin";

  const open = (id: PermissionId): void => {
    system.shell.openExternal(PANE_URLS[id]).catch(ignore);
  };

  return {
    granted: (id) => {
      if (!mac) {
        return true;
      }

      return id === "accessibility"
        ? system.systemPreferences.isTrustedAccessibilityClient(false)
        : system.systemPreferences.getMediaAccessStatus("screen") === "granted";
    },
    openPane: (id) => {
      if (!mac) {
        return;
      }

      open(id);
      system.setTimer(() => {
        open(id);
      }, PANE_RETRY_MS);
    },
    prompt: (id) => {
      if (!mac) {
        return;
      }

      if (id === "accessibility") {
        system.systemPreferences.isTrustedAccessibilityClient(true);

        return;
      }

      // Asking for one tiny picture of a screen is what lists the app under Screen Recording and shows macOS's prompt.
      system.desktopCapturer
        .getSources({
          thumbnailSize: { height: 1, width: 1 },
          types: ["screen"],
        })
        .catch(ignore);
    },
  };
};
