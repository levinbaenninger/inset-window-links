import type { MutationOutcome } from "../../../shared/dto";
import type { CaptureId } from "../../../shared/ids";
import type { DraftText } from "../../../shared/text";
import { isBlank, keptTodos, keptViewDescriptions } from "../../../shared/text";

export const SAVE_AFTER_MS = 600;

export interface TextStore {
  updateText: (id: CaptureId, text: DraftText) => Promise<MutationOutcome>;
  setTodoDone: (
    id: CaptureId,
    todoId: string,
    done: boolean
  ) => Promise<MutationOutcome>;
}

/** Anything main answers to a save but ok. */
export type SaveError = Exclude<MutationOutcome, { kind: "ok" }>;

/**
 * What main stores: it trims the text and drops blank next steps. Comparing in this form keeps a
 * trailing space being typed from reading as a change. The due date is left out: it is saved on
 * its own, with setDue, as soon as it is picked.
 */
export const storedForm = (text: DraftText): DraftText => ({
  description: text.description.trim(),
  due: null,
  relationship: text.relationship.trim(),
  todos: keptTodos(text.todos),
  viewDescriptions: keptViewDescriptions(text.viewDescriptions),
});

export const sameText = (a: DraftText, b: DraftText): boolean =>
  JSON.stringify(storedForm(a)) === JSON.stringify(storedForm(b));

/** The one call to main that saves a draft. */
export type SaveCall =
  | { kind: "text"; text: DraftText }
  | { kind: "check"; todoId: string; done: boolean };

/**
 * A step checked or unchecked, and nothing else changed: that goes as a check, which leaves the
 * capture's edited time alone. Anything more goes as the whole text.
 */
const callFor = (base: DraftText, values: DraftText): SaveCall => {
  const before = storedForm(base);
  const after = storedForm(values);

  const flipped = after.todos.filter((todo, at) => {
    const old = before.todos[at];

    return old?.id === todo.id && old.done !== todo.done;
  });

  const [only] = flipped;

  if (only !== undefined && flipped.length === 1) {
    const checked = before.todos.map((todo) =>
      todo.id === only.id ? { ...todo, done: only.done } : todo
    );

    if (sameText({ ...before, todos: checked }, after)) {
      return { done: only.done, kind: "check", todoId: only.id };
    }
  }

  return { kind: "text", text: after };
};

interface Common {
  /** Bumped by every edit, across all captures, so an answer to an older draft never matches. */
  rev: number;
  values: DraftText;
  /** What main holds, as far as this page knows: the stored copy, then each save it confirmed. */
  base: DraftText;
}

/**
 * The unsaved words of one capture. A capture without one is clean: main holds what it shows.
 * - dirty: edited since the last send. An older rev may still be on its way.
 * - saving: the latest rev is on its way.
 * - failed: the latest rev could not be saved; it stays until saved or discarded.
 */
export type Draft =
  | (Common & {
      kind: "dirty";
      inFlight: { rev: number; sent: DraftText } | null;
      /** Send the latest as soon as the one in flight answers. */
      flushWanted: boolean;
    })
  | (Common & { kind: "saving" })
  | (Common & { kind: "failed"; error: SaveError });

export type DraftEvent =
  | { kind: "edit"; rev: number; values: DraftText; base: DraftText }
  | { kind: "flush" }
  | { kind: "answered"; rev: number; outcome: MutationOutcome }
  | { kind: "retry" }
  | { kind: "discard" };

/** What the store does after a step: send a save, or answer the copies waiting on revs up to `upTo`. */
export type Effect =
  | { kind: "send"; rev: number; call: SaveCall }
  | { kind: "settle"; upTo: number; outcome: MutationOutcome };

export interface Step {
  draft: Draft | null;
  effects: Effect[];
}

export const DISCARDED: SaveError = {
  kind: "failed",
  message: "The changes were discarded.",
};

const OK: MutationOutcome = { kind: "ok" };

const unchanged = (draft: Draft | null): Step => ({ draft, effects: [] });

/** A blank title is never sent: the capture keeps its last one. Words main already holds are not sent again. */
const sendLatest = ({ base, rev, values }: Common): Step => {
  if (isBlank(values.relationship)) {
    return {
      draft: {
        base,
        flushWanted: false,
        inFlight: null,
        kind: "dirty",
        rev,
        values,
      },
      effects: [],
    };
  }

  if (sameText(values, base)) {
    return {
      draft: null,
      effects: [{ kind: "settle", outcome: OK, upTo: rev }],
    };
  }

  return {
    draft: { base, kind: "saving", rev, values },
    effects: [{ call: callFor(base, values), kind: "send", rev }],
  };
};

const edited = (draft: Draft | null, event: DraftEvent & { kind: "edit" }) => {
  const common = {
    base: draft?.base ?? event.base,
    rev: event.rev,
    values: event.values,
  };

  if (draft?.kind === "dirty") {
    return { ...draft, ...common };
  }

  return {
    ...common,
    flushWanted: false,
    inFlight:
      draft?.kind === "saving"
        ? { rev: draft.rev, sent: storedForm(draft.values) }
        : null,
    kind: "dirty" as const,
  };
};

/** The words on their way to main, if any. */
const inFlightOf = (draft: Draft): { rev: number; sent: DraftText } | null => {
  if (draft.kind === "saving") {
    return { rev: draft.rev, sent: storedForm(draft.values) };
  }

  return draft.kind === "dirty" ? draft.inFlight : null;
};

const answered = (
  draft: Draft,
  { rev, outcome }: { rev: number; outcome: MutationOutcome }
): Step => {
  const inFlight = inFlightOf(draft);

  if (inFlight?.rev !== rev) {
    return unchanged(draft);
  }

  if (outcome.kind !== "ok") {
    // Every copy waiting on this draft is refused: the words it waits for are not on disk.
    return {
      draft: {
        base: draft.base,
        error: outcome,
        kind: "failed",
        rev: draft.rev,
        values: draft.values,
      },
      effects: [{ kind: "settle", outcome, upTo: draft.rev }],
    };
  }

  const saved = { kind: "settle", outcome: OK, upTo: rev } as const;

  if (draft.kind === "saving") {
    return { draft: null, effects: [saved] };
  }

  const confirmed = {
    base: inFlight.sent,
    rev: draft.rev,
    values: draft.values,
  };

  if (draft.kind === "dirty" && draft.flushWanted) {
    const next = sendLatest(confirmed);

    return { draft: next.draft, effects: [saved, ...next.effects] };
  }

  return {
    draft: { ...confirmed, flushWanted: false, inFlight: null, kind: "dirty" },
    effects: [saved],
  };
};

/** One capture's draft, one event: the next draft (null once clean) and what to do about it. */
export const step = (draft: Draft | null, event: DraftEvent): Step => {
  switch (event.kind) {
    case "edit": {
      return unchanged(edited(draft, event));
    }

    case "flush": {
      if (draft?.kind !== "dirty") {
        return unchanged(draft);
      }

      return draft.inFlight === null
        ? sendLatest(draft)
        : unchanged({ ...draft, flushWanted: true });
    }

    case "answered": {
      return draft === null ? unchanged(draft) : answered(draft, event);
    }

    case "retry": {
      return draft?.kind === "failed" ? sendLatest(draft) : unchanged(draft);
    }

    default: {
      // Nothing may be on its way: words already sent could still land after being discarded.
      const discardable =
        draft !== null &&
        (draft.kind === "failed" ||
          (draft.kind === "dirty" && draft.inFlight === null));

      return discardable
        ? {
            draft: null,
            effects: [{ kind: "settle", outcome: DISCARDED, upTo: draft.rev }],
          }
        : unchanged(draft);
    }
  }
};

/** What a copy of a capture copies, taken the moment it starts. */
export type Snapshot =
  /** Main holds what the screen shows: it copies the stored capture. */
  | { kind: "clean" }
  /** Unsaved words that could not be saved: nothing is copied. */
  | { kind: "failed"; error: SaveError }
  /** A blank title is never saved, so the words on screen can't be copied. */
  | { kind: "untitled" }
  /** These words, once main has saved their rev or a later one. */
  | {
      kind: "pending";
      rev: number;
      text: DraftText;
      saved: Promise<MutationOutcome>;
    };

/** What closing the window would lose: how many captures' words, and why the first could not be saved. */
export interface Unsaved {
  count: number;
  error: SaveError;
}

interface Waiter {
  rev: number;
  resolve: (outcome: MutationOutcome) => void;
}

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

/**
 * Every capture's unsaved words, above the views, so leaving a capture or closing its viewer never
 * drops them. A save is sent a while after the last keystroke, or at once on flush, one at a time
 * per capture. A draft goes away only once its latest words are saved, or when it is discarded.
 */
export class DraftStore {
  readonly #store: () => TextStore;
  readonly #drafts = new Map<CaptureId, Draft>();
  /** The words last saved, as typed, shown until the stored copy says otherwise. */
  readonly #confirmed = new Map<CaptureId, DraftText>();
  /** Why a capture's last save failed, kept while its words are unsaved, as more are typed too. */
  readonly #errors = new Map<CaptureId, SaveError>();
  readonly #waiters = new Map<CaptureId, Waiter[]>();
  readonly #timers = new Map<CaptureId, ReturnType<typeof setTimeout>>();
  readonly #listeners = new Set<() => void>();
  #rev = 0;
  /** Set once the page is going away: nothing more is sent after its last save. */
  #left = false;

  /** `store` is read when a save is sent, so the page's bridge need not exist when this is made. */
  constructor(store: () => TextStore) {
    this.#store = store;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  };

  /** The same object until it changes, for useSyncExternalStore. */
  draft(id: CaptureId): Draft | undefined {
    return this.#drafts.get(id);
  }

  /**
   * Why the capture's words could not be saved, from the failure until they are saved or
   * discarded: typing on after a failure keeps it on screen.
   */
  error(id: CaptureId): SaveError | undefined {
    return this.#errors.get(id);
  }

  /** The words last saved as typed, while the stored copy matches them. */
  confirmed(id: CaptureId): DraftText | undefined {
    return this.#confirmed.get(id);
  }

  /** What the capture's page shows: the draft, else the words just saved, else the stored copy. */
  shown(id: CaptureId, stored: DraftText): DraftText {
    return this.draft(id)?.values ?? this.confirmed(id) ?? stored;
  }

  /** A fresh stored copy: the words just saved give way to it unless it carries them. */
  adopt(id: CaptureId, stored: DraftText): void {
    const confirmed = this.#confirmed.get(id);

    if (confirmed !== undefined && !sameText(confirmed, stored)) {
      this.#confirmed.delete(id);
      this.#changed();
    }
  }

  /** `base` is what the page showed before this edit: it counts only when there was no draft. */
  edit(id: CaptureId, values: DraftText, base: DraftText): void {
    this.#rev += 1;
    this.#apply(id, { base, kind: "edit", rev: this.#rev, values });
    clearTimeout(this.#timers.get(id));
    this.#timers.set(
      id,
      setTimeout(() => this.flush(id), SAVE_AFTER_MS)
    );
  }

  /** Checks a step off at once. */
  toggle(id: CaptureId, todoId: string, done: boolean, base: DraftText): void {
    const values = this.shown(id, base);

    this.edit(
      id,
      {
        ...values,
        todos: values.todos.map((todo) =>
          todo.id === todoId ? { ...todo, done } : todo
        ),
      },
      base
    );
    this.flush(id);
  }

  flush(id: CaptureId): void {
    clearTimeout(this.#timers.get(id));
    this.#timers.delete(id);
    this.#apply(id, { kind: "flush" });
  }

  /** Sends failed words again; words typed since the failure go at once instead of after the pause. */
  retry(id: CaptureId): void {
    if (this.draft(id)?.kind === "failed") {
      this.#apply(id, { kind: "retry" });
    } else {
      this.flush(id);
    }
  }

  discard(id: CaptureId): void {
    clearTimeout(this.#timers.get(id));
    this.#timers.delete(id);
    this.#apply(id, { kind: "discard" });
  }

  /** A title left blank goes back to the saved one. */
  restoreBlankTitle(id: CaptureId): void {
    const draft = this.draft(id);

    if (draft !== undefined && isBlank(draft.values.relationship)) {
      this.edit(
        id,
        { ...draft.values, relationship: draft.base.relationship },
        draft.base
      );
    }
  }

  /** The capture was deleted: its words have nowhere to go. */
  forget(id: CaptureId): void {
    clearTimeout(this.#timers.get(id));
    this.#timers.delete(id);
    this.#drafts.delete(id);
    this.#confirmed.delete(id);
    this.#errors.delete(id);
    this.#settle(id, Number.POSITIVE_INFINITY, { kind: "missing" });
    this.#changed();
  }

  /**
   * The page is going away, and a call queued behind one in flight would never be sent. So the
   * latest words of every capture with anything unconfirmed go straight to main, which writes them
   * after whatever it is still writing, and nothing more is sent.
   */
  leave(): void {
    this.#left = true;

    for (const [id, draft] of this.#drafts) {
      clearTimeout(this.#timers.get(id));

      const inFlight =
        draft.kind === "saving" ||
        (draft.kind === "dirty" && draft.inFlight !== null);

      if (
        !isBlank(draft.values.relationship) &&
        (inFlight || !sameText(draft.values, draft.base))
      ) {
        const text = storedForm(draft.values);

        void settle(() => this.#store().updateText(id, text));
      }
    }
  }

  /**
   * Takes what a copy copies, and sends the words it needs saved. A failed draft refuses at once,
   * whether or not its capture is open; so does a blank title, which is never saved.
   */
  snapshot(id: CaptureId): Snapshot {
    const draft = this.draft(id);

    if (draft === undefined) {
      return { kind: "clean" };
    }

    if (draft.kind === "failed") {
      return { error: draft.error, kind: "failed" };
    }

    if (isBlank(draft.values.relationship)) {
      return { kind: "untitled" };
    }

    const { rev } = draft;
    const text = storedForm(draft.values);

    const { promise, resolve } = Promise.withResolvers<MutationOutcome>();

    // Waiting before the flush, which can find the words saved already and answer at once.
    this.#waiters.set(id, [...(this.#waiters.get(id) ?? []), { resolve, rev }]);
    this.flush(id);

    return { kind: "pending", rev, saved: promise, text };
  }

  /** Whether any capture holds words main does not have. */
  get unsaved(): boolean {
    return this.#drafts.size > 0;
  }

  /**
   * Before the window closes or the app quits: sends every capture's words now, a blank title
   * going back to the saved one, and waits until no save is on its way. What is left could not
   * be saved, so closing now would lose it. A failed draft is not sent again here; Retry does.
   */
  async settle(): Promise<Unsaved | null> {
    for (const id of this.#drafts.keys()) {
      this.restoreBlankTitle(id);
      this.flush(id);
    }

    if ([...this.#drafts.values()].some(({ kind }) => kind !== "failed")) {
      await this.#nextChange();

      return this.settle();
    }

    const errors = [...this.#drafts.values()].flatMap((draft) =>
      draft.kind === "failed" ? [draft.error] : []
    );

    const [error] = errors;

    return error === undefined ? null : { count: errors.length, error };
  }

  /** Sends every capture's failed words again. */
  retryAll(): void {
    for (const id of this.#drafts.keys()) {
      this.retry(id);
    }
  }

  /** Gives up every capture's unsaved words, where nothing is on its way. */
  discardAll(): void {
    for (const id of this.#drafts.keys()) {
      this.discard(id);
    }
  }

  #nextChange(): Promise<undefined> {
    const { promise, resolve } = Promise.withResolvers<undefined>();

    const stop = this.subscribe(() => {
      stop();
      resolve(undefined);
    });

    return promise;
  }

  #apply(id: CaptureId, event: DraftEvent): void {
    const before = this.#drafts.get(id) ?? null;
    const { draft, effects } = step(before, event);

    if (draft === before) {
      return;
    }

    if (draft === null) {
      this.#drafts.delete(id);

      // Saved, or main held these words already: they stay on screen as typed, trailing space and
      // all. Discarded ones give way to the stored copy.
      if (before !== null && event.kind !== "discard") {
        this.#confirmed.set(id, before.values);
      } else {
        this.#confirmed.delete(id);
      }
    } else {
      this.#drafts.set(id, draft);
    }

    if (draft === null) {
      this.#errors.delete(id);
    } else if (draft.kind === "failed") {
      this.#errors.set(id, draft.error);
    } else if (event.kind === "answered" && event.outcome.kind === "ok") {
      this.#errors.delete(id);
    }

    for (const effect of effects) {
      if (effect.kind === "settle") {
        this.#settle(id, effect.upTo, effect.outcome);
      } else {
        this.#send(id, effect.rev, effect.call);
      }
    }

    this.#changed();
  }

  #send(id: CaptureId, rev: number, call: SaveCall): void {
    if (this.#left) {
      return;
    }

    const store = this.#store();

    const answer = async () => {
      const outcome = await settle(() =>
        call.kind === "text"
          ? store.updateText(id, call.text)
          : store.setTodoDone(id, call.todoId, call.done)
      );

      this.#apply(id, { kind: "answered", outcome, rev });
    };

    void answer();
  }

  #settle(id: CaptureId, upTo: number, outcome: MutationOutcome): void {
    const waiting = this.#waiters.get(id) ?? [];
    const due = waiting.filter((waiter) => waiter.rev <= upTo);
    const rest = waiting.filter((waiter) => waiter.rev > upTo);

    if (rest.length === 0) {
      this.#waiters.delete(id);
    } else {
      this.#waiters.set(id, rest);
    }

    for (const waiter of due) {
      waiter.resolve(outcome);
    }
  }

  #changed(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }
}
