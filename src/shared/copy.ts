import { z } from "zod";

import type { MutationOutcome } from "./dto";
import { ViewIdSchema } from "./ids";

/** What a copy of a capture puts on the clipboard. Validated where it arrives in main. */
export const CopyRequestSchema = z.discriminatedUnion("kind", [
  /** ⌘C: the title and description. */
  z.object({ kind: z.literal("entry") }),
  /** Copy as text: every detail. */
  z.object({ kind: z.literal("note") }),
  /** One window's saved image. */
  z.object({ kind: z.literal("image"), viewId: ViewIdSchema }),
]);

export type CopyRequest = z.infer<typeof CopyRequestSchema>;

/**
 * Names one copy from its start, when main takes the capture as it stands after every write sent
 * before, until it is copied. The page makes it up, so starting a copy waits for nothing.
 */
export const CopyTicketSchema = z.uuid().brand<"CopyTicket">();

export type CopyTicket = z.infer<typeof CopyTicketSchema>;

export const newCopyTicket = (): CopyTicket =>
  CopyTicketSchema.parse(crypto.randomUUID());

/**
 * How main's copy went: a mutation's outcome, or `notSaved` when what the screen showed as the copy
 * began is not on disk (a write of it failed, or didn't land within SETTLE_MS), so nothing was copied.
 */
export type CopyOutcome =
  | MutationOutcome
  | { kind: "notSaved"; message: string };
