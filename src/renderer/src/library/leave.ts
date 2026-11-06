import type { OwedDiscard } from "../../../shared/dto";
import type { LeaveAnswer, LeaveReason } from "../../../shared/leave";
import { SETTLE_MS } from "../../../shared/leave";
import type { DraftStore, Unsaved } from "./drafts";

/**
 * Which question the prompt asks:
 * - save: words couldn't be saved (Retry, Discard and close, Cancel);
 * - undiscarded: main answered a Discard with a failure (Keep changes, Discard again, Cancel);
 * - stalled: main hasn't answered a Discard in time (Wait, Close anyway, Cancel). Keep changes and
 *   Discard again would act on words main may be putting back that moment, so they wait for it.
 */
export type PromptKind = "save" | "undiscarded" | "stalled";

export const promptKind = ({ stalled, undiscarded }: Unsaved): PromptKind => {
  if (!undiscarded) {
    return "save";
  }

  return stalled > 0 ? "stalled" : "undiscarded";
};

/**
 * Recent Captures being asked to let go, as its window closes or the app quits.
 * - waiting: the saves on their way are being waited for, at most SETTLE_MS; nothing shows.
 * - held: words could not be saved or discarded, or not in time, and the prompt asks what to do
 *   with them.
 */
export type LeaveState =
  | { kind: "idle" }
  | { kind: "waiting"; reason: LeaveReason }
  | {
      kind: "held";
      reason: LeaveReason;
      unsaved: Unsaved;
      /** Retry, Discard again or Wait is on its way: Retry waits for its answer; Cancel and Discard still work. */
      retrying: boolean;
    };

/**
 * How far the page is in opening. It shows captures only once it knows which Discards main still
 * owes, since a capture main owes one for must open as not discarded.
 * - reading: it is asking main; nothing shows yet.
 * - unread: main couldn't say, or not within SETTLE_MS. No capture shows, so none can be copied
 *   or edited, and the page asks again after OWED_RETRY_MS.
 * - open: it took them in and told main its count.
 */
export type Opening = "reading" | "unread" | "open";

/** How long the page waits before it asks main again which Discards it still owes. */
export const OWED_RETRY_MS = 1000;

/** The Discards main still owes, or null when it couldn't say within SETTLE_MS. */
const owedInTime = async (
  owed: () => Promise<readonly OwedDiscard[]>
): Promise<readonly OwedDiscard[] | null> => {
  const { promise: late, resolve } = Promise.withResolvers<null>();
  const timer = setTimeout(() => resolve(null), SETTLE_MS);

  try {
    return await Promise.race([owed(), late]);
  } catch (error) {
    console.error("Couldn’t hear which Discards main still owes", error);

    return null;
  } finally {
    clearTimeout(timer);
  }
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
  a.count === b.count &&
  a.error === b.error &&
  a.late === b.late &&
  a.undiscarded === b.undiscarded &&
  a.stalled === b.stalled &&
  a.typedSince === b.typedSince;

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
  #opening: Opening = "reading";
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

  /** For useSyncExternalStore, as `state` is. */
  readonly opening = (): Opening => this.#opening;

  /**
   * Tells main the count as the page loads. Main keeps the count a crashed or reloaded page last
   * reported until a fresh page reports its own.
   */
  announce(): void {
    this.#main().reportUnsaved(this.#reported());
  }

  /**
   * As the page loads, before it shows anything: takes in the Discards main still owes, then tells
   * main the count, so the first count it hears holds them. Until main can say, the page doesn't
   * open and reports nothing: treating its captures as clean would let a copy take, or an edit
   * save over, the words a Discard is still owed for. It asks again until main answers.
   */
  async open(owed: () => Promise<readonly OwedDiscard[]>): Promise<void> {
    const listed = await owedInTime(owed);

    if (listed === null) {
      const { promise: again, resolve } = Promise.withResolvers<undefined>();

      this.#setOpening("unread");
      setTimeout(() => resolve(undefined), OWED_RETRY_MS);
      await again;

      return this.open(owed);
    }

    this.#drafts.owe(listed);
    this.announce();
    this.#setOpening("open");
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

  /** Saves every capture's words again, keeping those a Discard couldn't finish with (Keep changes). */
  retry(): void {
    const state = this.#state;

    if (state.kind !== "held" || state.retrying) {
      return;
    }

    this.#set({ ...state, retrying: true });
    this.#drafts.retryAll();
    void this.#wait();
  }

  /**
   * Gives every capture's words up and lets go, even while a save is still on its way. A Discard
   * again of one main couldn't finish holds the close as Retry does, until main has put the saved
   * versions back, and asks again if it can't: letting go first would close on a Discard that may
   * fail again. Discards only still on their way let go at once, as any Discard does, so a write
   * that hangs can't keep the window open; their marker finishes them at the next start.
   */
  discard(): void {
    const state = this.#state;

    if (state.kind !== "held") {
      return;
    }

    if (promptKind(state.unsaved) === "undiscarded") {
      this.#set({ ...state, retrying: true });
      this.#drafts.discardAll();
      void this.#wait();

      return;
    }

    this.#run += 1;
    this.#set({ kind: "idle" });
    this.#drafts.discardAll();
    this.#main().answerLeave("go");
  }

  /** Waits again for the Discards main hasn't answered, as long as any wait, and asks again if they still haven't. */
  wait(): void {
    const state = this.#state;

    if (state.kind !== "held" || state.retrying) {
      return;
    }

    this.#set({ ...state, retrying: true });
    void this.#wait();
  }

  /**
   * Lets go now, without waiting for main to answer the Discards still on their way: main goes on
   * putting the saved versions back, and their markers finish them at the next start. A Discard
   * main answered with a failure stays owed, so Recent Captures shows it again when it opens.
   */
  leaveNow(): void {
    if (this.#state.kind === "held") {
      this.#finish("go");
    }
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
    this.#changed();
  }

  #setOpening(opening: Opening): void {
    if (opening !== this.#opening) {
      this.#opening = opening;
      this.#changed();
    }
  }

  #changed(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}
