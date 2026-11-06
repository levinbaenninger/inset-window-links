import path from "node:path";

import type { MutationOutcome } from "../../shared/dto";
import type { DueDate } from "../../shared/due";
import { saveProblem } from "../../shared/errors";
import type { CaptureId, ViewId } from "../../shared/ids";
import { DraftIdSchema } from "../../shared/ids";
import type { CaptureStatus } from "../../shared/status";
import { ACTIVE } from "../../shared/status";
import type { DraftText } from "../../shared/text";
import { keptTodos } from "../../shared/text";
import type { StoreFs } from "./fs";
import type { CaptureRecord } from "./schema";
import { readVersioned } from "./schema";

export interface NewCapture {
  record: CaptureRecord;
  images: ReadonlyMap<ViewId, Uint8Array>;
}

export type PublishResult =
  | { kind: "published" }
  | { kind: "alreadyPublished" }
  /** Discarded before it landed: nothing was written. */
  | { kind: "withdrawn" }
  | { kind: "failed"; message: string };

export type StoreEntry =
  | { kind: "current"; record: CaptureRecord }
  | { kind: "unsupported"; id: string; version: number }
  | { kind: "unreadable"; id: string };

/** A capture as a copy takes it, or why one of the changes on screen when it began is not on disk. */
export type Snapshot =
  | { kind: "taken"; entry: StoreEntry | undefined }
  | { kind: "failed"; message: string };

const RECORD_FILE = "record.json";
const VIEWS_DIR = "views";
const STAGING_DIR = ".staging";
const TRASH_DIR = ".trash";

/**
 * A record with the page's words in it, as they are saved and as they are copied. A view the text
 * does not name keeps its description; the due date has its own call.
 */
export const withText = (
  record: CaptureRecord,
  text: DraftText
): CaptureRecord => ({
  ...record,
  description: text.description.trim(),
  relationship: text.relationship,
  todos: keptTodos(text.todos),
  views: record.views.map((view) => ({
    ...view,
    description: (text.viewDescriptions[view.id] ?? view.description).trim(),
  })),
});

/** Whether two versions of a record hold the same words, which is all a text save changes. */
const sameWords = (a: CaptureRecord, b: CaptureRecord): boolean =>
  JSON.stringify([
    a.relationship,
    a.description,
    a.todos,
    a.views.map((view) => view.description),
  ]) ===
  JSON.stringify([
    b.relationship,
    b.description,
    b.todos,
    b.views.map((view) => view.description),
  ]);

const entryId = (entry: StoreEntry): string =>
  entry.kind === "current" ? entry.record.id : entry.id;

const entryTime = (entry: StoreEntry): string =>
  entry.kind === "current" ? entry.record.createdAt : "";

/**
 * <root>/<captureId>/{record.json, views/<viewId>.png}, plus .staging and .trash.
 * A UUID-named directory directly under root is always complete. The single-instance
 * lock makes this the only writer, so the in-memory index is the truth after open().
 */
export class CaptureStore {
  readonly #root: string;
  readonly #fs: StoreFs;
  readonly #index = new Map<string, StoreEntry>();
  readonly #listeners = new Set<() => void>();
  #queue: Promise<unknown> = Promise.resolve();
  #pending = 0;
  /** Each capture's rewrites still queued or on their way. */
  readonly #writes = new Map<string, Set<Promise<MutationOutcome>>>();
  /** How many text saves each capture was sent: a save with a later one behind it gives way. */
  readonly #textSent = new Map<string, number>();
  /** Captures whose publish was given up before it landed. */
  readonly #withdrawn = new Set<string>();

  private constructor(root: string, fs: StoreFs) {
    this.#root = root;
    this.#fs = fs;
  }

  static async open(root: string, fs: StoreFs): Promise<CaptureStore> {
    const store = new CaptureStore(root, fs);

    await fs.mkdir(root);
    await fs.rmrf(path.join(root, STAGING_DIR));
    await fs.rmrf(path.join(root, TRASH_DIR));

    const names = await fs.readdir(root);
    const ids = names.filter((name) => DraftIdSchema.safeParse(name).success);

    const entries = await Promise.all(ids.map((id) => store.#load(id)));

    for (const entry of entries) {
      store.#index.set(entryId(entry), entry);
    }

    return store;
  }

  async #load(id: string): Promise<StoreEntry> {
    try {
      const read = readVersioned(
        await this.#fs.readText(path.join(this.#root, id, RECORD_FILE))
      );

      if (read.kind === "current" && read.record.id === id) {
        return { kind: "current", record: read.record };
      }

      return read.kind === "unsupported"
        ? { id, kind: "unsupported", version: read.version }
        : { id, kind: "unreadable" };
    } catch {
      return { id, kind: "unreadable" };
    }
  }

  #serial<T>(run: () => Promise<T>): Promise<T> {
    const previous = this.#queue;

    this.#pending += 1;

    const result = (async () => {
      try {
        await previous;

        return await run();
      } finally {
        this.#pending -= 1;
      }
    })();

    this.#queue = Promise.allSettled([result]);

    return result;
  }

  #changed(): void {
    for (const listener of this.#listeners) {
      listener();
    }
  }

  publish(capture: NewCapture): Promise<PublishResult> {
    return this.#serial(async () => {
      const { id } = capture.record;

      if (this.#index.has(id)) {
        return { kind: "alreadyPublished" };
      }

      const staging = path.join(
        this.#root,
        STAGING_DIR,
        `${id}-${crypto.randomUUID()}`
      );

      try {
        await this.#fs.mkdir(path.join(staging, VIEWS_DIR));

        await Promise.all(
          capture.record.views.map((view) => {
            const png = capture.images.get(view.id);

            return png === undefined
              ? Promise.reject(new Error(`Missing image for view ${view.id}`))
              : this.#fs.writeFileDurable(
                  path.join(staging, VIEWS_DIR, `${view.id}.png`),
                  png
                );
          })
        );

        await this.#fs.writeFileDurable(
          path.join(staging, RECORD_FILE),
          JSON.stringify(capture.record, null, 2)
        );

        if (this.#withdrawn.delete(id)) {
          await Promise.allSettled([this.#fs.rmrf(staging)]);

          return { kind: "withdrawn" };
        }

        await this.#fs.rename(staging, path.join(this.#root, id));
      } catch (error) {
        await Promise.allSettled([this.#fs.rmrf(staging)]);

        return { kind: "failed", message: saveProblem(error) };
      }

      this.#index.set(id, { kind: "current", record: capture.record });
      this.#changed();

      return { kind: "published" };
    });
  }

  /**
   * Gives up a capture's publish: one still queued or being written never lands. The panel's
   * Discard calls it, so a save it gave up on can't bring the capture back later.
   */
  withdraw(id: string): void {
    this.#withdrawn.add(id);
  }

  /** Newest first. */
  list(): readonly StoreEntry[] {
    return [...this.#index.values()].toSorted(
      (a, b) =>
        entryTime(b).localeCompare(entryTime(a)) ||
        entryId(a).localeCompare(entryId(b))
    );
  }

  get(id: string): StoreEntry | undefined {
    return this.#index.get(id);
  }

  /**
   * Rewrites a current record; anything else is reported, never written. A record read as an
   * older version was upgraded on read, so it is written as the current version. A write that
   * `givesWay` before it lands is not made: a later one takes its place.
   */
  #rewrite(
    id: CaptureId,
    change: (record: CaptureRecord) => CaptureRecord | null,
    givesWay: () => boolean = () => false
  ): Promise<MutationOutcome> {
    const write = this.#serial(async (): Promise<MutationOutcome> => {
      const entry = this.#index.get(id);

      if (entry === undefined) {
        return { kind: "missing" };
      }

      if (entry.kind !== "current") {
        return {
          kind: "readOnly",
          version: entry.kind === "unsupported" ? entry.version : 0,
        };
      }

      const record = change(entry.record);

      if (record === null) {
        return { kind: "missing" };
      }

      if (record === entry.record) {
        return { kind: "ok" };
      }

      const target = path.join(this.#root, id, RECORD_FILE);

      try {
        await this.#fs.writeFileDurable(
          `${target}.tmp`,
          JSON.stringify(record, null, 2)
        );

        if (givesWay()) {
          await Promise.allSettled([this.#fs.rmrf(`${target}.tmp`)]);

          return { kind: "ok" };
        }

        await this.#fs.rename(`${target}.tmp`, target);
      } catch (error) {
        return { kind: "failed", message: saveProblem(error) };
      }

      this.#index.set(id, { kind: "current", record });
      this.#changed();

      return { kind: "ok" };
    });

    const writes = this.#writes.get(id) ?? new Set();

    const settled = () => {
      writes.delete(write);

      if (writes.size === 0 && this.#writes.get(id) === writes) {
        this.#writes.delete(id);
      }
    };

    writes.add(write);
    this.#writes.set(id, writes);
    void write.then(settled, settled);

    return write;
  }

  /**
   * For a text save sent now: whether a later one was sent before it lands. The later one holds
   * the whole text, so the earlier gives way. The page sends them one at a time; only its last
   * save, as it goes away, can follow one still on its way, so discarded words never land after it.
   */
  #laterText(id: CaptureId): () => boolean {
    const sent = this.#textSent.get(id) ?? 0;

    return () => (this.#textSent.get(id) ?? 0) !== sent;
  }

  updateText(
    id: CaptureId,
    text: DraftText,
    now: Date
  ): Promise<MutationOutcome> {
    this.#textSent.set(id, (this.#textSent.get(id) ?? 0) + 1);

    return this.#rewrite(
      id,
      (record) => {
        const next = withText(record, text);

        // Words it holds already are not written again: putting back the saved words, after
        // changes were discarded, then works on a disk that still can't be written.
        return sameWords(next, record)
          ? record
          : { ...next, updatedAt: now.toISOString() };
      },
      this.#laterText(id)
    );
  }

  /**
   * Sets or clears the due date. Apart from the text, so a change from the list's menu is not
   * undone by the open capture's next text save. It is an edit, so updatedAt moves.
   */
  setDue(
    id: CaptureId,
    due: DueDate | null,
    now: Date
  ): Promise<MutationOutcome> {
    return this.#rewrite(id, (record) => ({
      ...record,
      due,
      updatedAt: now.toISOString(),
    }));
  }

  /** Checks a to-do off or on. Not an edit of the text, so updatedAt stays. */
  setTodoDone(
    id: CaptureId,
    todoId: string,
    done: boolean
  ): Promise<MutationOutcome> {
    return this.#rewrite(
      id,
      (record) =>
        record.todos.some((todo) => todo.id === todoId)
          ? {
              ...record,
              todos: record.todos.map((todo) =>
                todo.id === todoId ? { ...todo, done } : todo
              ),
            }
          : null,
      this.#laterText(id)
    );
  }

  /** Moves a capture between the list, snoozed and done. Not an edit of the text, so updatedAt stays. */
  setStatus(id: CaptureId, status: CaptureStatus): Promise<MutationOutcome> {
    return this.#rewrite(id, (record) => ({ ...record, status }));
  }

  /**
   * Puts a snoozed capture back in the list, but only if it is still snoozed until `until`: a
   * capture the user snoozed again, or moved, in the meantime is left as it is.
   */
  wake(id: CaptureId, until: string): Promise<MutationOutcome> {
    return this.#rewrite(id, (record) =>
      record.status.kind === "snoozed" && record.status.until === until
        ? { ...record, status: ACTIVE }
        : null
    );
  }

  /** Moves the record to .trash first, so a half-deleted record is never listed. */
  remove(id: CaptureId): Promise<MutationOutcome> {
    return this.#serial(async () => {
      const entry = this.#index.get(id);

      if (entry === undefined) {
        return { kind: "missing" };
      }

      if (entry.kind !== "current") {
        return {
          kind: "readOnly",
          version: entry.kind === "unsupported" ? entry.version : 0,
        };
      }

      const trash = path.join(this.#root, TRASH_DIR);

      try {
        await this.#fs.mkdir(trash);
        await this.#fs.rename(
          path.join(this.#root, id),
          path.join(trash, `${id}-${crypto.randomUUID()}`)
        );
      } catch (error) {
        return { kind: "failed", message: saveProblem(error) };
      }

      this.#index.delete(id);
      this.#changed();
      await Promise.allSettled([this.#fs.rmrf(trash)]);

      return { kind: "ok" };
    });
  }

  /** PNG path for a view the record lists. Anything else is rejected, so no URL maps to a path. */
  imagePath(id: string, viewId: string): string | null {
    const entry = this.#index.get(id);

    if (
      entry?.kind !== "current" ||
      !entry.record.views.some((view) => view.id === viewId)
    ) {
      return null;
    }

    return path.join(this.#root, id, VIEWS_DIR, `${viewId}.png`);
  }

  /**
   * The capture as it stands once every write queued so far has landed, read in their order. If
   * one of its own writes queued by now fails, such as a due date just picked, what was on screen
   * is not on disk, so it answers why instead.
   */
  snapshot(id: string): Promise<Snapshot> {
    const writes = [...(this.#writes.get(id) ?? [])];

    return this.#serial(async (): Promise<Snapshot> => {
      const outcomes = await Promise.all(writes);
      const failed = outcomes.find((outcome) => outcome.kind === "failed");

      return failed ?? { entry: this.#index.get(id), kind: "taken" };
    });
  }

  /** Whether a write is queued or on its way, so quitting now would cut it off. */
  get busy(): boolean {
    return this.#pending > 0;
  }

  /** Settles once every write queued so far has. */
  async idle(): Promise<void> {
    await this.#queue;
  }

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  }
}
