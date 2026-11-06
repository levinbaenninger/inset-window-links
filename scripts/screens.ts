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
  landing: (object | null)[];
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
  landing: [],
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
  /** Every text save answers that it failed, as a full disk would. */
  failSaves?: boolean;
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

/** The first argument of every recorded call to `method`, in order: the capture it acted on. */
const callsTo = (page: Page, method: string) =>
  page.evaluate<string[]>(
    `globalThis.__calls.filter((call) => call.method === ${JSON.stringify(method)}).map((call) => call.args[0])`
  );

/**
 * Polls `expression` from here until it is true. waitForFunction would poll inside the page,
 * where the renderer's Content-Security-Policy forbids the eval it needs for a string.
 */
const until = async (
  page: Page,
  expression: string,
  what: string,
  end = Date.now() + 5000
): Promise<void> => {
  if (await page.evaluate<boolean>(expression)) {
    return;
  }

  if (Date.now() > end) {
    throw new Error(`timed out waiting for ${what}`);
  }

  await page.waitForTimeout(50);
  await until(page, expression, what, end);
};

const waitForCalls = (page: Page, method: string, count: number) =>
  until(
    page,
    `globalThis.__calls.filter((call) => call.method === ${JSON.stringify(method)}).length >= ${count}`,
    `${count} ${method} call(s)`
  );

/** On the clipboard before each copy, so a copy that wrote nothing shows. */
const SENTINEL = "(what the clipboard held before)";

const seedClipboard = (page: Page) =>
  page.evaluate(`navigator.clipboard.writeText(${JSON.stringify(SENTINEL)})`);

const readClipboard = (page: Page) =>
  page.evaluate<string>("navigator.clipboard.readText()");

/** Runs `step` for each item, one after the other, as a user presses keys. */
const inTurn = async <T>(
  items: readonly T[],
  step: (item: T) => Promise<void>
): Promise<void> => {
  const [first, ...rest] = items;

  if (first === undefined) {
    return;
  }

  await step(first);
  await inTurn(rest, step);
};

/** The menu's plain Copy, whose name ends in its key, apart from Copy as text. */
const COPY_ITEM = /^Copy\s*⌘C$/u;

/** App keys no menu shows: each must do nothing while a menu is open. */
const UNSHOWN_KEYS = [
  "Meta+Shift+D",
  "Meta+D",
  "Meta+Shift+S",
  "Meta+F",
  "Meta+/",
] as const;

/** The same, as main sends them when a native menu key or Windows' key handling fires. */
const UNSHOWN_COMMANDS = [
  "setDue",
  "focusDescription",
  "focusSteps",
  "find",
  "showShortcuts",
] as const;

/** Notes whether each key pressed from now on was cancelled, which keeps the native menu from it too. */
const recordKeys = (page: Page) =>
  page.evaluate(`
    globalThis.__keys = [];
    window.addEventListener("keydown", (event) => {
      if (!["Alt", "Control", "Meta", "Shift"].includes(event.key)) {
        setTimeout(() => globalThis.__keys.push(event.defaultPrevented), 0);
      }
    }, { capture: true });
  `);

/** What a swallowed key could have changed: the menu, a popover or dialog (the Due picker, the sheet), a field. */
const swallowedState = (page: Page) =>
  page.evaluate<{
    keys: boolean[];
    menuOpen: boolean;
    popovers: number;
    typing: boolean;
  }>(`({
    keys: globalThis.__keys,
    menuOpen: document.querySelector("[role=menu][data-state=open]") !== null,
    popovers: document.querySelectorAll("[data-slot=popover-content], [role=dialog]").length,
    typing: document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement,
  })`);

const callCount = (page: Page, method: string) =>
  page.evaluate<number>(
    `globalThis.__calls.filter((call) => call.method === ${JSON.stringify(method)}).length`
  );

/** How many things on screen say Copied, as text or as a button's label. */
const copiedShown = (page: Page) =>
  page.evaluate<number>(
    `document.querySelectorAll('[aria-label="Copied"]').length + [...document.querySelectorAll("output, [role=status]")].filter((node) => node.textContent?.trim() === "Copied").length`
  );

/** Waits until the sidebar row of capture `id` has focus. */
const waitForRowFocus = (page: Page, id: string) =>
  until(
    page,
    `document.activeElement?.matches("[data-testid='recent-item']") === true && (document.activeElement.getAttribute("href") ?? "").includes(${JSON.stringify(id)})`,
    `focus on the row of ${id}`
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
      await page.getByRole("button", { name: "Keyboard Shortcuts" }).click();
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
      assert.equal(
        await page.getByTestId("recent-item").count(),
        3,
        "due:week holds today, the coming six days and what is overdue"
      );
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
      await page.getByLabel("Date", { exact: true }).fill("2026-11-19");
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
      await page.getByRole("menuitem", { name: "Due", exact: true }).hover();
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
      assert.match(
        (await page.getByTestId("match-source").textContent()) ?? "",
        /^Window description: First free day/u
      );
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
      await page.getByTestId("due-suggestions").waitFor();
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
      await until(
        page,
        `document.querySelector("input[aria-label^='Search captures']")?.placeholder === "Search or due:today"`,
        "the whole placeholder at the default width"
      );
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
      await page.waitForTimeout(100);
      await until(
        page,
        `document.querySelector("input[aria-label^='Search captures']")?.placeholder === "Search"`,
        "the short placeholder at the narrowest sidebar"
      );
      assert.ok(
        await page.evaluate<boolean>(`(() => {
          const input = document.querySelector("input[aria-label^='Search captures']");
          const style = getComputedStyle(input);
          const context = document.createElement("canvas").getContext("2d");

          context.font = style.font;

          return context.measureText(input.placeholder).width + 12 <=
            input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        })()`),
        "the short placeholder fits, with air before the filter button"
      );
      assert.deepEqual(
        await page.getByTestId("due-badge").evaluateAll((badges) =>
          badges
            .filter((badge) => {
              const box = badge.getBoundingClientRect();
              const row = badge.closest("a")?.getBoundingClientRect();

              return (
                row === undefined ||
                box.left < row.left ||
                box.right > row.right ||
                badge.scrollWidth > badge.clientWidth ||
                badge.querySelector("svg") === null
              );
            })
            .map((badge) => badge.textContent)
        ),
        [],
        "every due chip keeps its icon and whole label inside its row"
      );
    },
    // One chip with the longest label a date gets: overdue from last year, which needs the year.
    data: {
      captures: CAPTURES.map((capture) =>
        capture.id === uuid(3) ? { ...capture, due: "2025-12-28" } : capture
      ),
    },
    hash: `/captures/${uuid(1)}`,
    name: "library-narrow",
    page: "library",
    size: { width: 720, height: 600 },
  },
  {
    act: async (page) => {
      await page.getByTestId("due-filter").click();
      await page.getByRole("menuitem", { name: /^Overdue/u }).waitFor();
      assert.equal(await page.getByRole("menuitem").count(), 5);
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
      await page.getByRole("menuitem", { name: "Due", exact: true }).hover();
      await page.getByRole("menuitem", { name: /^This weekend/u }).waitFor();
      assert.match(
        (await page
          .getByRole("menuitem", { name: /^Reopen all/u })
          .textContent()) ?? "",
        /⌘O$/u,
        "a row's menu shows the keys that act on it once it has focus"
      );
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-due-menu",
    page: "library",
    platforms: ["macos"],
  },
  {
    data: {
      draft: draft({
        ...FULL_DRAFT,
        landing: [{ appName: "Calendar", title: "Calendar: November" }],
      }),
    },
    name: "popover-landing",
    page: "popover",
    platforms: ["windows"],
  },
  {
    // macOS names no window before its image exists.
    data: { draft: draft({ ...FULL_DRAFT, landing: [null] }) },
    name: "popover-landing",
    page: "popover",
    platforms: ["macos"],
  },
  {
    act: async (page) => {
      await page.evaluate(
        "document.hasFocus = () => false; window.dispatchEvent(new Event('blur'))"
      );
      await page.getByTestId("unfocused-hint").waitFor();
    },
    data: { draft: draft(FULL_DRAFT) },
    name: "popover-unfocused",
    page: "popover",
  },
  {
    act: async (page) => {
      await page
        .getByRole("button", { name: /^Add a description of window 3/u })
        .click();
      const field = page.getByTestId("window-description");

      await waitForFocus(page, "[data-testid='window-description']");
      await field.fill("First free day is the 24th.");
      assert.equal(
        await page.getByTestId("source-preview").count(),
        1,
        "the description opens under its own window's row"
      );
    },
    data: { draft: draft(FULL_DRAFT) },
    name: "popover-describe-window",
    page: "popover",
    platforms: ["macos"],
  },
  {
    act: async (page) => {
      const search = page.getByRole("textbox", { name: /^Search captures/u });

      await search.fill("due:o");
      await page.getByTestId("due-suggestions").waitFor();
      assert.deepEqual(
        await page
          .getByTestId("due-suggestions")
          .getByRole("button")
          .evaluateAll((buttons) =>
            buttons.map((button) => button.getAttribute("aria-label"))
          ),
        ["Overdue (due:overdue)"]
      );
      assert.equal(await page.getByTestId("recent-no-match").count(), 0);
      assert.equal(await page.getByTestId("recent-item").count(), 3);
      await search.press("Enter");
      assert.equal(await search.inputValue(), "due:overdue");
      await search.fill("due:");
      assert.deepEqual(
        await page
          .getByTestId("due-suggestions")
          .getByRole("button")
          .evaluateAll((buttons) =>
            buttons.map((button) => button.textContent)
          ),
        [
          "due:todayDue today",
          "due:overdueOverdue",
          "due:weekDue this week (incl. overdue)",
          "due:anyHas a Due",
          "due:noneNo Due",
        ],
        "the labelled list, in the order all three apps use"
      );
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-search-partial-due",
    page: "library",
  },
  {
    act: async (page) => {
      await page
        .getByRole("textbox", { name: /^Search captures/u })
        .fill("second quote");
      assert.match(
        (await page.getByTestId("match-source").textContent()) ?? "",
        /^Step: Get a second quote/u
      );
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-search-step",
    page: "library",
    platforms: ["macos"],
  },
  {
    act: async (page) => {
      const rows = page.getByTestId("recent-item");

      await rows.nth(1).focus();
      await seedClipboard(page);
      await page.keyboard.press("ControlOrMeta+C");
      await waitForCalls(page, "copyEntry", 1);
      assert.equal(
        await readClipboard(page),
        "Movers need the lift on Monday, keys only come Thursday",
        "⌘C on a row copies its title"
      );

      // The open capture's row copies what its editor holds, saved first, not the list's copy.
      const title = page.getByTestId("record-relationship");

      await title.fill("Rieder's quote is CHF 260 over the cap");
      await rows.nth(0).focus();
      await seedClipboard(page);
      await page.keyboard.press("ControlOrMeta+C");
      await waitForCalls(page, "copyEntry", 2);
      assert.match(
        await readClipboard(page),
        /^Rieder's quote is CHF 260 over the cap\n\nChairs are CHF 280/u,
        "⌘C on the open capture's row copies the title just typed"
      );
      await page.getByRole("button", { name: "More" }).focus();
      await seedClipboard(page);
      await page.keyboard.press("ControlOrMeta+C");
      await waitForCalls(page, "copyEntry", 3);
      assert.match(
        await readClipboard(page),
        /^Rieder's quote is CHF 260 over the cap\n\nChairs are CHF 280/u,
        "⌘C on the open capture copies its title and description"
      );
      assert.deepEqual(await callsTo(page, "copyEntry"), [
        uuid(2),
        uuid(1),
        uuid(1),
      ]);

      await rows.nth(1).focus();
      await page.keyboard.press("Space");
      await until(
        page,
        "globalThis.__screens.data.captures[1].status.kind === 'done'",
        "the row marked done"
      );
      await until(
        page,
        "document.querySelectorAll(\"[data-testid='recent-item']\").length === 2",
        "the row leaving the list"
      );
      await waitForRowFocus(page, uuid(3));

      // ⌫ asks first, naming the capture in focus.
      await page.keyboard.press("Backspace");
      assert.equal(
        await page.getByTestId("delete-names").textContent(),
        "The floor plan has room for 12 desks only without the shelving wall"
      );
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-row-keys",
    page: "library",
    platforms: ["macos"],
  },

  {
    act: async (page) => {
      const title = page.getByTestId("record-relationship");

      await title.fill(`${await title.inputValue()} (revised)`);
      await sendCommand(page, "copyNote");
      await page
        .getByTestId("capture-feedback")
        .filter({
          hasText: "Not copied: changes aren’t saved",
        })
        .waitFor();
      assert.equal(
        await page.evaluate<number>(
          "globalThis.__calls.filter((call) => call.method === 'copyNote').length"
        ),
        0,
        "a failed save copies nothing"
      );
      await title.evaluate((field) =>
        field.closest(".overflow-y-auto")?.scrollTo(0, 0)
      );
    },
    data: { captures: CAPTURES, failSaves: true },
    hash: `/captures/${uuid(1)}`,
    name: "library-copy-refused",
    page: "library",
  },
  {
    data: {
      draft: draft({
        activity: { kind: "confirmingQuit" },
        landing: [{ appName: "Calendar", title: "Calendar: November" }],
        text: { ...FULL_DRAFT.text, due: null, todos: [] },
      }),
    },
    name: "popover-quit-landing",
    page: "popover",
    platforms: ["windows"],
  },
  {
    data: {
      draft: draft({
        ...FULL_DRAFT,
        activity: { kind: "saving" },
        landing: [{ appName: "Calendar", title: "Calendar: November" }],
      }),
    },
    name: "popover-saving-landing",
    page: "popover",
    platforms: ["windows"],
  },
  {
    // Windows: main takes Ctrl+Alt+C and Ctrl+O before the page and sends them as commands.
    act: async (page) => {
      const rows = page.getByTestId("recent-item");
      const row = rows.nth(1);
      const menu = page.getByRole("menu");

      await row.click({ button: "right" });
      await page.getByRole("menuitem", { name: "Copy as text" }).waitFor();

      // Keys main takes for itself and the menu doesn't show, such as Ctrl+Shift+D, do nothing.
      await inTurn(UNSHOWN_COMMANDS, async (command) => {
        await sendCommand(page, command);
      });

      await page.waitForTimeout(150);
      assert.deepEqual(
        await page.evaluate(
          `({ menuOpen: document.querySelector("[role=menu][data-state=open]") !== null, popovers: document.querySelectorAll("[data-slot=popover-content], [role=dialog]").length })`
        ),
        { menuOpen: true, popovers: 0 },
        "commands the row menu doesn't show are dropped while it is open"
      );

      await sendCommand(page, "copyNote");
      await menu.waitFor({ state: "detached" });
      await waitForRowFocus(page, uuid(2));
      await row.click({ button: "right" });
      await menu.waitFor();
      await sendCommand(page, "reopen");
      await menu.waitFor({ state: "detached" });
      await waitForRowFocus(page, uuid(2));
      await sendCommand(page, "copyNote");
      await row.getByText("Copied").waitFor();
      await waitForCalls(page, "copyNote", 2);
      assert.deepEqual(
        {
          copyNote: await callsTo(page, "copyNote"),
          reopen: await callsTo(page, "reopen"),
        },
        { copyNote: [uuid(2), uuid(2)], reopen: [uuid(2)] },
        "the commands act on the right-clicked row, menu open or closed, not the open capture"
      );

      // Delete on a row asks, then removes it and moves focus on to the next row.
      await page.keyboard.press("Delete");
      await page.getByRole("button", { name: "Delete", exact: true }).click();
      await waitForCalls(page, "remove", 1);
      await waitForRowFocus(page, uuid(3));
      assert.deepEqual(await callsTo(page, "remove"), [uuid(2)]);

      // The ⋯ menu takes Ctrl+Alt+C from main too, for the open capture, and closes.
      await page.getByRole("button", { name: "More" }).click();
      await menu.waitFor();
      await sendCommand(page, "copyNote");
      await menu.waitFor({ state: "detached" });
      await waitForCalls(page, "copyNote", 3);
      assert.deepEqual(
        await callsTo(page, "copyNote"),
        [uuid(2), uuid(2), uuid(1)],
        "Ctrl+Alt+C with the ⋯ menu open copies the open capture"
      );
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-row-menu-keys",
    page: "library",
    platforms: ["windows"],
  },
  {
    // The keys pressed with row B's menu open, while capture A is open, act on B.
    act: async (page) => {
      const rows = page.getByTestId("recent-item");
      const rowB = rows.nth(1);
      const menu = page.getByRole("menu");

      const openMenu = async () => {
        await rowB.click({ button: "right" });
        await menu.waitFor();
      };

      const closedOnB = async (after: string) => {
        try {
          // A submenu counts as a second menu, so wait for every one to go.
          await until(
            page,
            `document.querySelector("[role=menu]") === null`,
            "the menus to close"
          );
          await waitForRowFocus(page, uuid(2));
        } catch (error) {
          throw new Error(`after ${after}: ${String(error)}`, { cause: error });
        }
      };

      await openMenu();
      await seedClipboard(page);
      await page.keyboard.press("Meta+C");
      await closedOnB("⌘C");
      await waitForCalls(page, "copyEntry", 1);
      assert.equal(
        await readClipboard(page),
        "Movers need the lift on Monday, keys only come Thursday",
        "⌘C in B's menu copies B"
      );

      await openMenu();
      await page.keyboard.press("Meta+Alt+C");
      await closedOnB("⌥⌘C");
      await waitForCalls(page, "copyNote", 1);

      await openMenu();
      await page.keyboard.press("Meta+O");
      await closedOnB("⌘O");
      await waitForCalls(page, "reopen", 1);

      await openMenu();
      await page.keyboard.press("Backspace");
      assert.equal(
        await page.getByTestId("delete-names").textContent(),
        "Movers need the lift on Monday, keys only come Thursday",
        "⌫ in B's menu asks to delete B"
      );
      await page.keyboard.press("Escape");
      await page.getByRole("alertdialog").waitFor({ state: "detached" });
      await waitForRowFocus(page, uuid(2));

      await openMenu();
      await page.keyboard.press("Escape");
      await closedOnB("Escape");
      await seedClipboard(page);
      await page.keyboard.press("Meta+C");
      await waitForCalls(page, "copyEntry", 2);
      assert.equal(
        await readClipboard(page),
        "Movers need the lift on Monday, keys only come Thursday",
        "⌘C after Escape copies B"
      );

      await openMenu();
      // The menu starts listening for presses outside it a moment after it opens.
      await page.waitForTimeout(200);
      await page.mouse.click(760, 520);
      await closedOnB("a click outside");
      await seedClipboard(page);
      await page.keyboard.press("Meta+C");
      await waitForCalls(page, "copyEntry", 3);
      assert.equal(
        await readClipboard(page),
        "Movers need the lift on Monday, keys only come Thursday",
        "⌘C after a click outside copies B"
      );

      // Keys the menu doesn't show are swallowed: nothing happens to A under the menu.
      await openMenu();
      await recordKeys(page);

      await inTurn(UNSHOWN_KEYS, (key) => page.keyboard.press(key));
      await inTurn(UNSHOWN_COMMANDS, async (command) => {
        await sendCommand(page, command);
      });

      await page.waitForTimeout(150);
      assert.deepEqual(
        await swallowedState(page),
        {
          keys: UNSHOWN_KEYS.map(() => true),
          menuOpen: true,
          popovers: 0,
          typing: false,
        },
        "⇧⌘D, ⌘D, ⇧⌘S, ⌘F and ⌘/ in B's menu, pressed or sent by main, do nothing"
      );

      // Space with nothing highlighted picks nothing.
      await page.keyboard.press("Space");
      await page.waitForTimeout(150);
      assert.deepEqual(
        {
          menuOpen: await menu.isVisible(),
          setStatus: await callsTo(page, "setStatus"),
        },
        { menuOpen: true, setStatus: [] },
        "Space with no item highlighted leaves the menu open and B as it is"
      );

      // Return and Space pick the highlighted item, for B.
      await menu.getByRole("menuitem", { name: COPY_ITEM }).hover();
      await seedClipboard(page);
      await page.keyboard.press("Enter");
      await closedOnB("Return on Copy");
      await waitForCalls(page, "copyEntry", 4);
      assert.equal(
        await readClipboard(page),
        "Movers need the lift on Monday, keys only come Thursday",
        "Return on the highlighted Copy copies B"
      );

      await openMenu();
      await menu.getByRole("menuitem", { name: "Copy as text" }).hover();
      await page.keyboard.press("Space");
      await closedOnB("Space on Copy as text");
      await waitForCalls(page, "copyNote", 2);

      // In a submenu, Space picks the highlighted option there.
      await openMenu();
      await menu.getByRole("menuitem", { name: "Due", exact: true }).hover();
      await page.keyboard.press("ArrowRight");
      await page
        .getByRole("menuitem", { name: /^Today/u })
        .and(page.locator(":focus"))
        .waitFor();
      await page.keyboard.press("Space");
      await closedOnB("Space in the Due submenu");
      await waitForCalls(page, "setDue", 1);

      await openMenu();
      await menu.getByRole("menuitem", { name: "Mark as done" }).hover();
      await page.keyboard.press("Space");
      await menu.waitFor({ state: "detached" });
      await until(
        page,
        "globalThis.__screens.data.captures[1].status.kind === 'done'",
        "B marked done"
      );
      await waitForRowFocus(page, uuid(3));

      assert.deepEqual(
        {
          copyEntry: await callsTo(page, "copyEntry"),
          copyNote: await callsTo(page, "copyNote"),
          remove: await callsTo(page, "remove"),
          reopen: await callsTo(page, "reopen"),
          setDue: await callsTo(page, "setDue"),
          setStatus: await callsTo(page, "setStatus"),
        },
        {
          copyEntry: [uuid(2), uuid(2), uuid(2), uuid(2)],
          copyNote: [uuid(2), uuid(2)],
          remove: [],
          reopen: [uuid(2)],
          setDue: [uuid(2)],
          setStatus: [uuid(2)],
        },
        "every key acts once, on B, never on the open capture"
      );
      assert.equal(
        await page.getByTestId("record-relationship").inputValue(),
        "Rieder's quote breaks the furniture cap and comes too late",
        "capture A stays open"
      );

      // The menu as it looks on the row now in focus.
      await rows.nth(1).click({ button: "right" });
      await menu.waitFor();
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-menu-keys",
    page: "library",
    platforms: ["macos"],
  },
  {
    // ⌘C on the open capture's row, and on its page, after its title failed to save.
    act: async (page) => {
      const title = page.getByTestId("record-relationship");
      const row = page.getByTestId("recent-item").first();

      await title.fill("NEW UNSAVED TITLE");
      await row.focus();
      await page.getByText("Couldn't save. The disk is full.").waitFor();
      await seedClipboard(page);
      await page.keyboard.press("ControlOrMeta+C");
      await row.getByText("Not copied: not saved").waitFor();
      await page.getByRole("button", { name: "More" }).focus();
      await page.keyboard.press("ControlOrMeta+C");
      await page
        .getByTestId("capture-feedback")
        .filter({ hasText: "Not copied: changes aren’t saved" })
        .waitFor();
      assert.deepEqual(
        {
          clipboard: await readClipboard(page),
          copyEntry: await callsTo(page, "copyEntry"),
          shown: await title.inputValue(),
        },
        { clipboard: SENTINEL, copyEntry: [], shown: "NEW UNSAVED TITLE" },
        "a failed save copies nothing"
      );
    },
    data: { captures: CAPTURES, failSaves: true },
    hash: `/captures/${uuid(1)}`,
    name: "library-row-copy-refused",
    page: "library",
    platforms: ["macos"],
  },

  {
    // The ⋯ menu answers the keys it shows itself, for the open capture, and swallows the rest.
    act: async (page) => {
      const more = page.getByRole("button", { name: "More" });
      const menu = page.getByRole("menu");

      const openMore = async () => {
        await more.click();
        await menu.waitFor();
      };

      await openMore();
      await page.keyboard.press("Meta+Alt+C");
      await menu.waitFor({ state: "detached" });
      await waitForCalls(page, "copyNote", 1);

      await openMore();
      await seedClipboard(page);
      await page.keyboard.press("Meta+C");
      await menu.waitFor({ state: "detached" });
      await waitForCalls(page, "copyEntry", 1);
      assert.match(
        await readClipboard(page),
        /^Rieder's quote breaks the furniture cap and comes too late\n\nChairs/u,
        "⌘C in the ⋯ menu copies the open capture"
      );

      await openMore();
      await page.keyboard.press("Meta+O");
      await menu.waitFor({ state: "detached" });
      await waitForCalls(page, "reopen", 1);

      await openMore();
      await recordKeys(page);

      await inTurn(UNSHOWN_KEYS, (key) => page.keyboard.press(key));
      await inTurn(UNSHOWN_COMMANDS, async (command) => {
        await sendCommand(page, command);
      });

      await page.waitForTimeout(150);
      assert.deepEqual(
        await swallowedState(page),
        {
          keys: UNSHOWN_KEYS.map(() => true),
          menuOpen: true,
          popovers: 0,
          typing: false,
        },
        "keys the ⋯ menu doesn't show do nothing"
      );
      assert.deepEqual(
        {
          copyEntry: await callsTo(page, "copyEntry"),
          copyNote: await callsTo(page, "copyNote"),
          reopen: await callsTo(page, "reopen"),
        },
        { copyEntry: [uuid(1)], copyNote: [uuid(1)], reopen: [uuid(1)] },
        "each key the ⋯ menu shows acts once, on the open capture"
      );
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-more-menu-keys",
    page: "library",
    platforms: ["macos"],
  },
  {
    // A's title can't be saved: no way of copying puts anything on the clipboard or says Copied.
    act: async (page) => {
      const title = page.getByTestId("record-relationship");
      const rowA = page.getByTestId("recent-item").first();
      const menu = page.getByRole("menu");
      const more = page.getByRole("button", { name: "More" });

      await title.fill("NEW UNSAVED TITLE");
      await rowA.focus();
      await page.getByText("Couldn't save. The disk is full.").waitFor();
      await seedClipboard(page);

      /** Each copy first sends the unsaved title again, which fails again: then nothing is copied. */
      const refused = async (what: string, copy: () => Promise<void>) => {
        const before = await callCount(page, "updateText");

        await copy();

        try {
          await until(
            page,
            `globalThis.__calls.filter((call) => call.method === "updateText").length > ${before}`,
            "the save to be tried again"
          );
        } catch (error) {
          throw new Error(`${what}: ${String(error)}`, { cause: error });
        }

        await page.waitForTimeout(100);
        assert.equal(await copiedShown(page), 0, `${what} says Copied`);
      };

      const inMore = async (act: () => Promise<void>) => {
        await more.click();
        await menu.waitFor();
        await act();
        await menu.waitFor({ state: "detached" });
      };

      const inRowMenu = async (act: () => Promise<void>) => {
        await rowA.click({ button: "right" });
        await menu.waitFor();
        await act();
        await menu.waitFor({ state: "detached" });
      };

      const item = (name: RegExp) =>
        menu.getByRole("menuitem", { name }).click();

      await refused("⌘C on the page", async () => {
        await more.focus();
        await page.keyboard.press("Meta+C");
      });
      await refused("⌘C on the row", async () => {
        await rowA.focus();
        await page.keyboard.press("Meta+C");
      });
      await refused("Copy as text sent by main, page", async () => {
        await more.focus();
        await sendCommand(page, "copyNote");
      });
      await refused("Copy as text sent by main, row", async () => {
        await rowA.focus();
        await sendCommand(page, "copyNote");
      });
      await refused("⋯ Copy", () => inMore(() => item(COPY_ITEM)));
      await refused("⋯ Copy as text", () =>
        inMore(() => item(/^Copy as text/u))
      );
      await refused("⌘C in the ⋯ menu", () =>
        inMore(() => page.keyboard.press("Meta+C"))
      );
      await refused("⌥⌘C in the ⋯ menu", () =>
        inMore(() => page.keyboard.press("Meta+Alt+C"))
      );
      await refused("the row menu's Copy", () =>
        inRowMenu(() => item(COPY_ITEM))
      );
      await refused("the row menu's Copy as text", () =>
        inRowMenu(() => item(/^Copy as text/u))
      );
      await refused("⌘C in the row menu", () =>
        inRowMenu(() => page.keyboard.press("Meta+C"))
      );
      await refused("⌥⌘C in the row menu", () =>
        inRowMenu(() => page.keyboard.press("Meta+Alt+C"))
      );
      await refused("a window's Copy image", () =>
        page.getByRole("button", { name: "Copy image" }).first().click()
      );
      await page
        .getByTestId("capture-feedback")
        .filter({ hasText: "Not copied: changes aren’t saved" })
        .waitFor();

      await page
        .getByRole("link", { name: /^Open window 1,/u })
        .first()
        .click();
      await page.getByTestId("viewer-image").waitFor();
      await refused("the viewer's Copy image", () =>
        page.getByRole("button", { name: "Copy image" }).click()
      );
      await page
        .getByTestId("viewer-feedback")
        .filter({ hasText: "Not copied: couldn’t save. The disk is full." })
        .waitFor();

      assert.deepEqual(
        {
          clipboard: await readClipboard(page),
          copyEntry: await callsTo(page, "copyEntry"),
          copyImage: await callsTo(page, "copyImage"),
          copyNote: await callsTo(page, "copyNote"),
        },
        { clipboard: SENTINEL, copyEntry: [], copyImage: [], copyNote: [] },
        "no copy reached main"
      );

      // The viewer is the same capture: back from it, the unsaved title and its error are still there.
      await page.getByRole("button", { name: "Back" }).click();
      await page.getByText("Couldn't save. The disk is full.").waitFor();
      assert.equal(await title.inputValue(), "NEW UNSAVED TITLE");
      await page
        .getByRole("link", { name: /^Open window 1,/u })
        .first()
        .click();
      await page.getByTestId("viewer-image").waitFor();
      await page.getByRole("button", { name: "Copy image" }).click();
      await page.getByTestId("viewer-feedback").waitFor();
    },
    data: { captures: CAPTURES, failSaves: true },
    hash: `/captures/${uuid(1)}`,
    name: "library-copy-gate",
    page: "library",
    platforms: ["macos"],
  },
  {
    // Copy image waits for the title being typed to be saved, then says Copied.
    act: async (page) => {
      const title = page.getByTestId("record-relationship");

      await title.fill("Rieder's quote breaks the cap, revised");
      await seedClipboard(page);
      await page.getByRole("button", { name: "Copy image" }).first().click();
      await page.getByRole("button", { name: "Copied" }).waitFor();
      assert.equal(await readClipboard(page), `(image ${uuid(101)})`);
      assert.deepEqual(
        await page.evaluate<string[]>(
          "globalThis.__calls.map((call) => call.method).filter((method) => method === 'updateText' || method === 'copyImage')"
        ),
        ["updateText", "copyImage"],
        "the edit is saved before the image is copied"
      );

      // Typed, then straight to the viewer: its Copy image saves that title first too.
      await title.fill("Typed just before opening the viewer");
      await page
        .getByRole("link", { name: /^Open window 2,/u })
        .first()
        .click();
      await page.getByTestId("viewer-image").waitFor();
      await seedClipboard(page);
      await page.getByRole("button", { name: "Copy image" }).click();
      await page.getByRole("button", { name: "Copied" }).waitFor();
      assert.equal(await readClipboard(page), `(image ${uuid(102)})`);
      assert.deepEqual(
        await page.evaluate<string[]>(
          "globalThis.__calls.filter((call) => call.method === 'copyImage' || (call.method === 'updateText' && call.args[1].relationship === 'Typed just before opening the viewer')).map((call) => call.method)"
        ),
        ["copyImage", "updateText", "copyImage"],
        "the title typed before the viewer is saved before the viewer's copy"
      );

      await page.getByRole("button", { name: "Back" }).click();
      assert.equal(
        await title.inputValue(),
        "Typed just before opening the viewer",
        "back from the viewer, the title typed before it is still there"
      );
      await page
        .getByRole("link", { name: /^Open window 2,/u })
        .first()
        .click();
      await page.getByRole("button", { name: "Copy image" }).click();
      await page.getByRole("button", { name: "Copied" }).waitFor();
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-copy-image",
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
    // The system's locale writes the dates; en-US matches the other two apps' screenshots.
    locale: "en-US",
    permissions: ["clipboard-read", "clipboard-write"],
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
