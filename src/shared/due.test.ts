import { describe, expect, it } from "vitest";

import {
  daysUntil,
  DueDateSchema,
  dueLabel,
  duePresets,
  dueSentence,
  dueState,
  dueSuggestions,
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
  it("names near days and the short weekday within a week", () => {
    expect([
      dueLabel("2026-11-05", at(5), "en-GB"),
      dueLabel("2026-11-06", at(5), "en-GB"),
      dueLabel("2026-11-04", at(5), "en-GB"),
      dueLabel("2026-11-09", at(5), "en-GB"),
    ]).toStrictEqual(["Today", "Tomorrow", "Yesterday", "Mon"]);
  });

  it("gives a short date further out, with the year only when it differs", () => {
    expect([
      dueLabel("2026-11-11", at(5), "en-GB"),
      dueLabel("2026-11-12", at(5), "en-GB"),
      dueLabel("2026-11-02", at(5), "en-GB"),
      dueLabel("2027-01-08", at(5), "en-GB"),
      dueLabel("2026-11-12", at(5), "en-US"),
    ]).toStrictEqual(["Wed", "12 Nov", "2 Nov", "8 Jan 2027", "Nov 12"]);
  });

  it("says overdue aloud, and the whole weekday", () => {
    expect([
      dueSentence("2026-11-04", at(5)),
      dueSentence("2026-11-05", at(5)),
      dueSentence("2026-11-09", at(5), "en-GB"),
    ]).toStrictEqual(["Overdue, was due yesterday", "Due today", "Due Monday"]);
  });
});

describe(matchesDue, () => {
  const now = at(5);

  it("reads the past, today, six and seven days out the same way as the other Inset apps", () => {
    const dues = ["2026-11-01", "2026-11-05", "2026-11-11", "2026-11-12", null];

    expect({
      any: dues.map((due) => matchesDue(due, "any", now)),
      none: dues.map((due) => matchesDue(due, "none", now)),
      overdue: dues.map((due) => matchesDue(due, "overdue", now)),
      today: dues.map((due) => matchesDue(due, "today", now)),
      week: dues.map((due) => matchesDue(due, "week", now)),
    }).toStrictEqual({
      any: [true, true, true, true, false],
      none: [false, false, false, false, true],
      overdue: [true, false, false, false, false],
      today: [false, true, false, false, false],
      week: [true, true, true, false, false],
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
      {
        due: "today",
        partialDue: null,
        text: "rieder chairs",
        unknownDue: null,
      },
      { due: "week", partialDue: null, text: "", unknownDue: null },
      { due: null, partialDue: null, text: "quote", unknownDue: null },
    ]);
  });

  it("reads due:any and due:none as filters", () => {
    expect([
      parseQuery("due:any").due,
      parseQuery("due:NONE").due,
    ]).toStrictEqual(["any", "none"]);
  });

  it("treats a filter still being typed as no filter, and offers what it can become", () => {
    const typing = ["due:", "due:to", "due:o", "chairs due:n"].map(parseQuery);

    expect(
      typing.map((query) => ({
        due: query.due,
        partial: query.partialDue,
        suggested: dueSuggestions(query),
        unknown: query.unknownDue,
      }))
    ).toStrictEqual([
      {
        due: null,
        partial: "",
        suggested: ["today", "overdue", "week", "any", "none"],
        unknown: null,
      },
      { due: null, partial: "to", suggested: ["today"], unknown: null },
      { due: null, partial: "o", suggested: ["overdue"], unknown: null },
      { due: null, partial: "n", suggested: ["none"], unknown: null },
    ]);
  });

  it("keeps a word that can become no filter apart, so the page can name the ones that exist", () => {
    const query = parseQuery("due:soon");

    expect({ query, suggested: dueSuggestions(query) }).toStrictEqual({
      query: { due: null, partialDue: null, text: "", unknownDue: "soon" },
      suggested: ["today", "overdue", "week", "any", "none"],
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
