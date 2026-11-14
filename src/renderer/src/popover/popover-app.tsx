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
import { flushSync } from "react-dom";

import { AddChips } from "@/components/add-chips";
import type { AddField } from "@/components/add-chips";
import { DueChip, DueOptions, useToday } from "@/components/due";
import { IconButton } from "@/components/icon-button";
import { ShortcutList } from "@/components/shortcut-sheet";
import { TodoEditor } from "@/components/todo-editor";
import type { TodoEditorHandle } from "@/components/todo-editor";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { TooltipProvider } from "@/components/ui/tooltip";
import { popoverApi } from "@/lib/bridge";
import { useCommands } from "@/lib/commands";
import { useWindowFocus } from "@/lib/use-window-focus";
import { coach } from "@/tutorial/anchors";
import { PageHints } from "@/tutorial/hint-layer";

import type { DraftSnapshot, PendingSummary } from "../../../shared/dto";
import { SAVE_LATE } from "../../../shared/leave";
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
import type { TutorialAction, TutorialView } from "../../../shared/tutorial";
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

/** Edits made while the fields are locked go nowhere: main would ignore them. */
const ignoreEdit = (_text: DraftText): null => null;

/** Room kept above and below a prompt, which the panel grows to fit when it is shorter. */
const DIALOG_MARGIN = 16;

const reportPanelHeight = (element: HTMLElement) => {
  const scroll = element.querySelector<HTMLElement>("[data-panel-scroll]");

  const overflow =
    scroll === null ? 0 : scroll.scrollHeight - scroll.clientHeight;

  const dialog = document.querySelector<HTMLElement>(
    "[data-slot='alert-dialog-content'][data-state='open']"
  );

  const prompt = dialog === null ? 0 : dialog.offsetHeight + DIALOG_MARGIN * 2;

  popoverApi().reportHeight(
    Math.ceil(
      Math.max(element.getBoundingClientRect().height + overflow, prompt)
    )
  );
};

/** A prompt that opens or closes changes what the panel must fit, though the panel itself doesn't change. */
const usePromptFit = () => {
  useEffect(() => {
    const report = () => {
      const panel = document.querySelector("main");

      if (panel !== null) {
        reportPanelHeight(panel);
      }
    };

    const frame = requestAnimationFrame(report);

    return () => {
      cancelAnimationFrame(frame);
      requestAnimationFrame(report);
    };
  }, []);
};

const PanelScroll = ({
  children,
  fade = false,
}: {
  children: ReactNode;
  /** Fades the foot of a long list, so it reads as one that scrolls. */
  fade?: boolean;
}) => {
  const scroll = useRef<HTMLDivElement>(null);
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

  // When the panel grows, what shows at its foot stays put and the new room opens above it. Main
  // grows the panel only after the content has grown, and a field that takes focus meanwhile is
  // scrolled into the short panel. Kept, that scroll would cut off the windows' tiles, and the
  // open one's border, at the top of a panel that now has room for them.
  useEffect(() => {
    const box = scroll.current;

    if (box === null) {
      return;
    }

    let height = box.clientHeight;
    let top = box.scrollTop;

    // The scroll a resize causes is settled below, from where it stood before.
    const onScroll = () => {
      if (box.clientHeight === height) {
        top = box.scrollTop;
      }
    };

    const observer = new ResizeObserver(() => {
      const grown = box.clientHeight - height;

      height = box.clientHeight;

      if (grown > 0) {
        box.scrollTop = Math.max(0, top - grown);
      }

      top = box.scrollTop;
    });

    box.addEventListener("scroll", onScroll, { passive: true });
    observer.observe(box);

    return () => {
      observer.disconnect();
      box.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div
      className={cn(
        "min-h-0 overflow-y-auto",
        fade &&
          "[mask-image:linear-gradient(to_bottom,black_calc(100%-2rem),transparent)]"
      )}
      data-panel-scroll
      ref={scroll}
    >
      {/* The inset at the top keeps a tile's focus ring and selection border inside the scroll. */}
      <div className={cn("pt-1", fade && "pb-6")} ref={content}>
        {children}
      </div>
    </div>
  );
};

/**
 * The title strip: it moves the panel and hides it. The shortcut sheet opens with ⌘/ and from the
 * app and tray menus, so the compact panel has no button for it. The title dims while another app
 * has the keyboard. The panel can float in front without it, as when
 * Windows keeps another app in front after a capture; its keys, such as Add Windows, then go to
 * that app, so the strip says to click the panel first.
 */
const PanelHeader = ({
  title,
  platform,
  keyHint = false,
}: {
  title: string;
  platform: KeyPlatform;
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
      <IconButton
        icon={MinusSignIcon}
        keys="Esc"
        label="Hide panel"
        onClick={() => popoverApi().dismiss()}
      />
    </header>
  );
};

/** What the quit prompt calls the windows still being added: "Calendar", or "2 windows". */
const landingName = (landing: DraftSnapshot["landing"]): string | null => {
  if (landing.length > 1) {
    return `${landing.length} windows`;
  }

  const [only] = landing;

  return only === undefined ? null : (only?.appName ?? "the window");
};

/** Why the quit prompt asks: a save it waited for ran late, a check blocks Save, or a window is landing. */
const quitDetail = (
  late: boolean,
  check: Saveability,
  landing: string | null
): string | null => {
  if (late) {
    return SAVE_LATE;
  }

  if (check.kind === "blocked") {
    return blockedReasons[check.reason];
  }

  return landing === null ? null : `Save waits for ${landing} to be added.`;
};

/** Return in a prompt runs `run`, whichever button has focus, before the button sees it. */
const returnRuns =
  (run: () => void) =>
  (event: React.KeyboardEvent): void => {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      run();
    }
  };

/**
 * Shown when Quit meets an unsaved draft, and again when the save it chose ran late; Save is
 * then Retry, which waits once more. The same blurred modal as every prompt: the panel behind it
 * can't be reached, and its fields are locked. Return always saves or retries, whichever button
 * has focus; Escape cancels, like the Cancel button; Space presses the focused button, so Discard
 * stays a deliberate choice. Save has focus, with its ring, so it is clear what Return does.
 */
const QuitPrompt = ({
  check,
  landing,
  late,
  primary,
}: {
  check: Saveability;
  landing: string | null;
  late: boolean;
  primary: RefObject<HTMLButtonElement | null>;
}) => {
  const detail = quitDetail(late, check, landing);

  usePromptFit();

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          void chooseQuit("cancel");
        }
      }}
      open
    >
      <AlertDialogContent
        data-testid="quit-prompt"
        onKeyDownCapture={returnRuns(() => {
          if (check.kind === "ok") {
            void chooseQuit("save");
          }
        })}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          primary.current?.focus({ focusVisible: true });
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Save before quitting?</AlertDialogTitle>
          <AlertDialogDescription>
            {detail ?? "This capture isn’t saved yet."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button onClick={() => chooseQuit("cancel")} variant="outline">
            Cancel
          </Button>
          <Button onClick={() => chooseQuit("discard")} variant="destructive">
            Discard
          </Button>
          <Button
            disabled={check.kind !== "ok"}
            onClick={() => chooseQuit("save")}
            ref={primary}
          >
            {late ? "Retry" : "Save"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

/**
 * Discard this capture? Keep has focus, and Return keeps it whichever button has focus, so only a
 * deliberate click or Space on Discard throws the capture away. Escape keeps it too.
 */
const DiscardPrompt = ({ onKeep }: { onKeep: () => void }) => {
  const keep = useRef<HTMLButtonElement>(null);

  usePromptFit();

  return (
    <AlertDialog
      onOpenChange={(open) => {
        if (!open) {
          onKeep();
        }
      }}
      open
    >
      <AlertDialogContent
        data-testid="discard-confirm"
        onCloseAutoFocus={(event) => event.preventDefault()}
        onKeyDownCapture={returnRuns(onKeep)}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          keep.current?.focus({ focusVisible: true });
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Discard this capture?</AlertDialogTitle>
          <AlertDialogDescription>
            Its windows and text are thrown away.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {/* The footer stacks in reverse, so Keep, the safe default, shows first, as Save does when quitting. */}
        <AlertDialogFooter>
          <Button onClick={discard} variant="destructive">
            Discard
          </Button>
          <Button onClick={onKeep} ref={keep} variant="outline">
            Keep
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

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
  const dueControls = useRef<HTMLDivElement>(null);
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

  /** Focus goes back to the Due control: the chip once a day is set, else + Due. */
  const closeDue = () => {
    setDueOpen(false);
    requestAnimationFrame(() => {
      const trigger = dueControls.current?.querySelector<HTMLElement>(
        "[data-testid='due-chip'] button, [data-testid='add-due']"
      );

      (trigger ?? title.current)?.focus();
    });
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
        {...coach("capture-title")}
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
        <div
          className="border-foreground/10 flex flex-wrap items-center gap-1 border-t px-1.5 py-1.5"
          ref={dueControls}
        >
          {text.due !== null && (
            <DueChip
              aria-expanded={dueOpen}
              due={text.due}
              keys={menuKeyLabel("setDue", platform)}
              now={now}
              onClear={() => setText({ ...text, due: null })}
              onClick={() => setDueOpen((open) => !open)}
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

/** Discard, and Save with its key while the key works. */
const PanelFooter = ({
  canSave,
  label,
  landing,
  mac,
  onDiscard,
  onSave,
}: {
  canSave: boolean;
  label: string;
  landing: boolean;
  mac: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) => (
  <footer className="flex items-center justify-between gap-2">
    <Button onClick={onDiscard} size="sm" variant="destructive-ghost">
      Discard
    </Button>
    <Button
      disabled={!canSave}
      onClick={onSave}
      size="sm"
      title={landing ? "Waits for the window being added" : undefined}
    >
      {label}
      {canSave && <Kbd>{mac ? "⌘↵" : "Ctrl+Enter"}</Kbd>}
    </Button>
  </footer>
);

/** Keyboard Shortcuts, in place of the panel until Done or Escape. */
const ShortcutsSheet = ({
  onDone,
  platform,
  shortcut,
}: {
  onDone: () => void;
  platform: DraftSnapshot["platform"];
  shortcut: DraftSnapshot["shortcut"];
}) => (
  <>
    <PanelHeader platform={platform} title="Keyboard Shortcuts" />
    <PanelScroll fade>
      <div className="px-3.5">
        <ShortcutList
          columns={1}
          globalLabel={shortcut.kind === "registered" ? shortcut.label : null}
          platform={platform}
        />
      </div>
    </PanelScroll>
    <footer className="flex shrink-0 items-center justify-end p-3.5">
      <Button autoFocus onClick={onDone} size="sm" variant="outline">
        Done
        <Kbd>Esc</Kbd>
      </Button>
    </footer>
  </>
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
  /** The quit prompt's Save, while it shows: it takes focus over the text. */
  const quitSave = useRef<HTMLButtonElement>(null);
  const block = useRef<TextBlockHandle>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const [sheet, setSheet] = useState(false);
  /** From Save until main has answered that it is saving, so nothing typed in between is lost. */
  const [submitting, setSubmitting] = useState(false);
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
    (activity === "idle" || activity === "saveFailed") &&
    !landing &&
    !submitting;

  // Main takes no edits while a save is on its way or the quit prompt asks, so the fields lock,
  // as in Context Pin's capture panel: nothing can be typed that would be thrown away.
  const locked = activity === "saving" || quitting || submitting;
  const edit = locked ? ignoreEdit : setText;

  const requestDiscard = async () => {
    if (hasContent) {
      setConfirmingDiscard(true);
    } else {
      await discard();
    }
  };

  /** The confirmation took focus from the footer, so focus goes back to the text. */
  const keepDraft = useCallback(() => {
    setConfirmingDiscard(false);
    requestAnimationFrame(() => relationship.current?.focus());
  }, []);

  const save = useCallback(async () => {
    if (!canSave) {
      return;
    }

    // Locked before the call goes out, also when ⌘S arrives as a menu command, which React would
    // otherwise render a moment later, after a key typed meanwhile.
    flushSync(() => setSubmitting(true));
    // Blank next steps are left out of what is saved. A failed call unlocks the fields too.
    await Promise.allSettled([
      popoverApi().save({ ...text, todos: keptTodos(text.todos) }),
    ]);
    setSubmitting(false);
  }, [canSave, text]);

  // Fields unlocked after a failed save: the keyboard goes back to the end of the title.
  useEffect(() => {
    const title = relationship.current;

    if (!locked && title !== null && document.activeElement === document.body) {
      title.focus();
      title.setSelectionRange(title.value.length, title.value.length);
    }
  }, [locked]);

  useEffect(
    () =>
      popoverApi().onShown(() => {
        setConfirmingDiscard(false);

        if (quitSave.current === null || quitSave.current.disabled) {
          relationship.current?.focus();
        } else {
          quitSave.current.focus({ focusVisible: true });
        }
      }),
    []
  );

  const closeSheet = useCallback(() => {
    setSheet(false);
    requestAnimationFrame(() => relationship.current?.focus());
  }, []);

  // A prompt stays the modal until it is answered: the sheet waits.
  const prompting = quitting || confirmingDiscard;

  // The menu keys that belong to the page: the fields and the sheet. Not while windows are picked.
  useCommands((command) => {
    if (command === "showShortcuts" && prompting) {
      return true;
    }

    if (command === "showShortcuts") {
      if (sheet) {
        closeSheet();
      } else {
        setSheet(true);
      }

      return true;
    }

    if (choosing || locked) {
      return true;
    }

    if (command === "saveCapture") {
      void save();

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

      // A prompt answers Escape itself.
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !quitting &&
        !confirmingDiscard
      ) {
        event.preventDefault();

        if (sheet) {
          closeSheet();
        } else if (choosing) {
          void cancelChoice();
        } else {
          popoverApi().dismiss();
        }
      }

      const saveKeys =
        event.key === "Enter" && (mac ? event.metaKey : event.ctrlKey);

      // Return that reaches the window with a prompt up, as after a click on its backdrop, is the
      // prompt's: it saves or retries at quit, and keeps the capture when asked about Discard.
      if (
        event.key === "Enter" &&
        !event.defaultPrevented &&
        confirmingDiscard
      ) {
        event.preventDefault();
        keepDraft();
      } else if (event.key === "Enter" && quitting && check.kind === "ok") {
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

  if (sheet && !prompting) {
    return (
      <ShortcutsSheet
        onDone={closeSheet}
        platform={platform}
        shortcut={snapshot.shortcut}
      />
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
      <PanelHeader keyHint platform={platform} title="New capture" />
      <PanelScroll>
        <div className="flex flex-col gap-3 px-3.5">
          {snapshot.notice !== null && (
            <NoticeBanner notice={snapshot.notice} />
          )}
          <fieldset
            className="flex min-w-0 flex-col gap-3 transition-opacity disabled:opacity-60 disabled:delay-150"
            data-testid="draft-fields"
            disabled={locked}
          >
            <SourceChips
              addKeys={menuKeyLabel("addWindows", platform)}
              descriptions={text.viewDescriptions}
              onAdd={addWindows}
              onDescribe={(view, description) =>
                edit({
                  ...text,
                  viewDescriptions: {
                    ...text.viewDescriptions,
                    [view.id]: description,
                  },
                })
              }
              onRemove={async (view) => {
                if (locked) {
                  return;
                }

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
              setText={edit}
              text={text}
              title={relationship}
            />
          </fieldset>
          {snapshot.activity.kind === "saveFailed" && (
            <div
              className="bg-destructive/10 flex items-center gap-2 rounded-lg py-1.5 pr-1.5 pl-3 text-xs"
              data-testid="save-failed"
              role="alert"
            >
              <p className="min-w-0 flex-1">
                Couldn’t save. Your windows and text are still here.{" "}
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
        {snapshot.activity.kind === "confirmingQuit" && (
          <QuitPrompt
            check={check}
            landing={landingName(snapshot.landing)}
            late={snapshot.activity.late}
            primary={quitSave}
          />
        )}
        {!quitting && confirmingDiscard && <DiscardPrompt onKeep={keepDraft} />}
        {!quitting && (
          <PanelFooter
            canSave={canSave}
            label={saveLabel(submitting ? "saving" : activity, landing)}
            landing={landing}
            mac={mac}
            onDiscard={requestDiscard}
            onSave={save}
          />
        )}
      </div>
    </>
  );
};

/** The in-app tutorial's tips (src/renderer/src/tutorial/) over the panel's channels. */
const tutorialSource = {
  load: async (): Promise<TutorialView> => await popoverApi().getTutorial(),
  subscribe: (listener: (view: TutorialView) => void) =>
    popoverApi().onTutorial(listener),
};

const actTutorial = (action: TutorialAction): void => {
  popoverApi().tutorial(action);
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
      <PageHints act={actTutorial} source={tutorialSource} />
    </TooltipProvider>
  );
};
