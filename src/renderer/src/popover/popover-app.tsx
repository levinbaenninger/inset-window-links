import {
  Clock01Icon,
  MinusSignIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ComponentProps } from "react";

import { TodoEditor } from "@/components/todo-editor";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { popoverApi } from "@/lib/bridge";
import { plural } from "@/lib/format";

import type { DraftSnapshot } from "../../../shared/dto";
import type { DraftText, Saveability } from "../../../shared/text";
import {
  hasTyped,
  keptTodos,
  MAX_RELATIONSHIP,
  saveability,
} from "../../../shared/text";
import { NoticeBanner } from "./notice-banner";
import { SourceChips } from "./source-chips";
import { SourceChooser } from "./source-chooser";
import { useDraft } from "./use-draft";

const discard = async () => {
  await popoverApi().discard();
};

const discardQuestion = (viewCount: number, text: DraftText): string => {
  const views = plural(viewCount, "view");

  if (viewCount === 0) {
    return "Discard your text?";
  }

  return hasTyped(text)
    ? `Discard ${views} and your text?`
    : `Discard ${views}?`;
};

const blockedReasons = {
  needsRelationship: "Write what connects them to save.",
  needsView: "Add a window to save.",
} as const;

const cancelChoice = async () => {
  await popoverApi().cancelChoice();
};

const addWindows = async () => {
  await popoverApi().addWindows();
};

const chooseQuit = async (choice: "save" | "discard" | "cancel") => {
  await popoverApi().chooseQuit(choice);
};

const HeaderButton = ({
  label,
  icon,
  ...props
}: { label: string; icon: typeof Clock01Icon } & ComponentProps<
  typeof Button
>) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button aria-label={label} size="icon-sm" variant="ghost" {...props}>
        <HugeiconsIcon icon={icon} />
      </Button>
    </TooltipTrigger>
    <TooltipContent side="bottom">{label}</TooltipContent>
  </Tooltip>
);

/** The title strip: it moves the panel, and holds the ways out of it. */
const PanelHeader = ({ title, detail }: { title: string; detail: string }) => (
  <header className="drag-region flex h-11 shrink-0 items-center gap-1 pr-2 pl-3.5">
    <h1 className="text-sm font-semibold">{title}</h1>
    <span className="text-muted-foreground ml-1 text-xs tabular-nums">
      {detail}
    </span>
    <span className="flex-1" />
    <HeaderButton
      icon={Clock01Icon}
      label="Recent captures"
      onClick={() => popoverApi().openRecent()}
    />
    <HeaderButton
      icon={Settings01Icon}
      label="Settings"
      onClick={() => popoverApi().openSettings()}
    />
    <HeaderButton
      icon={MinusSignIcon}
      label="Hide panel"
      onClick={() => popoverApi().dismiss()}
    />
  </header>
);

/** Shown when Quit meets an unsaved draft. Escape cancels, like the Cancel button. */
const QuitPrompt = ({ check }: { check: Saveability }) => (
  <section
    aria-label="Quit Inset Window Links"
    className="bg-foreground/5 flex flex-col gap-2.5 rounded-lg p-3"
    data-testid="quit-prompt"
  >
    <div className="flex flex-col gap-0.5">
      <p className="font-medium">Save this capture before quitting?</p>
      <p className="text-muted-foreground text-xs">
        {check.kind === "ok"
          ? "Discarding loses these views and your text."
          : `${blockedReasons[check.reason]} Or discard it to quit now.`}
      </p>
    </div>
    <div className="flex justify-end gap-1.5">
      <Button onClick={() => chooseQuit("cancel")} size="sm" variant="ghost">
        Cancel
      </Button>
      <Button
        onClick={() => chooseQuit("discard")}
        size="sm"
        variant="destructive"
      >
        Discard and quit
      </Button>
      <Button
        disabled={check.kind !== "ok"}
        onClick={() => chooseQuit("save")}
        size="sm"
      >
        Save and quit
      </Button>
    </div>
  </section>
);

/** Keyed by draft id, so local UI state such as the discard question resets with each new draft. */
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
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const viewCount = snapshot.views.length;
  const activity = snapshot.activity.kind;
  const quitting = activity === "confirmingQuit";
  const choosing = activity === "choosing";

  const pending =
    snapshot.activity.kind === "capturing" ? snapshot.activity.pending : null;

  const mac = snapshot.platform === "macos";
  const check = saveability(viewCount, text);
  const hasContent = viewCount > 0 || hasTyped(text);

  const canSave =
    (activity === "idle" || activity === "saveFailed") && check.kind === "ok";

  // Blank next steps are left out of what is saved.
  const saved = (): DraftText => ({ ...text, todos: keptTodos(text.todos) });

  const requestDiscard = async () => {
    if (hasContent) {
      setConfirmingDiscard(true);
    } else {
      await discard();
    }
  };

  /** The confirmation replaced the footer that had focus, so focus goes back to the text. */
  const keepDraft = useCallback(() => {
    setConfirmingDiscard(false);
    relationship.current?.focus();
  }, []);

  const save = async () => {
    if (canSave) {
      await popoverApi().save(saved());
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
      // Escape and Enter also end an IME composition, which must not hide or save.
      if (event.isComposing) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();

        if (choosing) {
          void cancelChoice();
        } else if (confirmingDiscard) {
          keepDraft();
        } else {
          popoverApi().dismiss();
        }
      }

      const saveKeys =
        event.key === "Enter" && (mac ? event.metaKey : event.ctrlKey);

      if (saveKeys && quitting && check.kind === "ok") {
        event.preventDefault();
        void chooseQuit("save");
      } else if (saveKeys && canSave) {
        event.preventDefault();
        void popoverApi().save({ ...text, todos: keptTodos(text.todos) });
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    mac,
    canSave,
    quitting,
    choosing,
    check.kind,
    text,
    confirmingDiscard,
    keepDraft,
  ]);

  if (snapshot.activity.kind === "choosing") {
    const { candidates } = snapshot.activity;

    return (
      <>
        <PanelHeader
          detail={
            candidates === "loading" ? "" : plural(candidates.length, "window")
          }
          title="Add windows"
        />
        <div className="flex flex-col gap-3 px-3.5 pb-3.5">
          {snapshot.notice !== null && (
            <NoticeBanner notice={snapshot.notice} />
          )}
          <SourceChooser
            candidates={candidates}
            mac={mac}
            onCancel={cancelChoice}
            onChoose={async (ids) => {
              await popoverApi().chooseSources(ids);
            }}
            reason={snapshot.activity.reason}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <PanelHeader
        detail={viewCount === 0 ? "" : plural(viewCount, "view")}
        title="New capture"
      />
      <div className="flex flex-col gap-4 px-3.5 pb-3.5">
        {snapshot.notice !== null && <NoticeBanner notice={snapshot.notice} />}
        <SourceChips
          onAdd={addWindows}
          onRemove={async (view) => {
            await popoverApi().removeView(view.id);
          }}
          pending={pending}
          shortcut={snapshot.shortcut}
          views={snapshot.views}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="relationship">What connects these views?</Label>
          <Textarea
            autoFocus
            className="max-h-48 min-h-20 resize-none"
            id="relationship"
            maxLength={MAX_RELATIONSHIP}
            onChange={(event) =>
              setText({ ...text, relationship: event.target.value })
            }
            placeholder="The budget cap in the sheet rules out this quote."
            ref={relationship}
            value={text.relationship}
          />
        </div>
        <div className="flex flex-col gap-1">
          <h2 className="text-sm leading-none font-medium">Next steps</h2>
          <TodoEditor
            onChange={(todos) => setText({ ...text, todos })}
            todos={text.todos}
          />
        </div>
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
        {quitting && <QuitPrompt check={check} />}
        {!quitting && confirmingDiscard && (
          <footer
            className="bg-destructive/10 flex items-center justify-between gap-2 rounded-lg py-1.5 pr-1.5 pl-3"
            data-testid="discard-confirm"
          >
            <span className="text-xs">{discardQuestion(viewCount, text)}</span>
            <span className="flex gap-1.5">
              <Button autoFocus onClick={keepDraft} size="sm" variant="ghost">
                Keep
              </Button>
              <Button onClick={discard} size="sm" variant="destructive">
                Discard draft
              </Button>
            </span>
          </footer>
        )}
        {!quitting && !confirmingDiscard && (
          <footer className="flex items-center justify-between gap-2">
            <Button
              className="-ml-2"
              onClick={requestDiscard}
              size="sm"
              variant="ghost"
            >
              Discard
            </Button>
            <span className="flex items-center gap-3">
              {check.kind === "blocked" && (
                <span
                  className="text-muted-foreground text-xs"
                  data-testid="save-blocked"
                >
                  {blockedReasons[check.reason]}
                </span>
              )}
              <Button disabled={!canSave} onClick={save} size="sm">
                {activity === "saving" ? "Saving…" : "Save"}
                <span className="opacity-70">{mac ? "⌘↵" : "Ctrl+Enter"}</span>
              </Button>
            </span>
          </footer>
        )}
      </div>
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
    <TooltipProvider delayDuration={500}>
      <main
        className="text-foreground flex flex-col text-sm select-none [&_input]:select-text [&_textarea]:select-text"
        ref={root}
      >
        {snapshot !== null && (
          <DraftForm
            key={snapshot.draftId}
            setText={setText}
            snapshot={snapshot}
            text={text}
          />
        )}
      </main>
    </TooltipProvider>
  );
};
