import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { OnboardingRecordSchema } from "./permissions/flow";
import type { OnboardingRecord } from "./permissions/flow";
import type { OnboardingStore } from "./permissions/store";
import { TutorialRecordSchema } from "./tutorial/store";
import type { TutorialRecord, TutorialStore } from "./tutorial/store";

const FILE = "app-state.json";

/**
 * Each field falls back on its own, so a damaged onboarding or tutorial record never brings the
 * first run back, and never adds the example capture again.
 */
const AppStateSchema = z.object({
  /** The first run has been handled: the setup and tutorial started, or the install predates them. */
  welcomed: z.boolean().catch(false),
  /** Where the permission setup is (src/main/permissions/); null before it ever ran. */
  onboarding: OnboardingRecordSchema.nullable().catch(null).default(null),
  /** The in-app tutorial's progress (src/main/tutorial/); null before it ever ran. */
  tutorial: TutorialRecordSchema.nullable().catch(null).default(null),
});

export type AppState = z.output<typeof AppStateSchema>;

const firstRun: AppState = {
  onboarding: null,
  tutorial: null,
  welcomed: false,
};

/** Small app facts that are not captures, from their file. Missing or unreadable reads as a first run. */
export const readAppState = (raw: string | null): AppState => {
  if (raw === null) {
    return firstRun;
  }

  try {
    const parsed = AppStateSchema.safeParse(JSON.parse(raw));

    return parsed.success ? parsed.data : firstRun;
  } catch {
    return firstRun;
  }
};

export interface AppStateFs {
  readText: (file: string) => Promise<string>;
  mkdir: (dir: string) => Promise<void>;
  writeText: (file: string, data: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
}

const nodeFs: AppStateFs = {
  mkdir: async (dir) => {
    await mkdir(dir, { recursive: true });
  },
  readText: (file) => readFile(file, "utf-8"),
  rename,
  writeText: (file, data) => writeFile(file, data),
};

export interface AppStateStore {
  current: () => AppState;
  /** Applies a change and writes the whole file; resolves once it is on disk. Writes go one at a time. */
  update: (change: Partial<AppState>) => Promise<void>;
  /** The onboarding record's place in this file, for the permission kit. */
  onboarding: OnboardingStore;
  /** The tutorial record's place in this file, for the tutorial kit. */
  tutorial: TutorialStore;
}

/** app-state.json beside the captures folder: the first-run flag and the onboarding step. */
export const openAppState = async (
  dir: string,
  fs: AppStateFs = nodeFs
): Promise<AppStateStore> => {
  const file = path.join(dir, FILE);
  let state = readAppState(await fs.readText(file).catch((): null => null));

  /** The last write, settled either way: each write waits for the one before it. */
  let queue: Promise<readonly PromiseSettledResult<void>[]> =
    Promise.allSettled([]);

  const write = async (snapshot: AppState) => {
    await fs.mkdir(dir);
    await fs.writeText(`${file}.tmp`, `${JSON.stringify(snapshot, null, 2)}\n`);
    await fs.rename(`${file}.tmp`, file);
  };

  const writeAfter = async (
    before: Promise<unknown>,
    snapshot: AppState
  ): Promise<void> => {
    await before;
    await write(snapshot);
  };

  const update = async (change: Partial<AppState>): Promise<void> => {
    state = { ...state, ...change };

    const turn = writeAfter(queue, state);

    // The next write waits for this one whether or not it lands; whoever asked for it hears if it failed.
    queue = Promise.allSettled([turn]);
    await turn;
  };

  return {
    current: () => state,
    onboarding: {
      read: (): Promise<OnboardingRecord | null> =>
        Promise.resolve(state.onboarding),
      write: (saved) => update({ onboarding: saved }),
    },
    tutorial: {
      read: (): Promise<TutorialRecord | null> =>
        Promise.resolve(state.tutorial),
      write: (saved) => update({ tutorial: saved }),
    },
    update,
  };
};
