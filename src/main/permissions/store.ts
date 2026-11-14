import { OnboardingRecordSchema } from "./flow";
import type { OnboardingRecord } from "./flow";

export interface OnboardingStore {
  /** The saved record; null without one, or when it can't be read. */
  readonly read: () => Promise<OnboardingRecord | null>;
  readonly write: (saved: OnboardingRecord) => Promise<void>;
}

/** An earlier write that failed doesn't stop the next: its caller heard about it. */
const failedEarlier = (): null => null;

/** Reads and writes text files; the app's own atomic write fits. */
export interface OnboardingFs {
  readonly readFile: (file: string) => Promise<string>;
  readonly writeAtomic: (file: string, data: string) => Promise<void>;
}

/** The flow's state in a file of its own (onboarding.json beside the app's data), apart from the app's settings. */
export const createOnboardingStore = (
  file: string,
  fs: OnboardingFs
): OnboardingStore => {
  // One write at a time, in the order asked: an atomic write ends in a rename, and the last rename wins, newest or not.
  let last: Promise<void> = Promise.resolve();

  return {
    read: async () => {
      try {
        const parsed = OnboardingRecordSchema.safeParse(
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
