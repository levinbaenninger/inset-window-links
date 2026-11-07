import type { LeaveAnswer, LeaveReason } from "../shared/leave";
import { LEAVE_ANSWER_MS, SETTLE_MS } from "../shared/leave";

/** Listening for one event, as Electron's emitters do. */
type On<E extends string> = (event: E, listener: () => void) => void;

/** The part of a WebContents the gate needs. */
export interface LeavePage {
  on: On<"did-navigate"> & On<"render-process-gone"> & On<"destroyed">;
  isDestroyed: () => boolean;
}

/** What the user picks in main's own dialog, shown when the page can't answer for its changes. */
export type LateChoice = "wait" | "go" | "cancel";

/**
 * Why main asks the user itself: the page is there but didn't answer in time, or it crashed,
 * reloaded or closed, so nothing is left to answer for the changes it last reported.
 */
export type LateWhy = "silent" | "gone";

/** Main's own dialog, in the order its buttons show; Return picks Wait, Esc picks Cancel. */
export const lateDialog = (
  appName: string,
  reason: LeaveReason,
  count: number,
  why: LateWhy = "silent"
) => {
  const changes =
    count === 1
      ? "1 change that wasn’t saved"
      : `${String(count)} changes that weren’t saved`;

  const state =
    why === "gone"
      ? "Recent Captures stopped responding."
      : "Recent Captures isn’t answering.";

  return {
    buttons: [
      "Wait",
      reason === "quit" ? "Quit anyway" : "Close anyway",
      "Cancel",
    ],
    cancelId: 2,
    choices: ["wait", "go", "cancel"] as const satisfies readonly LateChoice[],
    defaultId: 0,
    detail: `${state} It last had ${changes}. If you ${reason === "quit" ? "quit" : "close it"} anyway, ${count === 1 ? "it is" : "they are"} lost.`,
    message: `${appName} couldn’t confirm your changes were saved`,
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
   * The page can't answer for the `count` captures' unsaved words it last reported: it is silent,
   * or gone. Main asks the user itself, over the page's window when there is one. Aborting
   * `signal` closes the dialog.
   */
  confirm: (
    page: P | null,
    reason: LeaveReason,
    count: number,
    why: LateWhy,
    signal: AbortSignal
  ) => Promise<LateChoice>;
  /** Main stopped waiting for the page's answer: the page drops the request. */
  cancel: (page: P) => void;
}

/**
 * Holds the Recent Captures window's close, and the app's quit, while its page holds words that
 * are not saved. The page reports how many it holds; a close or quit then asks it, and waits for
 * its last word. One page at a time: each new window's page takes the slot.
 *
 * The count is the last one a page reported. A page that crashes, reloads or closes can't report
 * again, so its count stays until a freshly loaded page reports its own: losing the page is never
 * taken as having saved. A close or quit while the count is above 0 and no live page can answer
 * asks the user in main's own dialog, as does one the page doesn't answer in time.
 */
export class LeaveGate<P extends LeavePage> {
  readonly #actions: LeaveGateActions<P>;
  #page: P | null = null;
  #count = 0;
  /** Whether the page has reported since it last loaded, so it can answer for its words. */
  #live = false;
  #pending: Pending | null = null;

  constructor(actions: LeaveGateActions<P>) {
    this.#actions = actions;
  }

  /** A new window's page: it answers once it has loaded and reported. */
  attach(page: P): void {
    if (page === this.#page) {
      return;
    }

    this.#page = page;
    this.#live = false;

    const gone = () => this.#gone(page);

    page.on("did-navigate", gone);
    page.on("render-process-gone", gone);
    page.on("destroyed", gone);
  }

  /** The page's own count, sent whenever it changes and once as it loads. */
  report(page: P, count: number): void {
    if (page !== this.#page || page.isDestroyed()) {
      return;
    }

    const fresh = !this.#live;

    this.#live = true;
    this.#count = count;

    const pending = this.#pending;

    if (pending === null || !fresh) {
      return;
    }

    // A page loaded afresh while main waited: it answers for itself now.
    disarm(pending);

    if (count === 0) {
      this.#settle("go");

      return;
    }

    this.#actions.ask(page, pending.reason);
    this.#arm(pending, LEAVE_ANSWER_MS);
  }

  /**
   * Whether the page may go now. A page with nothing unsaved goes at once. Otherwise a live page
   * is asked, and a second request while it is asked shares the one answer; the page is asked
   * again, as a quit when it is one, so a page that stopped answering meanwhile is noticed. With
   * no live page to ask, main's dialog asks at once.
   */
  request(reason: LeaveReason): Promise<"go" | "stay"> {
    if (this.#count === 0) {
      return Promise.resolve("go");
    }

    const page = this.#answering();
    const existing = this.#pending;

    if (existing !== null) {
      existing.reason = reason === "quit" ? "quit" : existing.reason;

      if (page !== null) {
        this.#actions.ask(page, existing.reason);
      }

      if (existing.dialog === null) {
        this.#arm(existing, page === null ? 0 : LEAVE_ANSWER_MS);
      }

      return existing.promise;
    }

    const { promise, resolve } = Promise.withResolvers<"go" | "stay">();

    const created: Pending = {
      dialog: null,
      promise,
      reason,
      resolve,
      timer: null,
    };

    this.#pending = created;

    if (page === null) {
      void this.#late(created);
    } else {
      this.#actions.ask(page, reason);
      this.#arm(created, LEAVE_ANSWER_MS);
    }

    return promise;
  }

  /**
   * The window's close event: true when the close must be prevented now. The page is asked, and
   * `close` runs again once it lets go, which then passes.
   */
  holdClose(page: P, close: () => void): boolean {
    if (page !== this.#page || this.#count === 0) {
      return false;
    }

    void this.#closeOnGo(close);

    return true;
  }

  async #closeOnGo(close: () => void): Promise<void> {
    if ((await this.request("close")) === "go") {
      close();
    }
  }

  answer(page: P, answer: LeaveAnswer): void {
    const pending = this.#pending;

    if (page !== this.#page || pending === null) {
      return;
    }

    switch (answer) {
      case "waiting": {
        // The page is alive and waits for its saves, which it gives up on after SETTLE_MS.
        if (pending.dialog === null) {
          this.#arm(pending, SETTLE_MS + LEAVE_ANSWER_MS);
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
        this.#settle(answer);
      }
    }
  }

  /** The page that can answer now, if any. */
  #answering(): P | null {
    const page = this.#page;

    return page !== null && this.#live && !page.isDestroyed() ? page : null;
  }

  #arm(pending: Pending, ms: number): void {
    clearTimeout(pending.timer ?? undefined);
    pending.timer = setTimeout(() => {
      void this.#late(pending);
    }, ms);
  }

  /** The page crashed, reloaded or closed: what it last reported stays, and nothing answers now. */
  #gone(page: P): void {
    if (page !== this.#page) {
      return;
    }

    this.#live = false;

    const pending = this.#pending;

    if (pending !== null && pending.dialog === null) {
      void this.#late(pending);
    }
  }

  /** The page can't answer for its words. Nothing unsaved goes; else the user decides. */
  async #late(pending: Pending): Promise<void> {
    clearTimeout(pending.timer ?? undefined);
    pending.timer = null;

    if (this.#pending !== pending || pending.dialog !== null) {
      return;
    }

    const count = this.#count;

    if (count === 0) {
      this.#settle("go");

      return;
    }

    const page = this.#answering();
    const dialog = new AbortController();

    pending.dialog = dialog;

    const choice = await this.#actions.confirm(
      this.#page,
      pending.reason,
      count,
      page === null ? "gone" : "silent",
      dialog.signal
    );

    if (dialog.signal.aborted || this.#pending !== pending) {
      return;
    }

    pending.dialog = null;

    switch (choice) {
      case "wait": {
        this.#arm(pending, LEAVE_ANSWER_MS);
        break;
      }

      case "go": {
        this.#settle("go");
        break;
      }

      default: {
        const asked = this.#answering();

        if (asked !== null) {
          this.#actions.cancel(asked);
        }

        this.#settle("stay");
      }
    }
  }

  #settle(answer: "go" | "stay"): void {
    if (answer === "go") {
      this.#count = 0;
    }

    const pending = this.#pending;

    if (pending === null) {
      return;
    }

    disarm(pending);
    this.#pending = null;
    pending.resolve(answer);
  }
}
