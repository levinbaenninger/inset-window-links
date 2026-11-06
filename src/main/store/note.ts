import { longDate } from "../../shared/dates";
import { dueDay } from "../../shared/due";
import { entryText, isBlank } from "../../shared/text";
import type { CaptureRecord } from "./schema";

/**
 * Plain text for the clipboard: the thought, its description and due date when it has them, its
 * to-dos as a checklist, then the windows it connects, each with its description.
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

    const about = isBlank(view.description)
      ? ""
      : `\n   ${view.description.trim().replaceAll(/\r?\n/gu, "\n   ")}`;

    return `${index + 1}. ${view.title ?? "Untitled window"}${app}, captured ${time.format(new Date(view.capturedAt))}${link}${about}`;
  });

  const due =
    record.due === null
      ? []
      : [`Due: ${longDate(dueDay(record.due), locale)}`, ""];

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
    ...due,
    ...todos,
    "Windows:",
    ...windows,
  ].join("\n");
};

/** What ⌘C copies of a stored capture: its title, then its description. */
export const formatEntry = (record: CaptureRecord): string =>
  entryText(record.relationship, record.description);
