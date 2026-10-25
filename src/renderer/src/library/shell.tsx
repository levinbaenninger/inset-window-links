import { Add01Icon, Settings01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  getRouteApi,
  Outlet,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import type { ComponentProps } from "react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { libraryApi } from "@/lib/bridge";

import { RecentList, SearchField } from "./recent-list";

const root = getRouteApi("__root__");

const SidebarButton = ({
  label,
  icon,
  ...props
}: { label: string; icon: typeof Add01Icon } & ComponentProps<
  typeof Button
>) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button aria-label={label} size="icon-sm" variant="ghost" {...props}>
        <HugeiconsIcon icon={icon} />
      </Button>
    </TooltipTrigger>
    <TooltipContent side="bottom">{label}</TooltipContent>
  </Tooltip>
);

/**
 * A Mac app's two panes: captures in a sidebar on the window's translucent material, the open
 * capture on the page's own background beside it. On macOS the traffic lights sit in the
 * sidebar's header; on Windows the caption buttons sit over the right pane's header. The image
 * view takes the whole window.
 */
export const Shell = () => {
  const { items } = root.useLoaderData();
  const { view } = useSearch({ strict: false });
  const { captureId } = useParams({ strict: false });
  const [query, setQuery] = useState("");
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
      <div className="bg-background h-screen">
        <Outlet />
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={500}>
      <div className="text-foreground flex h-screen">
        <aside
          aria-label="Recent captures"
          className="win:bg-muted/50 flex w-80 shrink-0 flex-col"
        >
          <header className="drag-region mac:pl-20 flex h-13 shrink-0 items-center justify-end gap-0.5 px-2">
            <h1 className="sr-only">Recent captures</h1>
            <SidebarButton
              icon={Settings01Icon}
              label="Settings"
              onClick={() => libraryApi().openSettings()}
            />
            <SidebarButton
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
        </aside>
        <div className="bg-background dark:bg-card border-foreground/10 flex min-w-0 flex-1 flex-col border-l">
          <Outlet />
        </div>
      </div>
    </TooltipProvider>
  );
};
