import type { MutationOutcome } from "../../../shared/dto";
import type { DueDate } from "../../../shared/due";
import { saveProblem } from "../../../shared/errors";
import type { CaptureId, ViewId } from "../../../shared/ids";
import { SAVE_LATE, SETTLE_MS } from "../../../shared/leave";
import type { DraftText, Todo, ViewDescriptions } from "../../../shared/text";
import { isBlank, keptTodos, keptViewDescriptions } from "../../../shared/text";

export const SAVE_AFTER_MS = 600;

/** A saved capture's fields that a draft edits, as the list and the capture's page both get them. */
interface Editable {
  description: string;
  due: DueDate | null;
  relationship: string;
  todos: readonly Todo[];
  views: readonly { id: ViewId; description: string }[];
}

/** A saved capture's fields as a draft holds them: what it shows when nothing is unsaved. */
export const storedText = (capture: Editable): DraftText => ({
  description: capture.description,
  due: capture.due,
  relationship: capture.relationship,
  todos: [...capture.todos],
  // SAFETY: the keys are the views' own ids.
  viewDescriptions: Object.fromEntries(
    capture.views.map((view) => [view.id, view.description])
  ) as ViewDescriptions,
});

/** Main's side of a draft: its saves, each numbered by the draft's rev, and Discard. */
export interface TextStore {
  updateText: (
    id: CaptureId,
    text: DraftText,
    rev: number
  ) => Promise<MutationOutcome>;
  setTodoDone: (
    id: CaptureId,
    todoId: string,
    done: boolean,
    rev: number
  ) => Promise<MutationOutcome>;
  /** Answers failed when main couldn't put the saved version back. */
  discard: (id: CaptureId, rev: number | null) => Promise<MutationOutcome>;
}

/** Anything main answers to a save but ok. */
export type SaveError = Exclude<MutationOutcome, { kind: "ok" }>;

/**
 * What main stores: it trims the text and drops blank next steps. Comparing in this form keeps a
 * trailing space being typed from reading as a change.
 */
export const storedForm = (text: DraftText): DraftText => ({
  description: text.description.trim(),
  due: text.due,
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
  /**
   * The saved baseline, which Discard changes puts back: the stored copy, then each save main
   * confirmed. A save the user discarded never becomes it.
   */
  base: DraftText;
  /**
   * A save of these changes main holds and can still undo, because a Discard of them couldn't put
   * the saved version back: the next Discard asks again, until a save of newer words replaces it.
   */
  landed?: number;
}

/** Words on their way to main. */
interface InFlight {
  rev: number;
  sent: DraftText;
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
      inFlight: InFlight | null;
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
  | { kind: "discard" }
  /** Main couldn't put the saved version back after `draft` was discarded, with save `rev` landed. */
  | { kind: "undiscarded"; draft: Draft; rev: number; error: SaveError };

/**
 * What the store does after a step: send a save; tell main the draft was discarded, and which save
 * of it, if any, main has not answered yet; or answer the copies waiting on revs up to `upTo`.
 */
export type Effect =
  | { kind: "send"; rev: number; call: SaveCall }
  | { kind: "discard"; rev: number | null }
  | { kind: "settle"; upTo: number; outcome: MutationOutcome };

export interface Step {
  draft: Draft | null;
  effects: Effect[];
}

export const DISCARDED: SaveError = {
  kind: "failed",
  message: "The changes were discarded.",
};

/** A save that didn't answer within SETTLE_MS. The words stay, and Retry can be pressed again. */
export const LATE: SaveError = { kind: "failed", message: SAVE_LATE };

/** How a save went, or LATE once SETTLE_MS pass without an answer. */
export const within = async (
  saved: Promise<MutationOutcome>
): Promise<MutationOutcome> => {
  const { promise: late, resolve } = Promise.withResolvers<SaveError>();
  const timer = setTimeout(() => resolve(LATE), SETTLE_MS);

  try {
    return await Promise.race([saved, late]);
  } finally {
    clearTimeout(timer);
  }
};

/** Why words could not be saved, in words: main's sentence, or what became of the capture. */
export const reasonOf = (error: SaveError): string => {
  switch (error.kind) {
    case "missing": {
      return "The capture was deleted.";
    }

    case "readOnly": {
      return "The capture can’t be changed.";
    }

    default: {
      return error.message;
    }
  }
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

/** The words on their way to main, if any. */
const inFlightOf = (draft: Draft): InFlight | null => {
  if (draft.kind === "saving") {
    return { rev: draft.rev, sent: storedForm(draft.values) };
  }

  return draft.kind === "dirty" ? draft.inFlight : null;
};

const edited = (draft: Draft | null, event: DraftEvent & { kind: "edit" }) => {
  const common: Common = {
    base: draft?.base ?? event.base,
    rev: event.rev,
    values: event.values,
  };

  if (draft?.landed !== undefined) {
    common.landed = draft.landed;
  }

  if (draft?.kind === "dirty") {
    return { ...draft, ...common };
  }

  return {
    ...common,
    flushWanted: false,
    inFlight: draft === null ? null : inFlightOf(draft),
    kind: "dirty" as const,
  };
};

const answered = (
  draft: Draft,
  { rev, outcome }: { rev: number; outcome: MutationOutcome }
): Step => {
  const inFlight = inFlightOf(draft);

  if (inFlight?.rev !== rev) {
    return unchanged(draft);
  }

  if (outcome.kind !== "ok" && sameText(draft.values, draft.base)) {
    // Main still holds the words on screen, as when an edit was typed back: nothing is unsaved. Copies
    // of the words that failed are refused; copies of the words on screen get them.
    return {
      draft: null,
      effects: [
        { kind: "settle", outcome, upTo: rev },
        { kind: "settle", outcome: OK, upTo: draft.rev },
      ],
    };
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

    case "undiscarded": {
      // The changes are back as not saved, unless newer ones were typed since: their save replaces them.
      return draft === null
        ? unchanged({
            base: event.draft.base,
            error: event.error,
            kind: "failed",
            landed: event.rev,
            rev: event.draft.rev,
            values: event.draft.values,
          })
        : unchanged(draft);
    }

    default: {
      if (draft === null) {
        return unchanged(draft);
      }

      // Gone at once, a save on its way too: main drops it, or undoes it if it landed already.
      return {
        draft: null,
        effects: [
          { kind: "settle", outcome: DISCARDED, upTo: draft.rev },
          {
            kind: "discard",
            rev: inFlightOf(draft)?.rev ?? draft.landed ?? null,
          },
        ],
      };
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

/** What closing the window would lose now: how many captures' words, and why. */
export interface Unsaved {
  count: number;
  /** Why the first of them that failed could not be saved, if any did. */
  error: SaveError | null;
  /** Some are still on their way, or waiting to be sent: their save didn't finish in time. */
  late: boolean;
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
    return { kind: "failed", message: saveProblem(error) };
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
  /**
   * The words last saved, as typed, shown until the stored copy says otherwise; or, after a
   * discard, the saved baseline it went back to, until the stored copy matches it.
   */
  readonly #confirmed = new Map<CaptureId, DraftText>();
  /** Captures whose #confirmed words are a discard's baseline, which a stale stored copy can't replace. */
  readonly #reverted = new Set<CaptureId>();
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

  /**
   * A fresh stored copy: the words just saved give way to it unless it carries them. A discard's
   * baseline stays until the stored copy matches it, as a save it gave up may have landed and be
   * on its way back out.
   */
  adopt(id: CaptureId, stored: DraftText): void {
    const confirmed = this.#confirmed.get(id);

    if (confirmed === undefined) {
      return;
    }

    if (sameText(confirmed, stored)) {
      this.#reverted.delete(id);
    } else if (!this.#reverted.has(id)) {
      this.#confirmed.delete(id);
      this.#changed();
    }
  }

  /** `base` is what the page showed before this edit: it counts only when there was no draft. */
  edit(id: CaptureId, values: DraftText, base: DraftText): void {
    this.#reverted.delete(id);
    this.#rev += 1;
    this.#apply(id, { base, kind: "edit", rev: this.#rev, values });
    clearTimeout(this.#timers.get(id));
    this.#timers.set(
      id,
      setTimeout(() => this.flush(id), SAVE_AFTER_MS)
    );
  }

  /** Sets or clears the due date, and saves it at once. */
  setDue(id: CaptureId, due: DraftText["due"], base: DraftText): void {
    this.edit(id, { ...this.shown(id, base), due }, base);
    this.flush(id);
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

  /**
   * Sends failed words again; words typed since the failure go at once instead of after the pause.
   * Settles with how that save went, ok at once when there is nothing to save, and LATE once
   * SETTLE_MS pass without an answer.
   */
  retry(id: CaptureId): Promise<MutationOutcome> {
    const saved = this.#whenSaved(id);

    if (this.draft(id)?.kind === "failed") {
      this.#apply(id, { kind: "retry" });
    } else {
      this.flush(id);
    }

    return within(saved);
  }

  /**
   * Gives the changes up: the saved baseline shows again at once, with no error, even while a save
   * of them is still on its way. Main drops that save, or puts the saved version back if it
   * landed; nothing is written, and the save's answer changes nothing here. If main can't put the
   * saved version back, the changes come back as not saved, with why.
   */
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
    this.#reverted.delete(id);
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

        void settle(() => this.#store().updateText(id, text, draft.rev));
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

    const text = storedForm(draft.values);
    // Waiting before the flush, which can find the words saved already and answer at once.
    const saved = this.#whenSaved(id);

    this.flush(id);

    return { kind: "pending", rev: draft.rev, saved, text };
  }

  /** How many captures hold words main does not have. */
  get count(): number {
    return this.#drafts.size;
  }

  /** What closing now would lose, or null when nothing. */
  unsaved(): Unsaved | null {
    const drafts = [...this.#drafts.values()];

    if (drafts.length === 0) {
      return null;
    }

    const failed = drafts.find((draft) => draft.kind === "failed");

    return {
      count: drafts.length,
      error: failed?.kind === "failed" ? failed.error : null,
      late: drafts.some((draft) => draft.kind !== "failed"),
    };
  }

  /**
   * Before the window closes or the app quits: sends every capture's words now, a blank title
   * going back to the saved one, and waits until no save is on its way, but no longer than
   * SETTLE_MS. What is left could not be saved, or not in time, so closing now would lose it. A
   * failed draft is not sent again here; Retry does.
   */
  async settle(): Promise<Unsaved | null> {
    const { promise: late, resolve } = Promise.withResolvers<"late">();
    const timer = setTimeout(() => resolve("late"), SETTLE_MS);

    try {
      return await this.#settleBy(late);
    } finally {
      clearTimeout(timer);
    }
  }

  async #settleBy(late: Promise<"late">): Promise<Unsaved | null> {
    for (const id of this.#drafts.keys()) {
      this.restoreBlankTitle(id);
      this.flush(id);
    }

    if ([...this.#drafts.values()].every(({ kind }) => kind === "failed")) {
      return this.unsaved();
    }

    const change = this.#nextChange();

    if ((await Promise.race([change.promise, late])) === "late") {
      change.stop();

      return this.unsaved();
    }

    return this.#settleBy(late);
  }

  /** Sends every capture's failed words again. */
  retryAll(): void {
    for (const id of this.#drafts.keys()) {
      void this.retry(id);
    }
  }

  /** Gives up every capture's unsaved words, those on their way too. */
  discardAll(): void {
    for (const id of this.#drafts.keys()) {
      this.discard(id);
    }
  }

  #nextChange() {
    const { promise, resolve } = Promise.withResolvers<"changed">();

    const stop = this.subscribe(() => {
      stop();
      resolve("changed");
    });

    return { promise, stop };
  }

  /** Settles once the capture's words as they are now are saved, or can't be. */
  #whenSaved(id: CaptureId): Promise<MutationOutcome> {
    const draft = this.draft(id);

    if (draft === undefined) {
      return Promise.resolve(OK);
    }

    const { promise, resolve } = Promise.withResolvers<MutationOutcome>();

    this.#waiters.set(id, [
      ...(this.#waiters.get(id) ?? []),
      { resolve, rev: draft.rev },
    ]);

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
      // all. Discarded ones give way to the saved baseline.
      if (before === null) {
        this.#confirmed.delete(id);
      } else if (event.kind === "discard") {
        this.#confirmed.set(id, before.base);
        this.#reverted.add(id);
      } else {
        this.#confirmed.set(id, before.values);
      }
    } else {
      this.#drafts.set(id, draft);
    }

    if (draft === null || event.kind === "discard") {
      this.#errors.delete(id);
    } else if (draft.kind === "failed") {
      this.#errors.set(id, draft.error);
    } else if (event.kind === "answered" && event.outcome.kind === "ok") {
      this.#errors.delete(id);
    }

    for (const effect of effects) {
      switch (effect.kind) {
        case "settle": {
          this.#settle(id, effect.upTo, effect.outcome);
          break;
        }

        case "discard": {
          if (!this.#left && before !== null) {
            void this.#discarded(id, effect.rev, before);
          }

          break;
        }

        default: {
          this.#send(id, effect.rev, effect.call);
        }
      }
    }

    this.#changed();
  }

  async #discarded(
    id: CaptureId,
    rev: number | null,
    draft: Draft
  ): Promise<void> {
    const outcome = await settle(() => this.#store().discard(id, rev));

    if (outcome.kind !== "ok" && rev !== null) {
      this.#apply(id, { draft, error: outcome, kind: "undiscarded", rev });
    }
  }

  #send(id: CaptureId, rev: number, call: SaveCall): void {
    if (this.#left) {
      return;
    }

    const store = this.#store();

    const answer = async () => {
      const outcome = await settle(() =>
        call.kind === "text"
          ? store.updateText(id, call.text, rev)
          : store.setTodoDone(id, call.todoId, call.done, rev)
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
