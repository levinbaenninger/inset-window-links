import {
  Add01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  getRouteApi,
  Outlet,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

import { IconButton } from "@/components/icon-button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { libraryApi } from "@/lib/bridge";

import type { CaptureListItem } from "../../../shared/dto";
import type { StatusKind } from "../../../shared/status";
import { listOf, RecentList, SearchField } from "./recent-list";
import { ResizeHandle, SidebarToggle, useSidebar } from "./sidebar";

const root = getRouteApi("__root__");

const SIDE_LISTS = [
  { kind: "snoozed", label: "Snoozed" },
  { kind: "done", label: "Done" },
] as const satisfies readonly { kind: StatusKind; label: string }[];

const ROW =
  "hover:bg-foreground/5 focus-visible:ring-ring/50 flex h-8 w-full items-center gap-2 rounded-md px-2 text-sm outline-none focus-visible:ring-3";

/** The rows at the sidebar's foot that open the snoozed and done lists; an empty list has none. */
const SideLists = ({
  items,
  onOpen,
}: {
  items: readonly CaptureListItem[];
  onOpen: (list: StatusKind) => void;
}) => (
  <ul className="flex flex-col">
    {SIDE_LISTS.map(({ kind, label }) => {
      const count = items.filter((item) => listOf(item) === kind).length;

      return count === 0 ? null : (
        <li key={kind}>
          <button className={ROW} onClick={() => onOpen(kind)} type="button">
            <span className="flex-1 text-left">{label}</span>
            <span className="text-muted-foreground text-xs tabular-nums">
              {count}
            </span>
            <HugeiconsIcon
              className="text-muted-foreground"
              icon={ArrowRight01Icon}
              size={14}
            />
          </button>
        </li>
      );
    })}
  </ul>
);

/**
 * A Mac app's two panes: captures in a sidebar on the window's translucent material, the open
 * capture on the page's own background beside it. On macOS the traffic lights sit in the
 * sidebar's header; on Windows the caption buttons sit over the right pane's header. The image
 * view takes the whole window. The sidebar can be resized by its edge, or folded away so the
 * capture has the whole window.
 */
export const Shell = () => {
  const { items } = root.useLoaderData();
  const { view } = useSearch({ strict: false });
  const { captureId } = useParams({ strict: false });
  const [query, setQuery] = useState("");
  const [list, setList] = useState<StatusKind>("active");
  const sideList = SIDE_LISTS.find(({ kind }) => kind === list);
  const sidebar = useSidebar();
  const search = useRef<HTMLInputElement>(null);

  useEffect(
    () =>
      libraryApi().onFind(() => {
        search.current?.focus();
        search.current?.select();
      }),
    []
  );

  if (view !== undefined) {
    return (
      <TooltipProvider delayDuration={500}>
        <div className="bg-background h-screen">
          <Outlet />
        </div>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={500}>
      <div className="text-foreground flex h-screen">
        <aside
          aria-label="Recent captures"
          className="win:bg-muted/50 relative flex w-(--sidebar-width) shrink-0 flex-col data-[collapsed=true]:hidden"
          data-collapsed={sidebar.state.collapsed}
          // SAFETY: CSSProperties has no index for custom properties; --sidebar-width is the one variable the width class reads.
          style={
            { "--sidebar-width": `${sidebar.state.width}px` } as CSSProperties
          }
        >
          <header className="drag-region mac:pl-20 flex h-11 shrink-0 items-center gap-0.5 px-2">
            <h1 className="sr-only">Recent captures</h1>
            <SidebarToggle />
            <span className="flex-1" />
            <IconButton
              icon={Add01Icon}
              label="New capture"
              onClick={() => libraryApi().newCapture()}
            />
          </header>
          <div className="px-2.5 pb-2">
            <SearchField field={search} onQuery={setQuery} query={query} />
          </div>
          <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {sideList !== undefined && (
              <button
                className={ROW}
                onClick={() => setList("active")}
                type="button"
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
                <span className="font-medium">{sideList.label}</span>
              </button>
            )}
            <RecentList
              activeId={captureId}
              items={items}
              list={list}
              query={query}
            />
          </nav>
          <footer className="flex shrink-0 flex-col gap-1 px-2 pb-2">
            {list === "active" && <SideLists items={items} onOpen={setList} />}
            <IconButton
              icon={Settings01Icon}
              keys={libraryApi().platform === "macos" ? "⌘," : "Ctrl+,"}
              label="Settings"
              onClick={() => libraryApi().openSettings()}
              side="top"
            />
          </footer>
          <ResizeHandle />
        </aside>
        <div
          className="bg-background mac:dark:bg-card border-foreground/10 flex min-w-0 flex-1 flex-col border-l data-[collapsed=true]:border-l-0"
          data-collapsed={sidebar.state.collapsed}
        >
          <Outlet />
        </div>
      </div>
    </TooltipProvider>
  );
};
