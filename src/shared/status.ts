import { z } from "zod";

/**
 * Where a capture sits: in the list, put away until a time, or done. One field, so a capture is
 * never both snoozed and done.
 */
export const CaptureStatusSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("active") }),
  z.object({ kind: z.literal("snoozed"), until: z.iso.datetime() }),
  z.object({ at: z.iso.datetime(), kind: z.literal("done") }),
]);

export type CaptureStatus = z.infer<typeof CaptureStatusSchema>;

export type StatusKind = CaptureStatus["kind"];

export const ACTIVE: CaptureStatus = { kind: "active" };

export interface SnoozePreset {
  id: "hour" | "evening" | "tomorrow" | "nextWeek";
  label: string;
  until: Date;
}

const MORNING = 9;
const EVENING = 18;
const MONDAY = 1;
const DAYS_IN_WEEK = 7;

/** The same calendar day at a local hour, so a change of clocks overnight keeps 9:00 at 9:00. */
const atHour = (day: Date, hour: number, addDays = 0): Date =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate() + addDays, hour);

/**
 * The times a capture can be snoozed until, from `now` in local time. This evening is offered
 * only while there is an hour left before it; next week is the coming Monday morning.
 */
export const snoozePresets = (now: Date): readonly SnoozePreset[] => {
  const evening = atHour(now, EVENING);
  const untilMonday = (MONDAY - now.getDay() + DAYS_IN_WEEK) % DAYS_IN_WEEK;

  const presets: (SnoozePreset | null)[] = [
    {
      id: "hour",
      label: "In an hour",
      until: new Date(now.getTime() + 60 * 60 * 1000),
    },
    evening.getTime() - now.getTime() > 60 * 60 * 1000
      ? { id: "evening", label: "This evening", until: evening }
      : null,
    { id: "tomorrow", label: "Tomorrow", until: atHour(now, MORNING, 1) },
    {
      id: "nextWeek",
      label: "Next week",
      until: atHour(
        now,
        MORNING,
        untilMonday === 0 ? DAYS_IN_WEEK : untilMonday
      ),
    },
  ];

  return presets.filter((preset) => preset !== null);
};
