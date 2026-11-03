import { cn } from "cn";
import type { ReactNode } from "react";

import { SidebarToggle, useSidebar } from "./sidebar";

/**
 * The top strip of the right pane: it moves the window, and on Windows keeps clear of the
 * caption buttons drawn over its right end. With the sidebar folded away it also makes room for
 * the traffic lights and holds the button that brings the sidebar back.
 */
export const PaneHeader = ({ children }: { children?: ReactNode }) => {
  const { state } = useSidebar();

  return (
    <header
      className={cn(
        "drag-region win:pr-36 flex h-11 shrink-0 items-center gap-0.5 px-4",
        state.collapsed && "mac:pl-20 pl-2"
      )}
    >
      {state.collapsed && (
        <span className="mr-2">
          <SidebarToggle />
        </span>
      )}
      {children}
    </header>
  );
};
