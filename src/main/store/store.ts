import path from "node:path";

import type { MutationOutcome } from "../../shared/dto";
import type { CaptureId, ViewId } from "../../shared/ids";
import { DraftIdSchema } from "../../shared/ids";
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
  | { kind: "failed"; message: string };

export type StoreEntry =
  | { kind: "current"; record: CaptureRecord }
  | { kind: "unsupported"; id: string; version: number }
  | { kind: "unreadable"; id: string };

const RECORD_FILE = "record.json";
const VIEWS_DIR = "views";
const STAGING_DIR = ".staging";
const TRASH_DIR = ".trash";

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

    const result = (async () => {
      await previous;

      return run();
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
        await this.#fs.rename(staging, path.join(this.#root, id));
      } catch (error) {
        await Promise.allSettled([this.#fs.rmrf(staging)]);

        return { kind: "failed", message: String(error) };
      }

      this.#index.set(id, { kind: "current", record: capture.record });
      this.#changed();

      return { kind: "published" };
    });
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
   * Rewrites a current record; anything else is reported, never written. A record read as
   * version 1 was upgraded on read, so it is written as the current version.
   */
  #rewrite(
    id: CaptureId,
    change: (record: CaptureRecord) => CaptureRecord | null
  ): Promise<MutationOutcome> {
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

      const record = change(entry.record);

      if (record === null) {
        return { kind: "missing" };
      }

      const target = path.join(this.#root, id, RECORD_FILE);

      try {
        await this.#fs.writeFileDurable(
          `${target}.tmp`,
          JSON.stringify(record, null, 2)
        );
        await this.#fs.rename(`${target}.tmp`, target);
      } catch (error) {
        return { kind: "failed", message: String(error) };
      }

      this.#index.set(id, { kind: "current", record });
      this.#changed();

      return { kind: "ok" };
    });
  }

  updateText(
    id: CaptureId,
    text: DraftText,
    now: Date
  ): Promise<MutationOutcome> {
    return this.#rewrite(id, (record) => ({
      ...record,
      relationship: text.relationship,
      todos: keptTodos(text.todos),
      updatedAt: now.toISOString(),
    }));
  }

  /** Checks a to-do off or on. Not an edit of the text, so updatedAt stays. */
  setTodoDone(
    id: CaptureId,
    todoId: string,
    done: boolean
  ): Promise<MutationOutcome> {
    return this.#rewrite(id, (record) =>
      record.todos.some((todo) => todo.id === todoId)
        ? {
            ...record,
            todos: record.todos.map((todo) =>
              todo.id === todoId ? { ...todo, done } : todo
            ),
          }
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
        return { kind: "failed", message: String(error) };
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

  onChange(listener: () => void): () => void {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  }
}
