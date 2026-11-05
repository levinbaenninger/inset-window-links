import { Add01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import { useEffect, useRef, useState } from "react";

import {
  DescribeButton,
  WINDOW_DESCRIPTION_PLACEHOLDER,
} from "@/components/describe-button";
import { Kbd } from "@/components/ui/kbd";
import { viewTitle } from "@/lib/format";

import type {
  PendingSummary,
  ShortcutStatus,
  ViewSummary,
} from "../../../shared/dto";
import type { ViewDescriptions } from "../../../shared/text";
import { MAX_VIEW_DESCRIPTION } from "../../../shared/text";

const TILE_IMAGE =
  "border-foreground/10 bg-muted aspect-[16/10] w-full overflow-hidden rounded-md border";

const TILE_TITLE = "text-muted-foreground truncate px-0.5 text-xs";

const SourceChip = ({
  view,
  index,
  open,
  description,
  onToggle,
  onDescribe,
  onRemove,
}: {
  view: ViewSummary;
  index: number;
  open: boolean;
  description: string;
  onToggle: () => void;
  /** Opens the window's image with its description field focused. */
  onDescribe: () => void;
  onRemove: () => void;
}) => {
  const title = viewTitle(view.title);

  return (
    <li
      className="group relative flex min-w-0 flex-col"
      data-testid="source-chip"
      data-view-id={view.id}
    >
      <button
        aria-expanded={open}
        aria-label={`${open ? "Hide" : "Show"} preview of window ${index + 1}, ${title}`}
        className={cn(
          TILE_IMAGE,
          "focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
          open && "ring-brand ring-2"
        )}
        onClick={onToggle}
        type="button"
      >
        <img
          alt=""
          className="size-full object-cover object-top"
          src={view.imageUrl}
        />
      </button>
      <span
        className={cn(TILE_TITLE, "mt-1")}
        data-testid="source-chip-title"
        title={[
          title,
          view.appName,
          view.sameWindowAs === null
            ? null
            : `again, as window ${view.sameWindowAs}`,
        ]
          .filter((part) => part !== null)
          .join(" · ")}
      >
        {title}
      </span>
      <DescribeButton
        description={description}
        label={`window ${index + 1}, ${title}`}
        onClick={onDescribe}
      />
      <button
        aria-label={`Remove window ${index + 1}, ${title}`}
        className="bg-background/90 text-foreground hover:bg-destructive hover:border-destructive focus-visible:ring-ring/50 border-foreground/10 absolute top-1 right-1 grid size-6 place-items-center rounded-full border opacity-0 outline-none group-focus-within:opacity-100 group-hover:opacity-100 hover:text-white focus-visible:ring-3"
        onClick={onRemove}
        type="button"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={12} />
      </button>
    </li>
  );
};

/** A window being captured, shown before its image exists so the press is answered at once. */
const PendingChip = ({ pending }: { pending: PendingSummary }) => (
  <li
    aria-busy
    className="flex min-w-0 flex-col gap-1"
    data-testid="pending-chip"
  >
    <span className={cn(TILE_IMAGE, "animate-pulse")} />
    <span className={TILE_TITLE}>
      {pending === null ? "Adding a window…" : viewTitle(pending.title)}
    </span>
  </li>
);

/**
 * Where the next window lands: opens the window list to pick several at once. It also shows the
 * other way in, the shortcut from any window, which verify-desktop reads by the hint test id.
 * It takes the next free cell, or a short bar across the row when the row above is full, so it
 * never opens a whole row of tile-high empty space. Before the first window the bar is taller.
 */
const AddTile = ({
  layout,
  shortcut,
  addKeys,
  onAdd,
}: {
  layout: AddLayout;
  shortcut: ShortcutStatus;
  addKeys: string;
  onAdd: () => void;
}) => {
  const bar = layout !== "cell";

  return (
    <li className={cn("flex min-w-0 flex-col", bar && "col-span-3")}>
      <button
        aria-label="Add windows"
        className={cn(
          "border-foreground/15 text-muted-foreground hover:text-foreground hover:bg-foreground/5 focus-visible:ring-ring/50 flex w-full items-center justify-center rounded-md border border-dashed text-xs outline-none focus-visible:ring-3",
          {
            bar: "h-10 gap-2",
            cell: "aspect-[16/10] flex-col gap-1.5",
            first: "h-[4.75rem] gap-2",
          }[layout]
        )}
        onClick={onAdd}
        title={
          shortcut.kind === "registered"
            ? `Pick windows from a list (${addKeys}), or press ${shortcut.label} in any window`
            : `Pick windows from a list (${addKeys}). ${shortcut.label} is taken by another app`
        }
        type="button"
      >
        <span
          className={cn(
            "flex items-center gap-1",
            layout === "first" && "text-foreground text-sm font-medium"
          )}
        >
          <HugeiconsIcon icon={Add01Icon} size={bar ? 16 : 18} />
          {bar && "Add windows"}
        </span>
        {shortcut.kind === "registered" && (
          <span className="flex items-center gap-1.5">
            {bar && "or"}
            <Kbd data-testid="hint">{shortcut.label}</Kbd>
          </span>
        )}
      </button>
    </li>
  );
};

type AddLayout = "first" | "bar" | "cell";

const COLUMNS = 3;

/** The last view in the open view's row, after which its image and description open. */
const rowEnd = (openIndex: number, views: number) =>
  Math.min((Math.floor(openIndex / COLUMNS) + 1) * COLUMNS, views) - 1;

/** The Add tile takes a cell beside the last tile, or a bar of its own when it starts a row. */
const addLayout = (count: number, startsRow: boolean): AddLayout => {
  if (count === 0) {
    return "first";
  }

  return startsRow || count % COLUMNS === 0 ? "bar" : "cell";
};

/**
 * The windows as tiles, three to a row, with Add windows last. Each tile names its window and
 * shows its description, or + Description. A tile opens its image under its own row, with the
 * description field, so the field sits by the window it describes. Past three rows the tiles
 * scroll inside themselves, keeping the newest in sight.
 */
export const SourceChips = ({
  views,
  pending,
  shortcut,
  addKeys,
  descriptions,
  onAdd,
  onDescribe,
  onRemove,
}: {
  views: readonly ViewSummary[];
  /** Windows still being captured, each with its title once known. */
  pending: readonly PendingSummary[];
  shortcut: ShortcutStatus;
  addKeys: string;
  descriptions: ViewDescriptions;
  onAdd: () => void;
  onDescribe: (view: ViewSummary, description: string) => void;
  onRemove: (view: ViewSummary) => void;
}) => {
  const list = useRef<HTMLUListElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const count = views.length + pending.length;
  const openIndex = views.findIndex((view) => view.id === openId);
  const open = views[openIndex] ?? null;
  const previewAfter = open === null ? -1 : rowEnd(openIndex, views.length);

  useEffect(() => {
    const last = list.current?.lastElementChild;

    if (count > 0 && last instanceof HTMLElement) {
      last.scrollIntoView({ block: "nearest" });
    }
  }, [count]);

  const preview = open !== null && (
    <li
      className="border-foreground/10 bg-background mac:dark:bg-card col-span-3 flex flex-col overflow-hidden rounded-lg border"
      key="preview"
    >
      {/* verify-desktop reads the image's size through this test id. */}
      <img
        alt={`Capture of ${viewTitle(open.title)}`}
        className="bg-muted max-h-32 w-full object-contain"
        data-testid="source-preview"
        height={open.height}
        src={open.imageUrl}
        width={open.width}
      />
      <textarea
        aria-label={`Description of window ${openIndex + 1}, ${viewTitle(open.title)}`}
        className="placeholder:text-muted-foreground border-foreground/10 field-sizing-content max-h-[calc(4lh+1rem)] min-h-[calc(1lh+1rem)] resize-none border-t bg-transparent px-3 py-2 text-sm outline-none"
        data-testid="window-description"
        key={open.id}
        maxLength={MAX_VIEW_DESCRIPTION}
        onChange={(event) => onDescribe(open, event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.blur();
          }
        }}
        placeholder={WINDOW_DESCRIPTION_PLACEHOLDER}
        ref={field}
        rows={1}
        value={descriptions[open.id] ?? ""}
      />
    </li>
  );

  return (
    <section aria-label="Windows in this capture">
      {/* Many windows scroll inside the grid; with an image open the panel scrolls instead,
          so the image, its field and Add windows stay in one piece. */}
      <ul
        className={cn(
          "-m-1 grid grid-cols-3 gap-x-2 gap-y-3 p-1",
          open === null && "max-h-[24rem] overflow-y-auto"
        )}
        ref={list}
      >
        {views.map((view, index) => [
          <SourceChip
            description={descriptions[view.id] ?? ""}
            index={index}
            key={view.id}
            onDescribe={() => {
              setOpenId(view.id);
              requestAnimationFrame(() => field.current?.focus());
            }}
            onRemove={() => onRemove(view)}
            onToggle={() => setOpenId(open?.id === view.id ? null : view.id)}
            open={open?.id === view.id}
            view={view}
          />,
          index === previewAfter ? preview : null,
        ])}
        {pending.map((item, index) => (
          <PendingChip key={index} pending={item} />
        ))}
        <AddTile
          addKeys={addKeys}
          layout={addLayout(
            count,
            previewAfter === views.length - 1 &&
              pending.length === 0 &&
              views.length % COLUMNS !== 0
          )}
          onAdd={onAdd}
          shortcut={shortcut}
        />
      </ul>
    </section>
  );
};
