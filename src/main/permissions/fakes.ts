/**
 * Test doubles for the permission kit: a clock, the macOS permission APIs
 * and System Settings. Only the kit's tests import this file.
 */
import type { PermissionId } from "@shared/onboarding";

import type { PermissionSystem } from "./system";

interface Timer {
  readonly at: number;
  readonly run: () => void;
  cancelled: boolean;
}

export interface FakeClock {
  readonly setTimer: (run: () => void, ms: number) => () => void;
  /** Runs every timer due within `ms`, in order, including ones they set. */
  readonly advance: (ms: number) => void;
  /** Timers set and neither run nor cancelled. */
  readonly pending: () => number;
}

export const fakeClock = (): FakeClock => {
  let now = 0;
  const timers: Timer[] = [];

  const due = (until: number): Timer | undefined =>
    timers
      .filter((timer) => !timer.cancelled && timer.at <= until)
      .toSorted((a, b) => a.at - b.at)[0];

  return {
    advance: (ms) => {
      const until = now + ms;

      for (let timer = due(until); timer !== undefined; timer = due(until)) {
        timer.cancelled = true;
        now = timer.at;
        timer.run();
      }

      now = until;
    },
    pending: () => timers.filter((timer) => !timer.cancelled).length,
    setTimer: (run, ms) => {
      const timer: Timer = { at: now + ms, cancelled: false, run };

      timers.push(timer);

      return () => {
        timer.cancelled = true;
      };
    },
  };
};

export interface FakeMac {
  readonly system: PermissionSystem;
  readonly clock: FakeClock;
  /** What the user has turned on in System Settings. */
  readonly grant: (id: PermissionId) => void;
  /** Every call the kit made, in order: prompts and panes opened. */
  readonly calls: string[];
}

/**
 * macOS as the kit sees it. Screen Recording keeps the answer it had when
 * the app started, as `getMediaAccessStatus` does, until `relaunched`.
 */
export const fakeMac = (
  initial: Partial<Record<PermissionId, boolean>> = {},
  options: { readonly platform?: string; readonly osMajor?: number } = {}
): FakeMac & { readonly relaunched: () => void } => {
  const clock = fakeClock();
  const calls: string[] = [];

  const turnedOn = new Set<PermissionId>(
    (["accessibility", "screen"] as const).filter((id) => initial[id] === true)
  );

  let screenAtLaunch = turnedOn.has("screen");

  return {
    calls,
    clock,
    grant: (id) => {
      turnedOn.add(id);
    },
    relaunched: () => {
      screenAtLaunch = turnedOn.has("screen");
    },
    system: {
      desktopCapturer: {
        getSources: async ({ thumbnailSize, types }) => {
          calls.push(
            `getSources ${types.join(",")} ${thumbnailSize.width}x${thumbnailSize.height}`
          );

          return await Promise.resolve([]);
        },
      },
      osMajor: options.osMajor ?? 26,
      platform: options.platform ?? "darwin",
      setTimer: clock.setTimer,
      shell: {
        openExternal: async (url) => {
          calls.push(`open ${url}`);
          await Promise.resolve();
        },
      },
      systemPreferences: {
        getMediaAccessStatus: () => (screenAtLaunch ? "granted" : "denied"),
        isTrustedAccessibilityClient: (prompt) => {
          if (prompt) {
            calls.push("prompt accessibility");
          }

          return turnedOn.has("accessibility");
        },
      },
    },
  };
};
