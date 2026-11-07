import {
  clockTime,
  dayAndTime,
  dayHeading,
  shortDate,
} from "../../../shared/dates";

export const viewTitle = (title: string | null): string =>
  title ?? "Untitled window";

/** "2:05 PM" or "14:05", as the system writes the time. */
export const formatClock = (iso: string): string => clockTime(new Date(iso));

/** "Today", "Yesterday" or "Tomorrow", then the weekday and date, so a list reads by recency. */
export const formatDay = (iso: string, now: Date = new Date()): string =>
  dayHeading(new Date(iso), now);

/** "Tomorrow, 9:00": a day and a time, for when a capture was made or a snooze ends. */
export const formatWhen = (iso: string, now: Date = new Date()): string =>
  dayAndTime(new Date(iso), now);

/** "Fri 7 Nov", beside a quick date choice. */
export const formatPickHint = (date: Date, now: Date = new Date()): string =>
  shortDate(date, now, { weekday: true });

export const plural = (count: number, noun: string): string =>
  `${count} ${count === 1 ? noun : `${noun}s`}`;
