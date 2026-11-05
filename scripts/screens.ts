import assert from "node:assert/strict";
import { once } from "node:events";
/**
 * Screenshots every window of the built renderer in its main states, light and dark, on macOS
 * and Windows, without Screen Recording or a real capture. Each page runs in Chromium with a fake
 * `window.inset` bridge that answers from the sample data below, so a before and an after run
 * show the same captures.
 *
 *   pnpm build && node scripts/screens.ts [output folder] [scene name filter]
 *
 * The default output folder is release/screens.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { chromium } from "playwright";
import type { Browser, Page } from "playwright";

const ROOT = path.resolve(import.meta.dirname, "..");
const RENDERER = path.join(ROOT, "out", "renderer");

const OUT = path.resolve(
  process.argv[2] ?? path.join(ROOT, "release", "screens")
);

const FIXTURES = path.join(OUT, ".fixtures");
const BRIDGE = path.join(ROOT, "scripts", "fixtures", "screens-bridge.js");

type Platform = "macos" | "windows";

type Theme = "light" | "dark";

const SAMPLE_WINDOWS = [
  {
    app: "Numbers",
    body: `<table>${[
      ["Item", "Quote", "Cap"],
      ["Desks (12)", "CHF 9,840", "CHF 10,000"],
      ["Chairs (12)", "CHF 5,280", "CHF 5,000"],
      ["Shelving", "CHF 2,160", "CHF 3,000"],
      ["Delivery", "CHF 980", "CHF 0"],
      ["Total", "CHF 18,260", "CHF 18,000"],
    ]
      .map(
        (row, index) =>
          `<tr>${row.map((cell) => (index === 0 ? `<th>${cell}</th>` : `<td>${cell}</td>`)).join("")}</tr>`
      )
      .join("")}</table>`,
    id: "w-budget",
    title: "Office move budget",
  },
  {
    app: "Mail",
    body: `<h2>Quote 2026-114: office furniture</h2><p class="meta">Rieder Möbel AG · 2 Nov</p><p>Dear Ms Keller,</p><p>Thank you for your enquiry. Please find our quote for 12 desks, 12 chairs and shelving attached. Delivery is possible from 24 November at the earliest.</p><p>Kind regards,<br>Jonas Rieder</p>`,
    id: "w-quote",
    title: "Quote 2026-114 from Rieder Möbel",
  },
  {
    app: "Safari",
    body: `<h2>Delivery dates</h2><div class="cal">${Array.from(
      { length: 30 },
      (_, day) =>
        `<span class="${day + 1 >= 24 ? "free" : ""}">${day + 1}</span>`
    ).join("")}</div>`,
    id: "w-dates",
    title: "rieder-moebel.ch: Delivery",
  },
  {
    app: "Calendar",
    body: `<h2>Week 47</h2><ul><li>Mon 17 · Movers book the lift</li><li>Thu 20 · Keys for the new floor</li><li>Fri 21 · Team moves in</li></ul>`,
    id: "w-calendar",
    title: "Calendar: November",
  },
  {
    app: "Preview",
    body: `<h2>Floor plan, level 3</h2><div class="plan"><span></span><span></span><span></span><span></span></div>`,
    id: "w-plan",
    title: "floor-plan-level-3.pdf",
  },
] as const;

const WINDOW_CSS = `
  body { margin: 0; font: 15px/1.5 -apple-system, system-ui, sans-serif; color: #1d1d1f; background: #fff; }
  .bar { height: 38px; background: #ececec; display: flex; align-items: center; gap: 8px; padding: 0 14px; border-bottom: 1px solid #d8d8d8; }
  .bar i { width: 12px; height: 12px; border-radius: 50%; background: #ff5f57; display: inline-block; }
  .bar i:nth-child(2) { background: #febc2e; } .bar i:nth-child(3) { background: #28c840; }
  .bar b { margin-left: 12px; font-weight: 600; font-size: 13px; color: #444; }
  main { padding: 28px 36px; }
  h2 { margin: 0 0 10px; font-size: 22px; }
  .meta { color: #6e6e73; margin-top: 0; }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
  th, td { border: 1px solid #e0e0e0; padding: 8px 12px; text-align: left; }
  th { background: #f5f5f7; }
  tr:last-child td { font-weight: 700; background: #fff4f2; }
  .cal { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; max-width: 520px; }
  .cal span { padding: 10px; border-radius: 8px; background: #f2f2f4; text-align: center; color: #999; }
  .cal span.free { background: #e3f1e6; color: #1d6b34; font-weight: 600; }
  ul { padding-left: 20px; font-size: 17px; }
  .plan { display: grid; grid-template-columns: 2fr 1fr; gap: 10px; height: 340px; }
  .plan span { border: 3px solid #333; border-radius: 4px; }
`;

const renderSampleWindows = async (browser: Browser) => {
  await mkdir(FIXTURES, { recursive: true });

  await Promise.all(
    SAMPLE_WINDOWS.map(async (win) => {
      const page = await browser.newPage({
        viewport: { height: 720, width: 1152 },
      });

      await page.setContent(
        `<style>${WINDOW_CSS}</style><div class="bar"><i></i><i></i><i></i><b>${win.title}</b></div><main>${win.body}</main>`
      );
      await page.screenshot({ path: path.join(FIXTURES, `${win.id}.png`) });
      await page.close();
    })
  );
};

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const NOW = new Date("2026-11-05T12:00:00+01:00");

const ago = (days: number, hours: number, minutes = 0) => {
  const date = new Date(NOW);

  date.setDate(date.getDate() - days);
  date.setHours(hours, minutes, 0, 0);

  return date.toISOString();
};

const originOf = (win: (typeof SAMPLE_WINDOWS)[number]) => {
  if (win.app === "Safari") {
    return {
      detail: "https://rieder-moebel.ch/delivery",
      kind: "page",
      label: "rieder-moebel.ch",
    };
  }

  if (win.app === "Numbers" || win.app === "Preview") {
    return {
      detail: `/Users/anna/Documents/${win.title}`,
      kind: "document",
      label: win.title,
    };
  }

  return {
    detail: `/Applications/${win.app}.app`,
    kind: "app",
    label: win.app,
  };
};

/** A due date `days` from today, from local parts as the app writes it. */
const dueIn = (days: number) => {
  const date = new Date(NOW);

  date.setDate(date.getDate() + days);

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
};

const view = (
  n: number,
  windowIndex: number,
  capturedAt: string,
  description = ""
) => {
  const win = SAMPLE_WINDOWS[windowIndex] ?? SAMPLE_WINDOWS[0];

  return {
    appName: win.app,
    capturedAt,
    description,
    height: 1440,
    id: uuid(100 + n),
    imageUrl: `/.fixtures/${win.id}.png`,
    origin: originOf(win),
    sameWindowAs: null,
    sampledAt: capturedAt,
    source: { kind: "direct" },
    title: win.title,
    width: 2304,
  };
};

const todo = (n: number, text: string, done = false) => ({
  done,
  id: `t${n}`,
  text,
});

const CAPTURES = [
  {
    createdAt: ago(0, 10, 42),
    description:
      "Chairs are CHF 280 over and delivery adds CHF 980 we never planned for. Rieder can only deliver from the 24th, three days after the team moves in.",
    due: dueIn(0),
    id: uuid(1),
    relationship: "Rieder's quote breaks the furniture cap and comes too late",
    status: { kind: "active" },
    todos: [
      todo(1, "Ask Rieder whether 21 November is possible", true),
      todo(2, "Get a second quote for the chairs"),
      todo(3, "Tell Marco the cap needs CHF 260 more"),
    ],
    updatedAt: ago(0, 10, 42),
    views: [
      view(
        1,
        0,
        ago(0, 10, 38),
        "The total row is CHF 260 over the cap; chairs and delivery cause it."
      ),
      view(2, 1, ago(0, 10, 40)),
      view(3, 2, ago(0, 10, 41), "First free day is the 24th."),
    ],
  },
  {
    createdAt: ago(0, 9, 5),
    description: "",
    due: dueIn(-2),
    id: uuid(2),
    relationship: "Movers need the lift on Monday, keys only come Thursday",
    status: { kind: "active" },
    todos: [todo(4, "Call building management about early keys")],
    updatedAt: ago(0, 9, 5),
    views: [view(4, 3, ago(0, 9, 3)), view(5, 4, ago(0, 9, 4))],
  },
  {
    createdAt: ago(1, 16, 20),
    description: "",
    due: dueIn(3),
    id: uuid(3),
    relationship:
      "The floor plan has room for 12 desks only without the shelving wall",
    status: { kind: "active" },
    todos: [],
    updatedAt: ago(1, 16, 20),
    views: [view(6, 4, ago(1, 16, 18))],
  },
  {
    createdAt: ago(4, 11, 0),
    description: "",
    due: dueIn(-3),
    id: uuid(4),
    relationship: "Budget sheet and calendar disagree on the move date",
    status: { at: ago(0, 8, 30), kind: "done" },
    todos: [
      todo(5, "Fix the date in the sheet", true),
      todo(6, "Send the plan to the team", true),
    ],
    updatedAt: ago(4, 11, 0),
    views: [view(7, 0, ago(4, 10, 58)), view(8, 3, ago(4, 10, 59))],
  },
  {
    createdAt: ago(2, 14, 10),
    description: "",
    due: dueIn(7),
    id: uuid(5),
    relationship: "Check the lease clause on early access once Marco is back",
    status: { kind: "snoozed", until: ago(-1, 9, 0) },
    todos: [todo(7, "Read clause 4.2 with Marco")],
    updatedAt: ago(2, 14, 10),
    views: [view(9, 1, ago(2, 14, 8))],
  },
  {
    createdAt: ago(6, 9, 30),
    description: "",
    due: null,
    id: uuid(6),
    relationship: "Cleaning crew quote matches the budget line",
    status: { at: ago(3, 17, 0), kind: "done" },
    todos: [],
    updatedAt: ago(6, 9, 30),
    views: [view(10, 0, ago(6, 9, 28))],
  },
];

const listItem = (capture: Capture) => ({
  createdAt: capture.createdAt,
  description: capture.description,
  due: capture.due,
  id: capture.id,
  kind: "current",
  relationship: capture.relationship,
  reopenable: capture.views.map((item) => item.id),
  status: capture.status,
  todos: capture.todos,
  views: capture.views.map(
    ({ appName, description, height, id, imageUrl, title, width }) => ({
      appName,
      description,
      height,
      id,
      imageUrl,
      title,
      width,
    })
  ),
});

const CANDIDATES = SAMPLE_WINDOWS.map((win, index) => ({
  appName: win.app,
  id: uuid(200 + index),
  imageUrl: `/.fixtures/${win.id}.png`,
  title: win.title,
}));

interface DraftState {
  activity: object;
  draftId: string;
  notice: object | null;
  platform: Platform;
  shortcut: object;
  text: {
    description: string;
    due: string | null;
    relationship: string;
    todos: object[];
    viewDescriptions: Record<string, string>;
  };
  views: object[];
}

const draft = (overrides: Partial<DraftState> = {}): DraftState => ({
  activity: { kind: "idle" },
  draftId: uuid(9),
  notice: null,
  platform: "macos",
  shortcut: { kind: "registered", label: "⌥⌘W" },
  text: {
    description: "",
    due: null,
    relationship: "",
    todos: [],
    viewDescriptions: {},
  },
  views: [],
  ...overrides,
});

const DRAFT_VIEWS = CAPTURES[0]?.views ?? [];

const FULL_DRAFT = {
  text: {
    description: "Chairs are CHF 280 over and delivery adds CHF 980.",
    due: dueIn(0),
    relationship: "Rieder's quote breaks the furniture cap",
    todos: [
      todo(1, "Ask Rieder whether 21 November is possible"),
      todo(2, "Get a second quote"),
    ],
    viewDescriptions: {
      [DRAFT_VIEWS[0]?.id ?? ""]:
        "The total row is CHF 260 over the cap; chairs and delivery cause it.",
    },
  },
  views: DRAFT_VIEWS,
};

/** Only the title so far: the add row offers the rest. */
const TITLE_ONLY_DRAFT = {
  text: {
    description: "",
    due: null,
    relationship: "Rieder's quote breaks the furniture cap",
    todos: [],
    viewDescriptions: {},
  },
  views: DRAFT_VIEWS,
};

const SETTINGS_VIEW = {
  openAtLogin: true,
  originsReadable: false,
  settings: {
    floatOnTop: true,
    hideOnClickAway: false,
    iconIn: "dockAndMenuBar",
    rememberPages: false,
  },
  shortcut: { kind: "registered", label: "⌥⌘W" },
  version: "0.1.0",
};

type Capture = Omit<(typeof CAPTURES)[number], "due"> & { due: string | null };

/** What a scene's fake bridge answers from: the popover's draft, the library's captures or the settings view. */
interface SceneData {
  captures?: readonly Capture[];
  draft?: DraftState;
  view?: typeof SETTINGS_VIEW;
}

interface Scene {
  name: string;
  page: "popover" | "library" | "settings";
  hash?: string;
  data: SceneData;
  platforms?: readonly Platform[];
  size?: { width: number; height: number };
  act?: (page: Page) => Promise<void>;
}

const sendCommand = (page: Page, command: string) =>
  page.evaluate(
    `window.dispatchEvent(new CustomEvent("fixture:command", { detail: ${JSON.stringify(command)} }))`
  );

const waitForFocus = (page: Page, selector: string) =>
  page.waitForFunction(
    "selector => document.querySelector(selector) === document.activeElement",
    selector
  );

const SCENES: readonly Scene[] = [
  { data: { draft: draft() }, name: "popover-empty", page: "popover" },
  {
    data: { draft: draft(FULL_DRAFT) },
    name: "popover-filled",
    page: "popover",
  },
  {
    data: {
      draft: draft({
        ...FULL_DRAFT,
        activity: {
          kind: "capturing",
          pending: { appName: "Calendar", title: "Calendar: November" },
        },
      }),
    },
    name: "popover-capturing",
    page: "popover",
    platforms: ["windows"],
  },
  {
    data: {
      draft: draft({
        ...FULL_DRAFT,
        activity: { candidates: CANDIDATES, kind: "choosing", reason: "menu" },
      }),
    },
    name: "popover-choose",
    page: "popover",
  },
  {
    data: {
      draft: draft({ ...FULL_DRAFT, activity: { kind: "confirmingQuit" } }),
    },
    name: "popover-quit",
    page: "popover",
    platforms: ["macos"],
  },
  {
    data: {
      draft: draft({
        notice: { kind: "permissionDenied", stillDenied: false },
      }),
    },
    name: "popover-permission",
    page: "popover",
    platforms: ["macos"],
  },
  {
    data: {
      draft: draft({
        ...FULL_DRAFT,
        text: {
          ...FULL_DRAFT.text,
          description:
            "Chairs are CHF 280 over and delivery adds CHF 980 we never planned for.\nRieder can only deliver from the 24th, three days after the team moves in.\nMarco signs off on anything above the cap, so he needs the numbers by Friday.",
          relationship:
            "Rieder's quote breaks the furniture cap, comes too late for the move, and leaves out the shelving we asked for, so we need a second quote before Marco signs anything",
        },
      }),
    },
    name: "popover-long-text",
    page: "popover",
    platforms: ["macos"],
  },
  {
    act: async (page) => {
      await page
        .getByRole("button", { exact: true, name: /^discard/iu })
        .first()
        .click();
    },
    data: { draft: draft(FULL_DRAFT) },
    name: "popover-discard",
    page: "popover",
    platforms: ["macos"],
  },
  {
    data: { captures: [] },
    hash: "/welcome",
    name: "library-first-run",
    page: "library",
  },
  {
    data: { captures: CAPTURES },
    hash: "/welcome",
    name: "library-home",
    page: "library",
  },
  {
    data: { captures: CAPTURES },
    hash: "/",
    name: "library-open",
    page: "library",
    platforms: ["macos"],
  },
  {
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-capture",
    page: "library",
  },
  {
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(2)}`,
    name: "library-capture-short",
    page: "library",
    platforms: ["macos"],
  },
  {
    act: async (page) => {
      await page.getByRole("button", { name: "Hide sidebar" }).click();
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-sidebar-hidden",
    page: "library",
  },
  {
    act: async (page) => {
      await page.getByTestId("record-relationship").focus();
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-editing",
    page: "library",
    platforms: ["macos"],
  },
  {
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}?view=${uuid(101)}`,
    name: "library-viewer",
    page: "library",
    platforms: ["macos"],
  },
  {
    act: async (page) => {
      await page.getByTestId("recent-item").first().click({ button: "right" });
      await page.getByRole("menuitem", { name: "Snooze" }).hover();
      await page.getByRole("menuitem", { name: /^Tomorrow/u }).waitFor();
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-context-menu",
    page: "library",
  },
  {
    act: async (page) => {
      await page.getByRole("button", { name: /^Done/u }).click();
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(4)}`,
    name: "library-done",
    page: "library",
    platforms: ["macos"],
  },
  {
    act: async (page) => {
      await page.getByRole("button", { name: /^Snoozed/u }).click();
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(5)}`,
    name: "library-snoozed",
    page: "library",
    platforms: ["macos"],
  },
  {
    act: async (page) => {
      await page.getByRole("button", { name: "More" }).click();
      await page.getByRole("menuitem", { name: "Copy as text" }).waitFor();
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-more-menu",
    page: "library",
    platforms: ["macos"],
  },
  {
    data: { draft: draft(TITLE_ONLY_DRAFT) },
    name: "popover-title-only",
    page: "popover",
  },
  {
    act: async (page) => {
      await page.getByTestId("add-due").click();
      await page.getByTestId("due-options").waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await page.getByTestId("due-options").count(), 0);
      await page.getByTestId("add-due").click();
    },
    data: { draft: draft(TITLE_ONLY_DRAFT) },
    name: "popover-due-picker",
    page: "popover",
  },
  {
    act: async (page) => {
      await page
        .getByRole("button", { name: /^Show preview of window 1/u })
        .click();
      await page.getByTestId("window-description").waitFor();
    },
    data: { draft: draft(FULL_DRAFT) },
    name: "popover-window-description",
    page: "popover",
  },
  {
    act: async (page) => {
      await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
      await page.getByTestId("shortcut-list").waitFor();
    },
    data: { draft: draft(FULL_DRAFT) },
    name: "popover-shortcuts",
    page: "popover",
  },
  {
    act: async (page) => {
      await page.getByTestId("due-chip").getByRole("button").first().click();
      await page.getByTestId("due-options").waitFor();
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-due-picker",
    page: "library",
  },
  {
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(3)}`,
    name: "library-capture-plain",
    page: "library",
    platforms: ["macos"],
  },
  {
    act: async (page) => {
      await page.getByTestId("open-shortcuts").click();
      await page.getByTestId("shortcut-sheet").waitFor();
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-shortcuts",
    page: "library",
  },
  {
    act: async (page) => {
      await page
        .getByRole("textbox", { name: /^Search captures/u })
        .fill("due:week");
      assert.equal(await page.getByTestId("recent-item").count(), 2);
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-search-due",
    page: "library",
  },
  {
    act: async (page) => {
      await page
        .getByRole("textbox", { name: /^Search captures/u })
        .fill("cap");
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-search-text",
    page: "library",
    platforms: ["macos"],
  },
  {
    act: async (page) => {
      await page
        .getByRole("textbox", { name: /^Search captures/u })
        .fill("forklift");
      await page.getByTestId("recent-no-match").waitFor();
      assert.equal(await page.getByTestId("recent-item").count(), 0);
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-search-empty",
    page: "library",
  },
  {
    act: async (page) => {
      await sendCommand(page, "focusDescription");
      await page
        .getByTestId("description")
        .fill("Delivery needs approval before Friday.");
      await sendCommand(page, "focusSteps");

      const step = page.getByRole("textbox", {
        name: "Next step 1",
        exact: true,
      });

      await step.waitFor();
      await waitForFocus(page, "[aria-label='Next step 1']");
      await step.fill("Call the supplier");
      await step.press("Enter");
      await page
        .getByRole("textbox", { name: "Next step 2", exact: true })
        .press("Backspace");
      await page
        .getByRole("textbox", { name: "Next step 2", exact: true })
        .waitFor({ state: "detached" });
      assert.equal(
        await page.getByRole("textbox", { name: /^Next step \d/u }).count(),
        1
      );
      await sendCommand(page, "setDue");
      await page.getByRole("button", { name: /^Tomorrow/u }).click();
      assert.equal(
        await page.getByTestId("due-chip").getAttribute("data-due-state"),
        "upcoming"
      );
    },
    data: { draft: draft(TITLE_ONLY_DRAFT) },
    name: "popover-fields-added",
    page: "popover",
  },
  {
    data: {
      draft: draft({
        ...FULL_DRAFT,
        text: { ...FULL_DRAFT.text, due: dueIn(-2) },
      }),
    },
    name: "popover-overdue",
    page: "popover",
  },
  {
    act: async (page) => {
      await page.getByTestId("due-chip").getByRole("button").first().click();
      await page.getByRole("button", { name: "Pick a date…" }).click();
      await page.getByLabel("Due date", { exact: true }).fill("2026-11-19");
      await page.getByRole("button", { name: "Set", exact: true }).click();
      await page.waitForFunction(
        "globalThis.__screens.data.captures[0].due === '2026-11-19'"
      );
      assert.equal(
        await page.getByTestId("due-chip").getAttribute("data-due-state"),
        "upcoming"
      );
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-custom-due",
    page: "library",
  },
  {
    act: async (page) => {
      await sendCommand(page, "focusDescription");
      const description = page.getByTestId("description");

      await description.waitFor();
      await waitForFocus(page, "[data-testid='description']");
      await description.fill("Keep the shelving wall clear for delivery.");
      await sendCommand(page, "focusSteps");

      const step = page.getByRole("textbox", {
        name: "Next step 1",
        exact: true,
      });

      await step.waitFor();
      await waitForFocus(page, "[aria-label='Next step 1']");
      await step.fill("Ask Marco to approve the layout");
      await step.press("Escape");
      await sendCommand(page, "setDue");
      await page.getByRole("button", { name: /^Tomorrow/u }).click();
      await page.waitForFunction(
        "globalThis.__screens.data.captures[2].due !== null"
      );
    },
    data: {
      captures: CAPTURES.map((capture, index) =>
        index === 2 ? { ...capture, due: null } : capture
      ),
    },
    hash: `/captures/${uuid(3)}`,
    name: "library-fields-added",
    page: "library",
  },
  {
    act: async (page) => {
      await page.getByTestId("recent-item").nth(1).click({ button: "right" });
      await page.getByRole("menuitem", { name: /^Change due date/u }).hover();
      await page
        .getByRole("menuitem", { name: "Pick a date…", exact: true })
        .click();
      await page.getByRole("dialog").waitFor();
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-context-date-picker",
    page: "library",
  },
  {
    act: async (page) => {
      await page.getByTestId("describe-window").first().click();
      const description = page.getByTestId("window-description").first();

      await description.fill("The lift booking needs an earlier key handover.");
      await description.press("Escape");
      await page.waitForFunction(
        "globalThis.__screens.data.captures[1].views[0].description === 'The lift booking needs an earlier key handover.'"
      );
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(2)}`,
    name: "library-window-description-edited",
    page: "library",
  },
  {
    act: async (page) => {
      await page
        .getByRole("textbox", { name: /^Search captures/u })
        .fill("First free day");
      assert.equal(await page.getByTestId("recent-item").count(), 1);
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-search-window-description",
    page: "library",
  },
  {
    act: async (page) => {
      await page
        .getByRole("textbox", { name: /^Search captures/u })
        .fill("due:soon");
      await page.getByTestId("recent-no-match").waitFor();
      assert.equal(await page.getByTestId("recent-item").count(), 0);
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-search-unknown-due",
    page: "library",
  },
  {
    act: async (page) => {
      await sendCommand(page, "find");
      const search = page.getByRole("textbox", { name: /^Search captures/u });

      await search.waitFor();
      await waitForFocus(page, "input[aria-label^='Search captures']");
      await search.fill("due:today");
      assert.equal(await page.getByTestId("recent-item").count(), 1);
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}?view=${uuid(101)}`,
    name: "library-find-from-viewer",
    page: "library",
  },
  {
    act: async (page) => {
      await page
        .getByRole("button", { name: /Resize sidebar/u })
        .press("ArrowLeft");
      await page
        .getByRole("button", { name: /Resize sidebar/u })
        .press("ArrowLeft");
      await page
        .getByRole("button", { name: /Resize sidebar/u })
        .press("ArrowLeft");
      await page
        .getByRole("button", { name: /Resize sidebar/u })
        .press("ArrowLeft");
      await page
        .getByRole("button", { name: /Resize sidebar/u })
        .press("ArrowLeft");
      await page
        .getByRole("button", { name: /Resize sidebar/u })
        .press("ArrowLeft");
      await page
        .getByRole("button", { name: /Resize sidebar/u })
        .press("ArrowLeft");
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-narrow",
    page: "library",
    size: { width: 720, height: 600 },
  },
  {
    act: async (page) => {
      await page.getByTestId("due-filter").click();
      await page.getByRole("menuitem", { name: /^Overdue/u }).waitFor();
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-filter-menu",
    page: "library",
    platforms: ["macos"],
  },
  {
    act: async (page) => {
      await page.getByTestId("recent-item").nth(1).click({ button: "right" });
      await page.getByRole("menuitem", { name: /^Change due date/u }).hover();
      await page.getByRole("menuitem", { name: /^This weekend/u }).waitFor();
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-due-menu",
    page: "library",
    platforms: ["macos"],
  },
  { data: { view: SETTINGS_VIEW }, name: "settings", page: "settings" },
];

const SIZES = {
  library: { height: 680, width: 1040 },
  popover: { height: 360, width: 520 },
  settings: { height: 320, width: 440 },
} as const;

const CONTENT_TYPES = new Map([
  [".css", "text/css"],
  [".html", "text/html"],
  [".js", "text/javascript"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"],
]);

const serve = async () => {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");

    const file = url.pathname.startsWith("/.fixtures/")
      ? path.join(OUT, url.pathname)
      : path.join(RENDERER, url.pathname);

    try {
      const body = await readFile(file);

      response.writeHead(200, {
        "content-type":
          CONTENT_TYPES.get(path.extname(file)) ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  // SAFETY: the server listens on a TCP port, so `address()` is an AddressInfo, never a pipe path or null.
  const { port } = server.address() as AddressInfo;

  return { origin: `http://127.0.0.1:${port}`, server };
};

/** The macOS sidebar material, which Chrome cannot draw, as a flat stand-in. */
const MATERIAL = { dark: "#2b2a2e", light: "#ececee" } as const;

const shoot = async (
  browser: Browser,
  origin: string,
  scene: Scene,
  platform: Platform,
  theme: Theme
) => {
  const size = scene.size ?? SIZES[scene.page];

  const context = await browser.newContext({
    colorScheme: theme,
    deviceScaleFactor: 2,
    timezoneId: "Europe/Zurich",
    locale: "en-GB",
    viewport: size,
  });

  try {
    const page = await context.newPage();
    const errors: string[] = [];

    page.on("pageerror", (error) => errors.push(error.message));
    page.setDefaultTimeout(5000);
    await page.clock.setFixedTime(NOW);

    const data =
      scene.page === "library"
        ? { ...scene.data, items: (scene.data.captures ?? []).map(listItem) }
        : scene.data;

    await page.addInitScript(
      `globalThis.__screens = ${JSON.stringify({ data, page: scene.page, platform })};`
    );
    await page.addInitScript({ path: BRIDGE });
    await page.goto(
      `${origin}/${scene.page}.html${scene.hash === undefined ? "" : `#${scene.hash}`}`
    );

    if (platform === "macos") {
      await page.addStyleTag({
        content: `html { background: ${MATERIAL[theme]}; }`,
      });
    }

    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);

    if (scene.act !== undefined) {
      await scene.act(page);
      await page.waitForTimeout(300);
    }

    // React Router's error boundary still makes a screenshot, so a crash would pass unnoticed.
    const crashed = await page.getByText("Something went wrong").count();

    if (crashed > 0) {
      throw new Error("the page crashed");
    }

    assert.deepEqual(errors, [], "renderer errors");

    const fitted = await page.evaluate<number | undefined>(
      "globalThis.__fitted"
    );

    if (fitted !== undefined && fitted > 0) {
      await page.setViewportSize({
        height: Math.min(fitted, 720),
        width: size.width,
      });
      await page.waitForTimeout(150);
    }

    if (scene.page === "popover") {
      const save = page.getByRole("button", { name: /^Save(?:\s|$)/u }).last();

      if (await save.count()) {
        const bounds = await save.boundingBox();

        assert.ok(
          bounds !== null &&
            bounds.y >= 0 &&
            bounds.y + bounds.height <= (page.viewportSize()?.height ?? 0),
          "Save stays visible in the capture panel"
        );
      }
    }

    const file = path.join(OUT, `${scene.name}-${platform}-${theme}.png`);

    await page.screenshot({ path: file });

    return path.relative(OUT, file);
  } finally {
    await context.close();
  }
};

interface Shot {
  scene: Scene;
  platform: Platform;
  theme: Theme;
}

const SHOTS: readonly Shot[] = SCENES.filter(
  (scene) =>
    process.argv[3] === undefined || scene.name.includes(process.argv[3])
).flatMap((scene) =>
  (scene.platforms ?? (["macos", "windows"] as const)).flatMap((platform) =>
    (["light", "dark"] as const).map((theme) => ({ platform, scene, theme }))
  )
);

/** One at a time: every shot waits on timers, and a loaded machine would change what it catches. */
const shootEach = async (
  browser: Browser,
  origin: string,
  shots: readonly Shot[]
): Promise<string[]> => {
  const [next, ...rest] = shots;

  if (next === undefined) {
    return [];
  }

  const { platform, scene, theme } = next;
  let taken: string | null = null;

  try {
    taken = await shoot(browser, origin, scene, platform, theme);
  } catch (error) {
    console.error(`${scene.name}-${platform}-${theme}: ${String(error)}`);
  }

  const later = await shootEach(browser, origin, rest);

  return taken === null ? later : [taken, ...later];
};

const main = async () => {
  await rm(OUT, { force: true, recursive: true });
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch();

  await renderSampleWindows(browser);

  const { origin, server } = await serve();

  const shots = await shootEach(browser, origin, SHOTS);

  await writeFile(
    path.join(OUT, "index.json"),
    `${JSON.stringify(shots, null, 2)}\n`
  );
  await browser.close();
  server.close();
  console.log(`${shots.length} screenshots in ${OUT}`);
  assert.equal(
    shots.length,
    SHOTS.length,
    "every scene must render successfully"
  );
};

await main();
