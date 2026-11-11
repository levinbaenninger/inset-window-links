/** While a permission step that updates live is showing: a grant shows green almost at once. */
export const FAST_POLL_MS = 500;

/** Otherwise: often enough that a feature needing the permission starts soon after the grant. */
export const SLOW_POLL_MS = 3000;

export interface Poller {
  /** Checks now, then on every interval while the check says to keep going. */
  readonly start: () => void;
  /** Fast while a step watches the grant; turning it on checks at once, even after the poll had stopped. */
  readonly setFast: (on: boolean) => void;
  readonly stop: () => void;
  readonly running: () => boolean;
}

/**
 * One poll for a permission that can be granted while the app runs. `check`
 * reads it, acts on it, and returns whether to keep polling. There is only
 * ever one timer, whatever the speed: the onboarding step and the feature
 * that waits for the grant share it.
 */
export const createPoller = (deps: {
  readonly check: () => boolean;
  readonly setTimer: (run: () => void, ms: number) => () => void;
  readonly fastMs?: number;
  readonly slowMs?: number;
}): Poller => {
  const fastMs = deps.fastMs ?? FAST_POLL_MS;
  const slowMs = deps.slowMs ?? SLOW_POLL_MS;
  let fast = false;
  let cancel: (() => void) | null = null;

  const clear = (): void => {
    cancel?.();
    cancel = null;
  };

  const run = (): void => {
    clear();

    if (deps.check()) {
      // oxlint-disable-next-line no-use-before-define -- each run schedules the next.
      schedule();
    }
  };

  const schedule = (): void => {
    clear();
    cancel = deps.setTimer(run, fast ? fastMs : slowMs);
  };

  return {
    running: () => cancel !== null,
    setFast: (on) => {
      if (on === fast) {
        return;
      }

      fast = on;

      if (on) {
        run();
      } else if (cancel !== null) {
        schedule();
      }
    },
    start: run,
    stop: clear,
  };
};
