import { isBlank } from "../../shared/text";
import type { CaptureRecord } from "./schema";

/** Plain text for the clipboard: the thought first, then the numbered sources it connects. */
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

    return `${index + 1}. ${view.title ?? "Untitled window"}${app}, captured ${time.format(new Date(view.capturedAt))}${chosen}`;
  });

  const nextStep = isBlank(record.nextStep)
    ? []
    : [`Next step: ${record.nextStep.trim()}`, ""];

  return [
    record.relationship.trim(),
    "",
    ...nextStep,
    "Sources:",
    ...sources,
  ].join("\n");
};
