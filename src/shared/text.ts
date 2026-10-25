import { z } from "zod";

/** Main rejects longer text, so the text fields stop at the same lengths. */
export const MAX_RELATIONSHIP = 10_000;
export const MAX_NEXT_STEP = 2000;

export const DraftTextSchema = z.object({
  nextStep: z.string().max(MAX_NEXT_STEP),
  relationship: z.string().max(MAX_RELATIONSHIP),
});

export type DraftText = z.infer<typeof DraftTextSchema>;

export const blankText: DraftText = { nextStep: "", relationship: "" };

export const isBlank = (value: string): boolean => value.trim() === "";

export type Saveability =
  | { kind: "ok" }
  | { kind: "blocked"; reason: "needsView" | "needsRelationship" };

/** The one save rule, shared by the reducer, the quit dialog, and the popover's Save button. */
export const saveability = (
  viewCount: number,
  text: DraftText
): Saveability => {
  if (viewCount === 0) {
    return { kind: "blocked", reason: "needsView" };
  }

  if (isBlank(text.relationship)) {
    return { kind: "blocked", reason: "needsRelationship" };
  }

  return { kind: "ok" };
};
