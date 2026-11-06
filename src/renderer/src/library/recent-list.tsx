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
import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

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
import { libraryApi } from "@/lib/bridge";
import { useCommands } from "@/lib/commands";
import { formatClock, formatDay } from "@/lib/format";
import type { MenuKey } from "@/lib/menu-keys";

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
import type { DraftText } from "../../../shared/text";
import { isBlank } from "../../../shared/text";
import { MenuEntries, useCaptureCommands } from "./capture-commands";
import { retryLabel } from "./copy-gate";
import { useEntryCopy } from "./copy-keys";
import { storedText } from "./drafts";
import { drafts } from "./page-drafts";
import type { RowAction } from "./row-keys";
import { neighborRow, rowKey } from "./row-keys";

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
      className="flex shrink-0 items-center gap-1 whitespace-nowrap"
    >
      <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} />
      {done}/{item.todos.length}
    </span>
  );
};

/** When a snoozed capture comes back, under the heading of that day; otherwise the time it was saved. */
const When = ({ item }: { item: CurrentItem }) => (
  <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
    {item.status.kind === "snoozed" && (
      <HugeiconsIcon icon={AlarmClockIcon} size={12} />
    )}
    {formatClock(
      item.status.kind === "snoozed" ? item.status.until : item.createdAt
    )}
  </span>
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

/**
 * Whether the due chip is wider than the row's text column, as a long date can be at the
 * narrowest sidebar. The chip then gets a line of its own under the row, never a shortened label.
 */
const useChipOwnLine = (
  column: RefObject<HTMLElement | null>,
  chip: RefObject<HTMLElement | null>,
  label: string | null
): boolean => {
  const [ownLine, setOwnLine] = useState(false);

  useLayoutEffect(() => {
    const host = column.current;

    if (host === null || label === null) {
      return;
    }

    const check = () =>
      setOwnLine((chip.current?.offsetWidth ?? 0) > host.clientWidth);

    // The chip's own width changes too, as when the font finishes loading.
    const observer = new ResizeObserver(check);

    observer.observe(host);

    if (chip.current !== null) {
      observer.observe(chip.current);
    }

    return () => observer.disconnect();
  }, [column, chip, label]);

  return label !== null && ownLine;
};

/**
 * The fields as the capture's page shows them: as typed, or as just saved, so words and a due date
 * not saved yet, or put back by a discard, read the same in the row.
 */
const useShownText = (item: CurrentItem): DraftText => {
  const stored = useMemo(() => storedText(item), [item]);

  const draft = useSyncExternalStore(drafts.subscribe, () =>
    drafts.draft(item.id)
  );

  const confirmed = useSyncExternalStore(drafts.subscribe, () =>
    drafts.confirmed(item.id)
  );

  return draft?.values ?? confirmed ?? stored;
};

/**
 * A capture in the list; right-click focuses it and opens what the capture's own "…" menu holds.
 * The row in focus takes the keys for a capture: ⌘C, the menu keys, Space to mark it done (or take
 * a done one back) and ⌫ to delete it. A row leaving the list hands focus on to the next row.
 * While its menu is open, the keys the menu shows act on this row whatever is highlighted: the
 * menu closes, focus comes back here, and the row does what the key says. Space and Return pick
 * the highlighted item instead.
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
  const link = useRef<HTMLAnchorElement>(null);
  const column = useRef<HTMLSpanElement>(null);
  const chip = useRef<HTMLSpanElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  /** A key pressed in the open menu, run once the menu has closed. */
  const afterMenu = useRef<RowAction | null>(null);
  /** From the menu opening until it has given focus back. */
  const menuHeld = useRef(false);
  const { platform } = libraryApi();

  // Words typed in this capture that could not be saved: they wait in it, so the row says so.
  const unsaved = useSyncExternalStore(
    drafts.subscribe,
    () => drafts.error(item.id) !== undefined
  );

  const text = useShownText(item);
  const { due } = text;

  // A blank title shows the stored one.
  const title = isBlank(text.relationship)
    ? item.relationship
    : text.relationship.trim();

  const commands = useCaptureCommands({
    from: "row",
    id: item.id,
    reopenable: item.reopenable,
    row: link,
    status: item.status,
    text,
    title,
  });

  const { feedback } = commands;

  /** A refused copy that offers Retry has a line of its own, under the row, outside its link. */
  const refused =
    feedback?.retry === undefined
      ? null
      : { retry: feedback.retry, text: feedback.text };

  const found = matchSource(item, needle);
  const dueShown = due !== null && item.status.kind !== "done";

  const chipOwnLine = useChipOwnLine(
    column,
    chip,
    dueShown ? `${due}@${now.toDateString()}` : null
  );

  const run = (action: RowAction) => {
    switch (action) {
      case "copyEntry": {
        void commands.copyEntry.run();
        break;
      }

      case "copyNote": {
        void commands.copyNote.run();
        break;
      }

      case "reopen": {
        void commands.reopen?.run();
        break;
      }

      case "delete": {
        commands.askDelete();
        break;
      }

      default: {
        if (link.current !== null) {
          neighborRow(link.current)?.focus();
        }

        void (item.status.kind === "done"
          ? commands.backToList.run()
          : commands.done.run());
      }
    }
  };

  const act = (action: RowAction) => {
    if (menuOpen) {
      afterMenu.current = action;
      setMenuOpen(false);
    } else {
      run(action);
    }
  };

  /** A key the open menu shows: it runs for this row, whatever item is highlighted. */
  const menuKey = (key: MenuKey): boolean => {
    if (key === "reopen" && commands.reopen === null) {
      return false;
    }

    act(key);

    return true;
  };

  useEntryCopy(link, () => act("copyEntry"));

  /*
   * A row leaving the list while it has focus, or while its menu has (or just had) it, hands
   * focus on to the next row. A menu item such as Mark as done can take the row out before the
   * closed menu gives focus back, and an open menu keeps focus inside it until it has gone, so
   * focus moves on once the menu is gone and only when nothing else took it.
   */
  useLayoutEffect(() => {
    const row = link.current;

    return () => {
      const focused = document.activeElement;
      const lost = focused === null || focused === document.body;

      const inMenu =
        focused?.closest(`[data-row-menu="${item.id}"]`) !== null &&
        focused !== null;

      if (
        row === null ||
        !(focused === row || inMenu || (lost && menuHeld.current))
      ) {
        return;
      }

      const next = neighborRow(row);

      setTimeout(() => {
        const current = document.activeElement;

        if (
          next?.isConnected === true &&
          (current === null || current === document.body)
        ) {
          next.focus();
        }
      }, 0);
    };
  }, [item.id]);

  useCommands((command) => {
    if (document.activeElement !== link.current) {
      return false;
    }

    switch (command) {
      case "copyNote":
      case "reopen":
      case "toggleDone": {
        act(command);

        return true;
      }

      default: {
        return false;
      }
    }
  });

  const badge =
    dueShown && due !== null ? (
      <DueBadge className="ml-auto" due={due} now={now} ref={chip} />
    ) : null;

  return (
    <li>
      <ContextMenu
        onOpenChange={(open) => {
          setMenuOpen(open);

          if (open) {
            menuHeld.current = true;
            commands.onMenuOpen();
          }
        }}
        open={menuOpen}
      >
        <ContextMenuTrigger asChild>
          <Link
            aria-current={active ? "page" : undefined}
            aria-keyshortcuts={`Space ${platform === "macos" ? "Backspace" : "Delete"}`}
            className={cn(
              "focus-visible:ring-ring/50 data-[state=open]:bg-foreground/5 flex flex-col gap-1 rounded-md px-2 py-2 outline-none focus-visible:ring-3",
              active ? "bg-foreground/10" : "hover:bg-foreground/5"
            )}
            data-testid="recent-item"
            onContextMenu={(event) => event.currentTarget.focus()}
            onKeyDown={(event) => {
              const action = rowKey(event, platform);

              if (action === "toggleDone" || action === "delete") {
                event.preventDefault();
                run(action);
              }
            }}
            params={{ captureId: item.id }}
            ref={link}
            to="/captures/$captureId"
          >
            <span className="flex items-start gap-2.5">
              <Thumbnail views={item.views} />
              <span
                className="flex min-w-0 flex-1 flex-col gap-0.5"
                ref={column}
              >
                <span className="line-clamp-2 text-sm leading-snug font-medium">
                  <Highlight needle={needle} text={title} />
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
                {/*
                 * Reversed and wrapping, so what no longer fits beside the chip wraps out of sight:
                 * the time first, then the step progress. The chip itself always stays whole.
                 */}
                <span
                  className="text-muted-foreground flex max-h-5 flex-row-reverse flex-wrap items-center justify-end gap-x-2.5 overflow-hidden text-xs tabular-nums"
                  data-testid="row-meta"
                >
                  {!chipOwnLine && badge}
                  {feedback === null || refused !== null ? (
                    <>
                      {unsaved && (
                        <span
                          className="text-destructive shrink-0"
                          data-testid="row-unsaved"
                          title="Changes couldn’t be saved. Open the capture to retry or discard them."
                        >
                          Not saved
                        </span>
                      )}
                      <Progress item={item} />
                      <When item={item} />
                    </>
                  ) : (
                    <output
                      className={cn(
                        "min-w-0 flex-1 truncate",
                        feedback.failed && "text-destructive"
                      )}
                      title={feedback.text}
                    >
                      {feedback.text}
                    </output>
                  )}
                </span>
              </span>
            </span>
            {chipOwnLine && badge !== null && (
              <span className="flex justify-end">{badge}</span>
            )}
          </Link>
        </ContextMenuTrigger>
        <ContextMenuContent
          className="min-w-52"
          data-row-menu={item.id}
          onCloseAutoFocus={(event) => {
            event.preventDefault();

            const action = afterMenu.current;

            afterMenu.current = null;
            menuHeld.current = false;

            const row = link.current;

            const free =
              document.activeElement === null ||
              document.activeElement === document.body;

            // A dialog the menu opened keeps focus; otherwise it comes back to this row.
            if (row?.isConnected === true && free) {
              row.focus();
            }

            if (action !== null) {
              run(action);
            }
          }}
          onMenuKey={menuKey}
        >
          <MenuEntries entries={commands.entries} kind="context" />
        </ContextMenuContent>
      </ContextMenu>
      {refused !== null && (
        <div
          className="flex items-center gap-2 px-2 pt-0.5 pb-1.5"
          data-testid="row-copy-refused"
        >
          <output
            className="text-destructive line-clamp-3 min-w-0 flex-1 text-xs leading-snug"
            title={refused.text}
          >
            {refused.text}
          </output>
          <Button
            aria-label={`${retryLabel(refused.retry.kind)} “${title}”`}
            onClick={() => {
              // The row keeps focus, so ⌘C copies again once the words are saved.
              link.current?.focus();
              refused.retry.run();
            }}
            size="xs"
            variant="outline"
          >
            Retry
          </Button>
        </div>
      )}
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
      return <KeptRow>Can’t be read</KeptRow>;
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
 * or after one that names no filter: each token with what it means, in the same list as the other
 * Inset apps. Picking one finishes the word; Return picks the first while a word is being typed.
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
  const parsed = parseQuery(query);
  const filters = dueSuggestions(parsed);
  const returnPicks = parsed.partialDue !== null;

  return filters.length === 0 ? null : (
    <ul
      aria-label="Due filters"
      className="flex flex-col pt-1.5"
      data-testid="due-suggestions"
    >
      {filters.map((filter, index) => {
        const first = returnPicks && index === 0;

        return (
          <li key={filter}>
            <Button
              aria-label={`${DUE_FILTER_LABELS[filter]} (due:${filter})`}
              className="w-full justify-between"
              onClick={() => {
                onQuery(withDueFilter(query, filter));
                onPicked();
              }}
              size="xs"
              title={first ? "Return picks this one" : undefined}
              type="button"
              variant={first ? "secondary" : "ghost"}
            >
              <span className="shrink-0">due:{filter}</span>
              <span className="text-muted-foreground min-w-0 truncate font-normal">
                {DUE_FILTER_LABELS[filter]}
              </span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
};

const FULL_PLACEHOLDER = "Search or due:today";

/** Air between the end of the placeholder and the filter button. */
const PLACEHOLDER_AIR = 12;

/**
 * The search's placeholder: "Search or due:today" when it fits with some air, else "Search", so
 * at the narrowest sidebar it never runs into the filter button.
 */
const useFittingPlaceholder = (
  field: RefObject<HTMLInputElement | null>
): string => {
  const [fits, setFits] = useState(true);

  useLayoutEffect(() => {
    const input = field.current;
    const context = document.createElement("canvas").getContext("2d");

    if (input === null || context === null) {
      return;
    }

    const check = () => {
      const style = getComputedStyle(input);

      context.font = style.font;

      // Computed padding is always in px, such as "6px".
      const room =
        input.clientWidth -
        Number(style.paddingLeft.slice(0, -2)) -
        Number(style.paddingRight.slice(0, -2));

      setFits(
        context.measureText(FULL_PLACEHOLDER).width + PLACEHOLDER_AIR <= room
      );
    };

    const observer = new ResizeObserver(check);

    observer.observe(input);
    // The width of the text changes once the font has loaded.
    void document.fonts.ready.then(check);

    return () => observer.disconnect();
  }, [field]);

  return fits ? FULL_PLACEHOLDER : "Search";
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
  const placeholder = useFittingPlaceholder(field);

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
        placeholder={placeholder}
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
