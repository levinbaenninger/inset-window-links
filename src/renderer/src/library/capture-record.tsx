import {
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
import {
  DescribeButton,
  WINDOW_DESCRIPTION_PLACEHOLDER,
} from "@/components/describe-button";
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
import { libraryApi } from "@/lib/bridge";
import { useCommands } from "@/lib/commands";
import { formatWhen, viewTitle } from "@/lib/format";

import type {
  CaptureDetail,
  MutationOutcome,
  OriginSummary,
  ViewSummary,
} from "../../../shared/dto";
import type { DueDate } from "../../../shared/due";
import type { CaptureId } from "../../../shared/ids";
import { menuKeyLabel } from "../../../shared/shortcuts";
import type { CaptureStatus } from "../../../shared/status";
import type { DraftText, Todo, ViewDescriptions } from "../../../shared/text";
import {
  MAX_DESCRIPTION,
  MAX_RELATIONSHIP,
  MAX_VIEW_DESCRIPTION,
} from "../../../shared/text";
import {
  MenuEntries,
  reopenedMessage,
  useCaptureCommands,
} from "./capture-commands";
import { entryText } from "./copy-keys";
import { ImageViewer } from "./image-viewer";
import { InlineSaver, trackSaver } from "./inline-saver";
import { PaneHeader } from "./pane-header";

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
      className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex max-w-1/2 min-w-0 shrink-0 items-center gap-1 rounded-sm px-0.5 text-xs outline-none focus-visible:ring-3"
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

const CopyImage = ({
  captureId,
  view,
}: {
  captureId: CaptureId;
  view: ViewSummary;
}) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await libraryApi().copyImage(captureId, view.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
 * description sits under the title; until there is one, a quiet "+ Description" under the title
 * adds it.
 */
const SourceCard = ({
  captureId,
  view,
  index,
  description,
  onDescribe,
  onLeave,
  onReopen,
}: {
  captureId: CaptureId;
  view: ViewSummary;
  index: number;
  description: string;
  onDescribe: (description: string) => void;
  onLeave: () => void;
  onReopen: (view: ViewSummary) => void;
}) => {
  const field = useRef<HTMLTextAreaElement>(null);
  const [adding, setAdding] = useState(false);
  const shown = adding || description !== "";
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
        <CopyImage captureId={captureId} view={view} />
      </div>
      <div className="flex min-w-0 items-center gap-2 px-0.5">
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
      {shown ? (
        <textarea
          aria-label={`Description of ${name}`}
          className={cn(
            FIELD,
            "placeholder:text-muted-foreground text-muted-foreground focus:text-foreground -mt-1 field-sizing-content resize-none bg-transparent text-sm leading-relaxed outline-none"
          )}
          data-testid="window-description"
          maxLength={MAX_VIEW_DESCRIPTION}
          onBlur={() => {
            setAdding(false);
            onLeave();
          }}
          onChange={(event) => onDescribe(event.target.value)}
          onKeyDown={fieldKeys}
          placeholder={WINDOW_DESCRIPTION_PLACEHOLDER}
          ref={field}
          rows={1}
          value={description}
        />
      ) : (
        <DescribeButton
          className="-mt-1.5"
          description={description}
          label={name}
          onClick={() => {
            setAdding(true);
            requestAnimationFrame(() => field.current?.focus());
          }}
        />
      )}
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

const viewDescriptionsOf = (detail: CaptureDetail): ViewDescriptions =>
  // SAFETY: the keys are the views' own ids.
  Object.fromEntries(
    detail.views.map((view) => [view.id, view.description])
  ) as ViewDescriptions;

/** The editable text. The due date is shown from the stored copy and saved on its own. */
const textOf = (detail: CaptureDetail): DraftText => ({
  description: detail.description,
  due: detail.due,
  relationship: detail.relationship,
  todos: [...detail.todos],
  viewDescriptions: viewDescriptionsOf(detail),
});

const problem = (outcome: MutationOutcome): string => {
  switch (outcome.kind) {
    case "ok": {
      return "";
    }

    case "missing": {
      return "This capture was deleted.";
    }

    case "readOnly": {
      return "This capture can't be changed.";
    }

    default: {
      return `Couldn't save. ${outcome.message}`;
    }
  }
};

const dueProblem = (outcome: MutationOutcome): string | null =>
  outcome.kind === "ok" ? null : problem(outcome);

const Record = ({
  detail,
  text,
  error,
  onText,
  onToggle,
  onTitleBlur,
  onLeave,
}: {
  detail: CaptureDetail;
  text: DraftText;
  error: string | null;
  onText: (text: DraftText) => void;
  onToggle: (todo: Todo, done: boolean) => void;
  onTitleBlur: () => void;
  onLeave: () => void;
}) => {
  const title = useRef<HTMLTextAreaElement>(null);
  const description = useRef<HTMLTextAreaElement>(null);
  const steps = useRef<TodoEditorHandle>(null);
  const dueControls = useRef<HTMLDivElement>(null);
  const [describing, setDescribing] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);

  /** The due date just picked, shown until the stored copy it was picked over changes. */
  const [pickedDue, setPickedDue] = useState<{
    due: DueDate | null;
    over: DueDate | null;
  } | null>(null);

  const [dueError, setDueError] = useState<string | null>(null);
  const [reopened, setReopened] = useState<string | null>(null);
  const now = useToday();
  const { platform } = libraryApi();
  const reopenable = detail.views.filter((view) => view.origin !== null);

  const due =
    pickedDue !== null && pickedDue.over === detail.due
      ? pickedDue.due
      : detail.due;

  const showDescription = describing || text.description !== "";
  const showSteps = text.todos.length > 0;

  const commands = useCaptureCommands({
    due,
    from: "page",
    id: detail.id,
    reopenable: reopenable.map((view) => view.id),
    status: detail.status,
  });

  const shown = reopened ?? commands.feedback;
  const isDone = detail.status.kind === "done";

  const reopen = async (views: readonly ViewSummary[]) => {
    const { failed } = await libraryApi().reopen(
      detail.id,
      views.map((view) => view.id)
    );

    setReopened(reopenedMessage(views.length, failed));
    setTimeout(() => setReopened(null), FEEDBACK_MS);
  };

  const setDue = async (next: DueDate | null) => {
    setPickedDue({ due: next, over: detail.due });

    const failed = dueProblem(await libraryApi().setDue(detail.id, next));

    setDueError(failed);

    if (failed !== null) {
      setPickedDue(null);
    }
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
        void commands.copy.run();

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
        <p className="text-muted-foreground mr-auto truncate text-xs">
          {formatWhen(detail.createdAt)}
          {detail.updatedAt === detail.createdAt
            ? ""
            : ` · edited ${formatWhen(detail.updatedAt)}`}
          <StatusNote status={detail.status} />
        </p>
        {shown !== null && (
          <output className="text-muted-foreground mr-2 text-xs">
            {shown}
          </output>
        )}
        <IconButton
          icon={isDone ? Undo02Icon : CheckmarkCircle02Icon}
          label={isDone ? "Not done" : "Mark as done"}
          onClick={() =>
            isDone ? commands.backToList.run() : commands.done.run()
          }
        />
        <DropdownMenu onOpenChange={(open) => open && commands.onMenuOpen()}>
          <DropdownMenuTrigger asChild>
            <IconButton icon={MoreHorizontalIcon} label="More" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <MenuEntries entries={commands.entries} kind="dropdown" />
          </DropdownMenuContent>
        </DropdownMenu>
        {commands.dialog}
        {reopenable.length > 0 && (
          <Button
            className="ml-1.5"
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
        data-copy={entryText(text.relationship, text.description)}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 pt-2 pb-10">
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
              {error !== null && (
                <p className="text-destructive text-xs" role="alert">
                  {error}
                </p>
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
              <div className="-mx-1.5">
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
                      onClear={() => setDue(null)}
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
                    void setDue(next);
                  }}
                />
              </PopoverContent>
            </Popover>
            {dueError !== null && (
              <p className="text-destructive text-xs" role="alert">
                {dueError}
              </p>
            )}
          </div>
          <section aria-label="Windows" className="flex flex-col gap-2">
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
                  onLeave={onLeave}
                  onReopen={(view) => reopen([view])}
                  view={item}
                />
              ))}
            </ul>
          </section>
        </div>
      </main>
    </>
  );
};

/**
 * One capture, edited in place. Keyed by the capture's id, so its text starts from the stored
 * copy once and is not reset by every reload: each save makes main report a change, and the
 * reload that follows would otherwise overwrite what is being typed.
 */
const CapturePane = ({
  detail,
  viewIndex,
}: {
  detail: CaptureDetail;
  viewIndex: number;
}) => {
  const saver = useMemo(
    () => new InlineSaver(detail.id, libraryApi()),
    [detail.id]
  );

  const { text, outcome } = useSyncExternalStore(saver.subscribe, saver.state);

  // The first copy is taken once; later ones only when they cannot overwrite typing.
  useEffect(() => {
    saver.adopt(textOf(detail));
  }, [saver, detail]);

  // A copy from the sidebar or a menu key waits for what is typed here.
  useEffect(() => trackSaver(detail.id, saver), [detail.id, saver]);

  /*
   * Leaving the capture for another one unmounts the pane, which saves what is left. Closing the
   * window runs no cleanup and, with ⌘W from the menu, no blur either, so pagehide saves then.
   */
  useEffect(() => {
    const flush = () => saver.flush({ leaving: true });

    window.addEventListener("pagehide", flush);

    return () => {
      window.removeEventListener("pagehide", flush);
      saver.flush();
    };
  }, [saver]);

  if (detail.views[viewIndex] !== undefined) {
    return <ImageViewer detail={detail} index={viewIndex} />;
  }

  return (
    <Record
      detail={detail}
      error={outcome === null ? null : problem(outcome)}
      onLeave={() => saver.flush()}
      onText={(next) => saver.edit(next)}
      onTitleBlur={() => saver.restoreBlankTitle()}
      onToggle={(todo, done) => saver.toggle(todo.id, done)}
      text={text ?? textOf(detail)}
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
