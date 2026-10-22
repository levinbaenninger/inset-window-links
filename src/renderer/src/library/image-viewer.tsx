import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Copy01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { libraryApi } from "@/lib/bridge";
import { formatDateTime, viewTitle } from "@/lib/format";

import type { CaptureDetail } from "../../../shared/dto";

/** Shows the image at one image pixel per device pixel, so captured text stays readable. */
export const ImageViewer = ({
  detail,
  index,
}: {
  detail: CaptureDetail;
  index: number;
}) => {
  const navigate = useNavigate();
  const [copied, setCopied] = useState(false);
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
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [captureId, navigate, previous, next]);

  if (view === undefined) {
    return null;
  }

  const copy = async () => {
    await libraryApi().copyImage(captureId, view.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <Button asChild size="sm" variant="ghost">
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
        <Button onClick={copy} size="sm" variant="ghost">
          <HugeiconsIcon icon={copied ? Tick02Icon : Copy01Icon} />
          {copied ? "Copied" : "Copy image"}
        </Button>
        {detail.views.length > 1 && (
          <div className="flex gap-1">
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
      <div className="bg-muted flex flex-1 overflow-auto p-4">
        <img
          alt={`Source ${index + 1}, ${viewTitle(view.title)}`}
          className="m-auto max-w-none"
          height={Math.round(view.height / window.devicePixelRatio)}
          src={view.imageUrl}
          width={Math.round(view.width / window.devicePixelRatio)}
        />
      </div>
    </main>
  );
};
