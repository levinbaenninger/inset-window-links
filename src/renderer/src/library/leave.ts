import type { LeaveAnswer, LeaveReason } from "../../../shared/leave";
import type { DraftStore, Unsaved } from "./drafts";

/**
 * Recent Captures being asked to let go, as its window closes or the app quits.
 * - waiting: the saves on their way are being waited for, at most SETTLE_MS; nothing shows.
 * - held: words could not be saved, or not in time, and the prompt asks what to do with them.
 */
export type LeaveState =
  | { kind: "idle" }
  | { kind: "waiting"; reason: LeaveReason }
  | {
      kind: "held";
      reason: LeaveReason;
      unsaved: Unsaved;
      /** Retry is on its way: Retry waits for its answer; Cancel and Discard still work. */
      retrying: boolean;
    };

/** What the page tells main. */
export interface LeaveMain {
  reportUnsaved: (count: number) => void;
  answerLeave: (answer: LeaveAnswer) => void;
}

/** Quitting closes the window too, so a quit asked for meanwhile wins. */
const merged = (a: LeaveReason, b: LeaveReason): LeaveReason =>
  a === "quit" || b === "quit" ? "quit" : "close";

const sameUnsaved = (a: Unsaved, b: Unsaved): boolean =>
  a.count === b.count && a.error === b.error && a.late === b.late;

/**
 * Holds a close or quit while the page has words that are not saved. Main asks only while the
 * page reports some, and lets the window go only on `go`. Every wait is bounded by the draft
 * store's settle, so a save that never answers ends in the prompt, never in a silent exit.
 */
export class LeaveFlow {
  readonly #drafts: DraftStore;
  readonly #main: () => LeaveMain;
  readonly #listeners = new Set<() => void>();
  #state: LeaveState = { kind: "idle" };
  /** Bumped by every wait and every final answer: a wait that ends after either changes nothing. */
  #run = 0;
  readonly #reported: () => number;

  constructor(drafts: DraftStore, main: () => LeaveMain) {
    this.#drafts = drafts;
    this.#main = main;

    let reported = drafts.count;

    this.#reported = () => reported;

    drafts.subscribe(() => {
      if (drafts.count !== reported) {
        reported = drafts.count;
        this.#main().reportUnsaved(reported);
      }

      this.#follow();
    });
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  };

  /** The same object until it changes, for useSyncExternalStore. */
  readonly state = (): LeaveState => this.#state;

  /**
   * Tells main the count as the page loads. Main keeps the count a crashed or reloaded page last
   * reported until a fresh page reports its own.
   */
  announce(): void {
    this.#main().reportUnsaved(this.#reported());
  }

  /**
   * Main asks again when a quit meets a close in progress, or when it asks a second time: the one
   * answer covers both, and the page says at once that it heard.
   */
  request(reason: LeaveReason): void {
    const state = this.#state;

    if (state.kind === "idle") {
      this.#set({ kind: "waiting", reason });
      this.#main().answerLeave("waiting");
      void this.#wait();

      return;
    }

    this.#set({ ...state, reason: merged(state.reason, reason) });
    this.#main().answerLeave(state.kind === "held" ? "held" : "waiting");
  }

  retry(): void {
    const state = this.#state;

    if (state.kind !== "held" || state.retrying) {
      return;
    }

    this.#set({ ...state, retrying: true });
    this.#drafts.retryAll();
    void this.#wait();
  }

  /** Gives every capture's words up and lets go, even while a save is still on its way. */
  discard(): void {
    if (this.#state.kind !== "held") {
      return;
    }

    this.#run += 1;
    this.#set({ kind: "idle" });
    this.#drafts.discardAll();
    this.#main().answerLeave("go");
  }

  cancel(): void {
    if (this.#state.kind === "held") {
      this.#finish("stay");
    }
  }

  /** Main stopped waiting for this page's answer: the request is gone, so the prompt is too. */
  dismiss(): void {
    if (this.#state.kind !== "idle") {
      this.#run += 1;
      this.#set({ kind: "idle" });
    }
  }

  async #wait(): Promise<void> {
    this.#run += 1;

    const run = this.#run;
    const unsaved = await this.#drafts.settle();
    const state = this.#state;

    if (run !== this.#run || state.kind === "idle") {
      return;
    }

    if (unsaved === null) {
      this.#finish("go");

      return;
    }

    this.#set({ kind: "held", reason: state.reason, retrying: false, unsaved });

    if (state.kind === "waiting") {
      this.#main().answerLeave("held");
    }
  }

  /**
   * While the prompt shows it follows the drafts: a save that ran late and lands takes its
   * capture off the count, and once nothing is left the close or quit goes ahead.
   */
  #follow(): void {
    const state = this.#state;

    if (state.kind !== "held" || state.retrying) {
      return;
    }

    const unsaved = this.#drafts.unsaved();

    if (unsaved === null) {
      this.#finish("go");
    } else if (!sameUnsaved(unsaved, state.unsaved)) {
      this.#set({ ...state, unsaved });
    }
  }

  #finish(answer: "go" | "stay"): void {
    this.#run += 1;
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
