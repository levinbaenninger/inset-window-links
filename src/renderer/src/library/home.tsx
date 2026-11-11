import { getRouteApi, Navigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { libraryApi } from "@/lib/bridge";

import icon from "../../../../build/icon.png";
import { PaneHeader } from "./pane-header";

const root = getRouteApi("__root__");

/**
 * An empty Recent Captures: how to add the first capture. Getting started and Show Me Around, in
 * the Help menu and the tray, explain the rest.
 */
export const EmptyLibrary = () => {
  const { shortcut } = root.useLoaderData();
  const { platform } = libraryApi();

  return (
    <>
      <PaneHeader />
      <main
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto p-8 pb-20 text-center"
        data-testid="empty-library"
      >
        <img alt="" className="size-14" src={icon} />
        <h1 className="text-lg font-semibold text-balance">No captures yet</h1>
        <p className="text-muted-foreground max-w-80 text-sm text-balance">
          {shortcut.kind === "registered" ? (
            <>
              Press <Kbd>{shortcut.label}</Kbd> in any window to add it.
            </>
          ) : (
            <>
              {shortcut.label} is taken by another app. Add windows from the
              capture panel.
            </>
          )}
        </p>
        <Button onClick={() => libraryApi().newCapture()}>New capture</Button>
        {platform === "windows" && (
          <p className="text-muted-foreground max-w-80 text-xs text-balance">
            Find Inset in the notification area, next to the clock.
          </p>
        )}
      </main>
    </>
  );
};

/** The library opens on the newest capture in the list, so there is no empty pane to pick from. */
export const Newest = () => {
  const { items } = root.useLoaderData();

  const newest = items.find(
    (item) => item.kind === "current" && item.status.kind === "active"
  );

  return newest === undefined ? (
    <EmptyLibrary />
  ) : (
    <Navigate
      params={{ captureId: newest.id }}
      replace
      to="/captures/$captureId"
    />
  );
};
