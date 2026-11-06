import { z } from "zod";

/** The one part of a thrown Node error the sentences need: its code, such as ENOSPC. */
const CodedErrorSchema = z.object({ code: z.string().min(1) });

const SENTENCES = {
  EACCES: "Inset can't write to its data folder.",
  ENOSPC: "The disk is full.",
  EPERM: "Inset can't write to its data folder.",
  EROFS: "The disk is read-only.",
} satisfies Record<string, string>;

const isNamed = (code: string): code is keyof typeof SENTENCES =>
  Object.hasOwn(SENTENCES, code);

const codeOf = (cause: unknown): string | null => {
  const parsed = CodedErrorSchema.safeParse(cause);

  return parsed.success ? parsed.data.code : null;
};

/**
 * Why a save failed, as a sentence a person can act on: the common disk errors by name, anything
 * else with its code. Every banner, prompt and refused copy shows this, never the raw error.
 */
export const saveProblem = (cause: unknown): string => {
  const code = codeOf(cause);

  if (code === null) {
    return "Couldn't save.";
  }

  return isNamed(code) ? SENTENCES[code] : `Couldn't save (${code}).`;
};

/** Why writing the clipboard, or reading the image for it, failed. */
export const copyProblem = (cause: unknown): string => {
  const code = codeOf(cause);

  return code === null ? "Couldn't copy." : `Couldn't copy (${code}).`;
};

/** Why a save failed, led by "Couldn't save" unless the reason already says so. */
export const couldNotSave = (reason: string): string =>
  reason.startsWith("Couldn't save") ? reason : `Couldn't save. ${reason}`;
