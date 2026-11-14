export interface SafeRelaunch {
  /**
   * Quits through the app's own quit path and opens the app again once it
   * has really quit. A quit the app holds and the user cancels, or replaces
   * with a plain Quit, never relaunches.
   */
  readonly request: () => void;
  /** The quit was cancelled: nothing is armed any more. */
  readonly disarm: () => void;
  /** A relaunch is armed and its quit is under way. */
  readonly pending: () => boolean;
}

export interface SafeRelaunchDeps {
  /**
   * The app's normal quit, with `atExit` to run at the very end, just
   * before the process exits, and only if the quit goes ahead. A quit path
   * that keeps one pending quit (the latest request wins, Cancel drops it)
   * fits as it is.
   */
  readonly quit: (atExit: () => void) => void;
  /** `app.relaunch()`: opens the app again once this process exits. */
  readonly relaunch: () => void;
  readonly onChange?: (pending: boolean) => void;
}

/**
 * The reopen that Screen Recording needs. The relaunch is armed as a token,
 * and only the exit of the quit that armed it, still armed, relaunches: a
 * cancelled quit disarms it, and a later quit runs its own exit, not this one.
 */
export const createSafeRelaunch = (deps: SafeRelaunchDeps): SafeRelaunch => {
  let armed: symbol | null = null;

  const set = (next: symbol | null): void => {
    const was = armed !== null;

    armed = next;

    if (was !== (next !== null)) {
      deps.onChange?.(next !== null);
    }
  };

  return {
    disarm: () => {
      set(null);
    },
    pending: () => armed !== null,
    request: () => {
      const token = Symbol("relaunch");

      set(token);
      deps.quit(() => {
        if (armed === token) {
          armed = null;
          deps.relaunch();
        }
      });
    },
  };
};
