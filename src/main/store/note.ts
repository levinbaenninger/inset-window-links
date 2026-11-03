import { isBlank } from "../../shared/text";
import type { CaptureRecord } from "./schema";

/**
 * Plain text for the clipboard: the thought, its description when there is one, its to-dos as a
 * checklist, then the windows it connects.
 */
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

  const windows = record.views.map((view, index) => {
    const app = view.appName === null ? "" : ` (${view.appName})`;
    const where = view.origin?.url ?? view.origin?.document ?? null;
    const link = where === null ? "" : `\n   ${where}`;

    return `${index + 1}. ${view.title ?? "Untitled window"}${app}, captured ${time.format(new Date(view.capturedAt))}${link}`;
  });

  const description = isBlank(record.description)
    ? []
    : [record.description.trim(), ""];

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
    ...description,
    ...todos,
    "Windows:",
    ...windows,
  ].join("\n");
};
