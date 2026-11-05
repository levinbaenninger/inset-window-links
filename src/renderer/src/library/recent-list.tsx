import {
  AlarmClockIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  FilterHorizontalIcon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import type { ReactNode, RefObject } from "react";
import { useRef } from "react";

import { DueBadge, useToday } from "@/components/due";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { useCommands } from "@/lib/commands";
import { formatClock, formatDay } from "@/lib/format";

import type { CaptureListItem, ListedView } from "../../../shared/dto";
import type { DueFilter, SearchQuery } from "../../../shared/due";
import {
  DUE_FILTER_LABELS,
  DUE_FILTERS,
  dueSuggestions,
  parseQuery,
  withDueFilter,
} from "../../../shared/due";
import { matchesCapture, matchSource } from "../../../shared/search";
import type { StatusKind } from "../../../shared/status";
import { MenuEntries, useCaptureCommands } from "./capture-commands";
import { entryText } from "./copy-keys";

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

/**
 * "1/3" with a check, or nothing when the capture has no next steps. A narrow row with a due chip
 * leaves it out, so the chip's date stays whole.
 */
const Progress = ({
  item,
  dueShown,
}: {
  item: CurrentItem;
  dueShown: boolean;
}) => {
  if (item.todos.length === 0) {
    return null;
  }

  const done = item.todos.filter((todo) => todo.done).length;

  return (
    <span
      aria-label={`${done} of ${item.todos.length} next steps done`}
      className={cn(
        "flex items-center gap-1",
        dueShown && "@max-[250px]:hidden"
      )}
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

/** The text with every match of the search marked, so a row shows why it is listed. */
const Highlight = ({ text, needle }: { text: string; needle: string }) => {
  if (needle === "") {
    return text;
  }

  const lower = text.toLocaleLowerCase();
  const parts: ReactNode[] = [];
  let from = 0;
  let at = lower.indexOf(needle);

  while (at >= 0) {
    parts.push(
      text.slice(from, at),
      <mark className="bg-brand/20 text-foreground rounded-xs" key={at}>
        {text.slice(at, at + needle.length)}
      </mark>
    );
    from = at + needle.length;
    at = lower.indexOf(needle, from);
  }

  parts.push(text.slice(from));

  return parts;
};

const ROW_SELECTOR = "[data-testid='recent-item']";

/**
 * A capture in the list; right-click focuses it and opens what the capture's own "…" menu holds.
 * The row in focus takes the menu keys for a capture, and Space marks it done, or takes a done one
 * back. The row then leaves this list, so focus moves on to the next row first, and Space again
 * does the next one.
 */
const CurrentRow = ({
  item,
  active,
  needle,
  now,
}: {
  item: CurrentItem;
  active: boolean;
  needle: string;
  now: Date;
}) => {
  const commands = useCaptureCommands({
    due: item.due,
    from: "row",
    id: item.id,
    reopenable: item.reopenable,
    status: item.status,
  });

  const { feedback } = commands;
  const found = matchSource(item, needle);
  const dueShown = item.due !== null && item.status.kind !== "done";

  const toggleDone = (row: HTMLElement) => {
    const rows = [...document.querySelectorAll<HTMLElement>(ROW_SELECTOR)];
    const at = rows.indexOf(row);

    (rows[at + 1] ?? rows[at - 1])?.focus();
    void (item.status.kind === "done"
      ? commands.backToList.run()
      : commands.done.run());
  };

  const link = useRef<HTMLAnchorElement>(null);

  useCommands((command) => {
    const row = link.current;

    // Its menu still open counts too: that menu shows these keys beside its items.
    if (
      row === null ||
      (document.activeElement !== row && row.dataset["state"] !== "open")
    ) {
      return false;
    }

    switch (command) {
      case "copyNote": {
        void commands.copy.run();

        return true;
      }

      case "reopen": {
        void commands.reopen?.run();

        return true;
      }

      case "toggleDone": {
        toggleDone(row);

        return true;
      }

      default: {
        return false;
      }
    }
  });

  return (
    <li>
      <ContextMenu onOpenChange={(open) => open && commands.onMenuOpen()}>
        <ContextMenuTrigger asChild>
          <Link
            aria-current={active ? "page" : undefined}
            aria-keyshortcuts="Space"
            className={cn(
              "focus-visible:ring-ring/50 data-[state=open]:bg-foreground/5 flex items-start gap-2.5 rounded-md px-2 py-2 outline-none focus-visible:ring-3",
              active ? "bg-foreground/10" : "hover:bg-foreground/5"
            )}
            data-copy={entryText(item.relationship, item.description)}
            data-testid="recent-item"
            // The menu's keys then act on this row once it closes.
            onContextMenu={(event) => event.currentTarget.focus()}
            onKeyDown={(event) => {
              const plain =
                !event.metaKey &&
                !event.ctrlKey &&
                !event.altKey &&
                !event.shiftKey;

              if (event.key === " " && plain && !event.repeat) {
                event.preventDefault();
                toggleDone(event.currentTarget);
              }
            }}
            params={{ captureId: item.id }}
            ref={link}
            to="/captures/$captureId"
          >
            <Thumbnail views={item.views} />
            <span className="@container flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="line-clamp-2 text-sm leading-snug font-medium">
                <Highlight needle={needle} text={item.relationship} />
              </span>
              {found !== null && (
                <span
                  className="text-muted-foreground line-clamp-1 text-xs"
                  data-testid="match-source"
                >
                  <span className="font-medium">{found.where}: </span>
                  <Highlight needle={needle} text={found.text} />
                </span>
              )}
              <span className="text-muted-foreground flex min-w-0 items-center gap-2.5 text-xs tabular-nums">
                {feedback === null ? (
                  <span
                    className={cn(
                      "flex shrink-0 items-center gap-2.5 whitespace-nowrap",
                      dueShown && "@max-[200px]:hidden"
                    )}
                  >
                    <When item={item} />
                    <Progress dueShown={dueShown} item={item} />
                  </span>
                ) : (
                  <output
                    className={cn(
                      "min-w-0 truncate",
                      feedback.failed && "text-destructive"
                    )}
                    title={feedback.text}
                  >
                    {feedback.text}
                  </output>
                )}
                {dueShown && item.due !== null && (
                  <DueBadge className="ml-auto" due={item.due} now={now} />
                )}
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

const Row = ({
  item,
  active,
  needle,
  now,
}: {
  item: CaptureListItem;
  active: boolean;
  needle: string;
  now: Date;
}) => {
  switch (item.kind) {
    case "unsupported": {
      return <KeptRow>Saved by a newer version</KeptRow>;
    }

    case "unreadable": {
      return <KeptRow>Can&apos;t be read</KeptRow>;
    }

    default: {
      return (
        <CurrentRow active={active} item={item} needle={needle} now={now} />
      );
    }
  }
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

/**
 * The due filters a search can still become, under the field while a due: word is being typed,
 * or after one that names no filter. Picking one finishes the word.
 */
export const DueSuggestions = ({
  query,
  onQuery,
  onPicked,
}: {
  query: string;
  onQuery: (query: string) => void;
  onPicked: () => void;
}) => {
  const filters = dueSuggestions(parseQuery(query));

  return filters.length === 0 ? null : (
    <ul
      aria-label="Due filters"
      className="flex flex-wrap gap-1 pt-1.5"
      data-testid="due-suggestions"
    >
      {filters.map((filter) => (
        <li key={filter}>
          <button
            className="bg-foreground/5 hover:bg-foreground/10 focus-visible:ring-ring/50 flex h-6 items-center gap-1.5 rounded-md px-2 text-xs outline-none focus-visible:ring-3"
            onClick={() => {
              onQuery(withDueFilter(query, filter));
              onPicked();
            }}
            title={DUE_FILTER_LABELS[filter]}
            type="button"
          >
            <span className="font-medium">due:{filter}</span>
          </button>
        </li>
      ))}
    </ul>
  );
};

/**
 * The sidebar's search. Its filter menu adds a due filter to the words, which can also be typed;
 * Return finishes a due: word being typed, and Escape clears the search.
 */
export const SearchField = ({
  query,
  onQuery,
  field,
  findKeys,
}: {
  query: string;
  onQuery: (query: string) => void;
  field: RefObject<HTMLInputElement | null>;
  findKeys: string;
}) => {
  const parsed = parseQuery(query);
  const active = parsed.due;

  const setFilter = (filter: DueFilter | null) => {
    onQuery(withDueFilter(query, filter === active ? null : filter));
    requestAnimationFrame(() => field.current?.focus());
  };

  return (
    <InputGroup>
      <InputGroupAddon>
        <HugeiconsIcon icon={Search01Icon} />
      </InputGroupAddon>
      <InputGroupInput
        aria-label={`Search captures (${findKeys})`}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={(event) => {
          const [first] = dueSuggestions(parsed);

          if (event.key === "Escape" && query !== "") {
            event.preventDefault();
            onQuery("");
          } else if (
            event.key === "Enter" &&
            parsed.partialDue !== null &&
            first !== undefined
          ) {
            event.preventDefault();
            onQuery(withDueFilter(query, first));
          }
        }}
        placeholder="Search or due:today"
        ref={field}
        type="text"
        value={query}
      />
      <InputGroupAddon align="inline-end">
        {query === "" ? null : (
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
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <InputGroupButton
              aria-label="Filter by Due"
              data-testid="due-filter"
              size="icon-xs"
              title="Filter by Due"
            >
              <HugeiconsIcon
                className={cn(active !== null && "text-brand")}
                icon={FilterHorizontalIcon}
              />
            </InputGroupButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-72">
            <DropdownMenuLabel>Filter by Due</DropdownMenuLabel>
            {DUE_FILTERS.map((filter) => (
              <DropdownMenuItem key={filter} onSelect={() => setFilter(filter)}>
                <span className="flex-1 whitespace-nowrap">
                  {DUE_FILTER_LABELS[filter]}
                </span>
                {filter === active ? (
                  <HugeiconsIcon icon={Tick02Icon} />
                ) : (
                  <span className="text-muted-foreground text-xs">
                    due:{filter}
                  </span>
                )}
              </DropdownMenuItem>
            ))}
            {active !== null && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setFilter(null)}>
                  Show all
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </InputGroupAddon>
    </InputGroup>
  );
};

/** How the empty state names a due filter: "No matches for “chairs”, due today". */
const LOOKED_FOR: Readonly<Record<DueFilter, string>> = {
  any: "with a Due",
  none: "without a Due",
  overdue: "overdue",
  today: "due today",
  week: "due this week",
};

const lookedFor = (search: SearchQuery) =>
  [
    search.text === "" ? null : `“${search.text}”`,
    search.due === null ? null : LOOKED_FOR[search.due],
  ]
    .filter((part) => part !== null)
    .join(", ");

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
  onClear,
}: {
  items: readonly CaptureListItem[];
  list: StatusKind;
  query: string;
  activeId: string | undefined;
  onClear: () => void;
}) => {
  const now = useToday();
  const search = parseQuery(query);
  const inList = items.filter((item) => listOf(item) === list);

  const ordered =
    list === "snoozed"
      ? inList.toSorted((a, b) => listedAt(a).localeCompare(listedAt(b)))
      : inList;

  const shown = ordered.filter((item) => matchesCapture(item, search, now));

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
    const what = lookedFor(search);

    return (
      <div
        className="flex flex-col items-center gap-2 px-3 py-8 text-center"
        data-testid="recent-no-match"
      >
        <HugeiconsIcon
          className="text-muted-foreground"
          icon={Search01Icon}
          size={20}
        />
        <p className="text-sm font-medium text-balance">
          {search.unknownDue === null
            ? `No matches${what === "" ? "" : ` for ${what}`}`
            : `There is no filter due:${search.unknownDue}`}
        </p>
        <p className="text-muted-foreground text-xs text-balance">
          {search.unknownDue === null
            ? "Search looks in titles, descriptions, next steps and windows."
            : "Pick one of the filters under the search field."}
        </p>
        <Button onClick={onClear} size="sm" variant="outline">
          Clear search
        </Button>
      </div>
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
              <Row
                active={item.id === activeId}
                item={item}
                key={item.id}
                needle={search.text}
                now={now}
              />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
};
