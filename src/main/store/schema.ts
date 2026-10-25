import { z } from "zod";

import { DraftIdSchema, ViewIdSchema } from "../../shared/ids";
import { isBlank, TodoSchema } from "../../shared/text";
import type { Todo } from "../../shared/text";

export const CURRENT_SCHEMA_VERSION = 2;

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

/**
 * What brings a view's window back: the app it belongs to, where the window was and, when they
 * could be read, the web page or the file it showed. Pages and files are only read where the
 * user granted Accessibility; nothing prompts.
 */
export const ViewOriginSchema = z.object({
  appPath: z.string().max(1024).nullable(),
  /** Where the window was, in DIP. Kept so a later version can put windows back; not used yet. */
  bounds: z
    .object({
      height: z.number(),
      width: z.number(),
      x: z.number(),
      y: z.number(),
    })
    .nullable(),
  document: z.string().max(1024).nullable(),
  url: z.string().max(2000).nullable(),
});

export type ViewOrigin = z.infer<typeof ViewOriginSchema>;

const V1ViewSchema = z.object({
  acquisition: AcquisitionSchema,
  appName: z.string().nullable(),
  capturedAt: z.iso.datetime(),
  height: z.int().positive(),
  id: ViewIdSchema,
  sampledAt: z.iso.datetime(),
  title: z.string().nullable(),
  width: z.int().positive(),
});

export const SavedViewSchema = V1ViewSchema.extend({
  origin: ViewOriginSchema.nullable(),
});

export type SavedView = z.infer<typeof SavedViewSchema>;

const V1RecordSchema = z.object({
  createdAt: z.iso.datetime(),
  id: DraftIdSchema,
  nextStep: z.string(),
  relationship: z.string().trim().min(1),
  schemaVersion: z.literal(1),
  updatedAt: z.iso.datetime(),
  views: z.array(V1ViewSchema).min(1),
});

export const CaptureRecordSchema = z.object({
  createdAt: z.iso.datetime(),
  id: DraftIdSchema,
  relationship: z.string().trim().min(1),
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
  todos: z.array(TodoSchema),
  updatedAt: z.iso.datetime(),
  views: z.array(SavedViewSchema).min(1),
});

export type CaptureRecord = z.infer<typeof CaptureRecordSchema>;

const LIST_ITEM = /^(?:[-*•]\s+)?(?:\[(?<mark>[ xX]?)\]\s*)?(?<text>.*)$/u;

/** A version 1 next step becomes one to-do per line, ids by position so they stay put until rewritten. */
export const todosFromNextStep = (nextStep: string): Todo[] =>
  nextStep
    .split(/\r?\n/u)
    .map((line) => LIST_ITEM.exec(line.trim())?.groups ?? {})
    .filter((groups) => !isBlank(groups["text"] ?? ""))
    .map((groups, index) => ({
      done: groups["mark"]?.toLowerCase() === "x",
      id: `v1-${index + 1}`,
      text: (groups["text"] ?? "").trim(),
    }));

const upgradeV1 = (record: z.infer<typeof V1RecordSchema>): CaptureRecord => ({
  createdAt: record.createdAt,
  id: record.id,
  relationship: record.relationship,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  todos: todosFromNextStep(record.nextStep),
  updatedAt: record.updatedAt,
  views: record.views.map((view) => ({ ...view, origin: null })),
});

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

/**
 * Peeks at schemaVersion first, so a newer app's record is kept intact rather than called corrupt.
 * Version 1 is read as version 2; the file is rewritten only when the capture is edited.
 */
export const readVersioned = (json: string): VersionedRead => {
  const parsed = parseJson(json);

  if (!parsed.ok) {
    return { detail: parsed.detail, kind: "unreadable" };
  }

  const peek = VersionPeekSchema.safeParse(parsed.value);

  if (!peek.success) {
    return { detail: "missing schemaVersion", kind: "unreadable" };
  }

  if (peek.data.schemaVersion === 1) {
    const old = V1RecordSchema.safeParse(parsed.value);

    return old.success
      ? { kind: "current", record: upgradeV1(old.data) }
      : { detail: old.error.message, kind: "unreadable" };
  }

  if (peek.data.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    return { kind: "unsupported", version: peek.data.schemaVersion };
  }

  const record = CaptureRecordSchema.safeParse(parsed.value);

  return record.success
    ? { kind: "current", record: record.data }
    : { detail: record.error.message, kind: "unreadable" };
};
