import { z } from "zod";

import { DueDateSchema } from "./due";
import { ViewIdSchema } from "./ids";
import type { ViewId } from "./ids";

/** A capture's own words, title then description: what ⌘C copies when no text is selected. */
export const entryText = (title: string, description: string): string =>
  [title.trim(), description.trim()].filter((part) => part !== "").join("\n\n");

/** Main rejects longer text, so the text fields stop at the same lengths. */
export const MAX_RELATIONSHIP = 10_000;
export const MAX_DESCRIPTION = 10_000;
export const MAX_TODO = 500;
export const MAX_TODOS = 30;
export const MAX_VIEW_DESCRIPTION = 2000;

/** A draft holds at most this many windows' descriptions; main caps a capture's views alike. */
export const MAX_VIEWS = 100;

export const TodoIdSchema = z.string().regex(/^[\w-]{1,64}$/u);

export const TodoSchema = z.object({
  done: z.boolean(),
  id: TodoIdSchema,
  text: z.string().max(MAX_TODO),
});

/** One thing to do next. A capture keeps a short list of them, checked off later in Recent Captures. */
export type Todo = z.infer<typeof TodoSchema>;

/** What matters in each window, by the view's id. A window without one has no entry or "". */
export const ViewDescriptionsSchema = z
  .record(ViewIdSchema, z.string().max(MAX_VIEW_DESCRIPTION))
  .refine((map) => Object.keys(map).length <= MAX_VIEWS, "Too many windows");

export type ViewDescriptions = z.infer<typeof ViewDescriptionsSchema>;

export const removeViewDescription = (
  descriptions: ViewDescriptions,
  id: ViewId
): ViewDescriptions => {
  const { [id]: _removed, ...remaining } = descriptions;

  return remaining;
};

export const DraftTextSchema = z.object({
  /** Optional free text below the thought. Defaults so a sender that predates it still validates. */
  description: z.string().max(MAX_DESCRIPTION).default(""),
  /** When the capture should be done by. Recent Captures sets it on its own; see setDue. */
  due: DueDateSchema.nullable().default(null),
  relationship: z.string().max(MAX_RELATIONSHIP),
  todos: z.array(TodoSchema).max(MAX_TODOS),
  viewDescriptions: ViewDescriptionsSchema.default({}),
});

export type DraftText = z.infer<typeof DraftTextSchema>;

export const blankText: DraftText = {
  description: "",
  due: null,
  relationship: "",
  todos: [],
  viewDescriptions: {},
};

export const isBlank = (value: string): boolean => value.trim() === "";

/** The to-dos worth keeping: blank rows are dropped and the rest trimmed. */
export const keptTodos = (todos: readonly Todo[]): Todo[] =>
  todos.flatMap((todo) =>
    isBlank(todo.text) ? [] : [{ ...todo, text: todo.text.trim() }]
  );

/** The descriptions worth keeping, trimmed and in a fixed order, so two copies compare equal. */
export const keptViewDescriptions = (
  descriptions: ViewDescriptions
): ViewDescriptions =>
  // SAFETY: the keys come from a ViewDescriptions, so they are view ids already.
  Object.fromEntries(
    Object.entries(descriptions)
      .map(([id, text]) => [id, text.trim()] as const)
      .toSorted(([a], [b]) => a.localeCompare(b))
  ) as ViewDescriptions;

/**
 * Anything added counts, a description, a window's description or a due date too, though only
 * the thought makes a draft saveable.
 */
export const hasTyped = (text: DraftText): boolean =>
  !isBlank(text.relationship) ||
  !isBlank(text.description) ||
  keptTodos(text.todos).length > 0 ||
  text.due !== null ||
  Object.values(text.viewDescriptions).some((value) => !isBlank(value));

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
