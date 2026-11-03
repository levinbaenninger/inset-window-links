import { Add01Icon, Settings01Icon } from "@hugeicons/core-free-icons";
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

import { RecentList, SearchField } from "./recent-list";
import { ResizeHandle, SidebarToggle, useSidebar } from "./sidebar";

const root = getRouteApi("__root__");

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
              icon={Settings01Icon}
              label="Settings"
              onClick={() => libraryApi().openSettings()}
            />
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
            <RecentList activeId={captureId} items={items} query={query} />
          </nav>
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
