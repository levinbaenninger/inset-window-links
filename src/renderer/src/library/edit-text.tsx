import type { KeyboardEvent } from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { libraryApi } from "@/lib/bridge";

import type { CaptureDetail } from "../../../shared/dto";
import { isBlank, MAX_NEXT_STEP, MAX_RELATIONSHIP } from "../../../shared/text";

const mac = navigator.userAgent.includes("Macintosh");

export const EditText = ({
  detail,
  onDone,
}: {
  detail: CaptureDetail;
  onDone: () => Promise<void>;
}) => {
  const [relationship, setRelationship] = useState(detail.relationship);
  const [nextStep, setNextStep] = useState(detail.nextStep);
  const [error, setError] = useState<string | null>(null);

  const canSave = !isBlank(relationship);

  const save = async () => {
    const outcome = await libraryApi().updateText(detail.id, {
      nextStep,
      relationship,
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

  const saveOnShortcut = async (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      (mac ? event.metaKey : event.ctrlKey) &&
      !event.nativeEvent.isComposing &&
      canSave
    ) {
      event.preventDefault();
      await save();
    }
  };

  return (
    <section aria-label="Edit your thought" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-relationship">What connects these views?</Label>
        <Textarea
          autoFocus
          id="edit-relationship"
          maxLength={MAX_RELATIONSHIP}
          onChange={(event) => setRelationship(event.target.value)}
          onKeyDown={saveOnShortcut}
          value={relationship}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="edit-next-step">Next step (optional)</Label>
        <Textarea
          id="edit-next-step"
          maxLength={MAX_NEXT_STEP}
          onChange={(event) => setNextStep(event.target.value)}
          onKeyDown={saveOnShortcut}
          value={nextStep}
        />
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
