import {
  ArrowDown01Icon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  CircleIcon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ChecklistView, TutorialAction } from "@shared/tutorial";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

import { coach } from "./anchors";

/**
 * The Getting started card at the top of the list: a short list of tasks
 * that tick themselves off as the user really does them. Clicking one shows
 * how; it never ticks it off. Once every task is done it says so, then goes
 * when closed.
 */
export const Checklist = ({
  act,
  view,
}: {
  readonly view: ChecklistView;
  readonly act: (action: TutorialAction) => void;
}) => {
  const open = !view.collapsed;

  return (
    <section
      aria-label={view.title}
      className="bg-background/60 border-foreground/10 mr-2 mb-2 rounded-lg border"
      {...coach("checklist")}
    >
      <header className="flex h-9 items-center gap-1 pr-1 pl-1">
        <button
          aria-expanded={open}
          className="hover:bg-foreground/5 focus-visible:ring-ring/50 flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-left text-xs outline-none focus-visible:ring-2"
          onClick={() => {
            act({ collapsed: open, kind: "collapse" });
          }}
          type="button"
        >
          <HugeiconsIcon
            className={cn(
              "text-muted-foreground size-3.5 shrink-0 motion-safe:transition-transform",
              !open && "-rotate-90"
            )}
            icon={ArrowDown01Icon}
          />
          <span className="font-medium">{view.title}</span>
          <span className="text-muted-foreground tabular-nums">
            · {view.complete ? "Done" : `${view.done} of ${view.total}`}
          </span>
        </button>
        {view.examples ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Getting started menu"
                size="icon-xs"
                variant="quiet"
              >
                <HugeiconsIcon icon={MoreHorizontalIcon} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => {
                  act({ kind: "removeExamples" });
                }}
              >
                Remove Examples
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <Button
          aria-label={`Close ${view.title}`}
          onClick={() => {
            act({ kind: "dismissChecklist" });
          }}
          size="icon-xs"
          variant="quiet"
        >
          <HugeiconsIcon icon={Cancel01Icon} />
        </Button>
      </header>
      {open && view.complete ? (
        <p className="text-muted-foreground px-3 pb-3 text-xs leading-snug">
          {view.doneText}
        </p>
      ) : null}
      {open && !view.complete ? (
        <ul className="flex flex-col pb-1.5">
          {view.tasks.map((task) => (
            <li className="px-1" key={task.id}>
              <button
                className="hover:bg-foreground/5 focus-visible:ring-ring/50 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs outline-none focus-visible:ring-2"
                onClick={() => {
                  act({ id: task.id, kind: "taskHint" });
                }}
                type="button"
                {...coach(`task-${task.id}`)}
              >
                <HugeiconsIcon
                  className={cn(
                    "size-4 shrink-0",
                    task.done ? "text-granted" : "text-muted-foreground/60"
                  )}
                  icon={task.done ? CheckmarkCircle02Icon : CircleIcon}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1",
                    task.done && "text-muted-foreground line-through"
                  )}
                >
                  {task.title}
                  <span className="sr-only">{task.done ? ", done" : ""}</span>
                </span>
                {task.keys === null ? null : (
                  <Kbd className="shrink-0">{task.keys}</Kbd>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
};
