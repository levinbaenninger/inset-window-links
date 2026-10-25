import { z } from "zod";

/** Main rejects longer text, so the text fields stop at the same lengths. */
export const MAX_RELATIONSHIP = 10_000;
export const MAX_TODO = 500;
export const MAX_TODOS = 30;

export const TodoIdSchema = z.string().regex(/^[\w-]{1,64}$/u);

export const TodoSchema = z.object({
  done: z.boolean(),
  id: TodoIdSchema,
  text: z.string().max(MAX_TODO),
});

/** One thing to do next. A capture keeps a short list of them, checked off later in Recent Captures. */
export type Todo = z.infer<typeof TodoSchema>;

export const DraftTextSchema = z.object({
  relationship: z.string().max(MAX_RELATIONSHIP),
  todos: z.array(TodoSchema).max(MAX_TODOS),
});

export type DraftText = z.infer<typeof DraftTextSchema>;

export const blankText: DraftText = { relationship: "", todos: [] };

export const isBlank = (value: string): boolean => value.trim() === "";

/** The to-dos worth keeping: blank rows are dropped and the rest trimmed. */
export const keptTodos = (todos: readonly Todo[]): Todo[] =>
  todos.flatMap((todo) =>
    isBlank(todo.text) ? [] : [{ ...todo, text: todo.text.trim() }]
  );

export const hasTyped = (text: DraftText): boolean =>
  !isBlank(text.relationship) || keptTodos(text.todos).length > 0;

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
