import { CheckmarkCircle02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  DragTileView,
  PermissionRowState,
  PermissionRowView,
} from "@shared/onboarding";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The row's one control: Allow, Waiting… (pulsing), Allowed (green), or Reopen to finish. */
export const PermissionControl = ({
  onAllow,
  onReopen,
  state,
  title,
}: {
  readonly state: PermissionRowState;
  readonly title: string;
  readonly onAllow: () => void;
  readonly onReopen: () => void;
}) => {
  if (state === "allowed") {
    return (
      <output
        aria-label={`${title} allowed`}
        className="bg-granted/12 text-granted inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2.5 text-xs font-medium"
      >
        <HugeiconsIcon className="size-3.5" icon={CheckmarkCircle02Icon} />
        Allowed
      </output>
    );
  }

  if (state === "waiting") {
    return (
      <Button
        aria-label={`Waiting for ${title}. Open System Settings again`}
        onClick={onAllow}
        size="sm"
        variant="outline"
      >
        <span
          aria-hidden="true"
          className="bg-pin size-1.5 rounded-full motion-safe:animate-pulse"
        />
        Waiting…
      </Button>
    );
  }

  if (state === "reopen" || state === "reopening") {
    return (
      <Button disabled={state === "reopening"} onClick={onReopen} size="sm">
        {state === "reopening" ? "Reopening…" : "Reopen to finish"}
      </Button>
    );
  }

  return (
    <Button aria-label={`Allow ${title}`} onClick={onAllow} size="sm">
      Allow
    </Button>
  );
};

/**
 * The app as System Settings lists it, to drag into the list when it isn't
 * there: the system drags the app bundle itself (src/main/permissions/bundle.ts).
 */
export const DragTile = ({
  listName,
  onDragStart,
  tile,
}: {
  readonly tile: DragTileView;
  readonly listName: string;
  readonly onDragStart: () => void;
}) => (
  <div className="flex flex-col items-start gap-1.5">
    <button
      aria-label={`Drag ${tile.name} into the ${listName} list`}
      className="bg-background border-foreground/15 focus-visible:ring-ring/50 flex h-11 cursor-grab items-center gap-2 rounded-lg border pr-3.5 pl-2 shadow-xs outline-none focus-visible:ring-3 active:cursor-grabbing"
      draggable
      onDragStart={(event) => {
        // The system drag carries the bundle; the page's own drag would carry nothing.
        event.preventDefault();
        onDragStart();
      }}
      type="button"
    >
      <img
        alt=""
        className="size-8"
        draggable={false}
        height={32}
        src={tile.icon}
        width={32}
      />
      <span className="text-sm font-semibold">{tile.name}</span>
    </button>
    <p className="text-muted-foreground text-xs leading-snug">
      ↑ Drag {tile.name} into the {listName} list
    </p>
  </div>
);

/**
 * One permission: what it is for and its control. The row being asked for
 * stands out; while it waits it also offers the tile to drag in, for when
 * the app isn't in System Settings' list.
 */
export const PermissionRow = ({
  active,
  onAllow,
  onDragTile,
  onReopen,
  row,
  tile,
}: {
  readonly row: PermissionRowView;
  readonly active: boolean;
  readonly tile: DragTileView | null;
  readonly onAllow: () => void;
  readonly onReopen: () => void;
  readonly onDragTile: () => void;
}) => {
  const showTile =
    active &&
    tile !== null &&
    (row.state === "waiting" || row.state === "reopen");

  return (
    <li
      aria-current={active ? "step" : undefined}
      className={cn(
        "flex flex-col gap-3 px-3.5 py-3 transition-colors motion-reduce:transition-none",
        active ? "bg-background/80" : "bg-transparent"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="text-sm font-medium">{row.title}</h3>
          <p className="text-muted-foreground text-xs leading-snug">
            {row.purpose}
          </p>
          {row.state === "reopen" || row.state === "reopening" ? (
            <p className="text-muted-foreground text-xs leading-snug">
              Turn it on in System Settings. macOS applies it once the app opens
              again.
            </p>
          ) : null}
        </div>
        <PermissionControl
          onAllow={onAllow}
          onReopen={onReopen}
          state={row.state}
          title={row.title}
        />
      </div>
      {showTile ? (
        <DragTile
          listName={row.listName}
          onDragStart={onDragTile}
          tile={tile}
        />
      ) : null}
    </li>
  );
};
