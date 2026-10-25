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
        aria-label={`${open ? "Hide" : "Show"} preview of view ${index + 1}, ${title}`}
        className={cn(
          TILE_IMAGE,
          "focus-visible:ring-ring/50 outline-none focus-visible:ring-3",
          open && "ring-primary ring-2"
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
      <span className="flex min-w-0 flex-col px-0.5">
        <span
          className="truncate text-xs font-medium"
          data-testid="source-chip-title"
          title={title}
        >
          {title}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {view.sameWindowAs === null
            ? (view.appName ?? "Window")
            : `Again, as view ${view.sameWindowAs}`}
        </span>
      </span>
      <button
        aria-label={`Remove view ${index + 1}, ${title}`}
        className="bg-background/90 text-foreground hover:bg-background focus-visible:ring-ring/50 absolute top-1 right-1 grid size-6 place-items-center rounded-full opacity-0 shadow-sm outline-none group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:ring-3"
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
    <span className={cn(TILE_IMAGE, "animate-pulse")} />
    <span className="flex min-w-0 flex-col px-0.5">
      <span className="truncate text-xs font-medium">
        {viewTitle(pending.title)}
      </span>
      <span className="text-muted-foreground truncate text-xs">Capturing…</span>
    </span>
  </li>
);

/**
 * Where the next view lands: opens the window list to pick several at once. Before the first
 * view it fills the row, since it is the first thing to do.
 */
const AddTile = ({ first, onAdd }: { first: boolean; onAdd: () => void }) => (
  <li className={cn("flex min-w-0 flex-col", first && "col-span-3")}>
    <button
      className={cn(
        "border-foreground/15 text-muted-foreground hover:text-foreground hover:bg-foreground/5 focus-visible:ring-ring/50 flex w-full flex-col items-center justify-center gap-1 rounded-md border border-dashed text-xs outline-none focus-visible:ring-3",
        first ? "h-28" : "aspect-[16/10]"
      )}
      onClick={onAdd}
      type="button"
    >
      <HugeiconsIcon icon={Add01Icon} size={16} />
      <span className={cn(first && "text-foreground text-sm font-medium")}>
        Add windows
      </span>
      {first && <span>Pick the windows this thought is about</span>}
    </button>
  </li>
);

/** Under the tiles: the other way in, from any window. */
const ShortcutHint = ({ shortcut }: { shortcut: ShortcutStatus }) => (
  <p
    className="text-muted-foreground flex items-center gap-1.5 text-xs"
    data-testid="hint"
  >
    {shortcut.kind === "registered" ? (
      <>
        Or press <Kbd>{shortcut.label}</Kbd> in any window to add it.
      </>
    ) : (
      `${shortcut.label} is taken by another app, so pick windows with Add windows.`
    )}
  </p>
);

/**
 * The views as tiles, three to a row, with Add windows last. Past three rows the tiles scroll
 * inside themselves, keeping the newest in sight. A tile opens its whole capture below.
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
    <section aria-label="Views in this capture" className="flex flex-col gap-2">
      <ul
        className="-mx-1 grid max-h-[22.5rem] grid-cols-3 gap-x-2 gap-y-3 overflow-y-auto px-1 pt-0.5 pb-1"
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
        <AddTile first={count === 0} onAdd={onAdd} />
      </ul>
      {open !== null && (
        <img
          alt={`Capture of ${viewTitle(open.title)}`}
          className="border-foreground/10 bg-muted max-h-64 w-full rounded-md border object-contain"
          data-testid="source-preview"
          height={open.height}
          src={open.imageUrl}
          width={open.width}
        />
      )}
      <ShortcutHint shortcut={shortcut} />
    </section>
  );
};
