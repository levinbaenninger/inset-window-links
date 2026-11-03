import { Add01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import { useEffect, useRef, useState } from "react";

import { Kbd } from "@/components/ui/kbd";
import { viewTitle } from "@/lib/format";

import type { ShortcutStatus, ViewSummary } from "../../../shared/dto";

export interface PendingView {
  title: string | null;
  appName: string | null;
}

const TILE_IMAGE =
  "border-foreground/10 bg-muted aspect-[16/10] w-full overflow-hidden rounded-md border";

const TILE_TITLE = "text-muted-foreground truncate px-0.5 text-xs";

const SourceChip = ({
  view,
  index,
  open,
  onToggle,
  onRemove,
}: {
  view: ViewSummary;
  index: number;
  open: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) => {
  const title = viewTitle(view.title);

  return (
    <li
      className="group relative flex min-w-0 flex-col gap-1"
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
        className={TILE_TITLE}
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

/** The window being captured, shown before its image exists so the press is answered at once. */
const PendingChip = ({ pending }: { pending: PendingView }) => (
  <li
    aria-busy
    className="flex min-w-0 flex-col gap-1"
    data-testid="pending-chip"
  >
    <span className={TILE_IMAGE} />
    <span className={TILE_TITLE}>{viewTitle(pending.title)}</span>
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
  onAdd,
}: {
  layout: AddLayout;
  shortcut: ShortcutStatus;
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
            ? undefined
            : `${shortcut.label} is taken by another app`
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

const addLayout = (count: number): AddLayout => {
  if (count === 0) {
    return "first";
  }

  return count % 3 === 0 ? "bar" : "cell";
};

/**
 * The windows as tiles, three to a row, with Add windows last. Past three rows the tiles scroll
 * inside themselves, keeping the newest in sight. A tile opens its whole image below.
 */
export const SourceChips = ({
  views,
  pending,
  shortcut,
  onAdd,
  onRemove,
}: {
  views: readonly ViewSummary[];
  pending: PendingView | null;
  shortcut: ShortcutStatus;
  onAdd: () => void;
  onRemove: (view: ViewSummary) => void;
}) => {
  const list = useRef<HTMLUListElement>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const count = views.length + (pending === null ? 0 : 1);
  const open = views.find((view) => view.id === openId) ?? null;

  useEffect(() => {
    const last = list.current?.lastElementChild;

    if (count > 0 && last instanceof HTMLElement) {
      last.scrollIntoView({ block: "nearest" });
    }
  }, [count]);

  return (
    <section
      aria-label="Windows in this capture"
      className="flex flex-col gap-2"
    >
      <ul
        className="-m-1 grid max-h-[22.5rem] grid-cols-3 gap-x-2 gap-y-3 overflow-y-auto p-1"
        ref={list}
      >
        {views.map((view, index) => (
          <SourceChip
            index={index}
            key={view.id}
            onRemove={() => onRemove(view)}
            onToggle={() => setOpenId(open?.id === view.id ? null : view.id)}
            open={open?.id === view.id}
            view={view}
          />
        ))}
        {pending === null ? null : <PendingChip pending={pending} />}
        <AddTile layout={addLayout(count)} onAdd={onAdd} shortcut={shortcut} />
      </ul>
      {open !== null && (
        <img
          alt={`Capture of ${viewTitle(open.title)}`}
          className="border-foreground/10 bg-muted max-h-64 w-full rounded-lg border object-contain"
          data-testid="source-preview"
          height={open.height}
          src={open.imageUrl}
          width={open.width}
        />
      )}
    </section>
  );
};
