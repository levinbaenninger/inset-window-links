import { mkdir, open, readdir, readFile, rename, rm } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";

/** The filesystem port. Tests wrap the real one to fail on chosen writes. */
export interface StoreFs {
  mkdir: (path: string) => Promise<void>;
  writeFileDurable: (path: string, data: Uint8Array | string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  rmrf: (path: string) => Promise<void>;
  readdir: (path: string) => Promise<readonly string[]>;
  readText: (path: string) => Promise<string>;
}

export const nodeStoreFs: StoreFs = {
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  readText: (path) => readFile(path, "utf-8"),
  readdir: (path) => readdir(path),
  rename: (from, to) => rename(from, to),
  rmrf: (path) => rm(path, { force: true, recursive: true }),
  writeFileDurable: async (path, data) => {
    const handle = await open(path, "w");

    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
};

/** Fails the durable writes `shouldFail` picks. Used by tests and the INSET_E2E fault switch. */
/** Every durable write waits `ms` first, so tests can quit while one is still on its way. */
export const slowWrites = (inner: StoreFs, ms: number): StoreFs => ({
  ...inner,
  writeFileDurable: async (path, data) => {
    await setTimeout(ms);
    await inner.writeFileDurable(path, data);
  },
});

/** A disk that hangs: while held, every durable write waits until `release` lets it finish. */
export const heldWrites = (inner: StoreFs) => {
  let holding = false;
  const waiting: (() => void)[] = [];

  const fs: StoreFs = {
    ...inner,
    writeFileDurable: async (path, data) => {
      if (holding) {
        const { promise, resolve } = Promise.withResolvers<undefined>();

        waiting.push(() => resolve(undefined));
        await promise;
      }

      await inner.writeFileDurable(path, data);
    },
  };

  return {
    fs,
    hold: () => {
      holding = true;
    },
    release: () => {
      holding = false;

      for (const resolve of waiting.splice(0)) {
        resolve();
      }
    },
    /** How many writes wait now. */
    waiting: () => waiting.length,
  };
};

export const failingWrites = (
  inner: StoreFs,
  shouldFail: (path: string) => boolean
): StoreFs => ({
  ...inner,
  writeFileDurable: (path, data) =>
    shouldFail(path)
      ? Promise.reject(
          Object.assign(
            new Error(`Injected write failure: ENOSPC, write '${path}'`),
            { code: "ENOSPC" }
          )
        )
      : inner.writeFileDurable(path, data),
});
