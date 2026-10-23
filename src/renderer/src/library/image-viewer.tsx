import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Copy01Icon,
  Tick02Icon,
  ZoomInAreaIcon,
  ZoomOutAreaIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { cn } from "cn";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { libraryApi } from "@/lib/bridge";
import { formatDateTime, viewTitle } from "@/lib/format";

import type { CaptureDetail } from "../../../shared/dto";

/**
 * Fits the whole capture in the window first. Actual size shows one image pixel per device pixel,
 * so small captured text stays readable; clicking the image or Z switches between the two.
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
  const [actualSize, setActualSize] = useState(false);
  const captureId = detail.id;
  const view = detail.views[index];
  const previous = detail.views[index - 1];
  const next = detail.views[index + 1];

  useEffect(() => {
    const go = async (viewId?: string) => {
      await navigate({
        params: { captureId },
        search: viewId === undefined ? {} : { view: viewId },
        to: "/captures/$captureId",
      });
    };

    const onKeyDown = async (event: KeyboardEvent) => {
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
  }, [captureId, navigate, previous, next]);

  if (view === undefined) {
    return null;
  }

  // Fit never enlarges past actual size, so a small capture is not blurred up.
  const cssWidth = Math.round(view.width / window.devicePixelRatio);
  const cssHeight = Math.round(view.height / window.devicePixelRatio);

  const copy = async () => {
    await libraryApi().copyImage(captureId, view.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="flex h-full flex-col">
      {/* On Windows this header is the title strip: draggable, with room on the right for the caption buttons. */}
      <header className="win:app-drag win:pr-36 flex items-center gap-3 border-b px-4 py-2">
        <Button asChild className="app-no-drag" size="sm" variant="ghost">
          <Link params={{ captureId }} search={{}} to="/captures/$captureId">
            <HugeiconsIcon icon={ArrowLeft01Icon} />
            Back to capture
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            Source {index + 1} of {detail.views.length}: {viewTitle(view.title)}
          </p>
          <p className="text-muted-foreground truncate text-xs">
            {[view.appName, `captured ${formatDateTime(view.capturedAt)}`]
              .filter((part) => part !== null)
              .join(" · ")}
          </p>
        </div>
        <Button
          aria-keyshortcuts="Z"
          className="app-no-drag"
          aria-pressed={actualSize}
          onClick={() => setActualSize(!actualSize)}
          size="sm"
          title="Switch with Z"
          variant="ghost"
        >
          <HugeiconsIcon icon={actualSize ? ZoomOutAreaIcon : ZoomInAreaIcon} />
          {actualSize ? "Fit to window" : "Actual size"}
        </Button>
        <Button
          className="app-no-drag"
          onClick={copy}
          size="sm"
          variant="ghost"
        >
          <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} />
          {copied ? "Copied" : "Copy image"}
        </Button>
        {detail.views.length > 1 && (
          <div className="app-no-drag flex gap-1">
            <Button
              aria-label="Previous source"
              disabled={previous === undefined}
              onClick={() =>
                previous !== undefined &&
                navigate({
                  params: { captureId },
                  search: { view: previous.id },
                  to: "/captures/$captureId",
                })
              }
              size="icon-sm"
              variant="outline"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} />
            </Button>
            <Button
              aria-label="Next source"
              disabled={next === undefined}
              onClick={() =>
                next !== undefined &&
                navigate({
                  params: { captureId },
                  search: { view: next.id },
                  to: "/captures/$captureId",
                })
              }
              size="icon-sm"
              variant="outline"
            >
              <HugeiconsIcon icon={ArrowRight01Icon} />
            </Button>
          </div>
        )}
      </header>
      <div className="bg-muted flex min-h-0 flex-1 overflow-auto p-4">
        <button
          aria-label={actualSize ? "Fit to window" : "Show at actual size"}
          className={cn(
            "focus-visible:ring-ring/50 rounded-sm outline-none focus-visible:ring-3",
            actualSize
              ? "m-auto shrink-0 cursor-zoom-out"
              : "flex size-full cursor-zoom-in"
          )}
          onClick={() => setActualSize(!actualSize)}
          type="button"
        >
          <img
            alt={`Source ${index + 1}, ${viewTitle(view.title)}`}
            className={
              actualSize
                ? "h-(--image-h) w-(--image-w) max-w-none"
                : "m-auto aspect-(--image-ratio) max-h-(--image-fit-h) max-w-(--image-fit-w) object-contain"
            }
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
    </main>
  );
};
