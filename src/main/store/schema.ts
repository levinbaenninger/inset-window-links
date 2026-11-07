import { z } from "zod";

import { DueDateSchema } from "../../shared/due";
import { DraftIdSchema, ViewIdSchema } from "../../shared/ids";
import { ACTIVE, CaptureStatusSchema } from "../../shared/status";
import { isBlank, MAX_VIEW_DESCRIPTION, TodoSchema } from "../../shared/text";
import type { Todo } from "../../shared/text";

export const CURRENT_SCHEMA_VERSION = 5;

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

const V2ViewSchema = V1ViewSchema.extend({
  origin: ViewOriginSchema.nullable(),
});

/** Since version 5 a view carries an optional description: what matters in that window. */
export const SavedViewSchema = V2ViewSchema.extend({
  description: z.string().max(MAX_VIEW_DESCRIPTION),
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

const V2RecordSchema = z.object({
  createdAt: z.iso.datetime(),
  id: DraftIdSchema,
  relationship: z.string().trim().min(1),
  schemaVersion: z.literal(2),
  todos: z.array(TodoSchema),
  updatedAt: z.iso.datetime(),
  views: z.array(V2ViewSchema).min(1),
});

const V3RecordSchema = V2RecordSchema.extend({
  description: z.string(),
  schemaVersion: z.literal(3),
});

const V4RecordSchema = V3RecordSchema.extend({
  schemaVersion: z.literal(4),
  status: CaptureStatusSchema,
});

/** Version 5 adds a due date to the capture and a description to each view. */
export const CaptureRecordSchema = V4RecordSchema.extend({
  due: DueDateSchema.nullable(),
  schemaVersion: z.literal(CURRENT_SCHEMA_VERSION),
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

/** Views before version 5 had no description. */
const describedViews = (
  views: readonly z.infer<typeof V2ViewSchema>[]
): SavedView[] => views.map((view) => ({ ...view, description: "" }));

/** Version 4 lacked only the due date and the views' descriptions. */
const upgradeV4 = (record: z.infer<typeof V4RecordSchema>): CaptureRecord => ({
  ...record,
  due: null,
  schemaVersion: CURRENT_SCHEMA_VERSION,
  views: describedViews(record.views),
});

/** Versions 2 and 3 had no status, so they are in the list. */
const upgradeV3 = (record: z.infer<typeof V3RecordSchema>): CaptureRecord =>
  upgradeV4({ ...record, schemaVersion: 4, status: ACTIVE });

/** A version 2 record had no description. */
const upgradeV2 = (record: z.infer<typeof V2RecordSchema>): CaptureRecord =>
  upgradeV3({ ...record, description: "", schemaVersion: 3 });

const upgradeV1 = (record: z.infer<typeof V1RecordSchema>): CaptureRecord =>
  upgradeV2({
    createdAt: record.createdAt,
    id: record.id,
    relationship: record.relationship,
    schemaVersion: 2,
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
 * Older versions are read as the current one; the file is rewritten only when the capture changes.
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

  const { schemaVersion } = peek.data;

  if (schemaVersion === 1) {
    const old = V1RecordSchema.safeParse(parsed.value);

    return old.success
      ? { kind: "current", record: upgradeV1(old.data) }
      : { detail: old.error.message, kind: "unreadable" };
  }

  if (schemaVersion === 2) {
    const old = V2RecordSchema.safeParse(parsed.value);

    return old.success
      ? { kind: "current", record: upgradeV2(old.data) }
      : { detail: old.error.message, kind: "unreadable" };
  }

  if (schemaVersion === 3) {
    const old = V3RecordSchema.safeParse(parsed.value);

    return old.success
      ? { kind: "current", record: upgradeV3(old.data) }
      : { detail: old.error.message, kind: "unreadable" };
  }

  if (schemaVersion === 4) {
    const old = V4RecordSchema.safeParse(parsed.value);

    return old.success
      ? { kind: "current", record: upgradeV4(old.data) }
      : { detail: old.error.message, kind: "unreadable" };
  }

  if (schemaVersion !== CURRENT_SCHEMA_VERSION) {
    return { kind: "unsupported", version: schemaVersion };
  }

  const record = CaptureRecordSchema.safeParse(parsed.value);

  return record.success
    ? { kind: "current", record: record.data }
    : { detail: record.error.message, kind: "unreadable" };
};
