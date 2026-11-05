/**
 * Every date and time the app shows, written in the system's locale through Intl. The app never
 * names a locale: left undefined, Intl takes the system's, so a Swiss, British or American system
 * each reads its own way. Tests pass one to get fixed text. The rules are the same in all three
 * Inset apps.
 */

type Locale = string | undefined;

const startOfDay = (date: Date): Date =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate());

const DAY_MS = 86_400_000;

/** Whole calendar days from `now` to `date`: 0 today, 1 tomorrow, -1 yesterday. */
export const calendarDays = (date: Date, now: Date): number =>
  Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / DAY_MS);

/** The days within which a weekday names the day without its date. */
const NEAR_DAYS = 6;

const RELATIVE = new Map([
  [-1, "Yesterday"],
  [0, "Today"],
  [1, "Tomorrow"],
]);

/** "5 Nov", "Nov 5" or "5 Nov 2027": the year only when it is not this year's. */
export const shortDate = (
  date: Date,
  now: Date,
  { weekday = false, locale }: { weekday?: boolean; locale?: Locale } = {}
): string => {
  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
  };

  if (weekday) {
    options.weekday = "short";
  }

  if (date.getFullYear() !== now.getFullYear()) {
    options.year = "numeric";
  }

  return date.toLocaleDateString(locale, options);
};

/**
 * A chip's day: Today, Tomorrow or Yesterday, the weekday within the coming six days, else a
 * short date.
 */
export const dayLabel = (date: Date, now: Date, locale?: Locale): string => {
  const days = calendarDays(date, now);
  const relative = RELATIVE.get(days);

  if (relative !== undefined) {
    return relative;
  }

  return days > 1 && days <= NEAR_DAYS
    ? date.toLocaleDateString(locale, { weekday: "long" })
    : shortDate(date, now, { locale });
};

/** A list heading: Today, Yesterday or Tomorrow, else the weekday and short date. */
export const dayHeading = (date: Date, now: Date, locale?: Locale): string =>
  RELATIVE.get(calendarDays(date, now)) ??
  shortDate(date, now, { locale, weekday: true });

/** "2:05 PM" or "14:05", as the system writes the time. */
export const clockTime = (date: Date, locale?: Locale): string =>
  date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });

/** "Tomorrow, 9:00": a day and a time. */
export const dayAndTime = (date: Date, now: Date): string =>
  `${dayHeading(date, now)}, ${clockTime(date)}`;

/** The whole date, for a tooltip, an accessible name or copied text: "Friday, 7 November 2026". */
export const longDate = (date: Date, locale?: Locale): string =>
  date.toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  });
