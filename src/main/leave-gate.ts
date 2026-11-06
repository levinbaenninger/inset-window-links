import type { LeaveAnswer, LeaveReason } from "../shared/leave";

/** Listening for one event, as Electron's emitters do. */
type On<E extends string> = (event: E, listener: () => void) => void;

/** The part of a WebContents the gate needs. */
export interface LeavePage {
  on: On<"did-navigate"> & On<"render-process-gone"> & On<"destroyed">;
  isDestroyed: () => boolean;
}

interface Pending {
  reason: LeaveReason;
  promise: Promise<"go" | "stay">;
  resolve: (answer: "go" | "stay") => void;
}

export interface LeaveGateActions<P> {
  /** Asks the page to let go; it answers through `answer`. */
  ask: (page: P, reason: LeaveReason) => void;
  /** The page shows its prompt: bring its window forward. */
  show: (page: P) => void;
}

/**
 * Holds a page's close, and the app's quit, while the page holds words that are not saved. The
 * page reports when it has any; a close or quit then asks it, and waits for its last word. A
 * page that is gone, or has loaded afresh, holds nothing any more, so a wait on it ends as `go`.
 */
export class LeaveGate<P extends LeavePage> {
  readonly #actions: LeaveGateActions<P>;
  readonly #unsaved = new WeakSet<P>();
  readonly #pending = new WeakMap<P, Pending>();
  readonly #watched = new WeakSet<P>();

  constructor(actions: LeaveGateActions<P>) {
    this.#actions = actions;
  }

  /** The page's own report. */
  report(page: P, unsaved: boolean): void {
    if (page.isDestroyed()) {
      return;
    }

    this.#watch(page);

    if (unsaved) {
      this.#unsaved.add(page);
    } else {
      this.#unsaved.delete(page);
    }
  }

  /**
   * Whether the page may go now. A clean page goes at once. Otherwise the page is asked, and a
   * second request while it is asked shares the one answer; a quit then tells the page so.
   */
  request(page: P | null, reason: LeaveReason): Promise<"go" | "stay"> {
    if (page === null || page.isDestroyed() || !this.#unsaved.has(page)) {
      return Promise.resolve("go");
    }

    const pending = this.#pending.get(page);

    if (pending !== undefined) {
      if (reason === "quit" && pending.reason === "close") {
        pending.reason = "quit";
        this.#actions.ask(page, "quit");
      }

      return pending.promise;
    }

    const { promise, resolve } = Promise.withResolvers<"go" | "stay">();

    this.#pending.set(page, { promise, reason, resolve });
    this.#actions.ask(page, reason);

    return promise;
  }

  /**
   * A window's close event: true when the close must be prevented now. The page is asked, and
   * `close` runs again once it lets go, which then passes.
   */
  holdClose(page: P, close: () => void): boolean {
    if (page.isDestroyed() || !this.#unsaved.has(page)) {
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

    if (answer === "held") {
      this.#actions.show(page);

      return;
    }

    this.#settle(page, answer);
  }

  #settle(page: P, answer: "go" | "stay"): void {
    if (answer === "go") {
      this.#unsaved.delete(page);
    }

    const pending = this.#pending.get(page);

    this.#pending.delete(page);
    pending?.resolve(answer);
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
