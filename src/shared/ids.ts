import { z } from "zod";

export const DraftIdSchema = z.uuid().brand<"DraftId">();

export type DraftId = z.infer<typeof DraftIdSchema>;

/** A capture is a published draft. Sharing the identity makes a retried save idempotent. */
export type CaptureId = DraftId;

export const ViewIdSchema = z.uuid().brand<"ViewId">();

export type ViewId = z.infer<typeof ViewIdSchema>;

export const CandidateIdSchema = z.uuid().brand<"CandidateId">();

export type CandidateId = z.infer<typeof CandidateIdSchema>;

export const newDraftId = (): DraftId =>
  DraftIdSchema.parse(crypto.randomUUID());

export const newViewId = (): ViewId => ViewIdSchema.parse(crypto.randomUUID());

export const newCandidateId = (): CandidateId =>
  CandidateIdSchema.parse(crypto.randomUUID());
