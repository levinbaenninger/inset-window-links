import {
  Copy01Icon,
  Delete02Icon,
  File01Icon,
  Globe02Icon,
  PencilEdit02Icon,
  RepeatIcon,
  SquareArrowUpRight02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  getRouteApi,
  Link,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { cn } from "cn";
import type { ComponentProps } from "react";
import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { libraryApi } from "@/lib/bridge";
import {
  formatDateTime,
  formatDay,
  formatClock,
  plural,
  viewTitle,
} from "@/lib/format";

import type {
  CaptureDetail,
  OriginSummary,
  ViewSummary,
} from "../../../shared/dto";
import type { CaptureId } from "../../../shared/ids";
import { EditText } from "./edit-text";
import { ImageViewer } from "./image-viewer";
import { PaneHeader } from "./pane-header";

const route = getRouteApi("/captures/$captureId");

const FEEDBACK_MS = 2500;

const IconAction = ({
  label,
  icon,
  ...props
}: { label: string; icon: typeof Copy01Icon } & ComponentProps<
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

/** Where a view came from, as a button that opens it again. */
const OriginButton = ({
  origin,
  onOpen,
}: {
  origin: OriginSummary;
  onOpen: () => void;
}) => (
  <button
    className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex min-w-0 items-center gap-1 self-start rounded-sm text-left text-xs outline-none focus-visible:ring-3"
    onClick={onOpen}
    title={`${ORIGIN_VERB[origin.kind]}: ${origin.detail}`}
    type="button"
  >
    <HugeiconsIcon
      className="shrink-0"
      icon={ORIGIN_ICON[origin.kind]}
      size={12}
    />
    <span className="truncate">{origin.label}</span>
  </button>
);

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
    <IconAction
      icon={copied ? Tick02Icon : Copy01Icon}
      label={copied ? "Copied" : `Copy image of ${viewTitle(view.title)}`}
      onClick={copy}
    />
  );
};

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
  <li className="flex min-w-0 flex-col gap-2" data-testid="record-source">
    <Link
      aria-label={`Open source ${index + 1}, ${viewTitle(view.title)}, at readable size`}
      className="bg-muted border-foreground/10 focus-visible:ring-ring/50 hover:border-foreground/25 overflow-hidden rounded-lg border outline-none focus-visible:ring-3"
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
        alt={`Source ${index + 1}, ${viewTitle(view.title)}`}
        className="aspect-video w-full object-contain"
        height={view.height}
        src={view.imageUrl}
        width={view.width}
      />
    </Link>
    <div className="flex items-start justify-between gap-2">
      <div className="flex min-w-0 flex-col gap-0.5">
        <p
          className="truncate text-sm font-medium"
          data-testid="record-source-title"
          title={viewTitle(view.title)}
        >
          {viewTitle(view.title)}
        </p>
        <p className="text-muted-foreground truncate text-xs tabular-nums">
          {[
            view.appName,
            formatClock(view.capturedAt),
            view.source.kind === "fallback" && view.source.reason !== "menu"
              ? "chosen from the window list"
              : null,
            view.sameWindowAs === null
              ? null
              : `same window as source ${view.sameWindowAs}`,
          ]
            .filter((part) => part !== null)
            .join(" · ")}
        </p>
        {view.origin !== null && (
          <OriginButton onOpen={() => onReopen(view)} origin={view.origin} />
        )}
      </div>
      <CopyImage captureId={captureId} view={view} />
    </div>
  </li>
);

/** The next steps, checked off right here; a check is saved at once. */
const TodoChecklist = ({ detail }: { detail: CaptureDetail }) => {
  const router = useRouter();

  if (detail.todos.length === 0) {
    return null;
  }

  const done = detail.todos.filter((todo) => todo.done).length;

  return (
    <section aria-label="Next steps" className="flex flex-col gap-2">
      <h2 className="text-muted-foreground flex items-baseline gap-2 text-xs font-medium">
        Next steps
        <span className="tabular-nums">
          {done} of {detail.todos.length} done
        </span>
      </h2>
      <ul className="border-foreground/10 divide-foreground/10 flex flex-col divide-y rounded-lg border">
        {detail.todos.map((todo) => (
          <li key={todo.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm">
              <Checkbox
                checked={todo.done}
                onCheckedChange={async (checked) => {
                  await libraryApi().setTodoDone(
                    detail.id,
                    todo.id,
                    checked === true
                  );
                  await router.invalidate();
                }}
              />
              <span
                className={cn(
                  "min-w-0 break-words",
                  todo.done && "text-muted-foreground line-through"
                )}
              >
                {todo.text}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
};

const RecordActions = ({
  detail,
  onEdit,
}: {
  detail: CaptureDetail;
  onEdit: () => void;
}) => {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = async () => {
    await libraryApi().copyNote(detail.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const remove = async () => {
    const outcome = await libraryApi().remove(detail.id);

    if (outcome.kind === "ok" || outcome.kind === "missing") {
      await navigate({ to: "/" });
    } else {
      setError(
        outcome.kind === "failed"
          ? outcome.message
          : "This capture is read-only."
      );
    }
  };

  return (
    <>
      {error !== null && (
        <span className="text-destructive mr-2 text-xs">{error}</span>
      )}
      <IconAction
        icon={copied ? Tick02Icon : Copy01Icon}
        label={copied ? "Copied" : "Copy note"}
        onClick={copy}
      />
      <IconAction icon={PencilEdit02Icon} label="Edit text" onClick={onEdit} />
      <AlertDialog>
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertDialogTrigger asChild>
              <Button aria-label="Delete" size="icon-sm" variant="ghost">
                <HugeiconsIcon icon={Delete02Icon} />
              </Button>
            </AlertDialogTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">Delete</TooltipContent>
        </Tooltip>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this capture?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the thought and its {detail.views.length} saved{" "}
              {detail.views.length === 1 ? "image" : "images"} from this
              computer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove} variant="destructive">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

/** "Opened 3 windows", or how many could not be. */
const reopenedMessage = (asked: number, failed: number): string => {
  if (failed === 0) {
    return `Opened ${plural(asked, "window")}`;
  }

  return failed === asked
    ? "Nothing could be opened"
    : `Opened ${asked - failed}, ${failed} could not be`;
};

const Record = ({ detail }: { detail: CaptureDetail }) => {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [reopened, setReopened] = useState<string | null>(null);
  const reopenable = detail.views.filter((view) => view.origin !== null);

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
          {formatDay(detail.createdAt)}, {formatClock(detail.createdAt)}
          {detail.updatedAt === detail.createdAt
            ? ""
            : ` · edited ${formatDateTime(detail.updatedAt)}`}
        </p>
        {reopened !== null && (
          <output className="text-muted-foreground mr-2 text-xs">
            {reopened}
          </output>
        )}
        {!editing && (
          <RecordActions detail={detail} onEdit={() => setEditing(true)} />
        )}
        {!editing && reopenable.length > 0 && (
          <Button
            className="ml-1"
            onClick={() => reopen(reopenable)}
            size="sm"
            title="Opens each page, file or app these views came from"
          >
            <HugeiconsIcon icon={RepeatIcon} />
            Reopen {reopenable.length === 1 ? "window" : "all"}
          </Button>
        )}
      </PaneHeader>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-7 px-8 pt-2 pb-10">
          {editing ? (
            <EditText
              detail={detail}
              onDone={async () => {
                setEditing(false);
                await router.invalidate();
              }}
            />
          ) : (
            <>
              <h1
                className="text-xl leading-snug font-semibold text-pretty whitespace-pre-wrap"
                data-testid="record-relationship"
              >
                {detail.relationship}
              </h1>
              <TodoChecklist detail={detail} />
            </>
          )}
          <section aria-label="Sources" className="flex flex-col gap-3">
            <h2 className="text-muted-foreground flex items-baseline gap-2 text-xs font-medium">
              Views
              <span className="tabular-nums">{detail.views.length}</span>
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
            <p className="text-muted-foreground text-xs">
              Each image was taken when it was added, at the time shown, not all
              at once.
            </p>
          </section>
        </div>
      </main>
    </>
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
            This capture does not exist or was deleted.
          </p>
          <Button asChild size="sm" variant="ghost">
            <Link to="/">Back</Link>
          </Button>
        </main>
      </>
    );
  }

  const index = detail.views.findIndex((item) => item.id === view);

  if (detail.views[index] !== undefined) {
    return <ImageViewer detail={detail} index={index} />;
  }

  return <Record detail={detail} key={detail.id} />;
};
