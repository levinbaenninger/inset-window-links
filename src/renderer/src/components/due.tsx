import {
  Calendar03Icon,
  CalendarRemove01Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "cn";
import { useEffect, useRef, useState } from "react";
import type { ComponentProps, KeyboardEvent } from "react";

import { Kbd } from "@/components/ui/kbd";
import { formatPickHint } from "@/lib/format";

import type { DueDate, DueState } from "../../../shared/due";
import {
  DueDateSchema,
  dueDay,
  dueLabel,
  dueLongLabel,
  duePresets,
  dueSentence,
  dueState,
  toDueDate,
} from "../../../shared/due";

const MINUTE = 60_000;

/** Today, kept current while the page stays open past midnight. */
export const useToday = (): Date => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => {
      const next = new Date();

      setNow((current) =>
        toDueDate(current) === toDueDate(next) ? current : next
      );
    }, MINUTE);

    return () => clearInterval(timer);
  }, []);

  return now;
};

const TONE: Record<DueState, string> = {
  overdue: "bg-destructive/10 text-destructive dark:bg-destructive/20",
  today: "bg-brand/12 text-brand dark:bg-brand/20",
  upcoming: "bg-foreground/6 text-muted-foreground",
};

/** The chip's look without its behaviour, for rows that only show a due date. */
export const dueTone = (due: DueDate, now: Date): string =>
  TONE[dueState(due, now)];

/** "Today", "Overdue · Mon 3 Nov": what a chip says. */
const chipText = (due: DueDate, now: Date): string => {
  const label = dueLabel(due, now);

  return dueState(due, now) === "overdue" ? `Overdue · ${label}` : label;
};

/**
 * A due date as a small chip: the destructive colour once it is past, the accent on the day, quiet
 * before. A list row shows it as it is; an editor makes it a button that opens the picker.
 */
export const DueBadge = ({
  due,
  now,
  className,
}: {
  due: DueDate;
  now: Date;
  className?: string;
}) => (
  <span
    aria-label={dueSentence(due, now)}
    className={cn(
      "inline-flex h-5 max-w-full min-w-0 items-center gap-1 rounded-sm px-1.5 text-xs leading-none font-medium whitespace-nowrap tabular-nums",
      dueTone(due, now),
      className
    )}
    data-due-state={dueState(due, now)}
    data-testid="due-badge"
    title={dueLongLabel(due)}
  >
    <HugeiconsIcon className="shrink-0" icon={Calendar03Icon} size={12} />
    <span className="truncate">{chipText(due, now)}</span>
  </span>
);

/** The chip in an editor: it opens the picker, and its × clears the date. */
export const DueChip = ({
  due,
  now,
  onClear,
  keys,
  className,
  ...props
}: {
  due: DueDate;
  now: Date;
  onClear: () => void;
  keys?: string;
} & ComponentProps<"button">) => (
  <span
    className={cn(
      "inline-flex h-7 shrink-0 items-center rounded-md text-xs font-medium tabular-nums",
      dueTone(due, now),
      className
    )}
    data-due-state={dueState(due, now)}
    data-testid="due-chip"
  >
    <button
      aria-label={`${dueSentence(due, now)}. Change Due`}
      className="focus-visible:ring-ring/50 flex h-full items-center gap-1.5 rounded-md pr-1 pl-2 outline-none hover:brightness-95 focus-visible:ring-3 dark:hover:brightness-125"
      title={`Due ${dueLongLabel(due)}${keys === undefined ? "" : ` (${keys})`}`}
      type="button"
      {...props}
    >
      <HugeiconsIcon icon={Calendar03Icon} size={14} />
      {chipText(due, now)}
    </button>
    <button
      aria-label="Clear Due"
      className="focus-visible:ring-ring/50 mr-0.5 grid size-6 place-items-center rounded-sm opacity-70 outline-none hover:opacity-100 focus-visible:ring-3"
      onClick={onClear}
      type="button"
    >
      <HugeiconsIcon icon={Cancel01Icon} size={12} />
    </button>
  </span>
);

const OPTION =
  "focus-visible:bg-accent hover:bg-accent focus-visible:text-accent-foreground flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm outline-none";

/**
 * Due's quick choices, laid out alike in all three Inset apps: a "Due" header with its key, Today,
 * Tomorrow, This weekend and Next week with their dates, then Pick a date… and, once set, Clear.
 * The arrow keys move between them and Escape closes. The panel shows it in its own flow, so the
 * panel grows to fit; Recent Captures shows it in a popover.
 */
export const DueOptions = ({
  due,
  now,
  keys,
  onPick,
  onClose,
}: {
  due: DueDate | null;
  now: Date;
  /** The key that opens the picker, shown in its header. */
  keys: string;
  onPick: (due: DueDate | null) => void;
  onClose: () => void;
}) => {
  const list = useRef<HTMLFieldSetElement>(null);
  const dateField = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const [typed, setTyped] = useState(due ?? toDueDate(now));

  useEffect(() => {
    list.current?.querySelector<HTMLElement>("[data-option]")?.focus();
  }, []);

  useEffect(() => {
    if (picking) {
      dateField.current?.focus();

      try {
        dateField.current?.showPicker();
      } catch {
        // The field alone still takes a typed date.
      }
    }
  }, [picking]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();

      if (picking) {
        setPicking(false);
      } else {
        onClose();
      }

      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
      return;
    }

    const options = [
      ...(list.current?.querySelectorAll<HTMLElement>("[data-option]") ?? []),
    ];

    const active = document.activeElement;
    const at = active instanceof HTMLElement ? options.indexOf(active) : -1;

    const step = event.key === "ArrowDown" ? 1 : -1;
    const next = options[(at + step + options.length) % options.length];

    if (
      next !== undefined &&
      !(document.activeElement instanceof HTMLInputElement)
    ) {
      event.preventDefault();
      next.focus();
    }
  };

  const commitTyped = () => {
    const parsed = DueDateSchema.safeParse(typed);

    if (parsed.success) {
      onPick(parsed.data);
    }
  };

  return (
    <fieldset
      className="m-0 flex min-w-0 flex-col border-0 p-0"
      data-testid="due-options"
      ref={list}
    >
      <legend className="sr-only">Due</legend>
      <div
        aria-hidden
        className="text-muted-foreground flex h-7 items-center justify-between px-2 text-xs font-medium"
      >
        Due
        <Kbd>{keys}</Kbd>
      </div>
      {duePresets(now).map((preset) => (
        <button
          aria-pressed={preset.due === due}
          className={OPTION}
          data-option
          key={preset.id}
          onClick={() => onPick(preset.due)}
          onKeyDown={onKeyDown}
          type="button"
        >
          <span className="flex-1">{preset.label}</span>
          <span className="text-muted-foreground text-xs tabular-nums">
            {formatPickHint(dueDay(preset.due), now)}
          </span>
        </button>
      ))}
      <div className="bg-border -mx-1 my-1 h-px" />
      {picking ? (
        <form
          className="flex items-center gap-1.5 px-1 py-1"
          onSubmit={(event) => {
            event.preventDefault();
            commitTyped();
          }}
        >
          <input
            aria-label="Date"
            className="border-input bg-background focus-visible:ring-ring/50 focus-visible:border-ring dark:bg-input/30 h-7 min-w-0 flex-1 rounded-md border px-2 text-sm outline-none focus-visible:ring-3"
            data-option
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={onKeyDown}
            ref={dateField}
            type="date"
            value={typed}
          />
          <button
            className="bg-primary text-primary-foreground hover:bg-primary/80 focus-visible:ring-ring/50 h-7 rounded-md px-2.5 text-xs font-medium outline-none focus-visible:ring-3"
            type="submit"
          >
            Set
          </button>
        </form>
      ) : (
        <button
          className={OPTION}
          data-option
          onClick={() => setPicking(true)}
          onKeyDown={onKeyDown}
          type="button"
        >
          <HugeiconsIcon icon={Calendar03Icon} size={16} />
          <span className="flex-1">Pick a date…</span>
        </button>
      )}
      {due !== null && (
        <button
          className={cn(OPTION, "text-destructive")}
          data-option
          onClick={() => onPick(null)}
          onKeyDown={onKeyDown}
          type="button"
        >
          <HugeiconsIcon icon={CalendarRemove01Icon} size={16} />
          <span className="flex-1">Clear</span>
        </button>
      )}
    </fieldset>
  );
};
