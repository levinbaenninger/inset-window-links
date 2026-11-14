import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { MutationOutcome } from "../../shared/dto";
import { DraftIdSchema, ViewIdSchema } from "../../shared/ids";
import type { StoreFs } from "../store/fs";
import { nodeStoreFs } from "../store/fs";
import type { NewCapture } from "../store/store";
import { CaptureStore } from "../store/store";
import { removeExampleCaptures } from "./remove-examples";

const SAVED = "11111111-1111-4111-8111-111111111111";
const STUCK = "22222222-2222-4222-8222-222222222222";
const GONE = "33333333-3333-4333-8333-333333333333";

/** A store holding SAVED and STUCK, whose delete of STUCK fails, and that never had GONE. */
const fakeStore = () => {
  const held = new Set([SAVED, STUCK]);

  return {
    get: (id: string) => (held.has(id) ? { kind: "current" } : undefined),
    remove: async (id: string): Promise<MutationOutcome> => {
      if (id === STUCK) {
        return await Promise.resolve({ kind: "failed", message: "EPERM" });
      }

      return await Promise.resolve({
        kind: held.delete(id) ? "ok" : "missing",
      });
    },
  };
};

const EXAMPLE = DraftIdSchema.parse("44444444-4444-4444-8444-444444444444");

const exampleCapture = (): NewCapture => {
  const view = ViewIdSchema.parse("0a000000-0000-4000-8000-000000000001");

  return {
    images: new Map([[view, new Uint8Array([0x89, 0x50, 0x4e, 0x47])]]),
    record: {
      createdAt: "2026-11-14T09:00:00.000Z",
      description: "",
      due: null,
      id: EXAMPLE,
      relationship: "Try me: an example capture",
      schemaVersion: 5,
      status: { kind: "active" },
      todos: [],
      updatedAt: "2026-11-14T09:00:00.000Z",
      views: [
        {
          acquisition: {
            kind: "fallback",
            reason: "probeUnavailable",
            windowKeyAtCapture: null,
          },
          appName: null,
          capturedAt: "2026-11-14T09:00:00.000Z",
          description: "",
          height: 750,
          id: view,
          origin: null,
          sampledAt: "2026-11-14T09:00:00.000Z",
          title: "A window",
          width: 1200,
        },
      ],
    },
  };
};

/** The real store on a temp folder, whose renames fail while `refuse` is set: a read-only disk. */
const storeOnDisk = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "inset-examples-"));
  const disk = { refuse: false };

  const fs: StoreFs = {
    ...nodeStoreFs,
    rename: async (from, to) => {
      if (disk.refuse) {
        throw Object.assign(new Error("EROFS: read-only file system"), {
          code: "EROFS",
        });
      }

      await nodeStoreFs.rename(from, to);
    },
  };

  const store = await CaptureStore.open(root, fs);

  await store.publish(exampleCapture());

  return { disk, root, store };
};

describe(removeExampleCaptures, () => {
  it("reports only the examples that are gone afterwards, so one that failed stays an example", async () => {
    await expect(
      removeExampleCaptures(fakeStore(), [SAVED, STUCK, GONE, "not-an-id"])
    ).resolves.toStrictEqual([SAVED, GONE]);
  });

  it("reports an example only once its delete holds on disk, and none when the disk refuses it", async () => {
    const refused = await storeOnDisk();

    refused.disk.refuse = true;

    const kept = await removeExampleCaptures(refused.store, [EXAMPLE]);
    const reopened = await CaptureStore.open(refused.root, nodeStoreFs);

    const deleted = await storeOnDisk();
    const gone = await removeExampleCaptures(deleted.store, [EXAMPLE]);
    const after = await CaptureStore.open(deleted.root, nodeStoreFs);

    expect({
      gone,
      goneOnDisk: after.get(EXAMPLE),
      kept,
      keptOnDisk: reopened.get(EXAMPLE)?.kind,
    }).toStrictEqual({
      gone: [EXAMPLE],
      goneOnDisk: undefined,
      kept: [],
      keptOnDisk: "current",
    });
  });
});
