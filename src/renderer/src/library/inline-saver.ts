import type { MutationOutcome } from "../../../shared/dto";
import type { CaptureId } from "../../../shared/ids";
import type { DraftText } from "../../../shared/text";
import { blankText, isBlank, keptTodos } from "../../../shared/text";

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
 */
const stored = (text: DraftText): DraftText => ({
  description: text.description.trim(),
  relationship: text.relationship.trim(),
  todos: keptTodos(text.todos),
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
   * is going away, the save goes straight to main: a call queued behind one still in flight would
   * never be sent.
   */
  flush({ leaving = false }: { leaving?: boolean } = {}): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;

    const text = this.#latest;

    if (
      this.#state.text === null ||
      isBlank(text.relationship) ||
      sameText(text, this.#saved)
    ) {
      return;
    }

    const sent = stored(text);

    this.#saved = sent;

    if (leaving) {
      void this.#store.updateText(this.#id, sent);
    } else {
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
    this.#inFlight += 1;
    this.#chain = this.#chain.then(async () => {
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
