import type { CaptureRecord } from "./store/schema";
import type { CaptureStore } from "./store/store";

/** setTimeout fires at once past this many milliseconds, so a longer wait is taken in steps. */
const MAX_DELAY = 2 ** 31 - 1;

export interface Timers<Handle> {
  set: (run: () => void, ms: number) => Handle;
  clear: (handle: Handle) => void;
}

export interface SnoozeClockDeps<Handle> {
  store: Pick<CaptureStore, "list" | "wake" | "onChange">;
  now: () => Date;
  /** Called once per sweep with every capture that sweep put back in the list. */
  notify: (woken: readonly CaptureRecord[]) => void;
  timers: Timers<Handle>;
}

/**
 * Puts snoozed captures back in the list when their time comes. One timer waits for the
 * nearest one; `sweep` also runs at start and after the computer wakes, since timers do not
 * count time asleep. Waking is a compare-and-set in the store, so overlapping sweeps wake and
 * announce each capture once.
 */
export const startSnoozeClock = <Handle>({
  store,
  now,
  notify,
  timers,
}: SnoozeClockDeps<Handle>) => {
  let timer: Handle | null = null;

  const snoozed = () =>
    store
      .list()
      .flatMap((entry) =>
        entry.kind === "current" && entry.record.status.kind === "snoozed"
          ? [{ record: entry.record, until: entry.record.status.until }]
          : []
      );

  /** Waits for the nearest snooze; `onDue` runs when it comes. */
  const arm = (onDue: () => void) => {
    if (timer !== null) {
      timers.clear(timer);
      timer = null;
    }

    const next = Math.min(...snoozed().map(({ until }) => Date.parse(until)));

    if (Number.isFinite(next)) {
      const delay = Math.min(MAX_DELAY, Math.max(0, next - now().getTime()));

      timer = timers.set(() => {
        timer = null;
        onDue();
      }, delay);
    }
  };

  const sweep = async () => {
    const due = snoozed().filter(
      ({ until }) => Date.parse(until) <= now().getTime()
    );

    const outcomes = await Promise.all(
      due.map(({ record, until }) => store.wake(record.id, until))
    );

    const woken = due
      .filter((_, index) => outcomes[index]?.kind === "ok")
      .map(({ record }) => record);

    if (woken.length > 0) {
      notify(woken);
    }

    arm(() => {
      void sweep();
    });
  };

  const unsubscribe = store.onChange(() =>
    arm(() => {
      void sweep();
    })
  );

  return {
    stop: () => {
      unsubscribe();

      if (timer !== null) {
        timers.clear(timer);
      }
    },
    sweep,
  };
};
