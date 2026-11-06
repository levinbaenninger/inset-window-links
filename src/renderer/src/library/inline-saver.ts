import type { MutationOutcome } from "../../../shared/dto";
import type { CaptureId } from "../../../shared/ids";
import type { DraftText } from "../../../shared/text";
import {
  blankText,
  isBlank,
  keptTodos,
  keptViewDescriptions,
} from "../../../shared/text";

export const SAVE_AFTER_MS = 600;

export interface TextStore {
  updateText: (id: CaptureId, text: DraftText) => Promise<MutationOutcome>;
  setTodoDone: (
    id: CaptureId,
    todoId: string,
    done: boolean
  ) => Promise<MutationOutcome>;
}

/**
 * What main stores: it trims the text and drops blank next steps. Comparing in this form keeps a
 * trailing space being typed from reading as a change that the reload after a save then undoes.
 * The due date is left out: it is saved on its own, with setDue, as soon as it is picked.
 */
const stored = (text: DraftText): DraftText => ({
  description: text.description.trim(),
  due: null,
  relationship: text.relationship.trim(),
  todos: keptTodos(text.todos),
  viewDescriptions: keptViewDescriptions(text.viewDescriptions),
});

const sameText = (a: DraftText, b: DraftText): boolean =>
  JSON.stringify(stored(a)) === JSON.stringify(stored(b));

const withDone = (text: DraftText, todoId: string, done: boolean) => ({
  ...text,
  todos: text.todos.map((todo) =>
    todo.id === todoId ? { ...todo, done } : todo
  ),
});

/** A rejected call, such as a closed IPC channel, reads as a failed save. */
const settle = async (
  call: () => Promise<MutationOutcome>
): Promise<MutationOutcome> => {
  try {
    return await call();
  } catch (error) {
    return { kind: "failed", message: String(error) };
  }
};

export interface InlineState {
  /** Null until the first stored copy is adopted. */
  text: DraftText | null;
  /** What went wrong with the last call to main, or null once one succeeds. */
  outcome: MutationOutcome | null;
}

/**
 * Saves a capture's text as it is edited in place: a while after the last keystroke, or at once
 * on flush. It compares with what it last sent, so a flush with nothing new sends nothing and
 * leaves the capture's edited time alone. Every call to main goes through one promise chain,
 * so a check that follows a text save cannot overtake it.
 */
export class InlineSaver {
  readonly #id: CaptureId;
  readonly #store: TextStore;
  readonly #listeners = new Set<() => void>();
  /** What was last sent, in stored form. */
  #saved: DraftText = blankText;
  /** What main last confirmed, so a failed save is sent again on the next flush. */
  #confirmed: DraftText = blankText;
  #state: InlineState = { outcome: null, text: null };
  #timer: ReturnType<typeof setTimeout> | undefined;
  #chain: Promise<MutationOutcome | null> = Promise.resolve(null);
  #inFlight = 0;
  /** Bumped when the page goes away: calls queued before then are dropped, not sent late. */
  #generation = 0;

  constructor(id: CaptureId, store: TextStore) {
    this.#id = id;
    this.#store = store;
  }

  /** For useSyncExternalStore: the same object until something changes. */
  readonly state = (): InlineState => this.#state;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  };

  get #latest(): DraftText {
    return this.#state.text ?? this.#saved;
  }

  set #latest(text: DraftText) {
    this.#set({ ...this.#state, text });
  }

  edit(text: DraftText): void {
    this.#latest = text;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.flush(), SAVE_AFTER_MS);
  }

  /**
   * Nothing is saved while the title is blank; the capture keeps its last title. When the page
   * is going away, a call queued behind one still in flight would never be sent, so the whole
   * latest text goes straight to main whenever anything is unconfirmed, and the queued calls,
   * all older than it, are dropped.
   */
  flush({ leaving = false }: { leaving?: boolean } = {}): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;

    const text = this.#latest;

    if (this.#state.text === null || isBlank(text.relationship)) {
      return;
    }

    const sent = stored(text);

    if (leaving) {
      const unconfirmed =
        this.#inFlight > 0 || !sameText(text, this.#confirmed);

      this.#generation += 1;

      if (unconfirmed) {
        this.#saved = sent;
        void settle(() => this.#store.updateText(this.#id, sent));
      }

      return;
    }

    if (!sameText(text, this.#saved)) {
      this.#saved = sent;
      this.#enqueue(sent, () => this.#store.updateText(this.#id, sent));
    }
  }

  /**
   * Checks a step off at once. When other text is still unsaved, or the step itself is not
   * saved yet, the whole text goes instead, since it carries the check too.
   */
  toggle(todoId: string, done: boolean): void {
    this.#latest = withDone(this.#latest, todoId, done);

    const savedStep = this.#saved.todos.some((todo) => todo.id === todoId);
    const saved = withDone(this.#saved, todoId, done);

    if (savedStep && sameText(this.#latest, saved)) {
      clearTimeout(this.#timer);
      this.#saved = saved;
      this.#enqueue(saved, () =>
        this.#store.setTodoDone(this.#id, todoId, done)
      );
    } else {
      this.flush();
    }
  }

  /**
   * Takes the stored text: the first copy always, later ones when nothing here is unsaved or on
   * its way, and they differ. A capture can open on the router's cached copy, older than its last
   * save; the fresh copy follows. A copy that arrives while a call is in flight may predate it,
   * so it is left alone.
   */
  adopt(text: DraftText): void {
    const later =
      this.#state.text !== null &&
      (this.#inFlight > 0 ||
        !sameText(this.#latest, this.#saved) ||
        sameText(text, this.#saved));

    if (later) {
      return;
    }

    this.#saved = stored(text);
    this.#confirmed = this.#saved;
    this.#latest = text;
  }

  /** Resolves once every call to main queued so far has answered. */
  async settled(): Promise<void> {
    await this.#chain;
  }

  /** A title left blank goes back to the saved one. */
  restoreBlankTitle(): void {
    if (isBlank(this.#latest.relationship)) {
      this.#latest = {
        ...this.#latest,
        relationship: this.#saved.relationship,
      };
    }
  }

  #set(state: InlineState): void {
    this.#state = state;

    for (const listener of this.#listeners) {
      listener();
    }
  }

  #enqueue(sent: DraftText, call: () => Promise<MutationOutcome>): void {
    const generation = this.#generation;

    this.#inFlight += 1;
    this.#chain = this.#chain.then(async () => {
      if (generation !== this.#generation) {
        this.#inFlight -= 1;

        return null;
      }

      const outcome = await settle(call);

      this.#inFlight -= 1;

      if (outcome.kind === "ok") {
        this.#confirmed = sent;
      } else {
        this.#saved = this.#confirmed;
      }

      this.#set({
        ...this.#state,
        outcome: outcome.kind === "ok" ? null : outcome,
      });

      return outcome;
    });
  }
}

/** A capture's saver while its page is open, and how many mounts of the page hold it. */
interface Held {
  saver: InlineSaver;
  holds: number;
}

/** The saver of each capture open for editing, so a copy from anywhere can wait for its edits. */
const editing = new Map<CaptureId, Held>();

/**
 * The saver for a capture's page: the one it already has, holding whatever is typed and not yet
 * saved, or a new one. The page can mount again, such as on the way to its image viewer, and must
 * not lose that text to the stored copy.
 */
export const saverFor = (id: CaptureId, store: TextStore): InlineSaver =>
  editing.get(id)?.saver ?? new InlineSaver(id, store);

/**
 * Makes `saver` the one savePending waits on for its capture. The returned call lets it go once
 * everything it has sent so far has answered, so a copy made just after the capture was left
 * still waits for its last save and learns whether it failed.
 */
export const trackSaver = (id: CaptureId, saver: InlineSaver): (() => void) => {
  const held = editing.get(id);

  if (held?.saver === saver) {
    held.holds += 1;
  } else {
    editing.set(id, { holds: 1, saver });
  }

  const release = async () => {
    await saver.settled();

    const now = editing.get(id);

    if (now?.saver === saver) {
      now.holds -= 1;

      if (now.holds === 0) {
        editing.delete(id);
      }
    }
  };

  return () => {
    void release();
  };
};

const SAVED: MutationOutcome = { kind: "ok" };

/**
 * Sends whatever is still being typed in a capture and waits until main has it. Anything but ok
 * means main holds older words than the screen shows.
 */
export const savePending = async (id: CaptureId): Promise<MutationOutcome> => {
  const saver = editing.get(id)?.saver;

  if (saver === undefined) {
    return SAVED;
  }

  saver.flush();
  await saver.settled();

  return saver.state().outcome ?? SAVED;
};
