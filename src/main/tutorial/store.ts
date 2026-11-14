import { z } from "zod";

/** What the tutorial keeps across restarts, in tutorial.json beside the app's data. */
export const TutorialRecordSchema = z.object({
  /** Checklist tasks done, by id. */
  done: z.array(z.string().max(40)).max(100),
  /** One-time hints seen, by id: they never come back. */
  seen: z.array(z.string().max(40)).max(100),
  /** The example items' ids, while they are on the shelf. */
  examples: z.array(z.string().max(100)).max(20),
  /** The examples were added once; they are never added again, even after they are deleted. */
  examplesSeeded: z.boolean(),
  /** The checklist was closed before every task was done; Getting Started brings it back. */
  checklistClosed: z.boolean(),
  collapsed: z.boolean(),
  /** Every task was done and the checklist said so: it doesn't show by itself again. */
  celebrated: z.boolean(),
  /** Settings › Show tips: one-time hints show at all. */
  tips: z.boolean(),
  version: z.literal(1),
});

export type TutorialRecord = z.output<typeof TutorialRecordSchema>;

export const freshRecord = (): TutorialRecord => ({
  celebrated: false,
  checklistClosed: false,
  collapsed: false,
  done: [],
  examples: [],
  examplesSeeded: false,
  seen: [],
  tips: true,
  version: 1,
});

export interface TutorialStore {
  /** The saved record; null without one, or when it can't be read. */
  readonly read: () => Promise<TutorialRecord | null>;
  readonly write: (saved: TutorialRecord) => Promise<void>;
}

/** An earlier write that failed doesn't stop the next: its caller heard about it. */
const failedEarlier = (): null => null;

/** Reads and writes text files; the app's own atomic write fits. */
export interface TutorialFs {
  readonly readFile: (file: string) => Promise<string>;
  readonly writeAtomic: (file: string, data: string) => Promise<void>;
}

export const createTutorialStore = (
  file: string,
  fs: TutorialFs
): TutorialStore => {
  // One write at a time, in the order asked: an atomic write ends in a rename, and the last rename wins, newest or not.
  let last: Promise<void> = Promise.resolve();

  return {
    read: async () => {
      try {
        const parsed = TutorialRecordSchema.safeParse(
          JSON.parse(await fs.readFile(file))
        );

        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    write: async (saved) => {
      const previous = last;

      const run = (async () => {
        // A failed write is its caller's to hear about; the next one still goes ahead.
        await previous.catch(failedEarlier);
        await fs.writeAtomic(file, `${JSON.stringify(saved, null, 2)}\n`);
      })();

      last = run;
      await run;
    },
  };
};
