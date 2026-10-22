import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { formatTime, viewTitle } from "@/lib/format";

import type { ShortcutStatus, ViewSummary } from "../../../shared/dto";

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
      <div className="flex items-center gap-2.5 p-1.5 pr-1">
        <button
          aria-expanded={expanded}
          aria-label={`${expanded ? "Hide" : "Show"} preview of view ${index + 1}, ${title}`}
          className="focus-visible:ring-ring/50 hover:bg-muted flex min-w-0 flex-1 items-center gap-2.5 rounded-md text-left outline-none focus-visible:ring-3"
          onClick={() => setExpanded(!expanded)}
          type="button"
        >
          <img
            alt=""
            className="bg-muted h-9 w-14 shrink-0 rounded-sm border object-cover object-top"
            src={view.imageUrl}
          />
          <span className="flex min-w-0 flex-col">
            <span
              className="truncate font-medium"
              data-testid="source-chip-title"
            >
              {title}
            </span>
            <span className="text-muted-foreground truncate text-xs tabular-nums">
              {meta}
              {view.sameWindowAs === null
                ? ""
                : ` · same window as view ${view.sameWindowAs}`}
            </span>
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
          data-testid="source-preview"
          height={view.height}
          src={view.imageUrl}
          width={view.width}
        />
      )}
    </li>
  );
};

/** Stands in the list where the next view will land, so collecting more than one window is visible. */
const NextViewSlot = ({ shortcut }: { shortcut: ShortcutStatus }) => (
  <li
    className="text-muted-foreground flex items-center justify-between gap-3 rounded-lg border border-dashed px-3 py-2.5 text-xs"
    data-testid="hint"
  >
    {shortcut.kind === "registered" ? (
      <>
        <span className="text-balance">
          Switch windows and press the shortcut to add a view.
        </span>
        <Kbd>{shortcut.label}</Kbd>
      </>
    ) : (
      <span>
        Switch windows and press the shortcut to add a view. The shortcut is
        taken by another app, so use Add View from Window List in the menu bar.
      </span>
    )}
  </li>
);

export const SourceChips = ({
  views,
  shortcut,
  onRemove,
}: {
  views: readonly ViewSummary[];
  shortcut: ShortcutStatus;
  onRemove: (view: ViewSummary) => void;
}) => (
  <ul aria-label="Views in this capture" className="flex flex-col gap-1.5">
    {views.map((view, index) => (
      <SourceChip
        index={index}
        key={view.id}
        onRemove={() => onRemove(view)}
        view={view}
      />
    ))}
    <NextViewSlot shortcut={shortcut} />
  </ul>
);
