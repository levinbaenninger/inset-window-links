import {
  Alert02Icon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  MoreHorizontalIcon,
  Undo02Icon,
  File01Icon,
  Globe02Icon,
  RepeatIcon,
  SquareArrowUpRight02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getRouteApi, Link } from "@tanstack/react-router";
import { cn } from "cn";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { KeyboardEvent } from "react";

import { AddChips } from "@/components/add-chips";
import type { AddField } from "@/components/add-chips";
import { DueChip, DueOptions, useToday } from "@/components/due";
import { IconButton } from "@/components/icon-button";
import { TodoEditor } from "@/components/todo-editor";
import type { TodoEditorHandle } from "@/components/todo-editor";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { WindowDescription } from "@/components/window-description";
import { libraryApi } from "@/lib/bridge";
import { useCommands } from "@/lib/commands";
import { formatWhen, viewTitle } from "@/lib/format";
import type { MenuKey } from "@/lib/menu-keys";
import { coach } from "@/tutorial/anchors";

import type {
  CaptureDetail,
  MutationOutcome,
  OriginSummary,
  ViewSummary,
} from "../../../shared/dto";
import type { DueDate } from "../../../shared/due";
import { couldNotSave } from "../../../shared/errors";
import type { CaptureId } from "../../../shared/ids";
import { menuKeyLabel } from "../../../shared/shortcuts";
import type { CaptureStatus } from "../../../shared/status";
import type { DraftText, Todo } from "../../../shared/text";
import {
  MAX_DESCRIPTION,
  MAX_RELATIONSHIP,
  storedText,
} from "../../../shared/text";
import type { Feedback } from "./capture-commands";
import {
  MenuEntries,
  reopenedMessage,
  useCaptureCommands,
} from "./capture-commands";
import { retryLabel, retryText } from "./copy-gate";
import { useEntryCopy } from "./copy-keys";
import type { SaveError } from "./drafts";
import { reasonOf } from "./drafts";
import { ImageViewer } from "./image-viewer";
import { drafts } from "./page-drafts";
import { PaneHeader } from "./pane-header";
import { ROW_SELECTOR } from "./row-keys";
import { ExampleTag, useIsExample } from "./tutorial";

const route = getRouteApi("/captures/$captureId");

const TITLE_PLACEHOLDER = "What connects these windows?";

const FEEDBACK_MS = 2500;

const ORIGIN_ICON = {
  app: SquareArrowUpRight02Icon,
  document: File01Icon,
  page: Globe02Icon,
} as const;

const ORIGIN_VERB = {
  app: "Open the app",
  document: "Open the file",
  page: "Open the page",
} as const;

/**
 * Where a window came from, as a button that opens it again. A file's name is usually the
 * window's title already, so then only the icon shows.
 */
const OriginButton = ({
  origin,
  title,
  onOpen,
}: {
  origin: OriginSummary;
  title: string;
  onOpen: () => void;
}) => {
  const repeated = title
    .toLocaleLowerCase()
    .includes(origin.label.toLocaleLowerCase());

  return (
    <button
      aria-label={`${ORIGIN_VERB[origin.kind]}: ${origin.label}`}
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mr-0.5 flex max-w-1/2 min-w-0 shrink-0 items-center gap-1 rounded-sm px-0.5 text-xs outline-none focus-visible:ring-3"
      onClick={onOpen}
      title={`${ORIGIN_VERB[origin.kind]}: ${origin.detail}`}
      type="button"
    >
      <HugeiconsIcon
        className="shrink-0"
        icon={ORIGIN_ICON[origin.kind]}
        size={12}
      />
      {!repeated && <span className="truncate">{origin.label}</span>}
    </button>
  );
};

/** Says Copied only once the image is on the clipboard; a refusal shows in the page header. */
const CopyImage = ({ onCopy }: { onCopy: () => Promise<boolean> }) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (await onCopy()) {
      setCopied(true);
      setTimeout(() => setCopied(false), FEEDBACK_MS);
    }
  };

  return (
    <span className="absolute top-2 right-2 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
      <IconButton
        icon={copied ? Tick02Icon : Copy01Icon}
        label={copied ? "Copied" : "Copy image"}
        onClick={copy}
        variant="overlay"
      />
    </span>
  );
};

/** A field being edited gets a quiet tint, so the keyboard's place shows without a frame. */
const FIELD =
  "focus:bg-foreground/4 -mx-1.5 rounded-md px-1.5 transition-colors";

/** Escape leaves a field, which saves it. */
const fieldKeys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
  if (event.key === "Escape" && !event.nativeEvent.isComposing) {
    event.preventDefault();
    event.currentTarget.blur();
  }
};

/**
 * A window as a card: its image opens the viewer, its origin opens the window again. Its
 * description sits under the title as plain text, edited in place on a click; until there is
 * one, a quiet "+ Description" under the title adds it.
 */
const SourceCard = ({
  captureId,
  view,
  index,
  description,
  onDescribe,
  onLeave,
  onReopen,
  onCopyImage,
}: {
  captureId: CaptureId;
  view: ViewSummary;
  index: number;
  description: string;
  onDescribe: (description: string) => void;
  onLeave: () => void;
  onReopen: (view: ViewSummary) => void;
  onCopyImage: () => Promise<boolean>;
}) => {
  const name = `window ${index + 1}, ${viewTitle(view.title)}`;

  return (
    <li
      className="group flex min-w-0 flex-col gap-1.5"
      data-testid="record-source"
    >
      <div className="relative">
        <Link
          aria-label={`Open ${name}, at readable size`}
          className="bg-muted border-foreground/10 focus-visible:ring-ring/50 hover:border-foreground/25 block overflow-hidden rounded-lg border outline-none focus-visible:ring-3"
          onDragStart={(event) => {
            event.preventDefault();
            libraryApi().dragImage(captureId, view.id);
          }}
          params={{ captureId }}
          search={{ view: view.id }}
          title="Open at readable size, or drag into another app"
          to="/captures/$captureId"
        >
          <img
            alt={`Window ${index + 1}, ${viewTitle(view.title)}`}
            className="aspect-video w-full object-contain"
            height={view.height}
            src={view.imageUrl}
            width={view.width}
          />
        </Link>
        <CopyImage onCopy={onCopyImage} />
      </div>
      {/* The origin ends flush with the image's right edge. */}
      <div className="flex min-w-0 items-center gap-2 pl-0.5">
        <p
          className="min-w-0 flex-1 truncate text-sm font-medium"
          data-testid="record-source-title"
          title={
            view.appName === null
              ? viewTitle(view.title)
              : `${viewTitle(view.title)} · ${view.appName}`
          }
        >
          {viewTitle(view.title)}
        </p>
        {view.origin !== null && (
          <OriginButton
            onOpen={() => onReopen(view)}
            origin={view.origin}
            title={viewTitle(view.title)}
          />
        )}
      </div>
      <WindowDescription
        addClassName="-mt-1.5"
        className="-mx-1.5 -mt-1 rounded-md px-1.5 text-sm leading-relaxed transition-colors"
        name={name}
        onChange={onDescribe}
        onLeave={onLeave}
        value={description}
      />
    </li>
  );
};

/** " · Snoozed until Tomorrow, 9:00" or " · Done", after the date. */
const StatusNote = ({ status }: { status: CaptureStatus }) => {
  switch (status.kind) {
    case "snoozed": {
      return <> · Snoozed until {formatWhen(status.until)}</>;
    }

    case "done": {
      return <> · Done</>;
    }

    default: {
      return null;
    }
  }
};

const problem = (outcome: MutationOutcome): string => {
  switch (outcome.kind) {
    case "ok": {
      return "";
    }

    case "missing": {
      return "This capture was deleted.";
    }

    case "readOnly": {
      return "This capture can’t be changed.";
    }

    default: {
      return couldNotSave(outcome.message);
    }
  }
};

/**
 * Words that could not be saved: why, then Retry and Discard changes. A deleted or unreadable
 * capture can't take them however often it is asked, so it offers only Discard changes. After a
 * Discard that couldn't finish, Keep changes saves them (`onRetry`), and Discard again asks main
 * again (`onDiscard`); Return keeps, whichever of the two has focus.
 */
const SaveFailure = ({
  failure,
  undiscarded,
  busy,
  onRetry,
  onDiscard,
}: {
  failure: SaveError;
  undiscarded: boolean;
  /**
   * A save is on its way: Retry waits for its answer, in place, so nothing moves. Discard changes
   * works at once; whatever that save does, the saved words stay on screen.
   */
  busy: boolean;
  onRetry: () => void;
  onDiscard: () => void;
}) => (
  <div
    className="flex flex-wrap items-center gap-x-2 gap-y-1"
    data-testid="save-failure"
    // Before the focused button sees it: Return keeps the changes, the safe answer, never discards.
    onKeyDownCapture={(event) => {
      if (
        undiscarded &&
        event.key === "Enter" &&
        !event.nativeEvent.isComposing
      ) {
        event.preventDefault();
        event.stopPropagation();
        onRetry();
      }
    }}
  >
    <p
      className="text-destructive flex items-center gap-1.5 text-xs"
      role="alert"
    >
      <HugeiconsIcon className="shrink-0" icon={Alert02Icon} size={14} />
      {undiscarded
        ? `Couldn’t discard your changes. ${reasonOf(failure)}`
        : problem(failure)}
    </p>
    {undiscarded ? (
      <span className="flex items-center gap-1">
        <Button
          onClick={onRetry}
          size="xs"
          title="Keep these words, and save them"
          variant="outline"
        >
          Keep changes
        </Button>
        <Button
          onClick={onDiscard}
          size="xs"
          title="Try again to go back to the saved words"
          variant="destructive"
        >
          Discard again
        </Button>
      </span>
    ) : (
      <span className="flex items-center gap-1">
        {failure.kind === "failed" && (
          <Button disabled={busy} onClick={onRetry} size="xs" variant="outline">
            Retry
          </Button>
        )}
        <Button
          onClick={onDiscard}
          size="xs"
          title="Go back to the saved words"
          variant="destructive"
        >
          Discard changes
        </Button>
      </span>
    )}
  </div>
);

/** What the last action in the header said; a copy refused for unsaved words offers Retry. */
const HeaderFeedback = ({
  feedback,
  onRetry,
}: {
  feedback: Feedback;
  onRetry: () => void;
}) => (
  <>
    <output
      className={cn(
        "mr-2 line-clamp-2 max-w-1/2 min-w-0 text-xs leading-tight",
        feedback.failed ? "text-destructive" : "text-muted-foreground"
      )}
      data-testid="capture-feedback"
      title={feedback.text}
    >
      {feedback.text}
    </output>
    {feedback.retry !== undefined && (
      <Button
        aria-label={retryLabel(feedback.retry.kind)}
        className="mr-1.5"
        onClick={() => {
          onRetry();
          feedback.retry?.run();
        }}
        size="xs"
        variant="outline"
      >
        {retryText(feedback.retry.kind)}
      </Button>
    )}
  </>
);

const Record = ({
  detail,
  text,
  failure,
  undiscarded,
  saving,
  onText,
  onDue,
  onToggle,
  onTitleBlur,
  onLeave,
  onRetry,
  onDiscard,
}: {
  detail: CaptureDetail;
  /** The fields on screen, the due date too: the draft's, else the saved ones. */
  text: DraftText;
  /** Why the words on screen could not be saved; they stay until saved or discarded. */
  failure: SaveError | null;
  /** The failure is a Discard that couldn't finish. */
  undiscarded: boolean;
  /** Whether a save of them is on its way. */
  saving: boolean;
  onText: (text: DraftText) => void;
  /** Sets or clears the due date, saved at once as part of the draft. */
  onDue: (due: DueDate | null) => void;
  onToggle: (todo: Todo, done: boolean) => void;
  onTitleBlur: () => void;
  onLeave: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}) => {
  const title = useRef<HTMLTextAreaElement>(null);
  const description = useRef<HTMLTextAreaElement>(null);
  const steps = useRef<TodoEditorHandle>(null);
  const dueControls = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLElement>(null);
  const [describing, setDescribing] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [reopened, setReopened] = useState<string | null>(null);
  const now = useToday();
  const { platform } = libraryApi();
  const reopenable = detail.views.filter((view) => view.origin !== null);
  const example = useIsExample(detail.id);

  const { due } = text;

  const showDescription = describing || text.description !== "";
  const showSteps = text.todos.length > 0;

  const commands = useCaptureCommands({
    from: "page",
    id: detail.id,
    reopenable: reopenable.map((view) => view.id),
    status: detail.status,
    text,
    title: text.relationship,
  });

  // ⌘C with nothing selected: the title and description on screen, once they are saved.
  useEntryCopy(page, () => {
    void commands.copyEntry.run();
  });

  /** A key the ⋯ menu shows runs for the open capture, whatever item is highlighted. */
  const moreKey = (key: MenuKey): boolean => {
    const item = {
      copyEntry: commands.copyEntry,
      copyNote: commands.copyNote,
      delete: null,
      reopen: commands.reopen,
    }[key];

    if (item === null) {
      return false;
    }

    setMoreOpen(false);
    void item.run();

    return true;
  };

  const shown: Feedback | null =
    reopened === null ? commands.feedback : { failed: false, text: reopened };

  const isDone = detail.status.kind === "done";

  const reopen = async (views: readonly ViewSummary[]) => {
    const { failed } = await libraryApi().reopen(
      detail.id,
      views.map((view) => view.id)
    );

    setReopened(reopenedMessage(views.length, failed));
    setTimeout(() => setReopened(null), FEEDBACK_MS);
  };

  const focusDescription = () => {
    setDescribing(true);
    requestAnimationFrame(() => description.current?.focus());
  };

  const focusSteps = () => {
    if (showSteps) {
      steps.current?.focusOrAdd();
    } else {
      onText({
        ...text,
        todos: [{ done: false, id: crypto.randomUUID(), text: "" }],
      });
    }
  };

  useCommands((command) => {
    // A sidebar row in focus takes the keys for a capture itself.
    const rowFocused = document.activeElement?.closest(ROW_SELECTOR) !== null;

    if (
      rowFocused &&
      (command === "copyNote" ||
        command === "reopen" ||
        command === "toggleDone")
    ) {
      return false;
    }

    switch (command) {
      case "focusDescription": {
        focusDescription();

        return true;
      }

      case "setDue": {
        setDueOpen(true);

        return true;
      }

      case "focusSteps": {
        focusSteps();

        return true;
      }

      case "toggleDone": {
        void (isDone ? commands.backToList.run() : commands.done.run());

        return true;
      }

      case "copyNote": {
        void commands.copyNote.run();

        return true;
      }

      case "reopen": {
        if (reopenable.length > 0) {
          void reopen(reopenable);
        }

        return true;
      }

      default: {
        return false;
      }
    }
  });

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
    ...(due === null
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
    <>
      <PaneHeader>
        {example && <ExampleTag />}
        <span className="flex-1" />
        {shown !== null && (
          <HeaderFeedback
            feedback={shown}
            onRetry={() => title.current?.focus()}
          />
        )}
        <IconButton
          icon={isDone ? Undo02Icon : CheckmarkCircle02Icon}
          label={isDone ? "Not done" : "Mark as done"}
          onClick={() =>
            isDone ? commands.backToList.run() : commands.done.run()
          }
        />
        {/* Not modal: a click on search or a field while it is open goes there. */}
        <DropdownMenu
          modal={false}
          onOpenChange={(open) => {
            setMoreOpen(open);

            if (open) {
              commands.onMenuOpen();
            }
          }}
          open={moreOpen}
        >
          <DropdownMenuTrigger asChild>
            <IconButton icon={MoreHorizontalIcon} label="More" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="min-w-52"
            onMenuKey={moreKey}
          >
            <MenuEntries entries={commands.entries} kind="dropdown" />
          </DropdownMenuContent>
        </DropdownMenu>
        {commands.dialog}
        {reopenable.length > 0 && (
          <Button
            className="ml-1.5"
            {...coach("reopen-all")}
            onClick={() => reopen(reopenable)}
            size="sm"
            title={`Opens the page, file or app each window showed (${menuKeyLabel("reopen", platform)})`}
            variant="outline"
          >
            <HugeiconsIcon icon={RepeatIcon} />
            Reopen {reopenable.length === 1 ? "window" : "all"}
            <Kbd>{menuKeyLabel("reopen", platform)}</Kbd>
          </Button>
        )}
      </PaneHeader>
      <main
        className="min-h-0 flex-1 overflow-y-auto"
        data-copy-entry
        ref={page}
      >
        <div className="mx-auto flex min-h-full max-w-3xl flex-col gap-6 px-8 pt-2 pb-4">
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              {/* Leaving a field saves at once instead of after the pause. */}
              <textarea
                aria-label={TITLE_PLACEHOLDER}
                className={cn(
                  FIELD,
                  "placeholder:text-muted-foreground field-sizing-content resize-none bg-transparent text-xl leading-snug font-semibold text-pretty outline-none"
                )}
                data-testid="record-relationship"
                id="record-title"
                maxLength={MAX_RELATIONSHIP}
                onBlur={() => {
                  onTitleBlur();
                  onLeave();
                }}
                onChange={(event) =>
                  onText({
                    ...text,
                    relationship: event.target.value.replaceAll(
                      /[\r\n]+/gu,
                      " "
                    ),
                  })
                }
                onKeyDown={(event) => {
                  fieldKeys(event);

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
              {failure !== null && (
                <SaveFailure
                  busy={saving}
                  failure={failure}
                  onDiscard={() => {
                    onDiscard();
                    title.current?.focus();
                  }}
                  onRetry={() => {
                    onRetry();
                    title.current?.focus();
                  }}
                  undiscarded={undiscarded}
                />
              )}
              {showDescription && (
                <textarea
                  aria-label="Description"
                  className={cn(
                    FIELD,
                    "placeholder:text-muted-foreground field-sizing-content resize-none bg-transparent text-sm leading-relaxed outline-none"
                  )}
                  data-testid="description"
                  maxLength={MAX_DESCRIPTION}
                  onBlur={() => {
                    setDescribing(false);
                    onLeave();
                  }}
                  onChange={(event) =>
                    onText({ ...text, description: event.target.value })
                  }
                  onKeyDown={fieldKeys}
                  placeholder="Add a description"
                  ref={description}
                  rows={1}
                  value={text.description}
                />
              )}
            </div>
            {showSteps && (
              <div className="-mx-1.5" {...coach("capture-steps")}>
                <TodoEditor
                  handle={steps}
                  onChange={(todos) => onText({ ...text, todos })}
                  onEmpty={() => title.current?.focus()}
                  onLeave={onLeave}
                  onToggle={onToggle}
                  todos={text.todos}
                />
              </div>
            )}
            <Popover onOpenChange={setDueOpen} open={dueOpen}>
              <PopoverAnchor asChild>
                <div
                  className="-mx-2 flex min-h-7 flex-wrap items-center gap-1"
                  ref={dueControls}
                >
                  {due !== null && (
                    <DueChip
                      aria-expanded={dueOpen}
                      due={due}
                      keys={menuKeyLabel("setDue", platform)}
                      now={now}
                      onClear={() => onDue(null)}
                      onClick={() => setDueOpen((open) => !open)}
                    />
                  )}
                  <AddChips chips={chips} onAdd={add} />
                </div>
              </PopoverAnchor>
              <PopoverContent
                className="w-64"
                onCloseAutoFocus={(event) => {
                  event.preventDefault();

                  // A click elsewhere has already put the keyboard where it was aimed. Escape or a
                  // pick leaves it nowhere, as what had it is gone, so it goes back to Due.
                  if (
                    document.activeElement !== null &&
                    document.activeElement !== document.body
                  ) {
                    return;
                  }

                  const trigger =
                    dueControls.current?.querySelector<HTMLButtonElement>(
                      "[data-testid='due-chip'] button, [data-testid='add-due']"
                    );

                  (trigger ?? title.current)?.focus();
                }}
                onOpenAutoFocus={(event) => event.preventDefault()}
              >
                <DueOptions
                  due={due}
                  keys={menuKeyLabel("setDue", platform)}
                  now={now}
                  onClose={() => setDueOpen(false)}
                  onPick={(next) => {
                    setDueOpen(false);
                    onDue(next);
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>
          <section
            aria-label="Windows"
            className="flex flex-col gap-2"
            {...coach("capture-windows")}
          >
            <h2 className="text-muted-foreground text-xs font-medium">
              Windows
            </h2>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-5">
              {detail.views.map((item, position) => (
                <SourceCard
                  captureId={detail.id}
                  description={text.viewDescriptions[item.id] ?? ""}
                  index={position}
                  key={item.id}
                  onDescribe={(value) =>
                    onText({
                      ...text,
                      viewDescriptions: {
                        ...text.viewDescriptions,
                        [item.id]: value,
                      },
                    })
                  }
                  onCopyImage={() => commands.copyImage(item.id)}
                  onLeave={onLeave}
                  onReopen={(view) => reopen([view])}
                  view={item}
                />
              ))}
            </ul>
          </section>
          <footer
            className="text-muted-foreground/80 mt-auto pt-4 text-xs"
            data-testid="record-footer"
          >
            Captured {formatWhen(detail.createdAt)}
            {detail.updatedAt === detail.createdAt
              ? ""
              : ` · edited ${formatWhen(detail.updatedAt)}`}
            <StatusNote status={detail.status} />
          </footer>
        </div>
      </main>
    </>
  );
};

/**
 * One capture, edited in place. Its unsaved words live in the page's draft store, not here, so
 * leaving the capture, or opening one of its windows, never drops them: they are shown again, with
 * their error when they could not be saved, until they are saved or discarded.
 */
const CapturePane = ({
  detail,
  viewIndex,
}: {
  detail: CaptureDetail;
  viewIndex: number;
}) => {
  const { id } = detail;
  const stored = useMemo(() => storedText(detail), [detail]);
  const draft = useSyncExternalStore(drafts.subscribe, () => drafts.draft(id));

  const confirmed = useSyncExternalStore(drafts.subscribe, () =>
    drafts.confirmed(id)
  );

  const error = useSyncExternalStore(drafts.subscribe, () => drafts.error(id));
  const text = draft?.values ?? confirmed ?? stored;

  useEffect(() => {
    drafts.adopt(id, stored);
  }, [id, stored]);

  // Leaving the capture saves what is left at once, rather than after the pause.
  useEffect(() => () => drafts.flush(id), [id]);

  if (detail.views[viewIndex] !== undefined) {
    return <ImageViewer detail={detail} index={viewIndex} />;
  }

  return (
    <Record
      detail={detail}
      failure={error ?? null}
      onDiscard={() => drafts.discard(id)}
      onDue={(due) => drafts.setDue(id, due, text)}
      onLeave={() => drafts.flush(id)}
      onRetry={() => drafts.retry(id)}
      onText={(next) => drafts.edit(id, next, text)}
      onTitleBlur={() => drafts.restoreBlankTitle(id)}
      onToggle={(todo, done) => drafts.toggle(id, todo.id, done, text)}
      saving={
        draft?.kind === "saving" ||
        (draft?.kind === "dirty" && draft.inFlight !== null)
      }
      text={text}
      undiscarded={drafts.undiscarded(id)}
    />
  );
};

export const CaptureRecord = () => {
  const detail = route.useLoaderData();
  const { view } = route.useSearch();

  if (detail === null) {
    return (
      <>
        <PaneHeader />
        <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 pb-20">
          <p
            className="text-muted-foreground text-sm"
            data-testid="record-missing"
          >
            This capture was deleted.
          </p>
          <Button asChild size="sm" variant="outline">
            <Link to="/">Back</Link>
          </Button>
        </main>
      </>
    );
  }

  return (
    <CapturePane
      detail={detail}
      key={detail.id}
      viewIndex={detail.views.findIndex((item) => item.id === view)}
    />
  );
};
