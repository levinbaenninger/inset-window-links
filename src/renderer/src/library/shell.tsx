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
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { IconButton } from "@/components/icon-button";
import { SHORTCUTS_ICON, ShortcutList } from "@/components/shortcut-sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { libraryApi } from "@/lib/bridge";
import { useCommands } from "@/lib/commands";
import { coach } from "@/tutorial/anchors";
import { Checklist } from "@/tutorial/checklist";
import { HintLayer } from "@/tutorial/hint-layer";
import { Spotlight } from "@/tutorial/spotlight";
import { useTutorial } from "@/tutorial/use-tutorial";

import type { CaptureListItem } from "../../../shared/dto";
import { menuKeyLabel } from "../../../shared/shortcuts";
import type { StatusKind } from "../../../shared/status";
import { DueSuggestions, listOf, RecentList, SearchField } from "./recent-list";
import { ResizeHandle, SidebarToggle, useSidebar } from "./sidebar";
import {
  actTutorial,
  endWalk,
  TutorialContext,
  tutorialSource,
} from "./tutorial";

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
            {/* The chevron's stroke ends flush with the due chips in the rows above. */}
            <HugeiconsIcon
              className="text-muted-foreground -mr-1.25"
              icon={ArrowRight01Icon}
              size={14}
            />
          </button>
        </li>
      );
    })}
  </ul>
);

/** Every key, for this platform, over whatever the window shows. */
const ShortcutSheet = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const { shortcut } = root.useLoaderData();
  const { platform } = libraryApi();

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="w-[44rem]" data-testid="shortcut-sheet">
        <header className="flex flex-col gap-0.5 px-5 pt-4 pb-3">
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            {platform === "macos"
              ? "Also in the menus."
              : "Inset’s windows answer these keys; the menu key is Ctrl."}{" "}
            Open this list with {menuKeyLabel("showShortcuts", platform)}.
          </DialogDescription>
        </header>
        <div className="min-h-0 overflow-y-auto [mask-image:linear-gradient(to_bottom,black_calc(100%-2.5rem),transparent)] px-5 pb-10">
          <ShortcutList
            globalLabel={shortcut.kind === "registered" ? shortcut.label : null}
            platform={platform}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

/**
 * A Mac app's two panes: captures in a sidebar on the window's translucent material, the open
 * capture on the page's own background beside it. On macOS the traffic lights sit in the
 * sidebar's header; on Windows the caption buttons sit over the right pane's header. The image
 * view takes the whole window. The sidebar can be resized by its edge, or folded away so the
 * capture has the whole window.
 */
export const Shell = () => {
  const navigate = useNavigate();
  const { items } = root.useLoaderData();
  const { view } = useSearch({ strict: false });
  const { captureId } = useParams({ strict: false });
  const [query, setQuery] = useState("");
  const [list, setList] = useState<StatusKind>("active");
  const [sheet, setSheet] = useState(false);
  const sideList = SIDE_LISTS.find(({ kind }) => kind === list);
  const sidebar = useSidebar();
  const search = useRef<HTMLInputElement>(null);
  const { platform } = libraryApi();
  const tutorial = useTutorial(tutorialSource);

  const { show, toggle } = sidebar;

  // The walkthrough starts on the list as it is: the sidebar shows, and a search or the sheet goes.
  const walked = useRef<number | null>(null);

  const onWalk = useEffectEvent((seq: number | null) => {
    if (seq !== null && seq !== walked.current) {
      walked.current = seq;
      show();
      setQuery("");
      setList("active");
      setSheet(false);
    }
  });

  useEffect(() => {
    onWalk(tutorial.spotlight?.seq ?? null);
  }, [tutorial.spotlight?.seq]);

  const find = async () => {
    if (view !== undefined && captureId !== undefined) {
      await navigate({
        to: "/captures/$captureId",
        params: { captureId },
        search: {},
      });
    }

    flushSync(show);
    requestAnimationFrame(() => {
      search.current?.focus();
      search.current?.select();
    });
  };

  // The window's own menu keys. Those for the open capture are taken by it first; any it leaves,
  // such as a field key while the image view is open, end here and do nothing.
  useCommands((command) => {
    if (command === "showShortcuts") {
      setSheet((open) => !open);

      return true;
    } else if (command === "toggleSidebar") {
      toggle();

      return true;
    } else if (command === "find") {
      void find();

      return true;
    }

    return false;
  });

  if (view !== undefined) {
    return (
      <TutorialContext value={tutorial}>
        <TooltipProvider delayDuration={500}>
          <div className="bg-background h-screen">
            <Outlet />
          </div>
          <ShortcutSheet onOpenChange={setSheet} open={sheet} />
        </TooltipProvider>
      </TutorialContext>
    );
  }

  return (
    <TutorialContext value={tutorial}>
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
                keys={menuKeyLabel("newCapture", platform)}
                label="New capture"
                onClick={() => libraryApi().newCapture()}
              />
            </header>
            <div className="px-2.5 pb-2" {...coach("search")}>
              <SearchField
                field={search}
                findKeys={menuKeyLabel("find", platform)}
                onQuery={setQuery}
                query={query}
              />
              <DueSuggestions
                onPicked={() => search.current?.focus()}
                onQuery={setQuery}
                query={query}
              />
            </div>
            <nav
              className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-3"
              {...coach("recent-list")}
            >
              {/* Getting started, at the top of the list and out of a search's way. */}
              {tutorial.checklist !== null &&
                query === "" &&
                list === "active" && (
                  <Checklist act={actTutorial} view={tutorial.checklist} />
                )}
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
                onClear={() => {
                  setQuery("");
                  search.current?.focus();
                }}
                query={query}
              />
            </nav>
            <footer className="flex shrink-0 flex-col gap-1 px-2 pb-2">
              {list === "active" && (
                <SideLists items={items} onOpen={setList} />
              )}
              <span className="flex items-center gap-0.5">
                <IconButton
                  icon={Settings01Icon}
                  keys={menuKeyLabel("openSettings", platform)}
                  label="Settings"
                  onClick={() => libraryApi().openSettings()}
                  side="top"
                  {...coach("settings")}
                />
                <IconButton
                  data-testid="open-shortcuts"
                  icon={SHORTCUTS_ICON}
                  keys={menuKeyLabel("showShortcuts", platform)}
                  label="Keyboard Shortcuts"
                  onClick={() => setSheet(true)}
                  side="top"
                />
              </span>
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
        <ShortcutSheet onOpenChange={setSheet} open={sheet} />
        <HintLayer act={actTutorial} view={tutorial} />
        <Spotlight onDone={endWalk} run={tutorial.spotlight} />
      </TooltipProvider>
    </TutorialContext>
  );
};
