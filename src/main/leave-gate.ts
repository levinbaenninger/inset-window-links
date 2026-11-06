import type { LeaveAnswer, LeaveReason } from "../shared/leave";
import { LEAVE_ANSWER_MS, SETTLE_MS } from "../shared/leave";

/** Listening for one event, as Electron's emitters do. */
type On<E extends string> = (event: E, listener: () => void) => void;

/** The part of a WebContents the gate needs. */
export interface LeavePage {
  on: On<"did-navigate"> & On<"render-process-gone"> & On<"destroyed">;
  isDestroyed: () => boolean;
}

/** What the user picks in main's own dialog, shown when the page doesn't answer in time. */
export type LateChoice = "wait" | "go" | "cancel";

/** Main's own dialog, in the order its buttons show; Return picks Wait, Esc picks Cancel. */
export const lateDialog = (
  appName: string,
  reason: LeaveReason,
  count: number
) => {
  const changes =
    count === 1
      ? "1 change that wasn't saved"
      : `${String(count)} changes that weren't saved`;

  return {
    buttons: [
      "Wait",
      reason === "quit" ? "Quit anyway" : "Close anyway",
      "Cancel",
    ],
    cancelId: 2,
    choices: ["wait", "go", "cancel"] as const satisfies readonly LateChoice[],
    defaultId: 0,
    detail: `Recent Captures isn't answering. It last had ${changes}. If you ${reason === "quit" ? "quit" : "close it"} anyway, ${count === 1 ? "it is" : "they are"} lost.`,
    message: `${appName} couldn't confirm your changes were saved`,
  };
};

interface Pending {
  reason: LeaveReason;
  promise: Promise<"go" | "stay">;
  resolve: (answer: "go" | "stay") => void;
  /** Runs out when the page hasn't answered in time. */
  timer: ReturnType<typeof setTimeout> | null;
  /** Closes main's dialog, once the page answers after all. */
  dialog: AbortController | null;
}

/** Nothing more runs out for this request, and main's dialog, if up, closes. */
const disarm = (pending: Pending): void => {
  clearTimeout(pending.timer ?? undefined);
  pending.timer = null;
  pending.dialog?.abort();
  pending.dialog = null;
};

export interface LeaveGateActions<P> {
  /** Asks the page to let go; it answers through `answer`. */
  ask: (page: P, reason: LeaveReason) => void;
  /** The page shows its prompt: bring its window forward. */
  show: (page: P) => void;
  /**
   * The page hasn't answered in time while it last said it held `count` captures' unsaved words:
   * main asks the user itself. Aborting `signal` closes the dialog.
   */
  confirm: (
    page: P,
    reason: LeaveReason,
    count: number,
    signal: AbortSignal
  ) => Promise<LateChoice>;
  /** Main stopped waiting for the page's answer: the page drops the request. */
  cancel: (page: P) => void;
}

/**
 * Holds a page's close, and the app's quit, while the page holds words that are not saved. The
 * page reports how many it holds; a close or quit then asks it, and waits for its last word.
 * A page that is gone, or has loaded afresh, holds nothing any more, so a wait on it ends as
 * `go`. A page that doesn't answer in time is never taken as saved: main asks the user instead.
 */
export class LeaveGate<P extends LeavePage> {
  readonly #actions: LeaveGateActions<P>;
  readonly #unsaved = new WeakMap<P, number>();
  readonly #pending = new WeakMap<P, Pending>();
  readonly #watched = new WeakSet<P>();

  constructor(actions: LeaveGateActions<P>) {
    this.#actions = actions;
  }

  /** The page's own report. */
  report(page: P, count: number): void {
    if (page.isDestroyed()) {
      return;
    }

    this.#watch(page);
    this.#unsaved.set(page, count);
  }

  /**
   * Whether the page may go now. A clean page goes at once. Otherwise the page is asked, and a
   * second request while it is asked shares the one answer; the page is asked again, as a quit
   * when it is one, so a page that stopped answering meanwhile is noticed.
   */
  request(page: P | null, reason: LeaveReason): Promise<"go" | "stay"> {
    if (page === null || page.isDestroyed() || this.#count(page) === 0) {
      return Promise.resolve("go");
    }

    const pending = this.#pending.get(page);

    if (pending !== undefined) {
      pending.reason = reason === "quit" ? "quit" : pending.reason;
      this.#actions.ask(page, pending.reason);

      if (pending.dialog === null) {
        this.#arm(page, pending, LEAVE_ANSWER_MS);
      }

      return pending.promise;
    }

    const { promise, resolve } = Promise.withResolvers<"go" | "stay">();

    const created: Pending = {
      dialog: null,
      promise,
      reason,
      resolve,
      timer: null,
    };

    this.#pending.set(page, created);
    this.#actions.ask(page, reason);
    this.#arm(page, created, LEAVE_ANSWER_MS);

    return promise;
  }

  /**
   * A window's close event: true when the close must be prevented now. The page is asked, and
   * `close` runs again once it lets go, which then passes.
   */
  holdClose(page: P, close: () => void): boolean {
    if (page.isDestroyed() || this.#count(page) === 0) {
      return false;
    }

    void this.#closeOnGo(page, close);

    return true;
  }

  async #closeOnGo(page: P, close: () => void): Promise<void> {
    if ((await this.request(page, "close")) === "go") {
      close();
    }
  }

  answer(page: P, answer: LeaveAnswer): void {
    const pending = this.#pending.get(page);

    if (pending === undefined) {
      return;
    }

    switch (answer) {
      case "waiting": {
        // The page is alive and waits for its saves, which it gives up on after SETTLE_MS.
        if (pending.dialog === null) {
          this.#arm(page, pending, SETTLE_MS + LEAVE_ANSWER_MS);
        }

        return;
      }

      case "held": {
        // Its prompt is up: the user takes as long as they like, and main's dialog gives way.
        disarm(pending);
        this.#actions.show(page);

        return;
      }

      default: {
        this.#settle(page, answer);
      }
    }
  }

  #count(page: P): number {
    return this.#unsaved.get(page) ?? 0;
  }

  #arm(page: P, pending: Pending, ms: number): void {
    clearTimeout(pending.timer ?? undefined);
    pending.timer = setTimeout(() => {
      void this.#late(page, pending);
    }, ms);
  }

  /** The page didn't answer in time. Nothing unsaved goes; else the user decides. */
  async #late(page: P, pending: Pending): Promise<void> {
    pending.timer = null;

    if (this.#pending.get(page) !== pending) {
      return;
    }

    const count = this.#count(page);

    if (count === 0) {
      this.#settle(page, "go");

      return;
    }

    const dialog = new AbortController();

    pending.dialog = dialog;

    const choice = await this.#actions.confirm(
      page,
      pending.reason,
      count,
      dialog.signal
    );

    if (dialog.signal.aborted || this.#pending.get(page) !== pending) {
      return;
    }

    pending.dialog = null;

    switch (choice) {
      case "wait": {
        this.#arm(page, pending, LEAVE_ANSWER_MS);
        break;
      }

      case "go": {
        this.#settle(page, "go");
        break;
      }

      default: {
        this.#actions.cancel(page);
        this.#settle(page, "stay");
      }
    }
  }

  #settle(page: P, answer: "go" | "stay"): void {
    if (answer === "go") {
      this.#unsaved.delete(page);
    }

    const pending = this.#pending.get(page);

    if (pending === undefined) {
      return;
    }

    disarm(pending);
    this.#pending.delete(page);
    pending.resolve(answer);
  }

  #watch(page: P): void {
    if (this.#watched.has(page)) {
      return;
    }

    this.#watched.add(page);

    const gone = () => this.#settle(page, "go");

    page.on("did-navigate", gone);
    page.on("render-process-gone", gone);
    page.on("destroyed", gone);
  }
}
