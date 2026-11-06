import type { LeaveAnswer, LeaveReason } from "../../../shared/leave";
import type { DraftStore, Unsaved } from "./drafts";

/**
 * Recent Captures being asked to let go, as its window closes or the app quits.
 * - waiting: the saves on their way are being waited for; nothing shows meanwhile.
 * - held: words could not be saved, and the prompt asks what to do with them.
 */
export type LeaveState =
  | { kind: "idle" }
  | { kind: "waiting"; reason: LeaveReason }
  | {
      kind: "held";
      reason: LeaveReason;
      unsaved: Unsaved;
      /** Retry is on its way: the buttons wait for its answer. */
      retrying: boolean;
    };

/** What the page tells main. */
export interface LeaveMain {
  reportUnsaved: (unsaved: boolean) => void;
  answerLeave: (answer: LeaveAnswer) => void;
}

/** Quitting closes the window too, so a quit asked for meanwhile wins. */
const merged = (a: LeaveReason, b: LeaveReason): LeaveReason =>
  a === "quit" || b === "quit" ? "quit" : "close";

/**
 * Holds a close or quit while the page has words that could not be saved. Main asks only while the
 * page reports unsaved words, and lets the window go only on `go`: so the page reports as soon as
 * its drafts empty, which is before it answers `go`.
 */
export class LeaveFlow {
  readonly #drafts: DraftStore;
  readonly #main: () => LeaveMain;
  readonly #listeners = new Set<() => void>();
  #state: LeaveState = { kind: "idle" };

  constructor(drafts: DraftStore, main: () => LeaveMain) {
    this.#drafts = drafts;
    this.#main = main;

    let reported = false;

    drafts.subscribe(() => {
      if (drafts.unsaved !== reported) {
        reported = drafts.unsaved;
        this.#main().reportUnsaved(reported);
      }
    });
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  };

  /** The same object until it changes, for useSyncExternalStore. */
  readonly state = (): LeaveState => this.#state;

  /** Main asks again when a quit meets a close in progress: the one answer covers both. */
  request(reason: LeaveReason): void {
    const state = this.#state;

    if (state.kind === "idle") {
      this.#set({ kind: "waiting", reason });
      void this.#decide();

      return;
    }

    this.#set({ ...state, reason: merged(state.reason, reason) });

    if (state.kind === "held") {
      this.#main().answerLeave("held");
    }
  }

  async retry(): Promise<void> {
    const state = this.#state;

    if (state.kind !== "held" || state.retrying) {
      return;
    }

    this.#set({ ...state, retrying: true });
    this.#drafts.retryAll();

    const unsaved = await this.#drafts.settle();
    const now = this.#state;

    if (now.kind !== "held") {
      return;
    }

    if (unsaved === null) {
      this.#finish("go");
    } else {
      this.#set({ ...now, retrying: false, unsaved });
    }
  }

  discard(): void {
    if (this.#state.kind === "held" && !this.#state.retrying) {
      this.#drafts.discardAll();
      this.#finish("go");
    }
  }

  cancel(): void {
    if (this.#state.kind === "held") {
      this.#finish("stay");
    }
  }

  async #decide(): Promise<void> {
    const unsaved = await this.#drafts.settle();
    const state = this.#state;

    if (state.kind !== "waiting") {
      return;
    }

    if (unsaved === null) {
      this.#finish("go");

      return;
    }

    this.#set({ kind: "held", reason: state.reason, retrying: false, unsaved });
    this.#main().answerLeave("held");
  }

  #finish(answer: "go" | "stay"): void {
    this.#set({ kind: "idle" });
    this.#main().answerLeave(answer);
  }

  #set(state: LeaveState): void {
    this.#state = state;

    for (const listener of this.#listeners) {
      listener();
    }
  }
}
