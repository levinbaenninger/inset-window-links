import { z } from "zod";

import { DraftIdSchema, ViewIdSchema } from "../../shared/ids";

export const CURRENT_SCHEMA_VERSION = 1;

const FallbackReasonSchema = z.enum([
  "probeUnavailable",
  "invalidId",
  "noMatch",
  "ambiguous",
  "vanished",
  "captureFailed",
  "menu",
]);

export const AcquisitionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("direct"), windowKeyAtCapture: z.string() }),
  z.object({
    kind: z.literal("fallback"),
    reason: FallbackReasonSchema,
    windowKeyAtCapture: z.string().nullable(),
  }),
]);

export type Acquisition = z.infer<typeof AcquisitionSchema>;

export const SavedViewSchema = z.object({
  acquisition: AcquisitionSchema,
  appName: z.string().nullable(),
  capturedAt: z.iso.datetime(),
  height: z.int().positive(),
  id: ViewIdSchema,
  sampledAt: z.iso.datetime(),
  title: z.string().nullable(),
  width: z.int().positive(),
});

export type SavedView = z.infer<typeof SavedViewSchema>;

export const CaptureRecordSchema = z.object({
  createdAt: z.iso.datetime(),
  id: DraftIdSchema,
  nextStep: z.string(),
  relationship: z.string().trim().min(1),
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  updatedAt: z.iso.datetime(),
  views: z.array(SavedViewSchema).min(1),
});

export type CaptureRecord = z.infer<typeof CaptureRecordSchema>;

const VersionPeekSchema = z.object({ schemaVersion: z.number() });

export type VersionedRead =
  | { kind: "current"; record: CaptureRecord }
  | { kind: "unsupported"; version: number }
  | { kind: "unreadable"; detail: string };

const parseJson = (json: string) => {
  try {
    return { ok: true, value: JSON.parse(json) } as const;
  } catch (error) {
    return { ok: false, detail: String(error) } as const;
  }
};

/** Peeks at schemaVersion first, so a newer app's record is kept intact rather than called corrupt. */
export const readVersioned = (json: string): VersionedRead => {
  const parsed = parseJson(json);

  if (!parsed.ok) {
    return { detail: parsed.detail, kind: "unreadable" };
  }

  const peek = VersionPeekSchema.safeParse(parsed.value);

  if (!peek.success) {
    return { detail: "missing schemaVersion", kind: "unreadable" };
  }

  if (peek.data.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    return { kind: "unsupported", version: peek.data.schemaVersion };
  }

  const record = CaptureRecordSchema.safeParse(parsed.value);

  return record.success
    ? { kind: "current", record: record.data }
    : { detail: record.error.message, kind: "unreadable" };
};
