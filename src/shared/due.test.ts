import { describe, expect, it } from "vitest";

import {
  daysUntil,
  DueDateSchema,
  dueLabel,
  duePresets,
  dueSentence,
  dueState,
  matchesDue,
  parseQuery,
  toDueDate,
  withDueFilter,
} from "./due";

/** Local time, as the app reads it. 5 November 2026 is a Thursday. */
const at = (day: number, hour = 10, month = 11) =>
  new Date(2026, month - 1, day, hour);

const presets = (now: Date) =>
  Object.fromEntries(duePresets(now).map((preset) => [preset.id, preset.due]));

describe(toDueDate, () => {
  it("writes the local day, also just before midnight", () => {
    expect([
      toDueDate(at(5, 23)),
      toDueDate(new Date(2026, 0, 1, 0, 0)),
      toDueDate(new Date(2026, 11, 31, 23, 59)),
    ]).toStrictEqual(["2026-11-05", "2026-01-01", "2026-12-31"]);
  });
});

describe("the due date schema", () => {
  it("takes calendar days only", () => {
    expect(
      [
        "2026-11-05",
        "2028-02-29",
        "2026-02-29",
        "2026-13-01",
        "5.11.2026",
        "",
      ].map((value) => DueDateSchema.safeParse(value).success)
    ).toStrictEqual([true, true, false, false, false, false]);
  });
});

describe(duePresets, () => {
  it("offers today, tomorrow, the coming Saturday and the coming Monday", () => {
    expect(presets(at(5))).toStrictEqual({
      nextWeek: "2026-11-09",
      today: "2026-11-05",
      tomorrow: "2026-11-06",
      weekend: "2026-11-07",
    });
  });

  it("reads this weekend as today on a Saturday or a Sunday", () => {
    expect([presets(at(7)).weekend, presets(at(8)).weekend]).toStrictEqual([
      "2026-11-07",
      "2026-11-08",
    ]);
  });

  it("reads next week as a full week ahead on a Monday, and as tomorrow on a Sunday", () => {
    expect([presets(at(9)).nextWeek, presets(at(8)).nextWeek]).toStrictEqual([
      "2026-11-16",
      "2026-11-09",
    ]);
  });

  it("crosses month and year ends", () => {
    expect(presets(new Date(2026, 11, 31, 22))).toStrictEqual({
      nextWeek: "2027-01-04",
      today: "2026-12-31",
      tomorrow: "2027-01-01",
      weekend: "2027-01-02",
    });
  });
});

describe(dueState, () => {
  it("is overdue before today, today on the day, upcoming after", () => {
    expect([
      dueState("2026-11-04", at(5, 0)),
      dueState("2026-11-05", at(5, 23)),
      dueState("2026-11-06", at(5, 23)),
    ]).toStrictEqual(["overdue", "today", "upcoming"]);
  });

  it("counts calendar days, not hours, across a change of clocks", () => {
    expect(daysUntil("2026-10-26", new Date(2026, 9, 24, 12))).toBe(2);
  });
});

describe(dueLabel, () => {
  it("names near days and the weekday within a week", () => {
    expect([
      dueLabel("2026-11-05", at(5), "en-GB"),
      dueLabel("2026-11-06", at(5), "en-GB"),
      dueLabel("2026-11-04", at(5), "en-GB"),
      dueLabel("2026-11-09", at(5), "en-GB"),
    ]).toStrictEqual(["Today", "Tomorrow", "Yesterday", "Monday"]);
  });

  it("gives the date further out, with the year only when it differs", () => {
    expect([
      dueLabel("2026-11-20", at(5), "en-GB"),
      dueLabel("2027-01-08", at(5), "en-GB"),
    ]).toStrictEqual(["Fri 20 Nov", "8 Jan 2027"]);
  });

  it("says overdue aloud", () => {
    expect([
      dueSentence("2026-11-04", at(5)),
      dueSentence("2026-11-05", at(5)),
    ]).toStrictEqual(["Overdue, was due yesterday", "Due today"]);
  });
});

describe(matchesDue, () => {
  const now = at(5);

  it("filters by today, the coming week and overdue", () => {
    const dues = ["2026-11-01", "2026-11-05", "2026-11-11", "2026-11-12", null];

    expect({
      overdue: dues.map((due) => matchesDue(due, "overdue", now)),
      today: dues.map((due) => matchesDue(due, "today", now)),
      week: dues.map((due) => matchesDue(due, "week", now)),
    }).toStrictEqual({
      overdue: [true, false, false, false, false],
      today: [false, true, false, false, false],
      week: [false, true, true, false, false],
    });
  });
});

describe(parseQuery, () => {
  it("takes the due filter out of the words, wherever it is", () => {
    expect([
      parseQuery("Rieder  due:Today chairs"),
      parseQuery("due:week"),
      parseQuery("quote"),
    ]).toStrictEqual([
      { due: "today", text: "rieder chairs", unknownDue: null },
      { due: "week", text: "", unknownDue: null },
      { due: null, text: "quote", unknownDue: null },
    ]);
  });

  it("keeps an unknown filter apart, so the page can name the ones that exist", () => {
    expect(parseQuery("due:soon")).toStrictEqual({
      due: null,
      text: "",
      unknownDue: "soon",
    });
  });

  it("does not read due: inside a word", () => {
    expect(parseQuery("overdue:x").due).toBeNull();
  });
});

describe(withDueFilter, () => {
  it("sets, replaces and removes the filter, keeping the words", () => {
    expect([
      withDueFilter("chairs", "today"),
      withDueFilter("due:today chairs", "week"),
      withDueFilter("chairs due:week", null),
    ]).toStrictEqual(["due:today chairs", "due:week chairs", "chairs"]);
  });
});
