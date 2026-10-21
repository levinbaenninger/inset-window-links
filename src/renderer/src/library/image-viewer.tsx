import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { formatDateTime, viewTitle } from "@/lib/format";

import type { ViewSummary } from "../../../shared/dto";

/** Shows the image at one image pixel per device pixel, so captured text stays readable. */
export const ImageViewer = ({
  captureId,
  view,
  index,
}: {
  captureId: string;
  view: ViewSummary;
  index: number;
}) => {
  const navigate = useNavigate();

  useEffect(() => {
    const onKeyDown = async (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        await navigate({
          params: { captureId },
          search: {},
          to: "/captures/$captureId",
        });
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [captureId, navigate]);

  return (
    <main className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-2">
        <Button asChild size="sm" variant="ghost">
          <Link params={{ captureId }} search={{}} to="/captures/$captureId">
            <HugeiconsIcon icon={ArrowLeft01Icon} />
            Back to capture
          </Link>
        </Button>
        <div className="min-w-0">
          <p className="truncate font-medium">
            Source {index + 1}: {viewTitle(view.title)}
          </p>
          <p className="text-muted-foreground truncate text-xs">
            {[view.appName, `captured ${formatDateTime(view.capturedAt)}`]
              .filter((part) => part !== null)
              .join(" · ")}
          </p>
        </div>
      </header>
      <div className="bg-muted flex-1 overflow-auto p-4">
        <img
          alt={`Source ${index + 1}, ${viewTitle(view.title)}`}
          className="max-w-none"
          height={Math.round(view.height / window.devicePixelRatio)}
          src={view.imageUrl}
          width={Math.round(view.width / window.devicePixelRatio)}
        />
      </div>
    </main>
  );
};
