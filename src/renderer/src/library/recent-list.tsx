import { getRouteApi, Link } from "@tanstack/react-router";

import { formatDateTime, viewTitle } from "@/lib/format";

import type { CaptureListItem } from "../../../shared/dto";

const route = getRouteApi("/");

const RecentItem = ({ item }: { item: CaptureListItem }) => {
  if (item.kind === "unsupported") {
    return (
      <li className="text-muted-foreground rounded-lg border border-dashed p-3">
        Saved by a newer version of Inset Window Links (format {item.version}).
        It is kept unchanged.
      </li>
    );
  }

  if (item.kind === "unreadable") {
    return (
      <li className="text-muted-foreground rounded-lg border border-dashed p-3">
        This capture could not be read. Its files are kept unchanged.
      </li>
    );
  }

  return (
    <li>
      <Link
        className="hover:bg-muted focus-visible:ring-ring flex flex-col gap-1 rounded-lg border p-3 outline-none focus-visible:ring-2"
        data-testid="recent-item"
        params={{ captureId: item.id }}
        to="/captures/$captureId"
      >
        <span className="line-clamp-2 font-medium">{item.relationship}</span>
        <span className="text-muted-foreground truncate text-xs">
          {formatDateTime(item.createdAt)} · {item.sourceTitles.length}{" "}
          {item.sourceTitles.length === 1 ? "view" : "views"}:{" "}
          {item.sourceTitles.map(viewTitle).join(", ")}
        </span>
      </Link>
    </li>
  );
};

export const RecentList = () => {
  const items = route.useLoaderData();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <h1 className="font-heading text-lg font-semibold">Recent captures</h1>
      {items.length === 0 ? (
        <p className="text-muted-foreground">
          No captures yet. Press the Add View shortcut in another window to
          start one.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <RecentItem item={item} key={item.id} />
          ))}
        </ul>
      )}
    </main>
  );
};
