import { z } from "zod";

/**
 * A due date: a calendar day with no time, written YYYY-MM-DD. It says when something should be
 * done by. Unlike a snooze it hides nothing. Every date here is built from local year, month and
 * day, never through UTC, so a date picked late in the evening stays on its day.
 */
const ISO_DAY = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/u;

const partsOf = (value: string) => {
  const groups = ISO_DAY.exec(value)?.groups;

  if (groups === undefined) {
    return null;
  }

  const year = Number(groups["year"]);
  const month = Number(groups["month"]);
  const day = Number(groups["day"]);
  const date = new Date(year, month - 1, day);

  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? { date, day, month, year }
    : null;
};

export const DueDateSchema = z
  .string()
  .refine((value) => partsOf(value) !== null, "Not a calendar date");

export type DueDate = z.infer<typeof DueDateSchema>;

const pad = (value: number) => String(value).padStart(2, "0");

/** The local calendar day of `date`, as YYYY-MM-DD. */
export const toDueDate = (date: Date): DueDate =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** Local midnight of a due date. Throws on a string that is not one, which the schema rules out. */
export const dueDay = (due: DueDate): Date => {
  const parts = partsOf(due);

  if (parts === null) {
    throw new Error(`Not a due date: ${due}`);
  }

  return parts.date;
};

const addDays = (date: Date, days: number): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

const DAY_MS = 86_400_000;

/** Whole days from today to the due date: 0 today, 1 tomorrow, -1 yesterday. */
export const daysUntil = (due: DueDate, now: Date): number =>
  Math.round((dueDay(due).getTime() - addDays(now, 0).getTime()) / DAY_MS);

const SATURDAY = 6;
const SUNDAY = 0;
const MONDAY = 1;
const WEEK = 7;

export type DuePresetId = "today" | "tomorrow" | "weekend" | "nextWeek";

export interface DuePreset {
  id: DuePresetId;
  label: string;
  due: DueDate;
}

/**
 * The quick choices, from `now` in local time. This weekend is the coming Saturday, or today
 * when it already is the weekend. Next week is the coming Monday, a full week ahead on a Monday.
 */
export const duePresets = (now: Date): readonly DuePreset[] => {
  const weekday = now.getDay();

  const toSaturday =
    weekday === SATURDAY || weekday === SUNDAY ? 0 : SATURDAY - weekday;

  const toMonday = (MONDAY - weekday + WEEK) % WEEK || WEEK;

  return [
    { due: toDueDate(now), id: "today", label: "Today" },
    { due: toDueDate(addDays(now, 1)), id: "tomorrow", label: "Tomorrow" },
    {
      due: toDueDate(addDays(now, toSaturday)),
      id: "weekend",
      label: "This weekend",
    },
    {
      due: toDueDate(addDays(now, toMonday)),
      id: "nextWeek",
      label: "Next week",
    },
  ];
};

/** How a due date reads against today: the chip's colour comes from this. */
export type DueState = "overdue" | "today" | "upcoming";

export const dueState = (due: DueDate, now: Date): DueState => {
  const days = daysUntil(due, now);

  if (days < 0) {
    return "overdue";
  }

  return days === 0 ? "today" : "upcoming";
};

/**
 * The short form for a chip: Today, Tomorrow, Yesterday, a weekday within the coming week, else
 * the weekday, day and month, or the day, month and year when it is not this year's.
 */
export const dueLabel = (
  due: DueDate,
  now: Date,
  locale?: Intl.LocalesArgument
): string => {
  const days = daysUntil(due, now);
  const date = dueDay(due);

  if (days === 0) {
    return "Today";
  }

  if (days === 1) {
    return "Tomorrow";
  }

  if (days === -1) {
    return "Yesterday";
  }

  const options: Intl.DateTimeFormatOptions =
    days > 1 && days < WEEK
      ? { weekday: "long" }
      : { day: "numeric", month: "short", weekday: "short" };

  if (date.getFullYear() !== now.getFullYear()) {
    options.year = "numeric";
    delete options.weekday;
  }

  return date.toLocaleDateString(locale, options);
};

/** The whole date, for a tooltip or an accessible name: "Friday, 7 November 2026". */
export const dueLongLabel = (
  due: DueDate,
  locale?: Intl.LocalesArgument
): string =>
  dueDay(due).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  });

/** What a chip says aloud: "Due today", "Overdue, was due Yesterday", "Due Friday". */
export const dueSentence = (due: DueDate, now: Date): string => {
  const label = dueLabel(due, now);

  const relative = ["Today", "Tomorrow", "Yesterday"].includes(label)
    ? label.toLocaleLowerCase()
    : label;

  return dueState(due, now) === "overdue"
    ? `Overdue, was due ${relative}`
    : `Due ${relative}`;
};

/** The due filters search understands, typed as due:<name>. */
export const DUE_FILTERS = ["today", "week", "overdue"] as const;

export type DueFilter = (typeof DUE_FILTERS)[number];

/**
 * today: due today. week: due from today through the next six days. overdue: due before today.
 * A capture without a due date matches none of them.
 */
export const matchesDue = (
  due: DueDate | null,
  filter: DueFilter,
  now: Date
): boolean => {
  if (due === null) {
    return false;
  }

  const days = daysUntil(due, now);

  switch (filter) {
    case "today": {
      return days === 0;
    }

    case "week": {
      return days >= 0 && days < WEEK;
    }

    default: {
      return days < 0;
    }
  }
};

export interface SearchQuery {
  /** The words to find, lower-cased, with the filter taken out. */
  text: string;
  due: DueFilter | null;
  /** A due: word that names no filter, so the page can say which ones exist. */
  unknownDue: string | null;
}

const DUE_TOKEN = /(?:^|\s)due:(?<name>\S*)/iu;

/** Splits a search into its words and an optional due:today, due:week or due:overdue filter. */
export const parseQuery = (query: string): SearchQuery => {
  const found = DUE_TOKEN.exec(query);
  const name = found?.groups?.["name"]?.toLocaleLowerCase() ?? null;

  const text = (found === null ? query : query.replace(found[0], " "))
    .trim()
    .replaceAll(/\s+/gu, " ")
    .toLocaleLowerCase();

  if (name === null) {
    return { due: null, text, unknownDue: null };
  }

  const known = DUE_FILTERS.find((filter) => filter === name) ?? null;

  return {
    due: known,
    text,
    unknownDue: known === null ? name : null,
  };
};

/** The query with its due filter replaced, or removed when `filter` is null. */
export const withDueFilter = (
  query: string,
  filter: DueFilter | null
): string => {
  const words = query.replace(DUE_TOKEN, " ").trim().replaceAll(/\s+/gu, " ");
  const token = filter === null ? "" : `due:${filter}`;

  return [token, words].filter((part) => part !== "").join(" ");
};
