import { MinusSignIcon } from "@hugeicons/core-free-icons";
import { cn } from "cn";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { ReactNode, RefObject } from "react";

import { AddChips } from "@/components/add-chips";
import type { AddField } from "@/components/add-chips";
import { DueChip, DueOptions, useToday } from "@/components/due";
import { IconButton } from "@/components/icon-button";
import { SHORTCUTS_ICON, ShortcutList } from "@/components/shortcut-sheet";
import { TodoEditor } from "@/components/todo-editor";
import type { TodoEditorHandle } from "@/components/todo-editor";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { TooltipProvider } from "@/components/ui/tooltip";
import { popoverApi } from "@/lib/bridge";
import { useCommands } from "@/lib/commands";
import { useWindowFocus } from "@/lib/use-window-focus";

import type { DraftSnapshot, PendingSummary } from "../../../shared/dto";
import type { KeyPlatform } from "../../../shared/shortcuts";
import { menuKeyLabel } from "../../../shared/shortcuts";
import type { DraftText, Saveability } from "../../../shared/text";
import {
  hasTyped,
  keptTodos,
  MAX_DESCRIPTION,
  MAX_RELATIONSHIP,
  removeViewDescription,
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

const reportPanelHeight = (element: HTMLElement) => {
  const scroll = element.querySelector<HTMLElement>("[data-panel-scroll]");

  const overflow =
    scroll === null ? 0 : scroll.scrollHeight - scroll.clientHeight;

  popoverApi().reportHeight(
    Math.ceil(element.getBoundingClientRect().height + overflow)
  );
};

const PanelScroll = ({
  children,
  fade = false,
}: {
  children: ReactNode;
  /** Fades the foot of a long list, so it reads as one that scrolls. */
  fade?: boolean;
}) => {
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const inner = content.current;
    const panel = inner?.closest("main");

    if (inner === null || !(panel instanceof HTMLElement)) {
      return;
    }

    const observer = new ResizeObserver(() => reportPanelHeight(panel));

    observer.observe(inner);

    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={cn(
        "min-h-0 overflow-y-auto",
        fade &&
          "[mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]"
      )}
      data-panel-scroll
    >
      <div className={cn(fade && "pb-6")} ref={content}>
        {children}
      </div>
    </div>
  );
};

/**
 * The title strip: it moves the panel, opens the shortcut sheet, and hides the panel. The title
 * dims while another app has the keyboard. The panel can float in front without it, as when
 * Windows keeps another app in front after a capture; its keys, such as Add Windows, then go to
 * that app, so the strip says to click the panel first.
 */
const PanelHeader = ({
  title,
  platform,
  onShortcuts,
  keyHint = false,
}: {
  title: string;
  platform: KeyPlatform;
  onShortcuts?: () => void;
  /** Says to click the panel while it lacks the keyboard. */
  keyHint?: boolean;
}) => {
  const focused = useWindowFocus();

  return (
    <header
      className="drag-region flex h-11 shrink-0 items-center gap-0.5 pr-2 pl-3.5"
      data-focused={focused}
    >
      <h1
        className={cn(
          "text-sm font-semibold transition-colors",
          !focused && "text-muted-foreground"
        )}
      >
        {title}
      </h1>
      <span className="mr-auto min-w-0 truncate pl-2">
        {!focused && keyHint && (
          <span
            className="text-muted-foreground text-xs"
            data-testid="unfocused-hint"
          >
            Click the panel to use {menuKeyLabel("addWindows", platform)}
          </span>
        )}
      </span>
      {onShortcuts !== undefined && (
        <IconButton
          icon={SHORTCUTS_ICON}
          keys={menuKeyLabel("showShortcuts", platform)}
          label="Keyboard Shortcuts"
          onClick={onShortcuts}
        />
      )}
      <IconButton
        icon={MinusSignIcon}
        keys="Esc"
        label="Hide panel"
        onClick={() => popoverApi().dismiss()}
      />
    </header>
  );
};

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

/** What the quit prompt calls the windows still being added: "Calendar", or "2 windows". */
const landingName = (landing: DraftSnapshot["landing"]): string | null => {
  if (landing.length > 1) {
    return `${landing.length} windows`;
  }

  const [only] = landing;

  return only === undefined ? null : (only?.appName ?? "the window");
};

/**
 * Shown when Quit meets an unsaved draft. Escape cancels, like the Cancel button. With a window
 * still being added, it says that Save waits for it.
 */
const QuitPrompt = ({
  check,
  landing,
}: {
  check: Saveability;
  landing: string | null;
}) => (
  <PromptRow
    label={
      <>
        <p className="font-medium">Save before quitting?</p>
        {check.kind === "blocked" ? (
          <p className="text-muted-foreground">
            {blockedReasons[check.reason]}
          </p>
        ) : (
          landing !== null && (
            <p className="text-muted-foreground truncate">
              Save waits for {landing} to be added.
            </p>
          )
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

export interface TextBlockHandle {
  focusDescription: () => void;
  openDue: () => void;
  focusSteps: () => void;
}

/**
 * The title and, once added, the description, the next steps and the due date, on one surface.
 * Each field grows with its text. An empty field takes no room: the quiet row at the foot adds
 * it, as do ⌘D, ⇧⌘D and ⇧⌘S. Return in the title moves on to the description, since a title is
 * one thought. The due picker opens in the panel's own flow, so the panel grows to fit it.
 */
const TextBlock = ({
  text,
  setText,
  title,
  platform,
  handle,
}: {
  text: DraftText;
  setText: (text: DraftText) => void;
  title: RefObject<HTMLTextAreaElement | null>;
  platform: KeyPlatform;
  handle: RefObject<TextBlockHandle | null>;
}) => {
  const description = useRef<HTMLTextAreaElement>(null);
  const steps = useRef<TodoEditorHandle>(null);
  const dueButton = useRef<HTMLButtonElement>(null);
  const [describing, setDescribing] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);
  const now = useToday();
  const showDescription = describing || text.description !== "";
  const showSteps = text.todos.length > 0;

  const focusDescription = () => {
    setDescribing(true);
    // The field mounts with this render; focus it once it is there.
    requestAnimationFrame(() => description.current?.focus());
  };

  const focusSteps = () => {
    if (showSteps) {
      steps.current?.focusOrAdd();
    } else {
      setText({
        ...text,
        todos: [{ done: false, id: crypto.randomUUID(), text: "" }],
      });
    }
  };

  const focusTitle = () => title.current?.focus();

  const closeDue = () => {
    setDueOpen(false);
    requestAnimationFrame(() => (dueButton.current ?? title.current)?.focus());
  };

  useImperativeHandle(handle, () => ({
    focusDescription,
    focusSteps,
    openDue: () => setDueOpen(true),
  }));

  const add = (field: AddField) => {
    if (field === "description") {
      focusDescription();
    } else if (field === "steps") {
      focusSteps();
    } else {
      setDueOpen(true);
    }
  };

  const chips = [
    ...(showDescription
      ? []
      : [
          {
            keys: menuKeyLabel("focusDescription", platform),
            field: "description" as const,
            label: "Description",
          },
        ]),
    ...(showSteps
      ? []
      : [
          {
            keys: menuKeyLabel("focusSteps", platform),
            field: "steps" as const,
            label: "Next steps",
          },
        ]),
    ...(text.due === null
      ? [
          {
            keys: menuKeyLabel("setDue", platform),
            field: "due" as const,
            label: "Due",
          },
        ]
      : []),
  ];

  return (
    <div className="bg-background mac:dark:bg-card border-foreground/10 flex flex-col rounded-lg border">
      <textarea
        aria-label={TITLE_PLACEHOLDER}
        autoFocus
        className={cn(
          "placeholder:text-muted-foreground field-sizing-content max-h-[calc(6lh+0.75rem)] min-h-[calc(1lh+0.75rem)] resize-none bg-transparent px-3 pt-3 text-base leading-6 font-semibold outline-none",
          !showDescription && "pb-1"
        )}
        id="relationship"
        maxLength={MAX_RELATIONSHIP}
        onChange={(event) =>
          setText({
            ...text,
            relationship: event.target.value.replaceAll(/[\r\n]+/gu, " "),
          })
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
            focusDescription();
          }
        }}
        placeholder={TITLE_PLACEHOLDER}
        ref={title}
        rows={1}
        value={text.relationship}
      />
      {showDescription && (
        <textarea
          aria-label="Description"
          className="placeholder:text-muted-foreground field-sizing-content max-h-[calc(8lh+0.75rem)] min-h-[calc(1lh+0.75rem)] resize-none bg-transparent px-3 pt-1 pb-2.5 text-sm outline-none"
          data-testid="description"
          maxLength={MAX_DESCRIPTION}
          onBlur={() => setDescribing(false)}
          onChange={(event) =>
            setText({ ...text, description: event.target.value })
          }
          onKeyDown={(event) => {
            if (event.key === "Escape" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.stopPropagation();
              event.currentTarget.blur();
            }
          }}
          placeholder="Add a description"
          ref={description}
          rows={1}
          value={text.description}
        />
      )}
      {showSteps && (
        <div className="border-foreground/10 border-t p-1.5">
          <TodoEditor
            handle={steps}
            onChange={(todos) => setText({ ...text, todos })}
            onEmpty={focusTitle}
            todos={text.todos}
          />
        </div>
      )}
      {(chips.length > 0 || text.due !== null) && (
        <div className="border-foreground/10 flex flex-wrap items-center gap-1 border-t px-1.5 py-1.5">
          {text.due !== null && (
            <DueChip
              aria-expanded={dueOpen}
              due={text.due}
              keys={menuKeyLabel("setDue", platform)}
              now={now}
              onClear={() => setText({ ...text, due: null })}
              onClick={() => setDueOpen((open) => !open)}
              ref={dueButton}
            />
          )}
          <AddChips chips={chips} onAdd={add} />
        </div>
      )}
      {dueOpen && (
        <div className="border-foreground/10 border-t p-1">
          <DueOptions
            due={text.due}
            keys={menuKeyLabel("setDue", platform)}
            now={now}
            onClose={closeDue}
            onPick={(due) => {
              setText({ ...text, due });
              closeDue();
            }}
          />
        </div>
      )}
    </div>
  );
};

/**
 * The windows still to appear as tiles: one Add Windows overtook shows at once, one being captured
 * once it is known.
 */
const pendingWindows = (snapshot: DraftSnapshot): PendingSummary[] => {
  const { activity } = snapshot;

  return activity.kind === "capturing" && activity.pending !== null
    ? [...snapshot.landing, activity.pending]
    : [...snapshot.landing];
};

const saveLabel = (
  activity: DraftSnapshot["activity"]["kind"],
  landing: boolean
) => {
  if (activity === "saving") {
    return "Saving…";
  }

  return landing ? "Adding…" : "Save";
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
  const block = useRef<TextBlockHandle>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [sheet, setSheet] = useState(false);
  const viewCount = snapshot.views.length;
  const activity = snapshot.activity.kind;
  const quitting = activity === "confirmingQuit";
  const choosing = activity === "choosing";

  const pending = pendingWindows(snapshot);
  const landing = snapshot.landing.length > 0;

  const mac = snapshot.platform === "macos";
  const { platform } = snapshot;
  // Save at quit waits for a window still landing, so it counts as one.
  const check = saveability(viewCount + snapshot.landing.length, text);
  const hasContent = viewCount > 0 || hasTyped(text);

  // A blocked draft is still sent: main answers with the notice that says what is missing. A
  // window still landing would be lost, so Save waits for it.
  const canSave =
    (activity === "idle" || activity === "saveFailed") && !landing;

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

  const closeSheet = useCallback(() => {
    setSheet(false);
    requestAnimationFrame(() => relationship.current?.focus());
  }, []);

  // The menu keys that belong to the page: the fields and the sheet. Not while windows are picked.
  useCommands((command) => {
    if (command === "showShortcuts") {
      if (sheet) {
        closeSheet();
      } else {
        setSheet(true);
      }

      return true;
    }

    if (choosing || quitting) {
      return true;
    }

    setSheet(false);

    requestAnimationFrame(() => {
      switch (command) {
        case "focusDescription": {
          block.current?.focusDescription();
          break;
        }

        case "setDue": {
          block.current?.openDue();
          break;
        }

        case "focusSteps": {
          block.current?.focusSteps();
          break;
        }

        default: {
          break;
        }
      }
    });

    return true;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape and Enter also end an IME composition, which must not hide or save.
      if (event.isComposing) {
        return;
      }

      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();

        if (sheet) {
          closeSheet();
        } else if (choosing) {
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
    sheet,
    closeSheet,
  ]);

  if (sheet) {
    return (
      <>
        <PanelHeader
          onShortcuts={closeSheet}
          platform={platform}
          title="Keyboard Shortcuts"
        />
        <PanelScroll fade>
          <div className="px-3.5">
            <ShortcutList
              columns={1}
              globalLabel={
                snapshot.shortcut.kind === "registered"
                  ? snapshot.shortcut.label
                  : null
              }
              platform={platform}
            />
          </div>
        </PanelScroll>
        <footer className="flex shrink-0 items-center justify-end p-3.5">
          <Button autoFocus onClick={closeSheet} size="sm" variant="outline">
            Done
            <Kbd>Esc</Kbd>
          </Button>
        </footer>
      </>
    );
  }

  if (snapshot.activity.kind === "choosing") {
    return (
      <>
        <PanelHeader platform={platform} title="Add windows" />
        <PanelScroll>
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
        </PanelScroll>
      </>
    );
  }

  return (
    <>
      <PanelHeader
        keyHint
        onShortcuts={() => setSheet(true)}
        platform={platform}
        title="New capture"
      />
      <PanelScroll>
        <div className="flex flex-col gap-3 px-3.5">
          {snapshot.notice !== null && (
            <NoticeBanner notice={snapshot.notice} />
          )}
          <SourceChips
            addKeys={menuKeyLabel("addWindows", platform)}
            descriptions={text.viewDescriptions}
            onAdd={addWindows}
            onDescribe={(view, description) =>
              setText({
                ...text,
                viewDescriptions: {
                  ...text.viewDescriptions,
                  [view.id]: description,
                },
              })
            }
            onRemove={async (view) => {
              setText({
                ...text,
                viewDescriptions: removeViewDescription(
                  text.viewDescriptions,
                  view.id
                ),
              });
              await popoverApi().removeView(view.id);
            }}
            pending={pending}
            shortcut={snapshot.shortcut}
            views={snapshot.views}
          />
          <TextBlock
            handle={block}
            platform={platform}
            setText={setText}
            text={text}
            title={relationship}
          />
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
        </div>
      </PanelScroll>
      <div className="shrink-0 px-3.5 pt-3 pb-3.5">
        {quitting && (
          <QuitPrompt check={check} landing={landingName(snapshot.landing)} />
        )}
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
              onClick={requestDiscard}
              size="sm"
              variant="destructive-ghost"
            >
              Discard
            </Button>
            <Button
              disabled={!canSave}
              onClick={save}
              size="sm"
              title={landing ? "Waits for the window being added" : undefined}
            >
              {saveLabel(activity, landing)}
              {/* The key does nothing while a save or a window is under way. */}
              {activity !== "saving" && !landing && (
                <Kbd>{mac ? "⌘↵" : "Ctrl+Enter"}</Kbd>
              )}
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
      reportPanelHeight(element);
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return (
    <TooltipProvider delayDuration={500}>
      <main
        className="text-foreground flex max-h-screen flex-col text-sm select-none [&_input]:select-text [&_textarea]:select-text"
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
