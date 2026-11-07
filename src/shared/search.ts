import type { CaptureListItem } from "./dto";
import type { SearchQuery } from "./due";
import { matchesDue } from "./due";

type Current = Extract<CaptureListItem, { kind: "current" }>;

/** Where a match was found, other than the title, and the text that holds it. */
export interface MatchSource {
  where: "Description" | "Step" | "Window" | "Window description";
  text: string;
}

/** Every searched field but the title, in the order a row explains a match. */
const sources = (item: Current): MatchSource[] => [
  { text: item.description, where: "Description" },
  ...item.todos.map((todo) => ({ text: todo.text, where: "Step" as const })),
  ...item.views.flatMap((view) => [
    {
      text: [view.title, view.appName]
        .filter((part) => part !== null)
        .join(" · "),
      where: "Window" as const,
    },
    { text: view.description, where: "Window description" as const },
  ]),
];

const holds = (text: string, needle: string) =>
  text.toLocaleLowerCase().includes(needle);

/**
 * A partial due: word filters nothing yet, so typing one never empties the list. An unknown one
 * matches nothing, and the page names the filters that exist.
 */
export const matchesCapture = (
  item: CaptureListItem,
  query: SearchQuery,
  now: Date
): boolean => {
  if (query.unknownDue !== null) {
    return false;
  }

  if (item.kind !== "current") {
    return query.text === "" && query.due === null;
  }

  if (query.due !== null && !matchesDue(item.due, query.due, now)) {
    return false;
  }

  return (
    holds(item.relationship, query.text) ||
    sources(item).some((source) => holds(source.text, query.text))
  );
};

const CONTEXT = 24;

/**
 * Why a row is listed when its title does not show it: the first other field that holds the
 * words, cut to a line around them. Null when there are no words or the title has them.
 */
export const matchSource = (
  item: Current,
  needle: string
): MatchSource | null => {
  if (needle === "" || holds(item.relationship, needle)) {
    return null;
  }

  const found = sources(item).find((source) => holds(source.text, needle));

  if (found === undefined) {
    return null;
  }

  const line = found.text.replaceAll(/\s+/gu, " ").trim();
  const from = Math.max(0, line.toLocaleLowerCase().indexOf(needle) - CONTEXT);

  if (from === 0) {
    return { text: line, where: found.where };
  }

  // The cut falls at the start of a word, so the snippet begins with a whole one.
  const cut = line.lastIndexOf(" ", from) + 1 || from;

  return { text: `…${line.slice(cut)}`, where: found.where };
};
