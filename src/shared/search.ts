import type { CaptureListItem } from "./dto";
import type { SearchQuery } from "./due";
import { matchesDue } from "./due";

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

  return [
    item.relationship,
    item.description,
    ...item.todos.map((todo) => todo.text),
    ...item.views.flatMap((view) => [
      view.title ?? "",
      view.appName ?? "",
      view.description,
    ]),
  ]
    .join("\n")
    .toLocaleLowerCase()
    .includes(query.text);
};
