import { HelpCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getRouteApi, Link } from "@tanstack/react-router";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { formatClock, formatDay, plural, viewTitle } from "@/lib/format";

import type {
  CaptureListItem,
  ListedView,
  ShortcutStatus,
} from "../../../shared/dto";

const route = getRouteApi("/");

type CurrentItem = Extract<CaptureListItem, { kind: "current" }>;

/** The first view, with a count of the rest, in a fixed column so every row's text lines up. */
const Thumbnail = ({ views }: { views: readonly ListedView[] }) => {
  const [first] = views;
  const more = views.length - 1;

  return (
    <span
      aria-hidden
      className="bg-muted relative h-12 w-20 shrink-0 overflow-hidden rounded-md border"
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
        <span className="bg-background/85 absolute right-1 bottom-1 rounded-sm px-1 text-xs font-medium tabular-nums">
          +{more}
        </span>
      )}
    </span>
  );
};

const CurrentRow = ({ item }: { item: CurrentItem }) => (
  <li>
    <Link
      className="hover:bg-muted focus-visible:ring-ring/50 -mx-3 flex items-start gap-4 rounded-lg p-3 outline-none focus-visible:ring-3"
      data-testid="recent-item"
      params={{ captureId: item.id }}
      to="/captures/$captureId"
    >
      <Thumbnail views={item.views} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 font-medium">{item.relationship}</span>
        {item.nextStep.trim() !== "" && (
          <span className="text-muted-foreground line-clamp-1 text-sm">
            Next: {item.nextStep}
          </span>
        )}
        <span className="text-muted-foreground truncate text-xs">
          {plural(item.views.length, "view")}:{" "}
          {item.views.map((view) => viewTitle(view.title)).join(", ")}
        </span>
      </span>
      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
        {formatClock(item.createdAt)}
      </span>
    </Link>
  </li>
);

const KeptRow = ({ children }: { children: string }) => (
  <li className="text-muted-foreground rounded-lg border border-dashed p-3">
    {children}
  </li>
);

const Row = ({ item }: { item: CaptureListItem }) => {
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
      return <CurrentRow item={item} />;
    }
  }
};

const matches = (item: CaptureListItem, query: string): boolean => {
  if (item.kind !== "current") {
    return query === "";
  }

  const haystack = [
    item.relationship,
    item.nextStep,
    ...item.views.map((view) => view.title ?? ""),
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

const FirstRun = ({ shortcut }: { shortcut: ShortcutStatus }) => (
  <section
    className="flex flex-col gap-2 rounded-lg border border-dashed p-6"
    data-testid="recent-empty"
  >
    <h2 className="font-medium">No captures yet</h2>
    <ol className="text-muted-foreground flex list-inside list-decimal flex-col gap-1">
      <li>
        In the window you want to keep, press{" "}
        {shortcut.kind === "registered" ? (
          <Kbd>{shortcut.label}</Kbd>
        ) : (
          "Add View from Window List in the menu bar"
        )}
        .
      </li>
      <li>Switch to the next window and press it again to add that view.</li>
      <li>Write what connects them, then save.</li>
    </ol>
    <Link
      className="text-primary self-start text-sm underline-offset-4 hover:underline"
      to="/welcome"
    >
      More about how Inset works
    </Link>
  </section>
);

export const RecentList = () => {
  const { items, shortcut } = route.useLoaderData();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const shown = items.filter((item) => matches(item, needle));
  const saved = items.filter((item) => item.kind === "current").length;

  return (
    <main className="win:pt-2 mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-2.5">
          <h1 className="font-heading text-xl font-semibold">
            Recent captures
          </h1>
          {saved > 0 && (
            <span className="text-muted-foreground text-sm tabular-nums">
              {plural(saved, "capture")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {saved > 0 && (
            <Input
              aria-label="Search captures"
              className="w-64"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search text and window titles"
              type="search"
              value={query}
            />
          )}
          <Button
            aria-label="How Inset works"
            asChild
            size="icon"
            title="How Inset works"
            variant="ghost"
          >
            <Link to="/welcome">
              <HugeiconsIcon icon={HelpCircleIcon} />
            </Link>
          </Button>
        </div>
      </header>
      {items.length === 0 && <FirstRun shortcut={shortcut} />}
      {items.length > 0 && shown.length === 0 && (
        <p className="text-muted-foreground" data-testid="recent-no-match">
          No captures match “{query.trim()}”.
        </p>
      )}
      {byDay(shown).map((group) => (
        <section
          aria-label={group.day}
          className="flex flex-col gap-1"
          key={group.day}
        >
          <h2 className="text-muted-foreground text-xs font-medium">
            {group.day}
          </h2>
          <ul className="flex flex-col">
            {group.items.map((item) => (
              <Row item={item} key={item.id} />
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
};
