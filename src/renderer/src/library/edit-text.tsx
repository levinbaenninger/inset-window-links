import { useEffect, useEffectEvent, useState } from "react";

import { TodoEditor } from "@/components/todo-editor";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { libraryApi } from "@/lib/bridge";

import type { CaptureDetail } from "../../../shared/dto";
import type { Todo } from "../../../shared/text";
import { isBlank, keptTodos, MAX_RELATIONSHIP } from "../../../shared/text";

export const EditText = ({
  detail,
  onDone,
}: {
  detail: CaptureDetail;
  onDone: () => Promise<void>;
}) => {
  const [relationship, setRelationship] = useState(detail.relationship);
  const [todos, setTodos] = useState<Todo[]>([...detail.todos]);
  const [error, setError] = useState<string | null>(null);

  const canSave = !isBlank(relationship);
  const mac = libraryApi().platform === "macos";

  const save = async () => {
    if (!canSave) {
      return;
    }

    const outcome = await libraryApi().updateText(detail.id, {
      relationship,
      todos: keptTodos(todos),
    });

    if (outcome.kind === "ok") {
      await onDone();
    } else {
      setError(
        outcome.kind === "failed"
          ? outcome.message
          : "This capture can no longer be edited."
      );
    }
  };

  // ⌘↵ saves from the text and from any next step.
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.key === "Enter" &&
      (mac ? event.metaKey : event.ctrlKey) &&
      !event.isComposing
    ) {
      event.preventDefault();
      void save();
    } else if (event.key === "Escape" && !event.isComposing) {
      event.preventDefault();
      void onDone();
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <section aria-label="Edit your thought" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-relationship">What connects these views?</Label>
        <Textarea
          autoFocus
          className="min-h-24"
          id="edit-relationship"
          maxLength={MAX_RELATIONSHIP}
          onChange={(event) => setRelationship(event.target.value)}
          value={relationship}
        />
      </div>
      <div className="flex flex-col gap-1">
        <h2 className="text-sm leading-none font-medium">Next steps</h2>
        <TodoEditor onChange={setTodos} todos={todos} />
      </div>
      {error !== null && <p className="text-destructive text-sm">{error}</p>}
      <div className="flex gap-2">
        <Button disabled={!canSave} onClick={save} size="sm">
          Save changes
          <span className="opacity-70">{mac ? "⌘↵" : "Ctrl+Enter"}</span>
        </Button>
        <Button onClick={onDone} size="sm" variant="ghost">
          Cancel
        </Button>
      </div>
    </section>
  );
};
