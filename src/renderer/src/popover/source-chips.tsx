import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatTime, viewTitle } from "@/lib/format";

import type { ViewSummary } from "../../../shared/dto";

const SourceChip = ({
  view,
  index,
  onRemove,
}: {
  view: ViewSummary;
  index: number;
  onRemove: () => void;
}) => {
  const [expanded, setExpanded] = useState(false);
  const title = viewTitle(view.title);

  const meta = [view.appName, formatTime(view.capturedAt)]
    .filter((part) => part !== null)
    .join(" · ");

  return (
    <li
      className="bg-card overflow-hidden rounded-lg border"
      data-testid="source-chip"
      data-view-id={view.id}
    >
      <div className="flex items-center gap-1.5 py-1 pr-1 pl-2.5">
        <button
          aria-expanded={expanded}
          aria-label={`${expanded ? "Hide" : "Show"} preview of view ${index + 1}, ${title}`}
          className="focus-visible:ring-ring flex min-w-0 flex-1 flex-col rounded-md py-0.5 text-left outline-none focus-visible:ring-2"
          onClick={() => setExpanded(!expanded)}
          type="button"
        >
          <span
            className="truncate font-medium"
            data-testid="source-chip-title"
          >
            {title}
          </span>
          <span className="text-muted-foreground truncate text-xs">
            {meta}
            {view.sameWindowAs === null
              ? ""
              : ` · same window as view ${view.sameWindowAs}`}
          </span>
        </button>
        {view.source.kind === "fallback" && (
          <Badge variant="outline">Chosen from list</Badge>
        )}
        <Button
          aria-label={`Remove view ${index + 1}, ${title}`}
          onClick={onRemove}
          size="icon-sm"
          variant="ghost"
        >
          <HugeiconsIcon icon={Cancel01Icon} />
        </Button>
      </div>
      {expanded && (
        <img
          alt={`Capture of ${title}`}
          className="bg-muted max-h-60 w-full border-t object-contain"
          height={view.height}
          src={view.imageUrl}
          width={view.width}
        />
      )}
    </li>
  );
};

export const SourceChips = ({
  views,
  onRemove,
}: {
  views: readonly ViewSummary[];
  onRemove: (view: ViewSummary) => void;
}) =>
  views.length === 0 ? null : (
    <ul aria-label="Views in this capture" className="flex flex-col gap-1.5">
      {views.map((view, index) => (
        <SourceChip
          index={index}
          key={view.id}
          onRemove={() => onRemove(view)}
          view={view}
        />
      ))}
    </ul>
  );
