import { ArrowDown01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { popoverApi } from "@/lib/bridge";

import type { DraftSnapshot } from "../../../shared/dto";
import type { DraftText } from "../../../shared/text";
import { isBlank, saveability } from "../../../shared/text";
import { NoticeBanner } from "./notice-banner";
import { SourceChips } from "./source-chips";
import { SourceChooser } from "./source-chooser";
import { useDraft } from "./use-draft";

const discard = async () => {
  await popoverApi().discard();
};

const discardQuestion = (viewCount: number, text: DraftText): string => {
  const views = `${viewCount} ${viewCount === 1 ? "view" : "views"}`;
  const typed = !isBlank(text.relationship) || !isBlank(text.nextStep);

  if (viewCount === 0) {
    return "Discard your text?";
  }

  return typed ? `Discard ${views} and your text?` : `Discard ${views}?`;
};

const blockedReasons = {
  needsRelationship: "Write the connection to save.",
  needsView: "Add a view to save.",
} as const;

const cancelChoice = async () => {
  await popoverApi().cancelChoice();
};

/** Keyed by draft id, so local UI state such as the open next-step field resets with each new draft. */
const DraftForm = ({
  snapshot,
  text,
  setText,
}: {
  snapshot: DraftSnapshot;
  text: DraftText;
  setText: (text: DraftText) => void;
}) => {
  const relationship = useRef<HTMLTextAreaElement>(null);
  const [nextStepOpen, setNextStepOpen] = useState(text.nextStep !== "");
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const viewCount = snapshot.views.length;
  const activity = snapshot.activity.kind;
  const mac = snapshot.platform === "macos";
  const check = saveability(viewCount, text);

  const hasContent =
    viewCount > 0 || !isBlank(text.relationship) || !isBlank(text.nextStep);

  const canSave =
    (activity === "idle" || activity === "saveFailed") && check.kind === "ok";

  const requestDiscard = async () => {
    if (hasContent) {
      setConfirmingDiscard(true);
    } else {
      await discard();
    }
  };

  const save = async () => {
    if (canSave) {
      await popoverApi().save(text);
    }
  };

  useEffect(
    () =>
      popoverApi().onShown(() => {
        setConfirmingDiscard(false);
        relationship.current?.focus();
      }),
    []
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        popoverApi().dismiss();
      }

      if (
        event.key === "Enter" &&
        (mac ? event.metaKey : event.ctrlKey) &&
        canSave
      ) {
        event.preventDefault();
        void popoverApi().save(text);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mac, canSave, text]);

  return (
    <>
      {snapshot.notice !== null && <NoticeBanner notice={snapshot.notice} />}
      {snapshot.activity.kind === "choosing" && (
        <SourceChooser
          candidates={snapshot.activity.candidates}
          onCancel={cancelChoice}
          onChoose={async (candidate) => {
            await popoverApi().chooseSource(candidate.id);
          }}
          reason={snapshot.activity.reason}
        />
      )}
      <SourceChips
        onRemove={async (view) => {
          await popoverApi().removeView(view.id);
        }}
        shortcut={snapshot.shortcut}
        views={snapshot.views}
      />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="relationship">What connects these views?</Label>
        <Textarea
          autoFocus
          className="max-h-48 min-h-20 resize-none"
          id="relationship"
          placeholder="e.g. The budget cap rules out this quote."
          onChange={(event) =>
            setText({ ...text, relationship: event.target.value })
          }
          ref={relationship}
          value={text.relationship}
        />
        {check.kind === "blocked" && (
          <p
            className="text-muted-foreground text-xs"
            data-testid="save-blocked"
          >
            {blockedReasons[check.reason]}
          </p>
        )}
      </div>
      <Collapsible onOpenChange={setNextStepOpen} open={nextStepOpen}>
        <CollapsibleTrigger asChild>
          <Button className="-ml-2 self-start" size="sm" variant="ghost">
            <HugeiconsIcon
              icon={nextStepOpen ? ArrowDown01Icon : ArrowRight01Icon}
            />
            Next step (optional)
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="pt-1.5">
            <Textarea
              aria-label="Next step (optional)"
              className="max-h-32 min-h-12 resize-none"
              onChange={(event) =>
                setText({ ...text, nextStep: event.target.value })
              }
              value={text.nextStep}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
      {snapshot.activity.kind === "saveFailed" && (
        <Alert data-testid="save-failed" variant="destructive">
          <AlertTitle>The capture was not saved</AlertTitle>
          <AlertDescription>
            Your views and text are still here. {snapshot.activity.message}
          </AlertDescription>
          <div className="col-span-full mt-2">
            <Button onClick={save} size="sm" variant="outline">
              Retry
            </Button>
          </div>
        </Alert>
      )}
      {confirmingDiscard ? (
        <footer
          className="bg-destructive/10 flex items-center justify-between gap-2 rounded-lg py-1.5 pr-1.5 pl-3"
          data-testid="discard-confirm"
        >
          <span className="text-xs">{discardQuestion(viewCount, text)}</span>
          <span className="flex gap-1.5">
            <Button
              autoFocus
              onClick={() => setConfirmingDiscard(false)}
              size="sm"
              variant="ghost"
            >
              Keep
            </Button>
            <Button onClick={discard} size="sm" variant="destructive">
              Discard draft
            </Button>
          </span>
        </footer>
      ) : (
        <footer className="flex items-center justify-between gap-2">
          <Button onClick={requestDiscard} size="sm" variant="ghost">
            Discard
          </Button>
          <Button disabled={!canSave} onClick={save} size="sm">
            {activity === "saving" ? "Saving…" : "Save"}
            <span className="opacity-70">{mac ? "⌘↵" : "Ctrl+Enter"}</span>
          </Button>
        </footer>
      )}
    </>
  );
};

export const PopoverApp = () => {
  const { snapshot, text, setText } = useDraft();
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = root.current;

    if (element === null) {
      return;
    }

    const observer = new ResizeObserver(() => {
      popoverApi().reportHeight(
        Math.ceil(element.getBoundingClientRect().height)
      );
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return (
    <main className="flex flex-col gap-3 p-3 text-sm" ref={root}>
      {snapshot !== null && (
        <DraftForm
          key={snapshot.draftId}
          setText={setText}
          snapshot={snapshot}
          text={text}
        />
      )}
    </main>
  );
};
