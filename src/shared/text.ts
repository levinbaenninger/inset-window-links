import { z } from "zod";

export const DraftTextSchema = z.object({
  nextStep: z.string().max(2000),
  relationship: z.string().max(10_000),
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
