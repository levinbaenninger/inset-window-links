import { Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import { useEffect, useEffectEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { plural, viewTitle } from "@/lib/format";

import type { CandidateSummary, FallbackReason } from "../../../shared/dto";
import type { CandidateId } from "../../../shared/ids";

/** Why the list opened instead of the window in front being added. Picking from the menu needs no reason. */
const reasons = {
  ambiguous: "The window in front could not be told apart from another.",
  captureFailed: "The window in front could not be captured.",
  invalidId: "The window in front could not be identified.",
  menu: null,
  noMatch: "The window in front could not be found to capture.",
  probeUnavailable: "The window in front could not be read.",
  vanished: "The window in front closed before it was captured.",
} satisfies { [K in FallbackReason]: string | null };

const Tile = ({
  candidate,
  picked,
  onToggle,
  onAddOnly,
}: {
  candidate: CandidateSummary;
  picked: boolean;
  onToggle: () => void;
  onAddOnly: () => void;
}) => (
  <li className="min-w-0">
    <button
      aria-pressed={picked}
      className="group focus-visible:ring-ring/50 flex w-full min-w-0 flex-col gap-1 rounded-md text-left outline-none focus-visible:ring-3"
      onClick={onToggle}
      onDoubleClick={onAddOnly}
      type="button"
    >
      <span
        className={cn(
          "bg-muted relative aspect-video w-full overflow-hidden rounded-md border",
          picked
            ? "border-primary ring-primary ring-1"
            : "border-foreground/10 group-hover:border-foreground/25"
        )}
      >
        <img
          alt=""
          className="size-full object-contain"
          src={candidate.imageUrl}
        />
        {picked && (
          <span className="bg-primary text-primary-foreground absolute top-1.5 left-1.5 grid size-5 place-items-center rounded-full">
            <HugeiconsIcon icon={Tick02Icon} size={12} strokeWidth={2.5} />
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-col px-0.5">
        <span className="truncate text-xs font-medium">
          {viewTitle(candidate.title)}
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {candidate.appName ?? "Window"}
        </span>
      </span>
    </button>
  </li>
);

/**
 * Every open window as a tile; click to pick as many as needed, double-click to add just
 * one. ⌘A picks all, ⌘↵ adds, Escape goes back to the draft.
 */
export const SourceChooser = ({
  mac,
  reason,
  candidates,
  onChoose,
  onCancel,
}: {
  mac: boolean;
  reason: FallbackReason;
  candidates: readonly CandidateSummary[] | "loading";
  onChoose: (ids: readonly CandidateId[]) => void;
  onCancel: () => void;
}) => {
  const [picked, setPicked] = useState<ReadonlySet<CandidateId>>(new Set());
  const list = candidates === "loading" ? [] : candidates;
  const allPicked = list.length > 0 && picked.size === list.length;
  const why = reasons[reason];

  const toggle = (id: CandidateId) => {
    const next = new Set(picked);

    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }

    setPicked(next);
  };

  const add = () => {
    if (picked.size > 0) {
      // In the order the windows are listed, which is the order they land in.
      onChoose(list.flatMap((item) => (picked.has(item.id) ? [item.id] : [])));
    }
  };

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const command = mac ? event.metaKey : event.ctrlKey;

    if (command && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setPicked(new Set(list.map((item) => item.id)));
    } else if (command && event.key === "Enter") {
      event.preventDefault();
      add();
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <section
      aria-label="Choose windows"
      className="flex flex-col gap-3"
      data-testid="source-chooser"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-xs">
          {why ?? "Pick the windows this thought is about."}
        </p>
        {list.length > 0 && (
          <Button
            className="-mr-2"
            onClick={() =>
              setPicked(
                allPicked ? new Set() : new Set(list.map((item) => item.id))
              )
            }
            size="xs"
            variant="ghost"
          >
            {allPicked ? "Select none" : "Select all"}
          </Button>
        )}
      </div>
      {candidates === "loading" ? (
        <ul
          aria-busy
          aria-label="Loading windows"
          className="grid grid-cols-3 gap-2"
        >
          {Array.from({ length: 6 }, (_, index) => (
            <li
              className="bg-muted aspect-video animate-pulse rounded-md"
              key={index}
            />
          ))}
        </ul>
      ) : (
        <ul
          aria-label="Open windows"
          className="-mx-1 grid max-h-[26rem] grid-cols-3 gap-x-2 gap-y-3 overflow-y-auto px-1 pt-0.5 pb-1"
        >
          {candidates.map((candidate) => (
            <Tile
              candidate={candidate}
              key={candidate.id}
              onAddOnly={() => onChoose([candidate.id])}
              onToggle={() => toggle(candidate.id)}
              picked={picked.has(candidate.id)}
            />
          ))}
          {candidates.length === 0 && (
            <li className="text-muted-foreground col-span-3 py-8 text-center text-xs">
              No other windows are open.
            </li>
          )}
        </ul>
      )}
      <footer className="flex items-center justify-between gap-2">
        <Button onClick={onCancel} size="sm" variant="ghost">
          Back
        </Button>
        <Button disabled={picked.size === 0} onClick={add} size="sm">
          {picked.size === 0
            ? "Add windows"
            : `Add ${plural(picked.size, "window")}`}
          <span className="opacity-70">{mac ? "⌘↵" : "Ctrl+Enter"}</span>
        </Button>
      </footer>
    </section>
  );
};
