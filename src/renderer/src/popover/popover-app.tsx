import {
  Clock01Icon,
  MinusSignIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import { IconButton } from "@/components/icon-button";
import { TodoEditor } from "@/components/todo-editor";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { TooltipProvider } from "@/components/ui/tooltip";
import { popoverApi } from "@/lib/bridge";

import type { DraftSnapshot } from "../../../shared/dto";
import type { DraftText, Saveability } from "../../../shared/text";
import {
  hasTyped,
  keptTodos,
  MAX_DESCRIPTION,
  MAX_RELATIONSHIP,
  saveability,
} from "../../../shared/text";
import { blockedReasons, NoticeBanner } from "./notice-banner";
import { SourceChips } from "./source-chips";
import { SourceChooser } from "./source-chooser";
import { useDraft } from "./use-draft";

const TITLE_PLACEHOLDER = "What connects these windows?";

const discard = async () => {
  await popoverApi().discard();
};

const cancelChoice = async () => {
  await popoverApi().cancelChoice();
};

const addWindows = async () => {
  await popoverApi().addWindows();
};

const chooseQuit = async (choice: "save" | "discard" | "cancel") => {
  await popoverApi().chooseQuit(choice);
};

/** The title strip: it moves the panel, and holds the ways out of it. */
const PanelHeader = ({ title }: { title: string }) => (
  <header className="drag-region flex h-11 shrink-0 items-center gap-0.5 pr-2 pl-3.5">
    <h1 className="mr-auto text-sm font-semibold">{title}</h1>
    <IconButton
      icon={Clock01Icon}
      label="Recent captures"
      onClick={() => popoverApi().openRecent()}
    />
    <IconButton
      icon={Settings01Icon}
      label="Settings"
      onClick={() => popoverApi().openSettings()}
    />
    <IconButton
      icon={MinusSignIcon}
      label="Hide panel"
      onClick={() => popoverApi().dismiss()}
    />
  </header>
);

/** A quiet row for a question that replaces the footer until it is answered. */
const PromptRow = ({
  children,
  label,
  testId,
}: {
  children: React.ReactNode;
  label: React.ReactNode;
  testId: string;
}) => (
  <footer
    className="bg-muted flex items-center gap-2 rounded-lg py-1.5 pr-1.5 pl-3"
    data-testid={testId}
  >
    <div className="flex min-w-0 flex-1 flex-col text-xs">{label}</div>
    <span className="flex shrink-0 gap-1.5">{children}</span>
  </footer>
);

/** Shown when Quit meets an unsaved draft. Escape cancels, like the Cancel button. */
const QuitPrompt = ({ check }: { check: Saveability }) => (
  <PromptRow
    label={
      <>
        <p className="font-medium">Save before quitting?</p>
        {check.kind === "blocked" && (
          <p className="text-muted-foreground">
            {blockedReasons[check.reason]}
          </p>
        )}
      </>
    }
    testId="quit-prompt"
  >
    <Button onClick={() => chooseQuit("cancel")} size="sm" variant="ghost">
      Cancel
    </Button>
    <Button
      onClick={() => chooseQuit("discard")}
      size="sm"
      variant="destructive"
    >
      Discard
    </Button>
    <Button
      disabled={check.kind !== "ok"}
      onClick={() => chooseQuit("save")}
      size="sm"
    >
      Save
    </Button>
  </PromptRow>
);

/**
 * The title, the details and the next steps on one surface. Each field grows with its text, and
 * Return in the title moves on to the details, since a title is one thought.
 */
const TextBlock = ({
  text,
  setText,
  title,
}: {
  text: DraftText;
  setText: (text: DraftText) => void;
  title: RefObject<HTMLTextAreaElement | null>;
}) => {
  const details = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="bg-background mac:dark:bg-card border-foreground/10 flex flex-col rounded-lg border">
      <textarea
        aria-label={TITLE_PLACEHOLDER}
        autoFocus
        className="placeholder:text-muted-foreground field-sizing-content max-h-[calc(6lh+0.75rem)] min-h-[calc(1lh+0.75rem)] resize-none bg-transparent px-3 pt-3 text-base leading-6 font-semibold outline-none"
        id="relationship"
        maxLength={MAX_RELATIONSHIP}
        onChange={(event) =>
          setText({ ...text, relationship: event.target.value })
        }
        onKeyDown={(event) => {
          const plain =
            !event.shiftKey &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey;

          if (
            event.key === "Enter" &&
            plain &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            details.current?.focus();
          }
        }}
        placeholder={TITLE_PLACEHOLDER}
        ref={title}
        rows={1}
        value={text.relationship}
      />
      <textarea
        aria-label="Details"
        className="placeholder:text-muted-foreground field-sizing-content max-h-[calc(8lh+0.75rem)] min-h-[calc(1lh+0.75rem)] resize-none bg-transparent px-3 pt-1 pb-2.5 text-sm outline-none"
        maxLength={MAX_DESCRIPTION}
        onChange={(event) =>
          setText({ ...text, description: event.target.value })
        }
        placeholder="Add details"
        ref={details}
        rows={1}
        value={text.description}
      />
      <div className="border-foreground/10 border-t p-1.5">
        <TodoEditor
          onChange={(todos) => setText({ ...text, todos })}
          todos={text.todos}
        />
      </div>
    </div>
  );
};

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

  // A blocked draft is still sent: main answers with the notice that says what is missing.
  const canSave = activity === "idle" || activity === "saveFailed";

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

  const save = useCallback(async () => {
    if (canSave) {
      // Blank next steps are left out of what is saved.
      await popoverApi().save({ ...text, todos: keptTodos(text.todos) });
    }
  }, [canSave, text]);

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
        void save();
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
    save,
    confirmingDiscard,
    keepDraft,
  ]);

  if (snapshot.activity.kind === "choosing") {
    return (
      <>
        <PanelHeader title="Add windows" />
        <div className="flex flex-col gap-3 px-3.5 pb-3.5">
          {snapshot.notice !== null && (
            <NoticeBanner notice={snapshot.notice} />
          )}
          <SourceChooser
            candidates={snapshot.activity.candidates}
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
      <PanelHeader title="New capture" />
      <div className="flex flex-col gap-3 px-3.5 pb-3.5">
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
        <TextBlock setText={setText} text={text} title={relationship} />
        {snapshot.activity.kind === "saveFailed" && (
          <div
            className="bg-destructive/10 flex items-center gap-2 rounded-lg py-1.5 pr-1.5 pl-3 text-xs"
            data-testid="save-failed"
            role="alert"
          >
            <p className="min-w-0 flex-1">
              Couldn&apos;t save. Your windows and text are still here.{" "}
              <span className="text-muted-foreground">
                {snapshot.activity.message}
              </span>
            </p>
            <Button onClick={save} size="sm" variant="outline">
              Retry
            </Button>
          </div>
        )}
        {quitting && <QuitPrompt check={check} />}
        {!quitting && confirmingDiscard && (
          <PromptRow
            label={<p className="font-medium">Discard this capture?</p>}
            testId="discard-confirm"
          >
            <Button autoFocus onClick={keepDraft} size="sm" variant="ghost">
              Keep
            </Button>
            <Button onClick={discard} size="sm" variant="destructive">
              Discard
            </Button>
          </PromptRow>
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
            <Button disabled={!canSave} onClick={save} size="sm">
              {activity === "saving" ? "Saving…" : "Save"}
              <Kbd>{mac ? "⌘↵" : "Ctrl+Enter"}</Kbd>
            </Button>
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
