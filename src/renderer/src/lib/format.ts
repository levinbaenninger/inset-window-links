export const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export const viewTitle = (title: string | null): string =>
  title ?? "Untitled window";

/** "2:05 PM" or "14:05", as the system writes the time. */
export const formatClock = (iso: string): string =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const startOfDay = (date: Date): number =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

const DAY_MS = 86_400_000;

/** "Today", "Yesterday", then the weekday and date, so a list reads by recency. */
export const formatDay = (iso: string, now: Date = new Date()): string => {
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);

  if (days === 0) {
    return "Today";
  }

  if (days === 1) {
    return "Yesterday";
  }

  const options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    weekday: "short",
  };

  if (date.getFullYear() !== now.getFullYear()) {
    options.year = "numeric";
  }

  return date.toLocaleDateString([], options);
};

export const plural = (count: number, noun: string): string =>
  `${count} ${count === 1 ? noun : `${noun}s`}`;
