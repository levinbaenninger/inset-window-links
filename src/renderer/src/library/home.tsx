import { getRouteApi, Navigate } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { libraryApi } from "@/lib/bridge";

import icon from "../../../../build/icon.png";
import { PaneHeader } from "./pane-header";

const root = getRouteApi("__root__");

/**
 * The guide, for the first run and Help: what to press, nothing more. The keys sit on the
 * right, as in Inset Shelf's empty shelf.
 */
export const Home = () => {
  const { items, shortcut } = root.useLoaderData();
  const mac = libraryApi().platform === "macos";

  const steps = [
    {
      keys: shortcut.kind === "registered" ? shortcut.label : null,
      text: "Add the window in front",
    },
    { keys: mac ? "⇧⌘N" : "Ctrl+Shift+N", text: "Pick several windows" },
    { keys: mac ? "⌘↵" : "Ctrl+Enter", text: "Save" },
  ];

  return (
    <>
      <PaneHeader />
      <main
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-8 pb-20 text-center"
        data-testid="welcome"
      >
        <img alt="" className="size-14" src={icon} />
        <h1 className="max-w-80 text-lg font-semibold text-balance">
          Keep a thought with its windows
        </h1>
        <ul className="flex w-full max-w-64 flex-col gap-2.5 text-left text-sm">
          {steps.map((step) => (
            <li
              className="flex items-center justify-between gap-3"
              key={step.text}
            >
              <span className="text-muted-foreground">{step.text}</span>
              {step.keys === null ? null : <Kbd>{step.keys}</Kbd>}
            </li>
          ))}
        </ul>
        <Button onClick={() => libraryApi().newCapture()}>New capture</Button>
        {items.length === 0 && !mac && (
          <p className="text-muted-foreground max-w-80 text-xs text-balance">
            Find Inset in the notification area, next to the clock.
          </p>
        )}
        {shortcut.kind === "unavailable" && (
          <p className="text-muted-foreground max-w-80 text-xs text-balance">
            {shortcut.label} is taken by another app.
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
    <Home />
  ) : (
    <Navigate
      params={{ captureId: newest.id }}
      replace
      to="/captures/$captureId"
    />
  );
};
