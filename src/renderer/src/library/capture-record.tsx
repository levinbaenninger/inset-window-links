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
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { KeyboardEvent } from "react";

import { IconButton } from "@/components/icon-button";
import { TodoEditor } from "@/components/todo-editor";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { libraryApi } from "@/lib/bridge";
import { formatDateTime, formatWhen, viewTitle } from "@/lib/format";

import type {
  CaptureDetail,
  MutationOutcome,
  OriginSummary,
  ViewSummary,
} from "../../../shared/dto";
import type { CaptureId } from "../../../shared/ids";
import type { CaptureStatus } from "../../../shared/status";
import type { DraftText, Todo } from "../../../shared/text";
import { MAX_DESCRIPTION, MAX_RELATIONSHIP } from "../../../shared/text";
import {
  MenuEntries,
  reopenedMessage,
  useCaptureCommands,
} from "./capture-commands";
import { ImageViewer } from "./image-viewer";
import { InlineSaver } from "./inline-saver";
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

/** A window as a card: its image opens the viewer, its origin opens the window again. */
const SourceCard = ({
  captureId,
  view,
  index,
  onReopen,
}: {
  captureId: CaptureId;
  view: ViewSummary;
  index: number;
  onReopen: (view: ViewSummary) => void;
}) => (
  <li
    className="group flex min-w-0 flex-col gap-1.5"
    data-testid="record-source"
  >
    <div className="relative">
      <Link
        aria-label={`Open window ${index + 1}, ${viewTitle(view.title)}, at readable size`}
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
  </li>
);

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

const textOf = (detail: CaptureDetail): DraftText => ({
  description: detail.description,
  relationship: detail.relationship,
  todos: [...detail.todos],
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

/** Escape leaves a field, which saves it. */
const fieldKeys = (event: KeyboardEvent<HTMLTextAreaElement>) => {
  if (event.key === "Escape" && !event.nativeEvent.isComposing) {
    event.preventDefault();
    event.currentTarget.blur();
  }
};

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
  const details = useRef<HTMLTextAreaElement>(null);
  const [reopened, setReopened] = useState<string | null>(null);
  const reopenable = detail.views.filter((view) => view.origin !== null);

  const commands = useCaptureCommands({
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

  return (
    <>
      <PaneHeader>
        <p className="text-muted-foreground mr-auto truncate text-xs">
          {formatWhen(detail.createdAt)}
          {detail.updatedAt === detail.createdAt
            ? ""
            : ` · edited ${formatDateTime(detail.updatedAt)}`}
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
          <DropdownMenuContent align="end" className="min-w-48">
            <MenuEntries entries={commands.entries} kind="dropdown" />
          </DropdownMenuContent>
        </DropdownMenu>
        {commands.dialog}
        {reopenable.length > 0 && (
          <Button
            className="ml-1.5"
            onClick={() => reopen(reopenable)}
            size="sm"
            title="Opens the page, file or app each window showed"
            variant="outline"
          >
            <HugeiconsIcon icon={RepeatIcon} />
            Reopen {reopenable.length === 1 ? "window" : "all"}
          </Button>
        )}
      </PaneHeader>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 pt-2 pb-10">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              {/* Leaving a field saves at once instead of after the pause. */}
              <textarea
                aria-label={TITLE_PLACEHOLDER}
                className="placeholder:text-muted-foreground field-sizing-content resize-none bg-transparent text-xl leading-snug font-semibold text-pretty outline-none"
                data-testid="record-relationship"
                id="record-title"
                maxLength={MAX_RELATIONSHIP}
                onBlur={() => {
                  onTitleBlur();
                  onLeave();
                }}
                onChange={(event) =>
                  onText({ ...text, relationship: event.target.value })
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
                    details.current?.focus();
                  }
                }}
                placeholder={TITLE_PLACEHOLDER}
                rows={1}
                value={text.relationship}
              />
              {error !== null && (
                <p className="text-destructive text-xs" role="alert">
                  {error}
                </p>
              )}
              <textarea
                aria-label="Details"
                className="placeholder:text-muted-foreground field-sizing-content resize-none bg-transparent text-sm leading-relaxed outline-none"
                maxLength={MAX_DESCRIPTION}
                onBlur={onLeave}
                onChange={(event) =>
                  onText({ ...text, description: event.target.value })
                }
                onKeyDown={fieldKeys}
                placeholder="Add details"
                ref={details}
                rows={1}
                value={text.description}
              />
            </div>
            <div className="-mx-1.5">
              <TodoEditor
                onChange={(todos) => onText({ ...text, todos })}
                onLeave={onLeave}
                onToggle={onToggle}
                todos={text.todos}
              />
            </div>
          </div>
          <section aria-label="Windows" className="flex flex-col gap-2">
            <h2 className="text-muted-foreground text-xs font-medium">
              Windows
            </h2>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-5">
              {detail.views.map((item, position) => (
                <SourceCard
                  captureId={detail.id}
                  index={position}
                  key={item.id}
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
