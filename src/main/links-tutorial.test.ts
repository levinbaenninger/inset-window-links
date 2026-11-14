import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { KeyPlatform } from "../shared/shortcuts";
import {
  CAPTURE_ACCELERATOR,
  keyLabel,
  SHEET,
  sheetKeyLabels,
} from "../shared/shortcuts";
import {
  EXAMPLE_URL,
  HOME_PAGE,
  LINKS_TASK_IDS,
  linksExample,
  linksHints,
  linksSpotlight,
  linksTasks,
  PANEL_PAGE,
  tutorialKeys,
} from "./links-tutorial";

const PLATFORMS: readonly KeyPlatform[] = ["macos", "windows"];

/** Every key the app answers, as the Keyboard Shortcuts sheet writes it for the system. */
const realKeys = (platform: KeyPlatform): ReadonlySet<string> =>
  new Set(
    SHEET.flatMap((group) =>
      group.rows.flatMap((row) =>
        sheetKeyLabels(row, platform, keyLabel(CAPTURE_ACCELERATOR, platform))
      )
    )
  );

const RENDERER = path.resolve(import.meta.dirname, "../renderer/src");

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      return sources(full);
    }

    return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")
      ? [readFileSync(full, "utf-8")]
      : [];
  });

/** The anchors the renderer marks: coach("id"), and the checklist's own task rows. */
const markedAnchors = (): ReadonlySet<string> =>
  new Set([
    ...sources(RENDERER).flatMap((text) =>
      [...text.matchAll(/coach\(\s*"(?<id>[a-z][a-z0-9-]*)"\s*\)/gu)].flatMap(
        (match) => (match.groups?.id === undefined ? [] : [match.groups.id])
      )
    ),
    ...linksTasks("macos").map((task) => `task-${task.id}`),
  ]);

/** Every sentence the tutorial shows on a platform. */
const words = (platform: KeyPlatform): string[] => {
  const example = linksExample(platform);

  return [
    ...linksTasks(platform).flatMap((task) => [task.title, task.how]),
    ...linksHints(platform).map((hint) => hint.text),
    ...linksSpotlight(platform).map((step) => step.text),
    example.title,
    example.description,
    ...example.steps,
  ];
};

describe("Inset Window Links' tutorial", () => {
  it("shows only keys the app really answers to, on macOS and Windows", () => {
    for (const platform of PLATFORMS) {
      const keys = realKeys(platform);

      expect({
        named: Object.values(tutorialKeys(platform)).filter(
          (shown) => !keys.has(shown)
        ),
        tasks: linksTasks(platform)
          .flatMap((task) => (task.keys === null ? [] : [task.keys]))
          .filter((shown) => !keys.has(shown)),
      }).toStrictEqual({ named: [], tasks: [] });
    }
  });

  it("writes keys for the system it runs on: no ⌘ on Windows, no Ctrl on a Mac", () => {
    expect({
      mac: words("macos").filter((text) => text.includes("Ctrl")),
      windows: words("windows").filter((text) => /[⌘⌥⇧]/u.test(text)),
    }).toStrictEqual({ mac: [], windows: [] });
  });

  it("points only at controls the pages mark", () => {
    const anchors = markedAnchors();

    const pointedAt = [
      ...linksTasks("macos").flatMap((task) =>
        task.anchor === null ? [] : [task.anchor]
      ),
      ...linksHints("macos").map((hint) => hint.anchor),
      ...linksSpotlight("macos").map((step) => step.anchor),
    ];

    expect(pointedAt.filter((anchor) => !anchors.has(anchor))).toStrictEqual(
      []
    );
  });

  it("has five tasks, ties hints to them, shows tips only in the panel and Recent Captures, and walks six stops", () => {
    const tasks = new Set(linksTasks("macos").map((task) => task.id));

    expect({
      hints: linksHints("macos").flatMap((hint) =>
        hint.task === null || tasks.has(hint.task) ? [] : [hint.task]
      ),
      pages: [
        ...new Set(linksHints("macos").map((hint) => hint.page)),
      ].toSorted(),
      steps: linksSpotlight("macos").length,
      tasks: [...tasks].toSorted(),
    }).toStrictEqual({
      hints: [],
      pages: [HOME_PAGE, PANEL_PAGE].toSorted(),
      steps: 6,
      tasks: Object.values(LINKS_TASK_IDS).toSorted(),
    });
  });

  it("names the Reopen button so both of its labels fit: Reopen window and Reopen all", () => {
    const reopen = linksTasks("macos").find(
      (task) => task.id === LINKS_TASK_IDS.reopen
    );

    expect(
      ["Reopen window", "Reopen all"].filter((label) =>
        reopen?.how.includes(label)
      )
    ).toStrictEqual([]);
  });

  it("makes the example capture a thing to try, with one harmless page to reopen", () => {
    const example = linksExample("macos");

    expect({
      pages: example.windows.flatMap((window) =>
        window.url === null ? [] : [window.url]
      ),
      steps: example.steps.length,
      tryIt: example.steps.some((step) => step.includes("⌥⌘W")),
    }).toStrictEqual({ pages: [EXAMPLE_URL], steps: 3, tryIt: true });
    expect(new URL(EXAMPLE_URL).protocol).toBe("https:");
  });
});
