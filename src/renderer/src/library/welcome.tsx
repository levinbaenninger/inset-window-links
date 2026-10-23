import { ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { getRouteApi, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { libraryApi } from "@/lib/bridge";

import icon from "../../../../build/icon.png";
import type { ShortcutStatus } from "../../../shared/dto";

const route = getRouteApi("/welcome");

const Step = ({
  n,
  title,
  children,
}: {
  n: number;
  title: ReactNode;
  children: ReactNode;
}) => (
  <li className="flex gap-3">
    <span className="bg-primary text-primary-foreground grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums">
      {n}
    </span>
    <div className="flex flex-col gap-0.5">
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground text-sm">{children}</p>
    </div>
  </li>
);

const FirstStep = ({ shortcut }: { shortcut: ShortcutStatus }) =>
  shortcut.kind === "registered" ? (
    <Step
      n={1}
      title={
        <>
          In a window you want to keep, press <Kbd>{shortcut.label}</Kbd>
        </>
      }
    >
      Inset takes a picture of that window and opens a small panel beside it.
    </Step>
  ) : (
    <Step n={1} title="In the Inset menu, choose Add View from Window List">
      {shortcut.label} is taken by another app, so pick the window from the list
      instead.
    </Step>
  );

const WhereItLives = () =>
  libraryApi().platform === "windows" ? (
    <>
      <p>
        Inset has no window of its own. Its icon sits in the notification area
        at the right end of the taskbar. If you don&apos;t see it, click{" "}
        <span className="bg-background inline-grid size-5 place-items-center rounded-sm border align-text-bottom">
          <HugeiconsIcon className="size-3.5" icon={ArrowUp01Icon} />
        </span>{" "}
        next to the clock. Drag the icon onto the taskbar to keep it in view.
      </p>
      <p>
        Click the icon to open your draft or your recent captures. Right-click
        it for everything else, including Quit.
      </p>
    </>
  ) : (
    <>
      <p>
        Inset has no Dock icon. It sits in the menu bar. If your menu bar hides
        icons, look behind its overflow control.
      </p>
      <p>
        The first capture asks for Screen Recording permission, which macOS
        needs before any app can capture a window.
      </p>
    </>
  );

export const Welcome = () => {
  const { shortcut } = route.useLoaderData();
  const save = libraryApi().platform === "windows" ? "Ctrl+Enter" : "⌘↵";

  return (
    <main
      className="win:pt-2 mx-auto flex max-w-xl flex-col gap-6 p-6"
      data-testid="welcome"
    >
      <header className="flex flex-col gap-2">
        <img alt="" className="size-12" src={icon} />
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-2xl font-semibold">
            Inset Window Links is running
          </h1>
          <p className="text-muted-foreground">
            Keep one thought together with the windows it is about. Nothing
            opens until you ask for it.
          </p>
        </div>
      </header>
      <ol aria-label="How it works" className="flex flex-col gap-4">
        <FirstStep shortcut={shortcut} />
        <Step n={2} title="Switch to the next window and press it again">
          Each press adds one view. Click back into your work whenever you like;
          the draft waits for you.
        </Step>
        <Step n={3} title="Write what connects the views, then save">
          Save with {save}. Captures stay on this computer.
        </Step>
      </ol>
      <section
        aria-label="Where Inset lives"
        className="bg-muted flex flex-col gap-2 rounded-lg p-4 text-sm"
      >
        <h2 className="font-medium">Where to find Inset</h2>
        <WhereItLives />
      </section>
      <footer>
        <Button asChild>
          <Link to="/">Show recent captures</Link>
        </Button>
      </footer>
    </main>
  );
};
