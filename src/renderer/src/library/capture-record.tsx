import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
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

const SourceCard = ({
  captureId,
  view,
  index,
}: {
  captureId: string;
  view: ViewSummary;
  index: number;
}) => (
  <li className="flex flex-col gap-2" data-testid="record-source">
    <Link
      aria-label={`Open source ${index + 1}, ${viewTitle(view.title)}, at readable size`}
      className="bg-muted focus-visible:ring-ring overflow-hidden rounded-lg border outline-none focus-visible:ring-2"
      params={{ captureId }}
      search={{ view: view.id }}
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
    <div className="flex flex-col gap-0.5">
      <p className="truncate font-medium" data-testid="record-source-title">
        {index + 1}. {viewTitle(view.title)}
      </p>
      <p className="text-muted-foreground truncate text-xs">
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
      <div className="flex flex-wrap gap-2">
        <Button onClick={onEdit} size="sm" variant="outline">
          Edit text
        </Button>
        <Button onClick={copy} size="sm" variant="outline">
          {copied ? "Copied" : "Copy note"}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="destructive">
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
    <section aria-label="Your thought" className="flex flex-col gap-3">
      <p
        className="text-base whitespace-pre-wrap"
        data-testid="record-relationship"
      >
        {detail.relationship}
      </p>
      {detail.nextStep.trim() !== "" && (
        <p className="whitespace-pre-wrap">
          <span className="font-medium">Next step: </span>
          {detail.nextStep}
        </p>
      )}
      <p className="text-muted-foreground text-xs">
        Saved {formatDateTime(detail.createdAt)}
        {detail.updatedAt === detail.createdAt
          ? ""
          : `, edited ${formatDateTime(detail.updatedAt)}`}
      </p>
      <RecordActions detail={detail} onEdit={() => setEditing(true)} />
    </section>
  );
};

export const CaptureRecord = () => {
  const detail = route.useLoaderData();
  const { view } = route.useSearch();

  if (detail === null) {
    return (
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
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
    return <ImageViewer captureId={detail.id} index={index} view={selected} />;
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <BackToList />
      <Reasoning detail={detail} />
      <section aria-label="Sources" className="flex flex-col gap-3">
        <h2 className="font-heading font-semibold">Sources</h2>
        <p className="text-muted-foreground text-xs">
          Each image was taken on its own action, at the time shown. They are
          not one simultaneous snapshot.
        </p>
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
