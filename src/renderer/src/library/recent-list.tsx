import {
  AlarmClockIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import type { RefObject } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { formatClock, formatDay } from "@/lib/format";

import type { CaptureListItem, ListedView } from "../../../shared/dto";
import type { StatusKind } from "../../../shared/status";
import { MenuEntries, useCaptureCommands } from "./capture-commands";

export type CurrentItem = Extract<CaptureListItem, { kind: "current" }>;

/** The first view, with a count of the rest, in a fixed column so every row's text lines up. */
const Thumbnail = ({ views }: { views: readonly ListedView[] }) => {
  const [first] = views;
  const more = views.length - 1;

  return (
    <span
      aria-hidden
      className="border-foreground/10 bg-muted relative mt-0.5 h-10 w-14 shrink-0 overflow-hidden rounded-md border"
    >
      {first !== undefined && (
        <img
          alt=""
          className="size-full object-cover object-top"
          loading="lazy"
          src={first.imageUrl}
        />
      )}
      {more > 0 && (
        <span className="bg-background/90 absolute right-0.5 bottom-0.5 rounded-sm px-1 text-xs leading-4 font-medium tabular-nums">
          +{more}
        </span>
      )}
    </span>
  );
};

/** "1/3" with a check, or nothing when the capture has no next steps. */
const Progress = ({ item }: { item: CurrentItem }) => {
  if (item.todos.length === 0) {
    return null;
  }

  const done = item.todos.filter((todo) => todo.done).length;

  return (
    <span
      aria-label={`${done} of ${item.todos.length} next steps done`}
      className="flex items-center gap-1"
    >
      <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} />
      {done}/{item.todos.length}
    </span>
  );
};

/** When a snoozed capture comes back, under the heading of that day; otherwise the time it was saved. */
const When = ({ item }: { item: CurrentItem }) =>
  item.status.kind === "snoozed" ? (
    <span className="flex items-center gap-1">
      <HugeiconsIcon icon={AlarmClockIcon} size={12} />
      {formatClock(item.status.until)}
    </span>
  ) : (
    formatClock(item.createdAt)
  );

/** A capture in the list; right-click opens what the capture's own "…" menu holds. */
const CurrentRow = ({
  item,
  active,
}: {
  item: CurrentItem;
  active: boolean;
}) => {
  const commands = useCaptureCommands({
    id: item.id,
    reopenable: item.reopenable,
    status: item.status,
  });

  return (
    <li>
      <ContextMenu onOpenChange={(open) => open && commands.onMenuOpen()}>
        <ContextMenuTrigger asChild>
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring/50 data-[state=open]:bg-foreground/5 flex items-start gap-2.5 rounded-md px-2 py-2 outline-none focus-visible:ring-3",
              active ? "bg-foreground/10" : "hover:bg-foreground/5"
            )}
            data-testid="recent-item"
            params={{ captureId: item.id }}
            to="/captures/$captureId"
          >
            <Thumbnail views={item.views} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="line-clamp-2 text-sm leading-snug font-medium">
                {item.relationship}
              </span>
              <span className="text-muted-foreground flex items-center gap-2.5 text-xs tabular-nums">
                <When item={item} />
                <Progress item={item} />
              </span>
            </span>
          </Link>
        </ContextMenuTrigger>
        <ContextMenuContent className="min-w-48">
          <MenuEntries entries={commands.entries} kind="context" />
        </ContextMenuContent>
      </ContextMenu>
      {commands.dialog}
    </li>
  );
};

const KeptRow = ({ children }: { children: string }) => (
  <li className="text-muted-foreground border-foreground/15 rounded-lg border border-dashed px-2.5 py-2 text-xs">
    {children}
  </li>
);

const Row = ({ item, active }: { item: CaptureListItem; active: boolean }) => {
  switch (item.kind) {
    case "unsupported": {
      return <KeptRow>Saved by a newer version</KeptRow>;
    }

    case "unreadable": {
      return <KeptRow>Can&apos;t be read</KeptRow>;
    }

    default: {
      return <CurrentRow active={active} item={item} />;
    }
  }
};

export const matches = (item: CaptureListItem, query: string): boolean => {
  if (item.kind !== "current") {
    return query === "";
  }

  const haystack = [
    item.relationship,
    item.description,
    ...item.todos.map((todo) => todo.text),
    ...item.views.flatMap((view) => [view.title ?? "", view.appName ?? ""]),
  ]
    .join("\n")
    .toLocaleLowerCase();

  return haystack.includes(query);
};

/** The time a row is grouped and ordered by: when a snoozed capture comes back, else when it was saved. */
const listedAt = (item: CaptureListItem): string => {
  if (item.kind !== "current") {
    return "";
  }

  return item.status.kind === "snoozed" ? item.status.until : item.createdAt;
};

/** Groups items under their day, keeping the order they come in. */
const byDay = (items: readonly CaptureListItem[]) => {
  const groups: { day: string; items: CaptureListItem[] }[] = [];

  for (const item of items) {
    const day = item.kind === "current" ? formatDay(listedAt(item)) : "Other";
    const last = groups.at(-1);

    if (last?.day === day) {
      last.items.push(item);
    } else {
      groups.push({ day, items: [item] });
    }
  }

  return groups;
};

export const SearchField = ({
  query,
  onQuery,
  field,
}: {
  query: string;
  onQuery: (query: string) => void;
  field: RefObject<HTMLInputElement | null>;
}) => (
  <InputGroup>
    <InputGroupAddon>
      <HugeiconsIcon icon={Search01Icon} />
    </InputGroupAddon>
    <InputGroupInput
      aria-label="Search captures"
      onChange={(event) => onQuery(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && query !== "") {
          event.preventDefault();
          onQuery("");
        }
      }}
      placeholder="Search"
      ref={field}
      type="text"
      value={query}
    />
    {query === "" ? null : (
      <InputGroupAddon align="inline-end">
        <InputGroupButton
          aria-label="Clear search"
          onClick={() => {
            onQuery("");
            field.current?.focus();
          }}
          size="icon-xs"
        >
          <HugeiconsIcon icon={Cancel01Icon} />
        </InputGroupButton>
      </InputGroupAddon>
    )}
  </InputGroup>
);

/** Which list a row belongs to. A record the app can't read stays with the captures in the list. */
export const listOf = (item: CaptureListItem): StatusKind =>
  item.kind === "current" ? item.status.kind : "active";

const EMPTY: Record<StatusKind, string> = {
  active: "No captures yet",
  done: "Nothing done yet",
  snoozed: "Nothing snoozed",
};

/**
 * One of the sidebar's lists, filtered by the search, under day headings: captures in the list
 * and done ones newest first, snoozed ones by when they come back, soonest first.
 */
export const RecentList = ({
  items,
  list,
  query,
  activeId,
}: {
  items: readonly CaptureListItem[];
  list: StatusKind;
  query: string;
  activeId: string | undefined;
}) => {
  const needle = query.trim().toLocaleLowerCase();
  const inList = items.filter((item) => listOf(item) === list);

  const ordered =
    list === "snoozed"
      ? inList.toSorted((a, b) => listedAt(a).localeCompare(listedAt(b)))
      : inList;

  const shown = ordered.filter((item) => matches(item, needle));

  if (inList.length === 0) {
    return (
      <p
        className="text-muted-foreground px-2 py-6 text-center text-xs"
        data-testid="recent-empty"
      >
        {list === "active" && items.length > 0
          ? "Nothing left in the list"
          : EMPTY[list]}
      </p>
    );
  }

  if (shown.length === 0) {
    return (
      <p
        className="text-muted-foreground px-2 py-6 text-center text-xs"
        data-testid="recent-no-match"
      >
        No matches
      </p>
    );
  }

  return (
    <>
      {byDay(shown).map((group) => (
        <section
          aria-label={group.day}
          className="flex flex-col gap-0.5"
          key={group.day}
        >
          <h2 className="text-muted-foreground px-2 pt-2 pb-1 text-xs font-medium">
            {group.day}
          </h2>
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <Row active={item.id === activeId} item={item} key={item.id} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
};
