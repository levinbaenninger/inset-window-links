import {
  ArrowLeft01Icon,
  ArrowLeft02Icon,
  ArrowRight01Icon,
  Copy01Icon,
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
    await libraryApi().copyImage(captureId, view.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="flex h-full flex-col">
      {/* The title strip: it moves the window, with room for the traffic lights or the caption buttons. */}
      <header className="drag-region mac:pl-20 win:pr-36 border-foreground/10 flex h-11 shrink-0 items-center gap-0.5 border-b px-3">
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
            <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
              {index + 1} of {detail.views.length}
            </span>
          </p>
          <p className="text-muted-foreground truncate text-xs">
            {[view.appName, formatDateTime(view.capturedAt)]
              .filter((part) => part !== null)
              .join(" · ")}
          </p>
        </div>
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
        {detail.views.length > 1 && (
          <>
            <IconButton
              disabled={previous === undefined}
              icon={ArrowLeft01Icon}
              keys="←"
              label="Previous window"
              onClick={() => go(previous?.id)}
            />
            <IconButton
              disabled={next === undefined}
              icon={ArrowRight01Icon}
              keys="→"
              label="Next window"
              onClick={() => go(next?.id)}
            />
          </>
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
            alt={`Window ${index + 1}, ${viewTitle(view.title)}`}
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
