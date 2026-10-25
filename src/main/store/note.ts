import type { CaptureRecord } from "./schema";

/** Plain text for the clipboard: the thought, its to-dos as a checklist, then the sources it connects. */
export const formatNote = (
  record: CaptureRecord,
  locale: string,
  timeZone: string
): string => {
  const time = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "short",
    timeZone,
    year: "numeric",
  });

  const sources = record.views.map((view, index) => {
    const app = view.appName === null ? "" : ` (${view.appName})`;

    const chosen =
      view.acquisition.kind === "fallback"
        ? ", chosen from the window list"
        : "";

    const where = view.origin?.url ?? view.origin?.document ?? null;
    const link = where === null ? "" : `\n   ${where}`;

    return `${index + 1}. ${view.title ?? "Untitled window"}${app}, captured ${time.format(new Date(view.capturedAt))}${chosen}${link}`;
  });

  const todos =
    record.todos.length === 0
      ? []
      : [
          "To do:",
          ...record.todos.map(
            (todo) => `- [${todo.done ? "x" : " "}] ${todo.text}`
          ),
          "",
        ];

  return [
    record.relationship.trim(),
    "",
    ...todos,
    "Sources:",
    ...sources,
  ].join("\n");
};
