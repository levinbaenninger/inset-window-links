import type { ReactNode } from "react";

/**
 * The top strip of the right pane: it moves the window, and on Windows keeps clear of the
 * caption buttons drawn over its right end.
 */
export const PaneHeader = ({ children }: { children?: ReactNode }) => (
  <header className="drag-region win:pr-36 flex h-11 shrink-0 items-center gap-0.5 px-4">
    {children}
  </header>
);
