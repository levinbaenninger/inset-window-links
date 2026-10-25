import {
  Add01Icon,
  Cancel01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import { useRef } from "react";
import type { KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";

import type { Todo } from "../../../shared/text";
import { MAX_TODO, MAX_TODOS } from "../../../shared/text";

const newTodo = (): Todo => ({
  done: false,
  id: crypto.randomUUID(),
  text: "",
});

/**
 * Next steps as a short list, typed like a checklist in a notes app: Return starts the next
 * one, Backspace in an empty one removes it, the arrow keys move between them.
 */
export const TodoEditor = ({
  todos,
  onChange,
  label = "Next steps",
}: {
  todos: readonly Todo[];
  onChange: (todos: Todo[]) => void;
  label?: string;
}) => {
  const fields = useRef(new Map<string, HTMLInputElement>());
  /** A step just added; its field takes focus as soon as it mounts. */
  const added = useRef<string | null>(null);

  const focus = (id: string | undefined) => {
    if (id !== undefined) {
      fields.current.get(id)?.focus();
    }
  };

  const insertAfter = (index: number) => {
    if (todos.length >= MAX_TODOS) {
      return;
    }

    const todo = newTodo();

    added.current = todo.id;
    onChange([...todos.slice(0, index + 1), todo, ...todos.slice(index + 1)]);
  };

  const remove = (index: number) => {
    const neighbour = todos[index - 1] ?? todos[index + 1];

    onChange(todos.filter((_, position) => position !== index));
    focus(neighbour?.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    // Return also ends an IME composition, which must not start a new step.
    if (event.nativeEvent.isComposing) {
      return;
    }

    const todo = todos[index];
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey;

    if (event.key === "Enter" && plain && !event.shiftKey) {
      event.preventDefault();
      insertAfter(index);
    } else if (event.key === "Backspace" && plain && todo?.text === "") {
      event.preventDefault();
      remove(index);
    } else if (event.key === "ArrowUp" && index > 0) {
      event.preventDefault();
      focus(todos[index - 1]?.id);
    } else if (event.key === "ArrowDown" && index < todos.length - 1) {
      event.preventDefault();
      focus(todos[index + 1]?.id);
    }
  };

  return (
    <div className="flex flex-col gap-0.5" data-testid="todo-editor">
      {todos.length > 0 && (
        <ul aria-label={label} className="flex flex-col">
          {todos.map((todo, index) => (
            <li
              className="group hover:bg-foreground/5 focus-within:bg-foreground/5 -mx-1.5 flex items-center gap-2 rounded-md py-0.5 pr-0.5 pl-2"
              key={todo.id}
            >
              {/* Done steps stay marked while their words are edited. */}
              <span
                aria-hidden
                className={cn(
                  "grid size-3.5 shrink-0 place-items-center rounded-full border",
                  todo.done
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-foreground/30"
                )}
              >
                {todo.done && (
                  <HugeiconsIcon icon={Tick02Icon} size={9} strokeWidth={3} />
                )}
              </span>
              <input
                aria-label={`Next step ${index + 1}`}
                className={cn(
                  "placeholder:text-muted-foreground h-7 min-w-0 flex-1 bg-transparent text-sm outline-none",
                  todo.done && "text-muted-foreground"
                )}
                maxLength={MAX_TODO}
                onChange={(event) =>
                  onChange(
                    todos.map((item) =>
                      item.id === todo.id
                        ? { ...item, text: event.target.value }
                        : item
                    )
                  )
                }
                onKeyDown={(event) => onKeyDown(event, index)}
                placeholder="Something to do next"
                ref={(element) => {
                  if (element === null) {
                    fields.current.delete(todo.id);

                    return;
                  }

                  fields.current.set(todo.id, element);

                  if (added.current === todo.id) {
                    added.current = null;
                    element.focus();
                  }
                }}
                value={todo.text}
              />
              <button
                aria-label={`Remove next step ${index + 1}`}
                className="text-muted-foreground hover:text-foreground hover:bg-foreground/10 grid size-6 shrink-0 place-items-center rounded-md opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                onClick={() => remove(index)}
                tabIndex={-1}
                type="button"
              >
                <HugeiconsIcon icon={Cancel01Icon} size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {todos.length < MAX_TODOS && (
        <Button
          className="-ml-2 self-start"
          onClick={() => insertAfter(todos.length - 1)}
          size="sm"
          variant="ghost"
        >
          <HugeiconsIcon icon={Add01Icon} />
          Add a next step
        </Button>
      )}
    </div>
  );
};
