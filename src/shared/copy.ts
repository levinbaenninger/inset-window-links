import { z } from "zod";

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
