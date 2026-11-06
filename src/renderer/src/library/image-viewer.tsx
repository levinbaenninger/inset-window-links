import {
  ArrowLeft02Icon,
  Copy01Icon,
  RepeatIcon,
  Tick02Icon,
  ZoomInAreaIcon,
  ZoomOutAreaIcon,
} from "@hugeicons/core-free-icons";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";

import { IconButton } from "@/components/icon-button";
import { libraryApi } from "@/lib/bridge";
import { formatWhen, viewTitle } from "@/lib/format";

import type { CaptureDetail, ViewSummary } from "../../../shared/dto";
import { copyCapture, notCopiedText } from "./copy-gate";

const FEEDBACK_MS = 2000;
const FAILURE_MS = 6000;

/** The capture's windows along the foot of the viewer; the open one is marked. */
const Filmstrip = ({
  views,
  current,
  onPick,
}: {
  views: readonly ViewSummary[];
  current: number;
  onPick: (view: ViewSummary) => void;
}) => (
  <nav
    aria-label="Windows in this capture"
    className="flex shrink-0 justify-center-safe gap-2 overflow-x-auto px-4 pt-1 pb-4"
  >
    {views.map((item, position) => (
      <button
        aria-current={position === current ? "true" : undefined}
        aria-label={`Window ${position + 1}, ${viewTitle(item.title)}`}
        className={cn(
          "bg-background focus-visible:ring-ring/50 h-12 w-20 shrink-0 overflow-hidden rounded-md outline-none focus-visible:ring-3",
          position === current
            ? "ring-brand ring-2"
            : "ring-foreground/10 opacity-70 ring-1 hover:opacity-100"
        )}
        key={item.id}
        onClick={() => onPick(item)}
        title={viewTitle(item.title)}
        type="button"
      >
        <img
          alt=""
          className="size-full object-cover object-top"
          src={item.imageUrl}
        />
      </button>
    ))}
  </nav>
);

/**
 * One window of a capture on a single quiet surface, as Quick Look shows a file. It fits the
 * window first; actual size shows one image pixel per device pixel, so small captured text stays
 * readable. Clicking the image or Z switches between the two, the arrow keys step through the
 * capture's windows, and Escape goes back.
 */
export const ImageViewer = ({
  detail,
  index,
}: {
  detail: CaptureDetail;
  index: number;
}) => {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
  /** Why the last copy put nothing on the clipboard, such as an edit that could not be saved. */
  const [refused, setRefused] = useState<string | null>(null);
  const [reopened, setReopened] = useState<string | null>(null);
  const [actualSize, setActualSize] = useState(false);
  const captureId = detail.id;
  const view = detail.views[index];
  const previous = detail.views[index - 1];
  const next = detail.views[index + 1];

  /** To another window of this capture, or back to the capture without one. */
  const go = useCallback(
    async (viewId?: string) => {
      await navigate({
        params: { captureId },
        search: viewId === undefined ? {} : { view: viewId },
        to: "/captures/$captureId",
      });
    },
    [captureId, navigate]
  );

  useEffect(() => {
    const onKeyDown = async (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        document.querySelector('[role="dialog"], [role="menu"]') !== null
      ) {
        return;
      }

      if (event.key === "Escape") {
        await go();
      }

      if (event.key === "ArrowLeft" && previous !== undefined) {
        await go(previous.id);
      }

      if (event.key === "ArrowRight" && next !== undefined) {
        await go(next.id);
      }

      if (event.key === "z" || event.key === "Z") {
        setActualSize((value) => !value);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go, previous, next]);

  if (view === undefined) {
    return null;
  }

  // Fit never enlarges past actual size, so a small capture is not blurred up.
  const cssWidth = Math.round(view.width / window.devicePixelRatio);
  const cssHeight = Math.round(view.height / window.devicePixelRatio);

  const copy = async () => {
    const result = await copyCapture(
      captureId,
      { kind: "image", viewId: view.id },
      libraryApi()
    );

    if (result.kind === "copied") {
      setRefused(null);
      setCopied(true);
      setTimeout(() => setCopied(false), FEEDBACK_MS);
    } else {
      setRefused(notCopiedText(result, "viewer"));
      setTimeout(() => setRefused(null), FAILURE_MS);
    }
  };

  const reopen = async () => {
    const { failed } = await libraryApi().reopen(captureId, [view.id]);

    setReopened(failed === 0 ? "Opened" : "Couldn't open");
    setTimeout(() => setReopened(null), FEEDBACK_MS);
  };

  return (
    <main className="bg-muted/60 dark:bg-background flex h-full flex-col">
      {/* The title strip: it moves the window, with room for the traffic lights or the caption buttons. */}
      <header className="drag-region mac:pl-20 win:pr-36 flex h-11 shrink-0 items-center gap-0.5 px-3">
        <IconButton
          icon={ArrowLeft02Icon}
          keys="Esc"
          label="Back"
          onClick={() => go()}
        />
        <div className="ml-1.5 min-w-0 flex-1 leading-tight">
          <p className="flex min-w-0 items-baseline gap-2 text-sm">
            <span className="truncate font-medium">
              {viewTitle(view.title)}
            </span>
            {detail.views.length > 1 && (
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                {index + 1} of {detail.views.length}
              </span>
            )}
          </p>
          <p className="text-muted-foreground truncate text-xs">
            {[view.appName, formatWhen(view.capturedAt)]
              .filter((part) => part !== null)
              .join(" · ")}
          </p>
        </div>
        {reopened !== null && (
          <output className="text-muted-foreground mr-1 text-xs">
            {reopened}
          </output>
        )}
        {refused !== null && (
          <output
            className="text-destructive mr-1 max-w-1/2 min-w-0 truncate text-xs"
            data-testid="viewer-feedback"
            title={refused}
          >
            {refused}
          </output>
        )}
        {view.origin !== null && (
          <IconButton
            icon={RepeatIcon}
            label={`Reopen ${view.origin.label}`}
            onClick={reopen}
          />
        )}
        <IconButton
          aria-keyshortcuts="Z"
          aria-pressed={actualSize}
          icon={actualSize ? ZoomOutAreaIcon : ZoomInAreaIcon}
          keys="Z"
          label={actualSize ? "Fit to window" : "Actual size"}
          onClick={() => setActualSize(!actualSize)}
        />
        <IconButton
          icon={copied ? Tick02Icon : Copy01Icon}
          label={copied ? "Copied" : "Copy image"}
          onClick={copy}
        />
      </header>
      <div className="flex min-h-0 flex-1 overflow-auto px-6 pt-2 pb-4">
        <button
          aria-label={actualSize ? "Fit to window" : "Show at actual size"}
          className={cn(
            "focus-visible:ring-ring/50 rounded-lg outline-none focus-visible:ring-3",
            actualSize
              ? "m-auto shrink-0 cursor-zoom-out"
              : "flex size-full cursor-zoom-in"
          )}
          onClick={() => setActualSize(!actualSize)}
          type="button"
        >
          <img
            alt={`Window ${index + 1}, ${viewTitle(view.title)}`}
            className={cn(
              "ring-foreground/10 rounded-lg shadow-lg ring-1",
              actualSize
                ? "h-(--image-h) w-(--image-w) max-w-none"
                : "m-auto aspect-(--image-ratio) max-h-(--image-fit-h) max-w-(--image-fit-w) object-contain"
            )}
            data-testid="viewer-image"
            src={view.imageUrl}
            // SAFETY: CSSProperties has no index for custom properties; every key here is a --image-* variable the classes above read.
            style={
              {
                "--image-fit-h": `min(100%, ${cssHeight}px)`,
                "--image-fit-w": `min(100%, ${cssWidth}px)`,
                "--image-h": `${cssHeight}px`,
                "--image-ratio": `${view.width} / ${view.height}`,
                "--image-w": `${cssWidth}px`,
              } as CSSProperties
            }
          />
        </button>
      </div>
      {detail.views.length > 1 && (
        <Filmstrip
          current={index}
          onPick={(item) => go(item.id)}
          views={detail.views}
        />
      )}
    </main>
  );
};
