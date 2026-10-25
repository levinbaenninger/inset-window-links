import { Cancel01Icon, Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { cn } from "cn";
import type { RefObject } from "react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import { formatClock, formatDay, plural } from "@/lib/format";

import type { CaptureListItem, ListedView } from "../../../shared/dto";

type CurrentItem = Extract<CaptureListItem, { kind: "current" }>;

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

/** "2 of 3 done", or nothing when the capture has no next steps. */
const progress = (item: CurrentItem): string | null => {
  if (item.todos.length === 0) {
    return null;
  }

  const done = item.todos.filter((todo) => todo.done).length;

  return done === item.todos.length
    ? "All done"
    : `${done} of ${item.todos.length} done`;
};

const CurrentRow = ({
  item,
  active,
}: {
  item: CurrentItem;
  active: boolean;
}) => (
  <li>
    <Link
      aria-current={active ? "page" : undefined}
      className={cn(
        "focus-visible:ring-ring/50 flex items-start gap-2.5 rounded-lg px-2 py-2 outline-none focus-visible:ring-3",
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
        <span className="text-muted-foreground truncate text-xs tabular-nums">
          {[
            formatClock(item.createdAt),
            plural(item.views.length, "view"),
            progress(item),
          ]
            .filter((part) => part !== null)
            .join(" · ")}
        </span>
      </span>
    </Link>
  </li>
);

const KeptRow = ({ children }: { children: string }) => (
  <li className="text-muted-foreground border-foreground/15 rounded-lg border border-dashed px-2.5 py-2 text-xs">
    {children}
  </li>
);

const Row = ({ item, active }: { item: CaptureListItem; active: boolean }) => {
  switch (item.kind) {
    case "unsupported": {
      return (
        <KeptRow>
          {`Saved by a newer version of Inset Window Links (format ${item.version}). It is kept unchanged.`}
        </KeptRow>
      );
    }

    case "unreadable": {
      return (
        <KeptRow>
          This capture could not be read. Its files are kept unchanged.
        </KeptRow>
      );
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
    ...item.todos.map((todo) => todo.text),
    ...item.views.flatMap((view) => [view.title ?? "", view.appName ?? ""]),
  ]
    .join("\n")
    .toLocaleLowerCase();

  return haystack.includes(query);
};

/** Groups newest-first items under their day, keeping the store's order. */
const byDay = (items: readonly CaptureListItem[]) => {
  const groups: { day: string; items: CaptureListItem[] }[] = [];

  for (const item of items) {
    const day = item.kind === "current" ? formatDay(item.createdAt) : "Other";
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

/** The sidebar's list: captures by day, newest first, filtered by the search. */
export const RecentList = ({
  items,
  query,
  activeId,
}: {
  items: readonly CaptureListItem[];
  query: string;
  activeId: string | undefined;
}) => {
  const needle = query.trim().toLocaleLowerCase();
  const shown = items.filter((item) => matches(item, needle));

  if (items.length === 0) {
    return (
      <p
        className="text-muted-foreground px-2 py-6 text-center text-xs"
        data-testid="recent-empty"
      >
        No captures yet
      </p>
    );
  }

  if (shown.length === 0) {
    return (
      <p
        className="text-muted-foreground px-2 py-6 text-center text-xs"
        data-testid="recent-no-match"
      >
        No captures match “{query.trim()}”
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
