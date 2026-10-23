import { Outlet, useSearch } from "@tanstack/react-router";

import { libraryApi } from "@/lib/bridge";

/**
 * On Windows the native title bar is hidden: an empty draggable strip sits under the caption
 * buttons, and the page scrolls below it so its scrollbar never runs under them. The image view
 * has its own header bar, which takes the strip's place.
 */
export const Shell = () => {
  const { view } = useSearch({ strict: false });
  const strip = libraryApi().platform === "windows" && view === undefined;

  return (
    <div className="flex h-screen flex-col">
      {strip && <div aria-hidden className="app-drag h-9 shrink-0" />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
};
