import {
  ArrowLeft01Icon,
  Copy01Icon,
  Delete02Icon,
  PencilEdit02Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  getRouteApi,
  Link,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { libraryApi } from "@/lib/bridge";
import { formatDateTime, formatTime, viewTitle } from "@/lib/format";

import type { CaptureDetail, ViewSummary } from "../../../shared/dto";
import type { CaptureId } from "../../../shared/ids";
import { EditText } from "./edit-text";
import { ImageViewer } from "./image-viewer";

const route = getRouteApi("/captures/$captureId");

const BackToList = () => (
  <Button asChild className="-ml-2 self-start" size="sm" variant="ghost">
    <Link to="/">
      <HugeiconsIcon icon={ArrowLeft01Icon} />
      Recent captures
    </Link>
  </Button>
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
    <Button
      aria-label={`Copy image of ${viewTitle(view.title)}`}
      onClick={copy}
      size="xs"
      variant="ghost"
    >
      <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} />
      {copied ? "Copied" : "Copy image"}
    </Button>
  );
};

const SourceCard = ({
  captureId,
  view,
  index,
}: {
  captureId: CaptureId;
  view: ViewSummary;
  index: number;
}) => (
  <li className="flex flex-col gap-2" data-testid="record-source">
    <Link
      aria-label={`Open source ${index + 1}, ${viewTitle(view.title)}, at readable size`}
      className="bg-muted focus-visible:ring-ring/50 group relative overflow-hidden rounded-lg border outline-none focus-visible:ring-3"
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
        <p className="truncate font-medium" data-testid="record-source-title">
          {index + 1}. {viewTitle(view.title)}
        </p>
        <p className="text-muted-foreground truncate text-xs tabular-nums">
          {[view.appName, `captured ${formatTime(view.capturedAt)}`]
            .filter((part) => part !== null)
            .join(" · ")}
          {view.sameWindowAs === null
            ? ""
            : ` · same window as source ${view.sameWindowAs}`}
        </p>
        {view.source.kind === "fallback" && (
          <Badge className="self-start" variant="outline">
            Chosen from the window list
          </Badge>
        )}
      </div>
      <CopyImage captureId={captureId} view={view} />
    </div>
  </li>
);

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
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1">
        <Button onClick={copy} size="sm" variant="outline">
          <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} />
          {copied ? "Copied" : "Copy note"}
        </Button>
        <Button onClick={onEdit} size="sm" variant="ghost">
          <HugeiconsIcon icon={PencilEdit02Icon} />
          Edit text
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="destructive">
              <HugeiconsIcon icon={Delete02Icon} />
              Delete
            </Button>
          </AlertDialogTrigger>
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
      </div>
      {error !== null && <p className="text-destructive text-sm">{error}</p>}
    </div>
  );
};

const Reasoning = ({ detail }: { detail: CaptureDetail }) => {
  const router = useRouter();
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <EditText
        detail={detail}
        onDone={async () => {
          setEditing(false);
          await router.invalidate();
        }}
      />
    );
  }

  return (
    <section aria-label="Your thought" className="flex flex-col gap-4">
      <h1
        className="font-heading text-xl leading-snug font-semibold whitespace-pre-wrap"
        data-testid="record-relationship"
      >
        {detail.relationship}
      </h1>
      {detail.nextStep.trim() !== "" && (
        <div className="bg-muted flex flex-col gap-0.5 rounded-lg px-3 py-2.5">
          <p className="text-muted-foreground text-xs font-medium">Next step</p>
          <p className="whitespace-pre-wrap">{detail.nextStep}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          Saved {formatDateTime(detail.createdAt)}
          {detail.updatedAt === detail.createdAt
            ? ""
            : `, edited ${formatDateTime(detail.updatedAt)}`}
        </p>
        <RecordActions detail={detail} onEdit={() => setEditing(true)} />
      </div>
    </section>
  );
};

export const CaptureRecord = () => {
  const detail = route.useLoaderData();
  const { view } = route.useSearch();

  if (detail === null) {
    return (
      <main className="win:pt-2 mx-auto flex max-w-3xl flex-col gap-4 p-6">
        <BackToList />
        <p data-testid="record-missing">
          This capture does not exist or was deleted.
        </p>
      </main>
    );
  }

  const index = detail.views.findIndex((item) => item.id === view);
  const selected = detail.views[index];

  if (selected !== undefined) {
    return <ImageViewer detail={detail} index={index} />;
  }

  return (
    <main className="win:pt-2 mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <BackToList />
      <Reasoning detail={detail} />
      <section aria-label="Sources" className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 className="font-heading font-semibold">
            Sources{" "}
            <span className="text-muted-foreground font-normal tabular-nums">
              {detail.views.length}
            </span>
          </h2>
          <p className="text-muted-foreground text-xs">
            Each image was taken on its own action, at the time shown. They are
            not one simultaneous snapshot.
          </p>
        </div>
        <ul className="grid grid-cols-2 gap-4">
          {detail.views.map((item, position) => (
            <SourceCard
              captureId={detail.id}
              index={position}
              key={item.id}
              view={item}
            />
          ))}
        </ul>
      </section>
    </main>
  );
};
