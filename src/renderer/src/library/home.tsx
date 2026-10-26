import { getRouteApi } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { libraryApi } from "@/lib/bridge";

import icon from "../../../../build/icon.png";
import { PaneHeader } from "./pane-header";

const root = getRouteApi("__root__");

/**
 * The first page, and Help: what to press, nothing more. The keys sit on the right, as in
 * Inset Shelf's empty shelf. With captures saved, the same page says to pick one.
 */
export const Home = () => {
  const { items, shortcut } = root.useLoaderData();
  const mac = libraryApi().platform === "macos";
  const empty = items.length === 0;

  const steps = [
    {
      keys: shortcut.kind === "registered" ? shortcut.label : null,
      text: "Add the window in front",
    },
    {
      keys: mac ? "⇧⌘N" : "Ctrl+Shift+N",
      text: "Pick several windows at once",
    },
    { keys: mac ? "⌘↵" : "Ctrl+Enter", text: "Save what connects them" },
  ];

  return (
    <>
      <PaneHeader />
      <main
        className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-8 pb-20 text-center"
        data-testid="welcome"
      >
        <img alt="" className="size-14" src={icon} />
        <div className="flex max-w-80 flex-col gap-1.5">
          <h1 className="text-lg font-semibold text-balance">
            {empty ? "Keep a thought with its windows" : "Pick a capture"}
          </h1>
          <p className="text-muted-foreground text-sm text-balance">
            {empty
              ? "Collect the windows a thought is about, write what connects them, and reopen them later."
              : "Or start a new one from any window."}
          </p>
        </div>
        <ul className="flex w-full max-w-72 flex-col gap-2.5 text-left text-sm">
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
        {empty && !mac && (
          <p className="text-muted-foreground max-w-80 text-xs text-balance">
            Inset sits in the notification area. Windows 11 can hide it behind
            the ^ next to the clock; drag it onto the taskbar to keep it.
          </p>
        )}
        {shortcut.kind === "unavailable" && (
          <p className="text-muted-foreground max-w-80 text-xs text-balance">
            {shortcut.label} is taken by another app. Use New capture, then Add
            windows.
          </p>
        )}
      </main>
    </>
  );
};
