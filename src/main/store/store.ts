import path from "node:path";

import type { MutationOutcome } from "../../shared/dto";
import { errorCode, saveProblem } from "../../shared/errors";
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

/** Next to a record: a Discard is putting its backup back. A start after a crash finishes that. */
const DISCARD_MARK = ".discard";

/** Next to a capture's folder: the panel withdrew it as it was renamed into place. A start removes it. */
const WITHDRAWN_MARK = ".withdrawn";

/**
 * A record with the page's words and due date in it, as they are saved and as they are copied. A
 * view the text does not name keeps its description.
 */
export const withText = (
  record: CaptureRecord,
  text: DraftText
): CaptureRecord => ({
  ...record,
  description: text.description.trim(),
  due: text.due,
  relationship: text.relationship,
  todos: keptTodos(text.todos),
  views: record.views.map((view) => ({
    ...view,
    description: (text.viewDescriptions[view.id] ?? view.description).trim(),
  })),
});

/** Whether two versions of a record hold the same words and due date, which is all a text save changes. */
const sameWords = (a: CaptureRecord, b: CaptureRecord): boolean =>
  JSON.stringify([
    a.relationship,
    a.description,
    a.due,
    a.todos,
    a.views.map((view) => view.description),
  ]) ===
  JSON.stringify([
    b.relationship,
    b.description,
    b.due,
    b.todos,
    b.views.map((view) => view.description),
  ]);

/**
 * A save of the page's draft: its rev, and the capture's epoch when main received it. Discard
 * bumps the epoch, so a save sent before it is stale.
 */
interface DraftWrite {
  rev: number;
  epoch: number;
}

/**
 * The version the last draft save replaced, kept as `record.json.prev` from the moment the record
 * was moved aside, so a Discard that comes after can put it back with a rename, which a full disk
 * can't fail. A later save of anything else keeps the backup in step, so putting it back never
 * undoes that save.
 */
interface Undo {
  rev: number;
  before: CaptureRecord;
  /** A Discard is putting it back: a newer save waits behind that, and leaves it be. */
  reverting: boolean;
}

/** What a save the page discarded answers: nothing was written, and the page no longer waits for it. */
const GIVEN_UP: MutationOutcome = { kind: "ok" };

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
  /** Each capture's epoch, bumped by every Discard. */
  readonly #epochs = new Map<string, number>();
  readonly #undo = new Map<string, Undo>();
  /** Captures whose publish was given up before it landed. */
  readonly #withdrawn = new Set<string>();
  /** Captures whose folder is being renamed into place. */
  readonly #placing = new Set<string>();
  /** The tombstone of a capture withdrawn while its folder was renamed into place. */
  readonly #tombstones = new Map<string, Promise<void>>();
  /** Each capture whose Discard marker may be on disk: its write, settled once it is. */
  readonly #marks = new Map<string, Promise<void>>();

  private constructor(root: string, fs: StoreFs) {
    this.#root = root;
    this.#fs = fs;
  }

  static async open(root: string, fs: StoreFs): Promise<CaptureStore> {
    const store = new CaptureStore(root, fs);

    await fs.mkdir(root);
    await fs.rmrf(path.join(root, STAGING_DIR));

    const marked = await fs.readdir(root);

    const withdrawn = marked.filter(
      (name) =>
        name.endsWith(WITHDRAWN_MARK) &&
        DraftIdSchema.safeParse(name.slice(0, -WITHDRAWN_MARK.length)).success
    );

    await Promise.all(
      withdrawn.map(async (name) => {
        await fs.rmrf(path.join(root, name.slice(0, -WITHDRAWN_MARK.length)));
        await fs.rmrf(path.join(root, name));
      })
    );

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
      const read = readVersioned(await this.#readRecord(id));

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

  #record(id: string): string {
    return path.join(this.#root, id, RECORD_FILE);
  }

  /**
   * A Discard cut short leaves its marker: the backup goes back first. A save stopped between
   * moving the record aside and renaming the new one in leaves only the backup: it is the record.
   */
  async #readRecord(id: string): Promise<string> {
    const target = this.#record(id);

    if (await this.#present(`${target}${DISCARD_MARK}`)) {
      try {
        await this.#fs.rename(`${target}.prev`, target);
      } catch (error) {
        // Already back: the crash came after the rename, before the marker went.
        if (errorCode(error) !== "ENOENT") {
          throw error;
        }
      }

      await this.#fs.rmrf(`${target}${DISCARD_MARK}`);
    }

    try {
      return await this.#fs.readText(target);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        throw error;
      }

      const text = await this.#fs.readText(`${target}.prev`);

      await this.#fs.rename(`${target}.prev`, target);

      return text;
    }
  }

  async #present(file: string): Promise<boolean> {
    try {
      await this.#fs.readText(file);

      return true;
    } catch (error) {
      if (errorCode(error) !== "ENOENT") {
        throw error;
      }

      return false;
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

        this.#placing.add(id);

        try {
          await this.#fs.rename(staging, path.join(this.#root, id));
        } finally {
          this.#placing.delete(id);
        }
      } catch (error) {
        await Promise.allSettled([this.#fs.rmrf(staging)]);

        return { kind: "failed", message: saveProblem(error) };
      }

      if (this.#withdrawn.delete(id)) {
        await this.#bury(id);

        return { kind: "withdrawn" };
      }

      this.#index.set(id, { kind: "current", record: capture.record });
      this.#changed();

      return { kind: "published" };
    });
  }

  /**
   * Gives up a capture's publish: one still queued or being written never lands. The panel's
   * Discard calls it, so a save it gave up on can't bring the capture back later. One whose folder
   * is being renamed into place gets a tombstone at once, so a crash before it is moved out again
   * can't list it either.
   */
  withdraw(id: string): void {
    this.#withdrawn.add(id);

    if (this.#placing.has(id) && !this.#tombstones.has(id)) {
      this.#tombstones.set(
        id,
        this.#touch(path.join(this.#root, `${id}${WITHDRAWN_MARK}`))
      );
    }
  }

  /** Moves a withdrawn capture's folder out, then its tombstone. If it can't, the next start does. */
  async #bury(id: string): Promise<void> {
    const trash = path.join(this.#root, TRASH_DIR);

    await this.#tombstones.get(id);
    this.#tombstones.delete(id);

    try {
      await this.#fs.mkdir(trash);
      await this.#fs.rename(
        path.join(this.#root, id),
        path.join(trash, `${id}-${crypto.randomUUID()}`)
      );
      await this.#fs.rmrf(path.join(this.#root, `${id}${WITHDRAWN_MARK}`));
    } catch (error) {
      console.error(`Couldn’t remove the withdrawn capture ${id}`, error);
    }

    await Promise.allSettled([this.#fs.rmrf(trash)]);
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

  #epoch(id: string): number {
    return this.#epochs.get(id) ?? 0;
  }

  /**
   * Rewrites a current record; anything else is reported, never written. A record read as an
   * older version was upgraded on read, so it is written as the current version. The new version
   * is written to a temp file and renamed in, so the record is always whole.
   *
   * A draft save first moves the record aside as the backup a Discard puts back. One the page
   * discarded before that is dropped, and one discarded while the record was moved aside puts it
   * back: a stale save is never renamed in. One discarded while its rename in was on its way is
   * undone by the Discard, which marks the capture first.
   */
  #rewrite(
    id: CaptureId,
    change: (record: CaptureRecord) => CaptureRecord | null,
    draft?: DraftWrite
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

      const stale = () =>
        draft !== undefined && draft.epoch !== this.#epoch(id);

      if (stale()) {
        return GIVEN_UP;
      }

      const record = change(entry.record);

      if (record === null) {
        return { kind: "missing" };
      }

      const target = this.#record(id);
      const prev = `${target}.prev`;

      const cleanUp = () =>
        Promise.allSettled([
          this.#fs.rmrf(`${target}.tmp`),
          this.#fs.rmrf(`${prev}.tmp`),
        ]);

      if (record === entry.record) {
        // Words it holds already stay, as when changes a Discard couldn't undo are kept: a marker
        // left by that Discard must not undo them later.
        return draft === undefined ? { kind: "ok" } : this.#unmarked(id);
      }

      const undo = draft === undefined ? this.#undo.get(id) : undefined;

      const backup =
        undo === undefined ? null : (change(undo.before) ?? undo.before);

      try {
        await this.#fs.writeFileDurable(
          `${target}.tmp`,
          JSON.stringify(record, null, 2)
        );

        if (backup !== null) {
          await this.#fs.writeFileDurable(
            `${prev}.tmp`,
            JSON.stringify(backup, null, 2)
          );
        }

        if (stale()) {
          await cleanUp();

          return GIVEN_UP;
        }

        if (draft === undefined) {
          // The backup first: if it can't take this change, the change fails, and a Discard still
          // finds the backup in step with the record.
          if (undo !== undefined && backup !== null) {
            await this.#fs.rename(`${prev}.tmp`, prev);
            undo.before = backup;
          }

          await this.#fs.rename(`${target}.tmp`, target);
        } else {
          await this.#unmark(id);
          await this.#fs.rename(target, prev);

          if (stale()) {
            await cleanUp();
            await this.#putBack(id);

            return GIVEN_UP;
          }

          const mine: Undo = {
            before: entry.record,
            reverting: false,
            rev: draft.rev,
          };

          this.#undo.set(id, mine);
          await this.#moveIn(id, mine);
        }
      } catch (error) {
        await cleanUp();

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

  /** Renames a draft save's temp file in; if that fails, the record moved aside goes back. */
  async #moveIn(id: string, undo: Undo): Promise<void> {
    const target = this.#record(id);

    try {
      await this.#fs.rename(`${target}.tmp`, target);
    } catch (error) {
      if (this.#undo.get(id) === undo) {
        this.#undo.delete(id);
      }

      await Promise.allSettled([this.#fs.rename(`${target}.prev`, target)]);

      throw error;
    }
  }

  /**
   * Puts back a record a discarded save had only moved aside. If it can't, the record stays aside,
   * and the next start reads it from there.
   */
  async #putBack(id: string): Promise<void> {
    const target = this.#record(id);

    const [back] = await Promise.allSettled([
      this.#fs.rename(`${target}.prev`, target),
    ]);

    if (back.status === "rejected") {
      console.error(`Couldn’t put back the record of ${id}`, back.reason);
    }
  }

  /**
   * Writes the Discard marker now, ahead of anything queued, so a crash from here on still comes
   * back to the backup. A full disk can fail it; the rename back still goes ahead.
   */
  #mark(id: string): Promise<void> {
    const marking =
      this.#marks.get(id) ?? this.#touch(`${this.#record(id)}${DISCARD_MARK}`);

    this.#marks.set(id, marking);

    return marking;
  }

  /** Writes an empty marker. A full disk can refuse it: that is logged, and the work goes on. */
  async #touch(file: string): Promise<void> {
    try {
      await this.#fs.writeFileDurable(file, "");
    } catch (error) {
      console.error(`Couldn’t write the marker ${file}`, error);
    }
  }

  /** Takes the Discard marker away, so it can't undo a save that comes after it. */
  async #unmark(id: string): Promise<void> {
    const marking = this.#marks.get(id);

    if (marking === undefined) {
      return;
    }

    await marking;
    await this.#fs.rmrf(`${this.#record(id)}${DISCARD_MARK}`);
    this.#marks.delete(id);
  }

  async #unmarked(id: string): Promise<MutationOutcome> {
    try {
      await this.#unmark(id);

      return { kind: "ok" };
    } catch (error) {
      return { kind: "failed", message: saveProblem(error) };
    }
  }

  /**
   * Puts the backup of draft save `rev` back by a rename, once the marker is down. If the rename
   * fails, the undo and the marker stay: the page shows the changes as not discarded, another
   * Discard tries again, and the next start finishes it.
   */
  async #revert(id: string, rev: number): Promise<MutationOutcome> {
    const undo = this.#undo.get(id);

    if (undo?.rev !== rev) {
      return { kind: "ok" };
    }

    undo.reverting = true;
    await this.#mark(id);

    const target = this.#record(id);

    try {
      await this.#fs.rename(`${target}.prev`, target);
    } catch (error) {
      undo.reverting = false;
      console.error(`Couldn’t put back the saved version of ${id}`, error);

      return {
        kind: "failed",
        message: `Couldn’t discard the changes. ${saveProblem(error)}`,
      };
    }

    this.#undo.delete(id);
    this.#index.set(id, { kind: "current", record: undo.before });
    this.#changed();
    await Promise.allSettled([this.#unmark(id)]);

    return { kind: "ok" };
  }

  /**
   * A page sends a capture's saves one at a time, so a new one means it heard back about the
   * last: that one can no longer be discarded, by this page or by a later one whose revs start
   * over. Only its pagehide save follows one still on its way, and no Discard comes after that.
   */
  #draftWrite(id: CaptureId, rev: number): DraftWrite {
    if (this.#undo.get(id)?.reverting === false) {
      this.#undo.delete(id);
    }

    return { epoch: this.#epoch(id), rev };
  }

  /** Saves the page's words, due date included, as draft save `rev`. */
  updateText(
    id: CaptureId,
    text: DraftText,
    now: Date,
    rev: number
  ): Promise<MutationOutcome> {
    return this.#rewrite(
      id,
      (record) => {
        const next = withText(record, text);

        // Words it holds already are not written again.
        return sameWords(next, record)
          ? record
          : { ...next, updatedAt: now.toISOString() };
      },
      this.#draftWrite(id, rev)
    );
  }

  /** Checks a to-do off or on, as draft save `rev`. Not an edit of the text, so updatedAt stays. */
  setTodoDone(
    id: CaptureId,
    todoId: string,
    done: boolean,
    rev: number
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
      this.#draftWrite(id, rev)
    );
  }

  /**
   * The page gave up its unsaved changes to a capture. Saves of them sent before now are stale:
   * one still on its way is dropped, and `rev`, the one the page had sent but not heard back
   * about, is undone if it landed already, by putting the backup back. Nothing is written but the
   * marker that lets a start after a crash finish the Discard. Answers whether the saved version
   * is back.
   */
  discard(id: CaptureId, rev: number | null): Promise<MutationOutcome> {
    this.#epochs.set(id, this.#epoch(id) + 1);

    if (rev === null) {
      return Promise.resolve({ kind: "ok" });
    }

    const undo = this.#undo.get(id);

    // Landed, or its rename in is on its way: the marker goes down at once, ahead of the queue.
    if (undo?.rev === rev && !undo.reverting) {
      undo.reverting = true;
      void this.#mark(id);
    }

    return this.#serial(() => this.#revert(id, rev));
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
      this.#undo.delete(id);
      this.#marks.delete(id);
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
