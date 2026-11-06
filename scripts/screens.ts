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

/** A capture's fields as main lists them for a Discard it still owes. */
const textOf = (capture: Capture) => ({
  description: capture.description,
  due: capture.due,
  relationship: capture.relationship,
  todos: capture.todos,
  viewDescriptions: Object.fromEntries(
    capture.views.map((each) => [each.id, each.description])
  ),
});

const ALL: readonly Capture[] = CAPTURES;
const [FIRST, ...REST] = ALL;

if (FIRST === undefined) {
  throw new Error("the fixture has no captures");
}

/** The first capture as main holds it while it owes a Discard of these words. */
const OWED_CAPTURE: Capture = {
  ...FIRST,
  relationship: "Rieder’s quote needs a second look",
};

/** The Discard a closed Recent Captures window left owed: main couldn’t put the saved words back. */
const OWED = {
  captureId: FIRST.id,
  message: "Inset can’t write to its data folder.",
  rev: 4,
  saved: textOf(FIRST),
  words: textOf(OWED_CAPTURE),
};

/** What a scene's fake bridge answers from: the popover's draft, the library's captures or the settings view. */
interface SceneData {
  captures?: readonly Capture[];
  /** Every text save answers that it failed, as a full disk would. */
  failSaves?: boolean;
  /** Text saves wait until the scene calls __releaseSaves, as a slow disk would. */
  holdSaves?: boolean;
  /** The capture panel's Save waits for main's answer until the scene calls __releaseSave. */
  holdSave?: boolean;
  /** The next copies main refuses as not saved, each with its reason; they copy nothing. */
  copyNotSaved?: string[];
  /** The Discards main still owes as Recent Captures opens. */
  owed?: readonly (typeof OWED)[];
  /** Main can't say which Discards it owes: each time the page asks, the call rejects. */
  owedUnread?: boolean;
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

/**
 * What the capture panel's quit or discard prompt looks like to the keyboard: whether it is a
 * modal over a backdrop, whether focus is in it, and whether the fields behind it take input.
 */
const promptState = (page: Page) =>
  page.evaluate<{
    focusInPrompt: boolean;
    modal: boolean;
    overlays: number;
    titleDisabled: boolean;
  }>(`({
    focusInPrompt: document.querySelector("[data-slot=alert-dialog-content]")?.contains(document.activeElement) === true,
    modal: document.querySelector("[data-slot=alert-dialog-content]")?.getAttribute("role") === "alertdialog",
    overlays: document.querySelectorAll("[data-slot=alert-dialog-overlay]").length,
    titleDisabled: document.querySelector("#relationship")?.matches(":disabled") === true,
  })`);

/** Tries to change the capture panel's text behind a lock: typing, the field keys, a click. */
const tryToEdit = async (page: Page) => {
  await page.locator("#relationship").click({ force: true, timeout: 1000 });
  await page.keyboard.type(" TYPED");
  await sendCommand(page, "focusSteps");
  await sendCommand(page, "setDue");
  await sendCommand(page, "focusDescription");
  await page.waitForTimeout(150);
};

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

/** Main asking Recent Captures to let its window close, or the app quit. */
const pushLeave = (page: Page, reason: "close" | "quit") =>
  page.evaluate(
    `window.dispatchEvent(new CustomEvent("fixture:leave", { detail: ${JSON.stringify(reason)} }))`
  );

const callCount = (page: Page, method: string) =>
  page.evaluate<number>(
    `globalThis.__calls.filter((call) => call.method === ${JSON.stringify(method)}).length`
  );

/** Changes how the fixture's main answers from now on, as `{ failSaves: true }`. */
const setData = (page: Page, flags: string) =>
  page.evaluate(`Object.assign(globalThis.__screens.data, ${flags})`);

/**
 * Types words on the open capture that can't be saved, then discards them while their Retry is on
 * its way, and main can't put the saved version back: the page shows them as not discarded.
 */
const undiscard = async (page: Page, words: string) => {
  const failure = page.getByTestId("save-failure");

  await setData(
    page,
    `{ failDiscards: false, failSaves: true, holdSaves: false }`
  );
  await page.getByTestId("record-relationship").fill(words);
  await failure.getByText(/The disk is full/u).waitFor();
  await setData(
    page,
    `{ failDiscards: true, failSaves: false, holdSaves: true }`
  );

  const sent = await callCount(page, "updateText");

  await failure.getByRole("button", { exact: true, name: "Retry" }).click();
  await waitForCalls(page, "updateText", sent + 1);
  await failure.getByRole("button", { name: "Discard changes" }).click();
  await failure
    .getByRole("button", { exact: true, name: "Discard again" })
    .waitFor();
  await setData(page, `{ holdSaves: false }`);
  await page.evaluate("globalThis.__releaseSaves()");
};

/**
 * Types words on the open capture that can't be saved, then discards them while their Retry is on
 * its way, and main holds that Discard without answering, as a disk that hangs would.
 */
const stallDiscard = async (page: Page, words: string) => {
  const failure = page.getByTestId("save-failure");

  await setData(
    page,
    `{ failDiscards: false, failSaves: true, holdDiscards: false, holdSaves: false }`
  );
  await page.getByTestId("record-relationship").fill(words);
  await failure.getByText(/The disk is full/u).waitFor();
  await setData(
    page,
    `{ failSaves: false, holdDiscards: true, holdSaves: true }`
  );

  const sent = await callCount(page, "updateText");
  const discards = await callCount(page, "discard");

  await failure.getByRole("button", { exact: true, name: "Retry" }).click();
  await waitForCalls(page, "updateText", sent + 1);
  await failure.getByRole("button", { name: "Discard changes" }).click();
  await waitForCalls(page, "discard", discards + 1);
  await setData(page, `{ holdSaves: false }`);
  await page.evaluate("globalThis.__releaseSaves()");
};

/** What the page answered main's close and quit requests, in order. */
const leaveAnswers = (page: Page) =>
  page.evaluate<string[]>(
    "globalThis.__calls.filter((call) => call.method === 'answerLeave').map((call) => call.args[0])"
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
      draft: draft({
        ...FULL_DRAFT,
        activity: { kind: "confirmingQuit", late: false },
      }),
    },
    name: "popover-quit",
    page: "popover",
    platforms: ["macos"],
  },
  {
    /*
     * The quit prompt answers Return with Save whichever button has focus, so a focused Discard
     * can't throw the capture away. Space presses the focused button, and Escape cancels. Save has
     * focus when the prompt shows, with its ring.
     */
    act: async (page) => {
      const prompt = page.getByTestId("quit-prompt");

      const button = (name: string) =>
        prompt.getByRole("button", { exact: true, name });

      await until(
        page,
        `document.activeElement?.textContent?.trim() === "Save"`,
        "focus on Save"
      );
      assert.notEqual(
        await page.evaluate<string>(
          "getComputedStyle(document.activeElement).boxShadow"
        ),
        "none",
        "Save shows its focus ring"
      );

      await inTurn(["Cancel", "Discard", "Save"], async (name) => {
        await button(name).focus();
        await page.keyboard.press("Enter");
      });
      await waitForCalls(page, "chooseQuit", 3);
      assert.deepEqual(
        await callsTo(page, "chooseQuit"),
        ["save", "save", "save"],
        "Return saves, whichever button has focus"
      );

      await inTurn(["Cancel", "Discard"], async (name) => {
        await button(name).focus();
        await page.keyboard.press("Space");
      });
      await waitForCalls(page, "chooseQuit", 5);

      const chosen = await callsTo(page, "chooseQuit");

      assert.deepEqual(
        chosen.slice(3),
        ["cancel", "discard"],
        "Space presses the focused button"
      );

      await page.keyboard.press("Escape");
      await waitForCalls(page, "chooseQuit", 6);
      const answered = await callsTo(page, "chooseQuit");

      assert.deepEqual(
        [answered.at(-1), await callCount(page, "dismiss")],
        ["cancel", 0],
        "Escape cancels the quit, as the prompt's Cancel does"
      );

      // The fixture's main keeps asking: the prompt is still up, as a modal that keeps focus.
      await button("Save").focus();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      await page.keyboard.press("Tab");
      assert.deepEqual(
        await promptState(page),
        {
          focusInPrompt: true,
          modal: true,
          overlays: 1,
          titleDisabled: true,
        },
        "the prompt is the shared modal: a backdrop, focus kept in it, the fields behind locked"
      );
      await button("Save").evaluate((node) =>
        node.focus({ focusVisible: true })
      );
    },
    data: {
      draft: draft({
        ...FULL_DRAFT,
        activity: { kind: "confirmingQuit", late: false },
      }),
    },
    name: "popover-quit-keys",
    page: "popover",
  },
  {
    // A save chosen at quit that ran late: the prompt asks again, and Return retries it.
    act: async (page) => {
      const prompt = page.getByTestId("quit-prompt");

      await prompt.getByText("Saving didn’t finish in time.").waitFor();
      await until(
        page,
        `document.activeElement?.textContent?.trim() === "Retry"`,
        "focus on Retry"
      );
      await prompt
        .getByRole("button", { exact: true, name: "Discard" })
        .focus();
      await page.keyboard.press("Enter");
      await waitForCalls(page, "chooseQuit", 1);
      assert.deepEqual(await callsTo(page, "chooseQuit"), ["save"]);

      // Nothing behind the prompt takes input while the late save is on its way, and Return
      // still retries after a click on the backdrop took focus out of the prompt.
      const before = await page.locator("#relationship").inputValue();
      const state = await promptState(page);

      await page.mouse.click(40, 120);
      await page.keyboard.type("TYPED");
      await page.keyboard.press("Enter");
      await waitForCalls(page, "chooseQuit", 2);
      assert.deepEqual(
        {
          chosen: await callsTo(page, "chooseQuit"),
          prompt: state,
          sent: await callCount(page, "setText"),
          title: await page.locator("#relationship").inputValue(),
        },
        {
          chosen: ["save", "save"],
          prompt: {
            focusInPrompt: true,
            modal: true,
            overlays: 1,
            titleDisabled: true,
          },
          sent: 0,
          title: before,
        },
        "the panel behind the prompt takes nothing, and Return retries whatever has focus"
      );
      await prompt
        .getByRole("button", { exact: true, name: "Retry" })
        .evaluate((node) => node.focus({ focusVisible: true }));
    },
    data: {
      draft: draft({
        ...FULL_DRAFT,
        activity: { kind: "confirmingQuit", late: true },
      }),
    },
    name: "popover-quit-late",
    page: "popover",
  },
  {
    /*
     * While the panel's save is on its way, as after Save or after Cancel in the late-save prompt,
     * the fields lock: nothing typed, no field key and no Due pick reaches text main would ignore.
     * Discard still works, and withdraws the save.
     */
    act: async (page) => {
      const title = page.locator("#relationship");

      await until(
        page,
        `document.querySelector("[data-testid='draft-fields']")?.disabled === true`,
        "the fields locked"
      );

      const before = {
        steps: await page.getByRole("textbox", { name: /^Next step/u }).count(),
        title: await title.inputValue(),
      };

      await tryToEdit(page);
      assert.deepEqual(
        {
          discard: await page
            .getByRole("button", { exact: true, name: "Discard" })
            .isEnabled(),
          duePicker: await page
            .getByRole("button", { name: /^Tomorrow/u })
            .count(),
          sent: await callCount(page, "setText"),
          steps: await page
            .getByRole("textbox", { name: /^Next step/u })
            .count(),
          title: await title.inputValue(),
          titleDisabled: await title.isDisabled(),
        },
        {
          discard: true,
          duePicker: 0,
          sent: 0,
          steps: before.steps,
          title: before.title,
          titleDisabled: true,
        },
        "the locked fields take no input, and Discard stays available"
      );
    },
    data: {
      draft: draft({ ...FULL_DRAFT, activity: { kind: "saving" } }),
    },
    name: "popover-saving-locked",
    page: "popover",
  },
  {
    /*
     * From the moment Save is pressed until main answers, the fields lock too, so a key typed in
     * that gap isn't lost. Once main answers, here with the panel still open as after a failed
     * save, they unlock and the title has the keyboard again.
     */
    act: async (page) => {
      const title = page.locator("#relationship");
      const before = await title.inputValue();

      await title.focus();
      await page.keyboard.press(
        (await page.evaluate<string>("globalThis.inset.platform")) === "macos"
          ? "Meta+Enter"
          : "Control+Enter"
      );
      await waitForCalls(page, "save", 1);
      await page.keyboard.type(" TYPED");

      const whileSaving = {
        disabled: await title.isDisabled(),
        sent: await callCount(page, "setText"),
        title: await title.inputValue(),
      };

      await page.evaluate("globalThis.__releaseSave()");
      await until(
        page,
        `document.querySelector("#relationship") === document.activeElement`,
        "the title has the keyboard again"
      );
      await page.keyboard.type("!");
      assert.deepEqual(
        { after: await title.inputValue(), whileSaving },
        {
          after: `${before}!`,
          whileSaving: { disabled: true, sent: 0, title: before },
        },
        "nothing typed between Save and main's answer is lost to it"
      );

      // File > Save Capture (⌘S) reaches the panel as a command, and locks the fields the same way.
      await sendCommand(page, "saveCapture");
      await waitForCalls(page, "save", 2);
      await page.keyboard.type("?");

      const viaMenu = {
        disabled: await title.isDisabled(),
        title: await title.inputValue(),
      };

      await page.evaluate("globalThis.__releaseSave()");
      await until(
        page,
        `document.querySelector("#relationship") === document.activeElement`,
        "the title has the keyboard again"
      );
      assert.deepEqual(
        viaMenu,
        { disabled: true, title: `${before}!` },
        "⌘S from the menu saves through the panel, which locks its fields"
      );
    },
    data: { draft: draft(FULL_DRAFT), holdSave: true },
    name: "popover-save-pending",
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
      const footerDiscard = page
        .getByRole("button", { exact: true, name: "Discard" })
        .first();

      const prompt = page.getByTestId("discard-confirm");

      await footerDiscard.click();
      await until(
        page,
        `document.activeElement?.textContent?.trim() === "Keep"`,
        "focus on Keep"
      );

      const keepBox = await prompt
        .getByRole("button", { exact: true, name: "Keep" })
        .boundingBox();

      const discardBox = await prompt
        .getByRole("button", { exact: true, name: "Discard" })
        .boundingBox();

      assert.ok(
        keepBox !== null && discardBox !== null && keepBox.y < discardBox.y,
        "Keep, the safe default, shows above Discard"
      );
      await prompt
        .getByRole("button", { exact: true, name: "Discard" })
        .focus();
      await page.keyboard.press("Enter");
      await prompt.waitFor({ state: "detached" });
      assert.equal(
        await callCount(page, "discard"),
        0,
        "Return keeps the capture, though Discard had focus"
      );

      await footerDiscard.click();
      await prompt.waitFor();
      assert.deepEqual(
        await promptState(page),
        {
          focusInPrompt: true,
          modal: true,
          overlays: 1,
          titleDisabled: false,
        },
        "the discard question is the shared modal"
      );
    },
    data: { draft: draft(FULL_DRAFT) },
    name: "popover-discard",
    page: "popover",
    platforms: ["macos"],
  },
  {
    /*
     * Keyboard Shortcuts asked for from the menu while the late-save prompt is up leaves the
     * prompt as it is: the modal, with focus kept in it, and Escape still cancels the quit.
     */
    act: async (page) => {
      await page.getByTestId("quit-prompt").waitFor();
      await sendCommand(page, "showShortcuts");
      await page.waitForTimeout(150);
      await page.keyboard.press("Tab");
      assert.deepEqual(
        {
          prompt: await promptState(page),
          sheet: await page
            .getByRole("heading", { name: "Keyboard Shortcuts" })
            .count(),
        },
        {
          prompt: {
            focusInPrompt: true,
            modal: true,
            overlays: 1,
            titleDisabled: true,
          },
          sheet: 0,
        },
        "the quit prompt stays the modal, with no sheet over it"
      );

      await page.keyboard.press("Escape");
      await waitForCalls(page, "chooseQuit", 1);
      assert.deepEqual(
        await callsTo(page, "chooseQuit"),
        ["cancel"],
        "Escape still cancels the quit"
      );
    },
    data: {
      draft: draft({
        ...FULL_DRAFT,
        activity: { kind: "confirmingQuit", late: true },
      }),
    },
    name: "popover-quit-shortcuts",
    page: "popover",
    platforms: ["macos"],
  },
  {
    // The same for “Discard this capture?”: the sheet waits, and Escape keeps the capture.
    act: async (page) => {
      const prompt = page.getByTestId("discard-confirm");

      const ask = async () => {
        await page
          .getByRole("button", { exact: true, name: "Discard" })
          .first()
          .click();
        await prompt.waitFor();
        await sendCommand(page, "showShortcuts");
        await page.waitForTimeout(150);
      };

      await ask();
      assert.deepEqual(
        {
          prompt: await promptState(page),
          sheet: await page
            .getByRole("heading", { name: "Keyboard Shortcuts" })
            .count(),
        },
        {
          prompt: {
            focusInPrompt: true,
            modal: true,
            overlays: 1,
            titleDisabled: false,
          },
          sheet: 0,
        },
        "the discard question stays the modal, with no sheet over it"
      );

      await page.keyboard.press("Escape");
      await prompt.waitFor({ state: "detached" });
      assert.equal(
        await callCount(page, "discard"),
        0,
        "Escape keeps the capture"
      );
      await ask();
    },
    data: { draft: draft(FULL_DRAFT) },
    name: "popover-discard-shortcuts",
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
          hasText:
            "Couldn’t save your changes, so nothing was copied. The disk is full.",
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
        activity: { kind: "confirmingQuit", late: false },
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
      await waitForCalls(page, "updateText", 1);

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
          setStatus: await callsTo(page, "setStatus"),
          // The Due joins B's draft and is saved with its words.
          updateText: await callsTo(page, "updateText"),
        },
        {
          copyEntry: [uuid(2), uuid(2), uuid(2), uuid(2)],
          copyNote: [uuid(2), uuid(2)],
          remove: [],
          reopen: [uuid(2)],
          setStatus: [uuid(2)],
          updateText: [uuid(2)],
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
      await page.getByText("Couldn’t save. The disk is full.").waitFor();
      await seedClipboard(page);
      await page.keyboard.press("ControlOrMeta+C");
      const saves = await callCount(page, "updateText");
      const refusal = page.getByTestId("row-copy-refused");

      await refusal
        .getByText(
          "Couldn’t save your changes, so nothing was copied. The disk is full."
        )
        .waitFor();
      await refusal
        .getByRole("button", { name: "Retry saving “NEW UNSAVED TITLE”" })
        .waitFor();
      await page.getByRole("button", { name: "More" }).focus();
      await page.keyboard.press("ControlOrMeta+C");
      await page
        .getByTestId("capture-feedback")
        .filter({
          hasText:
            "Couldn’t save your changes, so nothing was copied. The disk is full.",
        })
        .waitFor();
      await page
        .getByRole("button", { exact: true, name: "Retry saving" })
        .waitFor();
      assert.deepEqual(
        {
          beginCopy: await callCount(page, "beginCopy"),
          clipboard: await readClipboard(page),
          copyEntry: await callsTo(page, "copyEntry"),
          saves: await callCount(page, "updateText"),
          shown: await title.inputValue(),
        },
        {
          beginCopy: 0,
          clipboard: SENTINEL,
          copyEntry: [],
          saves,
          shown: "NEW UNSAVED TITLE",
        },
        "a failed draft refuses at once: main is never asked, and nothing is sent again"
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
    /*
     * A's title can't be saved. No way of copying A puts anything on the clipboard or says Copied,
     * and none sends the words again: the failed draft refuses at once. Leaving A, and copying it
     * from its row long after the save failed, still refuses, and A shows its words and error
     * again. After Discard changes, every one of those ways copies.
     */
    act: async (page) => {
      const title = page.getByTestId("record-relationship");
      const rowA = page.getByTestId("recent-item").first();
      const rowB = page.getByTestId("recent-item").nth(1);
      const menu = page.getByRole("menu");
      const more = page.getByRole("button", { name: "More" });
      const failure = page.getByTestId("save-failure");

      await title.fill("NEW UNSAVED TITLE");
      await rowA.focus();
      await failure.getByText("Couldn’t save. The disk is full.").waitFor();
      await failure.getByRole("button", { name: "Retry" }).waitFor();
      await failure.getByRole("button", { name: "Discard changes" }).waitFor();
      await seedClipboard(page);

      const saves = await callCount(page, "updateText");

      const copies = () =>
        page.evaluate<number>(
          `globalThis.__calls.filter((call) => ["copyEntry", "copyNote", "copyImage"].includes(call.method)).length`
        );

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

      /** Every way to copy A: from its page, its row, both menus, main, and its windows. */
      const ways: readonly (readonly [string, () => Promise<void>])[] = [
        [
          "⌘C on the page",
          async () => {
            await more.focus();
            await page.keyboard.press("Meta+C");
          },
        ],
        [
          "⌘C on the row",
          async () => {
            await rowA.focus();
            await page.keyboard.press("Meta+C");
          },
        ],
        [
          "Copy as text sent by main, page",
          async () => {
            await more.focus();
            await sendCommand(page, "copyNote");
          },
        ],
        [
          "Copy as text sent by main, row",
          async () => {
            await rowA.focus();
            await sendCommand(page, "copyNote");
          },
        ],
        ["⋯ Copy", () => inMore(() => item(COPY_ITEM))],
        ["⋯ Copy as text", () => inMore(() => item(/^Copy as text/u))],
        ["⌘C in the ⋯ menu", () => inMore(() => page.keyboard.press("Meta+C"))],
        [
          "⌥⌘C in the ⋯ menu",
          () => inMore(() => page.keyboard.press("Meta+Alt+C")),
        ],
        ["the row menu's Copy", () => inRowMenu(() => item(COPY_ITEM))],
        [
          "the row menu's Copy as text",
          () => inRowMenu(() => item(/^Copy as text/u)),
        ],
        [
          "⌘C in the row menu",
          () => inRowMenu(() => page.keyboard.press("Meta+C")),
        ],
        [
          "⌥⌘C in the row menu",
          () => inRowMenu(() => page.keyboard.press("Meta+Alt+C")),
        ],
        [
          "a window's Copy image",
          () =>
            page.getByRole("button", { name: "Copy image" }).first().click(),
        ],
      ];

      await inTurn(ways, async ([what, copy]) => {
        await copy();
        await page.waitForTimeout(150);
        assert.equal(await copiedShown(page), 0, `${what} says Copied`);
        assert.equal(await copies(), 0, `${what} reached main's copy`);
        assert.equal(
          await callCount(page, "beginCopy"),
          0,
          `${what} began a copy in main`
        );
      });
      await page
        .getByTestId("capture-feedback")
        .filter({
          hasText:
            "Couldn’t save your changes, so nothing was copied. The disk is full.",
        })
        .waitFor();

      await page
        .getByRole("link", { name: /^Open window 1,/u })
        .first()
        .click();
      await page.getByTestId("viewer-image").waitFor();
      await page.getByRole("button", { name: "Copy image" }).click();
      await page
        .getByTestId("viewer-feedback")
        .filter({
          hasText:
            "Couldn’t save your changes, so nothing was copied. The disk is full.",
        })
        .waitFor();
      assert.equal(
        await copiedShown(page),
        0,
        "the viewer's Copy image says Copied"
      );

      // The viewer is the same capture: back from it, the unsaved title and its error are still there.
      await page.getByRole("button", { name: "Back" }).click();
      await failure.getByText("Couldn’t save. The disk is full.").waitFor();
      assert.equal(await title.inputValue(), "NEW UNSAVED TITLE");

      // Leaving A, its words stay. Long after their save failed, A's row still refuses, and says why.
      await rowB.click();
      await until(
        page,
        `document.querySelector("[data-testid='record-relationship']")?.value === ${JSON.stringify(CAPTURES[1]?.relationship)}`,
        "capture B to open"
      );
      await rowA.getByTestId("row-unsaved").waitFor({ timeout: 8000 });
      await page.waitForTimeout(1000);
      await inRowMenu(() => page.keyboard.press("Meta+C"));
      await page
        .getByTestId("row-copy-refused")
        .getByText(
          "Couldn’t save your changes, so nothing was copied. The disk is full."
        )
        .waitFor();
      assert.deepEqual(
        { clipboard: await readClipboard(page), copies: await copies() },
        { clipboard: SENTINEL, copies: 0 },
        "no copy of A reached main"
      );

      // Back in A: its words, the error, Retry and Discard changes, and nothing sent again.
      await rowA.click();
      await failure.waitFor();
      assert.equal(await title.inputValue(), "NEW UNSAVED TITLE");
      assert.equal(
        await callCount(page, "updateText"),
        saves,
        "a refused copy sends nothing again"
      );

      // Typing on after the failure keeps the error and its buttons where they are: nothing jumps.
      const description = page.getByTestId("description");

      /** How far the description sits below the title, which the error row between them sets. */
      const gap = () =>
        page.evaluate<number>(
          `document.querySelector("[data-testid='description']").getBoundingClientRect().top - document.querySelector("#record-title").getBoundingClientRect().top`
        );

      const at = await gap();

      await description.focus();
      await page.keyboard.press("End");
      await page.keyboard.type(" Typed after the failure.");
      assert.ok(await failure.isVisible(), "the error stays while typing");
      assert.equal(await gap(), at, "nothing moves while typing");
      await waitForCalls(page, "updateText", saves + 1);
      await failure.getByText("Couldn’t save. The disk is full.").waitFor();
      assert.equal(await gap(), at, "nothing moves once it fails again");

      const sent = await callCount(page, "updateText");

      // Discard changes: the stored words come back, the title has focus, and every way copies.
      await failure.getByRole("button", { name: "Discard changes" }).click();
      await failure.waitFor({ state: "detached" });
      assert.equal(await title.inputValue(), CAPTURES[0]?.relationship);
      await waitForFocus(page, "#record-title");
      await inTurn(ways, async ([what, copy]) => {
        const before = await copies();

        await copy();

        try {
          await until(
            page,
            `globalThis.__calls.filter((call) => ["copyEntry", "copyNote", "copyImage"].includes(call.method)).length === ${before + 1}`,
            "the copy"
          );
        } catch (error) {
          throw new Error(`${what} after Discard changes: ${String(error)}`, {
            cause: error,
          });
        }
      });
      assert.equal(
        await callCount(page, "updateText"),
        sent,
        "the discarded words are never sent"
      );
    },
    data: { captures: CAPTURES, failSaves: true },
    hash: `/captures/${uuid(1)}`,
    name: "library-copy-gate",
    page: "library",
    platforms: ["macos"],
  },
  {
    // Words that can't be saved stay with their capture after it is left, and its row says so.
    act: async (page) => {
      const title = page.getByTestId("record-relationship");
      const rows = page.getByTestId("recent-item");

      await title.fill("Rieder's quote breaks the cap: ask Marco for CHF 260");
      await rows.nth(1).click();
      await rows.nth(0).getByTestId("row-unsaved").waitFor();
      await rows.nth(0).click();
      await page.getByTestId("save-failure").waitFor();
      assert.equal(
        await title.inputValue(),
        "Rieder's quote breaks the cap: ask Marco for CHF 260"
      );
    },
    data: { captures: CAPTURES, failSaves: true },
    hash: `/captures/${uuid(1)}`,
    name: "library-draft-failed",
    page: "library",
  },
  {
    /*
     * Closing or quitting with words that couldn't be saved is held: the prompt says how many and
     * why. Return retries whichever button has focus, Esc cancels, and Space presses the focused
     * button, so Discard is only ever a deliberate choice.
     */
    act: async (page) => {
      const title = page.getByTestId("record-relationship");
      const rows = page.getByTestId("recent-item");
      const prompt = page.getByTestId("leave-prompt");
      const failure = page.getByTestId("save-failure");
      const typed = "Rieder's quote breaks the cap: ask Marco for CHF 260";
      const button = (name: string) => prompt.getByRole("button", { name });
      const log: string[] = [];

      const answered = async (more: readonly string[], what: string) => {
        log.push(...more);
        await until(
          page,
          `JSON.stringify(globalThis.__calls.filter((call) => call.method === 'answerLeave').map((call) => call.args[0])) === ${JSON.stringify(JSON.stringify(log))}`,
          what
        );
      };

      const failSaves = (on: boolean) =>
        page.evaluate(`globalThis.__screens.data.failSaves = ${String(on)}`);

      const retryFocused = (what: string) =>
        until(page, "document.activeElement?.textContent === 'Retry'", what);

      const held = async (reason: "close" | "quit") => {
        await pushLeave(page, reason);
        await prompt.waitFor();
        await answered(["waiting", "held"], `the ${reason} is held`);
        await retryFocused(`Retry has focus when the ${reason} is held`);
      };

      // Nothing unsaved: the window may go at once.
      await pushLeave(page, "close");
      await answered(["waiting", "go"], "a clean page goes at once");
      assert.equal(await prompt.count(), 0, "no prompt for a clean page");

      // The mouse was used last, and Retry still shows its ring, so it is clear what Return does.
      await title.click();
      await title.fill(typed);
      await failure.waitFor();
      await held("close");
      assert.equal(
        await prompt.getByRole("heading").textContent(),
        "1 change couldn’t be saved"
      );
      assert.equal(
        await prompt
          .locator("[data-slot=alert-dialog-description]")
          .textContent(),
        "The disk is full."
      );
      assert.deepEqual(await prompt.getByRole("button").allTextContents(), [
        "Cancel",
        "Discard and close",
        "Retry",
      ]);
      assert.notEqual(
        await page.evaluate<string>(
          "getComputedStyle(document.activeElement).boxShadow"
        ),
        "none",
        "Retry shows its focus ring"
      );

      // Return retries whichever button has focus, and never answers: the disk is still full.
      await inTurn(["Cancel", "Discard and close", "Retry"], async (name) => {
        const sent = await callCount(page, "updateText");

        await button(name).focus();
        await page.keyboard.press("Enter");
        await waitForCalls(page, "updateText", sent + 1);
        await retryFocused(`Retry has focus again after Return on ${name}`);
        await page.waitForTimeout(100);
        assert.equal(
          await callCount(page, "updateText"),
          sent + 1,
          `Return on ${name} retries once`
        );
        assert.equal(await prompt.count(), 1, `Return on ${name} keeps it`);
        await answered([], `Return on ${name} answers nothing`);
      });

      // Esc cancels, with the words still there.
      await page.keyboard.press("Escape");
      await prompt.waitFor({ state: "detached" });
      await answered(["stay"], "Esc stays");
      assert.equal(await title.inputValue(), typed, "Esc keeps the words");

      // Space presses the focused button: Cancel stays.
      await held("close");
      await button("Cancel").focus();
      await page.keyboard.press(" ");
      await prompt.waitFor({ state: "detached" });
      await answered(["stay"], "Space on Cancel stays");
      assert.equal(await title.inputValue(), typed, "Cancel keeps the words");

      // A quit says so. Once the disk works, Return saves the words and lets the app quit.
      await held("quit");
      await button("Discard and quit").waitFor();
      await failSaves(false);
      await page.keyboard.press("Enter");
      await prompt.waitFor({ state: "detached" });
      await answered(["go"], "Retry saved");
      assert.equal(await page.getByTestId("row-unsaved").count(), 0);

      // Space on Discard and close gives the words up: the saved title comes back.
      await failSaves(true);
      await title.fill("Typed, then given up");
      await failure.waitFor();
      await held("close");
      await button("Discard and close").focus();
      await page.keyboard.press(" ");
      await prompt.waitFor({ state: "detached" });
      await answered(["go"], "Space on Discard lets go");
      assert.equal(
        await title.inputValue(),
        typed,
        "Discard brings the saved title back"
      );
      assert.equal(await page.getByTestId("row-unsaved").count(), 0);
      assert.equal(await failure.count(), 0, "Discard clears the error");

      // Two captures' words, each unsaved: the prompt counts both.
      await title.fill("Ask Marco before Friday");
      await failure.waitFor();
      await rows.nth(1).click();
      await rows.nth(0).getByTestId("row-unsaved").waitFor();
      await title.fill("Delivery from the 24th clashes with the move");
      await failure.waitFor();
      await held("close");
      assert.equal(
        await prompt.getByRole("heading").textContent(),
        "2 changes couldn’t be saved"
      );

      // The round 6 reviewer's probe: Return on a focused Discard and close retries both.
      const sent = await callCount(page, "updateText");

      await button("Discard and close").focus();
      await page.keyboard.press("Enter");
      await waitForCalls(page, "updateText", sent + 2);
      await retryFocused("Retry has focus after Return on Discard");
      await answered([], "Return on Discard answers nothing");
      assert.equal(await page.getByTestId("row-unsaved").count(), 2);
    },
    data: { captures: CAPTURES, failSaves: true },
    hash: `/captures/${uuid(1)}`,
    name: "library-leave-held",
    page: "library",
  },
  {
    /*
     * A save that never answers: the close waits SETTLE_MS, then holds with "Saving didn't finish
     * in time", never closing on its own. Cancel and Discard work at once while it still hangs, and
     * the discarded words landing late never come back: every field shows the saved words.
     */
    act: async (page) => {
      const title = page.getByTestId("record-relationship");
      const description = page.getByTestId("description");
      const step = page.getByRole("textbox", { name: "Next step 2" });
      const windowDescription = page.getByTestId("window-description").first();

      const rowTitle = page
        .getByTestId("recent-item")
        .first()
        .locator("span.line-clamp-2");

      const prompt = page.getByTestId("leave-prompt");
      const [stored] = CAPTURES;

      const release = () => page.evaluate("globalThis.__releaseSaves()");

      const fields = async () => ({
        description: await description.inputValue(),
        row: (await rowTitle.textContent()) ?? "",
        step: await step.inputValue(),
        title: await title.inputValue(),
        window: await windowDescription.inputValue(),
      });

      const saved = {
        description: stored?.description,
        row: stored?.relationship,
        step: stored?.todos[1]?.text,
        title: stored?.relationship,
        window: stored?.views[0]?.description,
      };

      const answers = () =>
        page.evaluate<string[]>(
          "globalThis.__calls.filter((call) => call.method === 'answerLeave').map((call) => call.args[0])"
        );

      const typeAll = async (mark: string) => {
        await title.fill(`${mark} title`);
        await description.fill(`${mark} description`);
        await step.fill(`${mark} step`);
        await windowDescription.fill(`${mark} window`);
        await title.focus();
      };

      const heldLate = async () => {
        const started = Date.now();

        await pushLeave(page, "close");
        await page.waitForTimeout(2500);
        assert.equal(await prompt.count(), 0, "it waits before it asks");
        await prompt
          .getByText("Saving didn’t finish in time.")
          .waitFor({ timeout: 3500 });
        // Bounded, with room for a loaded machine: main itself gives up waiting at 6 s.
        assert.ok(Date.now() - started < 6000, "it asks within the bound");
        assert.equal(
          await prompt.getByRole("heading").textContent(),
          "1 change couldn’t be saved"
        );
      };

      await typeAll("HUNG");
      await waitForCalls(page, "updateText", 1);
      await heldLate();
      assert.deepEqual(await answers(), ["waiting", "held"]);

      // Cancel answers at once, though the save still hangs, and keeps the words.
      await page.keyboard.press("Escape");
      await prompt.waitFor({ state: "detached", timeout: 500 });
      assert.deepEqual(await answers(), ["waiting", "held", "stay"]);
      assert.equal(await title.inputValue(), "HUNG title");

      // Discard answers at once too, and every field shows the saved words straight away.
      await heldLate();
      await prompt.getByRole("button", { name: "Discard and close" }).click();
      await prompt.waitFor({ state: "detached", timeout: 500 });
      assert.deepEqual(await answers(), [
        "waiting",
        "held",
        "stay",
        "waiting",
        "held",
        "go",
      ]);
      assert.deepEqual(await fields(), saved, "Discard shows the saved words");

      // Discard tells main to drop the save on its way. Nothing is written to put the saved words
      // back: the discarded save never lands, and its answer brings nothing back.
      const sent = await callCount(page, "updateText");

      await waitForCalls(page, "discard", 1);
      await release();
      await page.waitForTimeout(200);
      assert.deepEqual(
        {
          discards: await callsTo(page, "discard"),
          onDisk: await page.evaluate<string>(
            "globalThis.__screens.data.captures[0].relationship"
          ),
          saves: await callCount(page, "updateText"),
        },
        { discards: [uuid(1)], onDisk: stored?.relationship, saves: sent },
        "Discard writes nothing, and the discarded save never lands"
      );
      assert.deepEqual(
        await fields(),
        saved,
        "the late answer brings nothing back, in the row either"
      );

      // As it looks: words typed while the disk hangs, and a close that waited for them.
      await typeAll("Waiting for the disk:");
      await waitForCalls(page, "updateText", sent + 1);
      await heldLate();
    },
    data: { captures: CAPTURES, holdSaves: true },
    hash: `/captures/${uuid(1)}`,
    name: "library-leave-late",
    page: "library",
  },
  {
    /*
     * Discard changes on the page works while a Retry still hangs: the saved words show at once, the
     * error goes, and the discarded words landing late never come back, on the page or its row.
     */
    act: async (page) => {
      const title = page.getByTestId("record-relationship");

      const rowTitle = page
        .getByTestId("recent-item")
        .first()
        .locator("span.line-clamp-2");

      const failure = page.getByTestId("save-failure");
      const stored = CAPTURES[0]?.relationship;

      const release = () => page.evaluate("globalThis.__releaseSaves()");

      await title.fill("DISCARD ME");
      await failure.waitFor();
      await page.evaluate(
        "globalThis.__screens.data.failSaves = false; globalThis.__screens.data.holdSaves = true"
      );

      const sent = await callCount(page, "updateText");

      await failure.getByRole("button", { name: "Retry" }).click();
      await waitForCalls(page, "updateText", sent + 1);
      assert.deepEqual(
        [
          await failure.getByRole("button", { name: "Retry" }).isDisabled(),
          await failure
            .getByRole("button", { name: "Discard changes" })
            .isEnabled(),
        ],
        [true, true],
        "Retry waits for the save on its way; Discard changes doesn't"
      );

      await failure.getByRole("button", { name: "Discard changes" }).click();
      await failure.waitFor({ state: "detached", timeout: 500 });
      assert.deepEqual(
        [await title.inputValue(), await rowTitle.textContent()],
        [stored, stored],
        "Discard changes shows the saved words at once"
      );

      await waitForCalls(page, "discard", 1);
      await release();
      await page.waitForTimeout(200);
      assert.deepEqual(
        {
          discards: await callsTo(page, "discard"),
          onDisk: await page.evaluate<string>(
            "globalThis.__screens.data.captures[0].relationship"
          ),
          saves: await callCount(page, "updateText"),
        },
        { discards: [uuid(1)], onDisk: stored, saves: sent + 1 },
        "Discard writes nothing, and the discarded Retry never lands"
      );
      assert.deepEqual(
        [
          await title.inputValue(),
          await rowTitle.textContent(),
          await failure.count(),
        ],
        [stored, stored, 0],
        "they never show again"
      );
    },
    data: { captures: CAPTURES, failSaves: true },
    hash: `/captures/${uuid(1)}`,
    name: "library-discard-held",
    page: "library",
    platforms: ["macos"],
  },
  {
    /*
     * A copy of words that couldn't be saved is refused at once and says why, with Retry beside it:
     * from the row, the page and the window viewer. Retry saves them, and the next copy copies them.
     * A Retry whose save hangs says so after SETTLE_MS and offers Retry again.
     */
    act: async (page) => {
      const title = page.getByTestId("record-relationship");
      const rowA = page.getByTestId("recent-item").first();
      const failure = page.getByTestId("save-failure");
      const more = page.getByRole("button", { name: "More" });
      const header = page.getByTestId("capture-feedback");

      const pageRetry = page.getByRole("button", {
        exact: true,
        name: "Retry saving",
      });

      const refusal = page.getByTestId("row-copy-refused");
      const description = CAPTURES[0]?.description ?? "";

      const failSaves = (on: boolean) =>
        page.evaluate(`globalThis.__screens.data.failSaves = ${String(on)}`);

      const unsaved = async (words: string) => {
        await failSaves(true);
        await title.fill(words);
        await failure.waitFor();
        await seedClipboard(page);
      };

      /** How many saves and copies main has seen: a refused copy adds to neither. */
      const asked = async () => ({
        beginCopy: await callCount(page, "beginCopy"),
        saves: await callCount(page, "updateText"),
      });

      const refusedAtOnce = async (
        what: string,
        before: Awaited<ReturnType<typeof asked>>
      ) => {
        assert.deepEqual(
          { ...(await asked()), clipboard: await readClipboard(page) },
          { ...before, clipboard: SENTINEL },
          `${what}: refused at once, nothing sent again`
        );
      };

      // The page: ⌘C is refused with why, and Retry; Retry saves; ⌘C then copies.
      await unsaved("Ask Marco for CHF 260 more");

      const atPage = await asked();

      await more.focus();
      await page.keyboard.press("Meta+C");
      await header
        .filter({
          hasText:
            "Couldn’t save your changes, so nothing was copied. The disk is full.",
        })
        .waitFor();
      await pageRetry.waitFor();
      await refusedAtOnce("the page", atPage);
      await failSaves(false);
      await pageRetry.click();
      await header.filter({ hasText: "Saved. You can copy it now." }).waitFor();
      await waitForFocus(page, "#record-title");
      await more.focus();
      await page.keyboard.press("Meta+C");
      await until(
        page,
        `globalThis.__calls.filter((call) => call.method === "copyEntry").length === 1`,
        "the copy after Retry"
      );
      assert.equal(
        await readClipboard(page),
        `Ask Marco for CHF 260 more\n\n${description}`
      );

      // The window viewer: Copy image is refused, Retry saves, Copy image then copies.
      await unsaved("Ask Marco before Friday");
      await page
        .getByRole("link", { name: /^Open window 1,/u })
        .first()
        .click();
      await page.getByTestId("viewer-image").waitFor();
      await page.getByRole("button", { name: "Copy image" }).click();
      await page
        .getByTestId("viewer-feedback")
        .filter({
          hasText:
            "Couldn’t save your changes, so nothing was copied. The disk is full.",
        })
        .waitFor();
      await failSaves(false);
      await pageRetry.click();
      await page.getByText("Saved. You can copy it now.").waitFor();
      await page.getByRole("button", { name: "Copy image" }).click();
      await waitForCalls(page, "copyImage", 1);
      assert.equal(await readClipboard(page), `(image ${uuid(101)})`);
      await page.getByRole("button", { name: "Back" }).click();
      await title.waitFor();

      // A Retry whose save hangs: after SETTLE_MS it says so, and offers Retry again.
      await unsaved("Ask Marco on Monday");
      await more.focus();
      await page.keyboard.press("Meta+C");
      await pageRetry.waitFor();
      await page.evaluate(
        "globalThis.__screens.data.failSaves = false; globalThis.__screens.data.holdSaves = true"
      );
      await pageRetry.click();
      await header.filter({ hasText: "Saving…" }).waitFor();
      await header
        .filter({ hasText: "Still not saved. Saving didn’t finish in time." })
        .waitFor({ timeout: 4000 });
      await pageRetry.waitFor();
      await page.evaluate(
        "globalThis.__screens.data.holdSaves = false; globalThis.__releaseSaves()"
      );
      await pageRetry.waitFor({ state: "detached" });

      // The row: ⌘C is refused on a line of its own with Retry; Retry saves, and ⌘C copies.
      await unsaved("Rieder can deliver on the 21st");

      const atRow = await asked();

      await rowA.focus();
      await page.keyboard.press("Meta+C");
      await refusal
        .getByText(
          "Couldn’t save your changes, so nothing was copied. The disk is full."
        )
        .waitFor();
      await refusedAtOnce("the row", atRow);
      await failSaves(false);
      await refusal.getByRole("button", { name: /^Retry saving/u }).click();
      await rowA.getByText("Saved. You can copy it now.").waitFor();
      await refusal.waitFor({ state: "detached" });
      await page.keyboard.press("Meta+C");
      await waitForCalls(page, "copyEntry", 2);
      assert.equal(
        await readClipboard(page),
        `Rieder can deliver on the 21st\n\n${description}`
      );

      // As it looks: the row's refusal, with Retry under it.
      await unsaved("Rieder can deliver on the 22nd");
      await rowA.focus();
      await page.keyboard.press("Meta+C");
      await refusal
        .getByText(
          "Couldn’t save your changes, so nothing was copied. The disk is full."
        )
        .waitFor();
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-copy-retry",
    page: "library",
    platforms: ["macos"],
  },
  {
    /*
     * A Due that can't be saved is a failed draft like any other edit: it stays on the page and
     * the row with "Not saved", Retry and Discard changes; a copy is refused and offers Retry
     * saving. Once Retry saves it, the copy carries the new date.
     */
    act: async (page) => {
      const failure = page.getByTestId("save-failure");
      const header = page.getByTestId("capture-feedback");
      const rowA = page.getByTestId("recent-item").first();
      const chip = page.locator("main").getByTestId("due-chip");

      const failSaves = (on: boolean) =>
        page.evaluate(`globalThis.__screens.data.failSaves = ${String(on)}`);

      // The picker can still be moving into place under its chip, so the click doesn't wait for it to settle.
      const pick = async (name: RegExp) => {
        await sendCommand(page, "setDue");

        const option = page.getByRole("button", { name });

        await option.waitFor();
        await option.click({ force: true });
      };

      await pick(/^Tomorrow/u);
      await failure.getByText(/The disk is full/u).waitFor();

      const chipText = await chip.textContent();
      const rowText = await rowA.textContent();

      assert.deepEqual(
        {
          chip: chipText?.includes("Tomorrow"),
          row: await rowA.getByText("Not saved").count(),
          rowChip: rowText?.includes("Tomorrow"),
          stored: await page.evaluate<string | null>(
            "globalThis.__screens.data.captures[0].due"
          ),
        },
        {
          chip: true,
          row: 1,
          rowChip: true,
          stored: CAPTURES[0]?.due ?? null,
        },
        "the failed Due stays on the page and the row, marked Not saved"
      );

      await seedClipboard(page);
      await sendCommand(page, "copyNote");
      await header
        .getByText(
          "Couldn’t save your changes, so nothing was copied. The disk is full."
        )
        .waitFor();
      assert.equal(await readClipboard(page), SENTINEL, "nothing copied");
      await page.getByRole("button", { name: /^Retry saving/u }).waitFor();

      await failSaves(false);
      await failure.getByRole("button", { name: "Retry" }).click();
      await failure.waitFor({ state: "detached" });
      await sendCommand(page, "copyNote");
      await waitForCalls(page, "copyNote", 1);

      const saved = await page.evaluate<string | null>(
        "globalThis.__screens.data.captures[0].due"
      );

      const clip = await readClipboard(page);

      assert.ok(
        saved !== null && clip.includes(`Due: ${saved}`),
        "Retry saved the Due, and the copy carries it"
      );

      // As it looks: another Due that can't be saved, once the copy's note is gone.
      await header.waitFor({ state: "detached", timeout: 4000 });
      await failSaves(true);
      await pick(/^Next week/u);
      await failure.getByText(/The disk is full/u).waitFor();
    },
    data: { captures: CAPTURES, failSaves: true },
    hash: `/captures/${uuid(1)}`,
    name: "library-due-failed",
    page: "library",
    platforms: ["macos"],
  },
  {
    /*
     * A Discard main can't finish brings the changes back with why, Keep changes and Discard again.
     * Nothing is saved meanwhile, typing included, and copies are refused with Keep changes. Discard
     * again asks main again and never saves the discarded words; Keep changes saves them, and so
     * does Return, whichever of the two has focus.
     */
    act: async (page) => {
      const failure = page.getByTestId("save-failure");
      const header = page.getByTestId("capture-feedback");
      const title = page.getByTestId("record-relationship");

      const rowTitle = page
        .getByTestId("recent-item")
        .first()
        .locator("span.line-clamp-2");

      const discardAgain = failure.getByRole("button", {
        exact: true,
        name: "Discard again",
      });

      const stored = CAPTURES[0]?.relationship;

      await undiscard(page, "DISCARDED WORDS");

      const saves = await callCount(page, "updateText");

      await title.press("End");
      await title.pressSequentially(" TYPED");
      await page.waitForTimeout(900);

      await seedClipboard(page);
      await sendCommand(page, "copyNote");
      await header
        .getByText(
          "Couldn’t discard your changes, so nothing was copied. Inset can’t write to its data folder."
        )
        .waitFor();
      assert.equal(
        await header
          .locator("xpath=..")
          .getByRole("button", { exact: true, name: "Keep changes" })
          .count(),
        1,
        "the refused copy offers Keep changes"
      );

      const discards = await callCount(page, "discard");

      await discardAgain.click();
      await waitForCalls(page, "discard", discards + 1);
      await discardAgain.waitFor();

      assert.deepEqual(
        {
          buttons: await failure.getByRole("button").allTextContents(),
          clipboard: await readClipboard(page),
          copyRetry: await page
            .getByRole("button", { name: /^Retry (?:saving|copying)/u })
            .count(),
          saves: await callCount(page, "updateText"),
          says: await failure.getByRole("alert").textContent(),
          title: await title.inputValue(),
        },
        {
          buttons: ["Keep changes", "Discard again"],
          clipboard: SENTINEL,
          copyRetry: 0,
          saves,
          says: "Couldn’t discard your changes. Inset can’t write to its data folder.",
          title: "DISCARDED WORDS TYPED",
        },
        "the changes stay with why; typing, copies and a failed Discard again save nothing"
      );

      await setData(page, `{ failDiscards: false }`);
      await discardAgain.click();
      await failure.waitFor({ state: "detached" });
      assert.deepEqual(
        {
          row: await rowTitle.textContent(),
          saves: await callCount(page, "updateText"),
          title: await title.inputValue(),
        },
        { row: stored, saves, title: stored },
        "Discard again puts the saved words back, and never saves the discarded ones"
      );

      await undiscard(page, "KEPT WORDS");

      const beforeKeep = await callCount(page, "updateText");

      await failure.getByRole("button", { name: "Keep changes" }).click();
      await failure.waitFor({ state: "detached" });
      await waitForCalls(page, "updateText", beforeKeep + 1);
      assert.deepEqual(
        {
          onDisk: await page.evaluate<string>(
            "globalThis.__screens.data.captures[0].relationship"
          ),
          row: await rowTitle.textContent(),
          title: await title.inputValue(),
        },
        { onDisk: "KEPT WORDS", row: "KEPT WORDS", title: "KEPT WORDS" },
        "Keep changes saves the words on screen"
      );

      await undiscard(page, "RETURN WORDS");

      const beforeReturn = {
        discards: await callCount(page, "discard"),
        saves: await callCount(page, "updateText"),
      };

      await discardAgain.focus();
      await page.keyboard.press("Enter");
      await failure.waitFor({ state: "detached" });
      await waitForCalls(page, "updateText", beforeReturn.saves + 1);
      assert.deepEqual(
        {
          discards: await callCount(page, "discard"),
          onDisk: await page.evaluate<string>(
            "globalThis.__screens.data.captures[0].relationship"
          ),
          title: await title.inputValue(),
        },
        {
          discards: beforeReturn.discards,
          onDisk: "RETURN WORDS",
          title: "RETURN WORDS",
        },
        "Return on a focused Discard again keeps the changes, and never discards"
      );

      // As it looks: a Discard that couldn't finish, once the copy's note is gone.
      await undiscard(page, "Rieder’s quote needs a second look");
      await header.waitFor({ state: "detached", timeout: 7000 });
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-discard-failed",
    page: "library",
    platforms: ["macos"],
  },
  {
    /*
     * Closing or quitting after a Discard that couldn't finish asks the same: "1 change couldn’t be
     * discarded", with Keep changes, Discard again and Cancel. Return keeps, whichever button has
     * focus, and saves words typed since too. Discard again holds the close until main has put the
     * saved version back, and asks again while it can't.
     */
    act: async (page) => {
      const title = page.getByTestId("record-relationship");
      const prompt = page.getByTestId("leave-prompt");

      const button = (name: string) =>
        prompt.getByRole("button", { exact: true, name });

      const answers = () =>
        page.evaluate<string[]>(
          "globalThis.__calls.filter((call) => call.method === 'answerLeave').map((call) => call.args[0])"
        );

      const asking = async (reason: "close" | "quit") => {
        await pushLeave(page, reason);
        await prompt.waitFor();
        await until(
          page,
          "document.activeElement?.textContent === 'Keep changes'",
          `Keep changes has focus when the ${reason} is held`
        );
      };

      await undiscard(page, "DISCARDED WORDS");
      await title.fill("NEWER WORDS");
      await page.waitForTimeout(900);

      const before = {
        discards: await callCount(page, "discard"),
        saves: await callCount(page, "updateText"),
      };

      await asking("quit");
      assert.deepEqual(
        {
          buttons: await prompt.getByRole("button").allTextContents(),
          heading: await prompt.getByRole("heading").textContent(),
          ring:
            (await page.evaluate<string>(
              "getComputedStyle(document.activeElement).boxShadow"
            )) !== "none",
          saves: await callCount(page, "updateText"),
          says: await prompt
            .locator("[data-slot=alert-dialog-description]")
            .textContent(),
        },
        {
          buttons: ["Cancel", "Discard again", "Keep changes"],
          heading: "1 change couldn’t be discarded",
          ring: true,
          saves: before.saves,
          says: "Inset can’t write to its data folder.",
        },
        "the quit asks about the Discard that couldn’t finish, and nothing typed since was sent"
      );

      await button("Discard again").focus();
      await page.keyboard.press("Enter");
      await prompt.waitFor({ state: "detached" });
      await until(
        page,
        "globalThis.__calls.some((call) => call.method === 'answerLeave' && call.args[0] === 'go')",
        "Keep changes lets the app quit"
      );
      assert.deepEqual(
        {
          answers: await answers(),
          discards: await callCount(page, "discard"),
          onDisk: await page.evaluate<string>(
            "globalThis.__screens.data.captures[0].relationship"
          ),
          saves: await callCount(page, "updateText"),
          title: await title.inputValue(),
        },
        {
          answers: ["waiting", "held", "go"],
          discards: before.discards,
          onDisk: "NEWER WORDS",
          saves: before.saves + 1,
          title: "NEWER WORDS",
        },
        "Return on a focused Discard again keeps the words on screen, and never discards"
      );

      await undiscard(page, "GIVEN UP WORDS");
      await asking("close");

      const tried = await callCount(page, "discard");

      await button("Discard again").click();
      await waitForCalls(page, "discard", tried + 1);
      await until(
        page,
        "document.activeElement?.textContent === 'Keep changes'",
        "the prompt asks again once Discard again fails"
      );
      assert.deepEqual(
        await answers(),
        ["waiting", "held", "go", "waiting", "held"],
        "a Discard again that fails never lets the window close"
      );

      await setData(page, `{ failDiscards: false }`);
      await button("Discard again").click();
      await prompt.waitFor({ state: "detached" });
      await until(
        page,
        "globalThis.__calls.filter((call) => call.method === 'answerLeave' && call.args[0] === 'go').length === 2",
        "Discard again lets the window close once it works"
      );
      assert.equal(
        await title.inputValue(),
        "NEWER WORDS",
        "Discard again brings the saved words back"
      );

      // As it looks: the close held by a Discard that couldn't finish.
      await undiscard(page, "Rieder’s quote needs a second look");
      await asking("close");
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-leave-undiscarded",
    page: "library",
  },
  {
    /*
     * A Discard main hasn't answered within SETTLE_MS asks to Wait, leave anyway, or Cancel. Return
     * waits, whichever button has focus, and asks again if main is still silent; Escape cancels;
     * Space on Close anyway or Quit anyway leaves at once. The prompt goes by itself once main
     * answers.
     */
    act: async (page) => {
      const prompt = page.getByTestId("leave-prompt");

      const button = (name: string) =>
        prompt.getByRole("button", { exact: true, name });

      const asked = async (reason: "close" | "quit") => {
        await pushLeave(page, reason);
        await prompt.waitFor();
        await until(
          page,
          "document.activeElement?.textContent === 'Wait'",
          `Wait has focus when the ${reason} is held`
        );
      };

      const says = () =>
        prompt.locator("[data-slot=alert-dialog-description]").textContent();

      await stallDiscard(page, "STALLED WORDS");
      await asked("close");
      assert.deepEqual(
        {
          buttons: await prompt.getByRole("button").allTextContents(),
          heading: await prompt.getByRole("heading").textContent(),
          ring:
            (await page.evaluate<string>(
              "getComputedStyle(document.activeElement).boxShadow"
            )) !== "none",
          says: await says(),
        },
        {
          buttons: ["Cancel", "Close anyway", "Wait"],
          heading: "1 change isn’t discarded yet",
          ring: true,
          says: "Discarding didn’t finish in time. If you close now, Inset finishes discarding in the background.",
        },
        "a Discard main hasn’t answered asks to wait or close anyway, not to keep or discard again"
      );

      await button("Close anyway").focus();
      await page.keyboard.press("Enter");
      assert.equal(
        await button("Wait").isDisabled(),
        true,
        "Return on a focused Close anyway waits"
      );
      await until(
        page,
        "document.activeElement?.textContent === 'Wait'",
        "the prompt asks again while main is still silent",
        Date.now() + 6000
      );
      assert.deepEqual(
        await leaveAnswers(page),
        ["waiting", "held"],
        "waiting never lets the window close"
      );

      await page.keyboard.press("Escape");
      await prompt.waitFor({ state: "detached" });
      assert.deepEqual(
        await leaveAnswers(page),
        ["waiting", "held", "stay"],
        "Escape cancels"
      );

      await asked("quit");
      assert.deepEqual(
        {
          buttons: await prompt.getByRole("button").allTextContents(),
          says: await says(),
        },
        {
          buttons: ["Cancel", "Quit anyway", "Wait"],
          says: "Discarding didn’t finish in time. If you quit now, Inset finishes discarding the next time it starts.",
        },
        "the quit asks the same, with Quit anyway"
      );
      await button("Quit anyway").focus();
      await page.keyboard.press("Space");
      await prompt.waitFor({ state: "detached" });
      assert.deepEqual(
        await leaveAnswers(page),
        ["waiting", "held", "stay", "waiting", "held", "go"],
        "Space on Quit anyway leaves at once"
      );

      // Typed while main still hasn't answered: it waits, and the prompt says leaving anyway loses it.
      const sentBefore = await callCount(page, "updateText");

      await page.getByTestId("record-relationship").fill("TYPED MEANWHILE");
      await page.waitForTimeout(900);
      assert.equal(
        await callCount(page, "updateText"),
        sentBefore,
        "typing waits for main’s answer"
      );

      await asked("close");
      assert.equal(
        await says(),
        "Discarding didn’t finish in time. If you close now, Inset finishes discarding in the background, and what you typed since is lost.",
        "the prompt says what Close anyway loses"
      );
      await page.evaluate("globalThis.__releaseDiscards()");
      await prompt.waitFor({ state: "detached" });
      await until(
        page,
        "globalThis.__calls.filter((call) => call.method === 'answerLeave' && call.args[0] === 'go').length === 2",
        "the close goes ahead once main puts the saved version back"
      );
      await waitForCalls(page, "updateText", sentBefore + 1);
      assert.equal(
        await page.evaluate<string>(
          "globalThis.__screens.data.captures[0].relationship"
        ),
        "TYPED MEANWHILE",
        "what was typed meanwhile is saved once the Discard works"
      );

      // As it looks: a close held by a Discard main hasn't answered.
      await stallDiscard(page, "Rieder’s quote needs a second look");
      await asked("close");
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-leave-stalled",
    page: "library",
  },
  {
    /*
     * Recent Captures opens while main still owes a Discard that a closed window couldn't finish.
     * The capture opens as not discarded, with the banner and the row's Not saved, and main hears
     * 1 unsaved before anything else. Copies are refused with Keep changes, which keeps the words;
     * typing sends nothing; Discard again puts the saved words back.
     */
    act: async (page) => {
      const failure = page.getByTestId("save-failure");
      const header = page.getByTestId("capture-feedback");
      const title = page.getByTestId("record-relationship");
      const row = page.getByTestId("recent-item").first();

      const refused =
        "Couldn’t discard your changes, so nothing was copied. Inset can’t write to its data folder.";

      const opened = async () => {
        await failure.getByRole("button", { name: "Discard again" }).waitFor();

        return {
          banner: await failure.getByRole("alert").textContent(),
          reports: await callsTo(page, "reportUnsaved"),
          row: await row.getByTestId("row-unsaved").textContent(),
          title: await title.inputValue(),
        };
      };

      assert.deepEqual(
        await opened(),
        {
          banner:
            "Couldn’t discard your changes. Inset can’t write to its data folder.",
          reports: [1, 1],
          row: "Not saved",
          title: OWED_CAPTURE.relationship,
        },
        "the capture opens as not discarded, and main hears 1 unsaved first"
      );

      await seedClipboard(page);
      await sendCommand(page, "copyNote");
      await header.getByText(refused).waitFor();
      await title.fill(`${OWED_CAPTURE.relationship} TYPED`);
      await page.waitForTimeout(900);
      assert.deepEqual(
        {
          clipboard: await readClipboard(page),
          keep: await page
            .getByRole("button", { exact: true, name: "Keep changes" })
            .count(),
          saves: await callCount(page, "updateText"),
        },
        { clipboard: SENTINEL, keep: 2, saves: 0 },
        "the copy is refused with Keep changes, and typing sends nothing"
      );

      await page
        .getByTestId("capture-feedback")
        .locator("xpath=..")
        .getByRole("button", { exact: true, name: "Keep changes" })
        .click();
      await failure.waitFor({ state: "detached" });
      await waitForCalls(page, "updateText", 1);
      await header.getByText("Saved. You can copy it now.").waitFor();
      await sendCommand(page, "copyNote");
      await header.filter({ hasText: "Copied" }).waitFor();
      const copied = await readClipboard(page);

      assert.equal(
        copied.split("\n")[0],
        `${OWED_CAPTURE.relationship} TYPED`,
        "Keep changes saves the words on screen, and the copy gets them"
      );

      await page.reload();
      await opened();

      const discards = await callCount(page, "discard");

      await failure.getByRole("button", { name: "Discard again" }).click();
      await failure.waitFor({ state: "detached" });
      await waitForCalls(page, "discard", discards + 1);

      const discarded = await page.evaluate<unknown[][]>(
        "globalThis.__calls.filter((call) => call.method === 'discard').map((call) => call.args)"
      );

      assert.deepEqual(
        {
          discarded: discarded.at(-1),
          saves: await callCount(page, "updateText"),
          title: await title.inputValue(),
        },
        {
          discarded: [FIRST.id, OWED.rev],
          saves: 0,
          title: FIRST.relationship,
        },
        "Discard again names the save main holds, and puts the saved words back"
      );

      // As it looks: the capture main still owes a Discard for, and a copy refused with Keep changes.
      await page.reload();
      await opened();
      await sendCommand(page, "copyNote");
      await header.getByText(refused).waitFor();
    },
    data: { captures: [OWED_CAPTURE, ...REST], owed: [OWED] },
    hash: `/captures/${uuid(1)}`,
    name: "library-owed-discard",
    page: "library",
    platforms: ["macos"],
  },
  {
    /*
     * Recent Captures opens while main can't say which Discards it still owes. The page shows no
     * capture and reports no count, so nothing can be copied or edited over the words a Discard
     * puts back; it asks again until main answers, then opens the capture as not discarded.
     */
    act: async (page) => {
      const unread = page.getByTestId("owed-unread");
      const failure = page.getByTestId("save-failure");

      await unread.waitFor();
      await seedClipboard(page);
      await sendCommand(page, "copyNote");
      assert.deepEqual(
        {
          asked: (await callCount(page, "owedDiscards")) > 0,
          clipboard: await readClipboard(page),
          reports: await callsTo(page, "reportUnsaved"),
          rows: await page.getByTestId("recent-item").count(),
          says: [
            await unread.getByRole("heading").textContent(),
            await unread.getByRole("status").textContent(),
          ],
        },
        {
          asked: true,
          clipboard: SENTINEL,
          reports: [],
          rows: 0,
          says: [
            "Recent Captures can’t open yet",
            "Inset couldn’t check which changes it still has to discard. Trying again…",
          ],
        },
        "while main can’t say, no capture shows, nothing is copied and no count is reported"
      );

      await setData(page, "{ owedUnread: false }");
      await failure.getByRole("button", { name: "Discard again" }).waitFor();
      assert.deepEqual(
        {
          banner: await failure.getByRole("alert").textContent(),
          clipboard: await readClipboard(page),
          reports: await callsTo(page, "reportUnsaved"),
          title: await page.getByTestId("record-relationship").inputValue(),
          unread: await unread.count(),
        },
        {
          banner:
            "Couldn’t discard your changes. Inset can’t write to its data folder.",
          clipboard: SENTINEL,
          reports: [1, 1],
          title: OWED_CAPTURE.relationship,
          unread: 0,
        },
        "once main answers, the capture opens as not discarded, and main hears 1 unsaved first"
      );

      // As it looks: the page while main can't say. A reload starts again from the scene's data.
      await page.reload();
      await unread.waitFor();
    },
    data: {
      captures: [OWED_CAPTURE, ...REST],
      owed: [OWED],
      owedUnread: true,
    },
    hash: `/captures/${uuid(1)}`,
    name: "library-owed-unread",
    page: "library",
  },
  {
    /*
     * Main refuses a copy when the capture as it began is not on disk: a due date that couldn't be
     * written, or a write that didn't land within SETTLE_MS. The page, the row and the viewer say
     * why and copy nothing, and their Retry copies again.
     */
    act: async (page) => {
      const header = page.getByTestId("capture-feedback");
      const rowA = page.getByTestId("recent-item").first();
      const refusal = page.getByTestId("row-copy-refused");
      const title = CAPTURES[0]?.relationship ?? "";
      const description = CAPTURES[0]?.description ?? "";

      const refuseNext = async (why: string) => {
        await seedClipboard(page);
        await page.evaluate(
          `globalThis.__screens.data.copyNotSaved = [${JSON.stringify(why)}]`
        );
      };

      // The page: Copy as text is refused, Retry copies.
      await refuseNext("Saving didn’t finish in time.");
      await sendCommand(page, "copyNote");
      await header
        .filter({
          hasText:
            "Couldn’t save your changes, so nothing was copied. Saving didn’t finish in time.",
        })
        .waitFor();
      assert.equal(
        await readClipboard(page),
        SENTINEL,
        "the page copied nothing"
      );
      await page
        .getByRole("button", { exact: true, name: "Retry copying" })
        .click();
      await waitForCalls(page, "copyNote", 1);
      await header.filter({ hasText: "Copied" }).waitFor();

      // The row: ⌘C is refused on a line of its own; Retry copies.
      await refuseNext("The disk is full.");
      await rowA.focus();
      await page.keyboard.press("Meta+C");
      await refusal
        .getByText(
          "Couldn’t save your changes, so nothing was copied. The disk is full."
        )
        .waitFor();
      assert.equal(
        await readClipboard(page),
        SENTINEL,
        "the row copied nothing"
      );
      await refusal
        .getByRole("button", { name: `Retry copying “${title}”` })
        .click();
      await waitForCalls(page, "copyEntry", 1);
      assert.equal(await readClipboard(page), `${title}\n\n${description}`);

      // The window viewer: Copy image is refused; Retry copies.
      await refuseNext("The disk is full.");
      await page
        .getByRole("link", { name: /^Open window 1,/u })
        .first()
        .click();
      await page.getByTestId("viewer-image").waitFor();
      await page.getByRole("button", { name: "Copy image" }).click();
      await page
        .getByTestId("viewer-feedback")
        .filter({
          hasText:
            "Couldn’t save your changes, so nothing was copied. The disk is full.",
        })
        .waitFor();
      assert.equal(
        await readClipboard(page),
        SENTINEL,
        "the viewer copied nothing"
      );
      await page
        .getByRole("button", { exact: true, name: "Retry copying" })
        .click();
      await waitForCalls(page, "copyImage", 1);
      assert.equal(await readClipboard(page), `(image ${uuid(101)})`);
      await page.getByRole("button", { name: "Back" }).click();

      // As it looks: the page's refusal, with Retry beside it.
      await refuseNext("The disk is full.");
      await sendCommand(page, "copyNote");
      await header
        .filter({
          hasText:
            "Couldn’t save your changes, so nothing was copied. The disk is full.",
        })
        .waitFor();
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-copy-not-saved",
    page: "library",
    platforms: ["macos"],
  },
  {
    // With each save held on its way to disk, a copy waits for it and copies the words from when it started.
    act: async (page) => {
      const title = page.getByTestId("record-relationship");
      const rows = page.getByTestId("recent-item");
      const menu = page.getByRole("menu");
      const more = page.getByRole("button", { name: "More" });
      const release = () => page.evaluate("globalThis.__releaseSaves()");
      const description = CAPTURES[0]?.description ?? "";

      // A second edit typed during the wait is not copied: the copy took the words before it.
      await title.fill("FIRST");
      await more.focus();
      await waitForCalls(page, "updateText", 1);
      await seedClipboard(page);
      await page.keyboard.press("Meta+C");
      await title.fill("FIRST AND SECOND");
      await more.focus();
      await page.waitForTimeout(200);
      assert.equal(
        await callCount(page, "copyEntry"),
        0,
        "the copy waits for the save"
      );
      await release();
      await waitForCalls(page, "copyEntry", 1);
      assert.equal(await readClipboard(page), `FIRST\n\n${description}`);
      assert.equal(await title.inputValue(), "FIRST AND SECOND");
      await waitForCalls(page, "updateText", 2);
      await release();

      // Leaving A while its save is on its way: A's row waits for that save, then copies A's words.
      await title.fill("TYPED IN A");
      await rows.nth(1).click();
      await waitForCalls(page, "updateText", 3);
      await seedClipboard(page);
      await rows.nth(0).click({ button: "right" });
      await menu.waitFor();
      await menu.getByRole("menuitem", { name: COPY_ITEM }).click();
      await page.waitForTimeout(200);
      assert.equal(
        await callCount(page, "copyEntry"),
        1,
        "A's copy waits for A's save"
      );
      await release();
      await waitForCalls(page, "copyEntry", 2);
      assert.equal(await readClipboard(page), `TYPED IN A\n\n${description}`);
      assert.deepEqual(await callsTo(page, "copyEntry"), [uuid(1), uuid(1)]);
    },
    data: { captures: CAPTURES, holdSaves: true },
    hash: `/captures/${uuid(1)}`,
    name: "library-copy-held",
    page: "library",
    platforms: ["macos"],
  },
  {
    // The page tells main when its first menu opens and its last one closes, however it closes.
    act: async (page) => {
      const rows = page.getByTestId("recent-item");
      const menu = page.getByRole("menu");

      const said = () =>
        page.evaluate<boolean[]>(
          "globalThis.__calls.filter((call) => call.method === 'menuOpen').map((call) => call.args[0])"
        );

      await rows.nth(1).click({ button: "right" });
      await menu.waitFor();
      assert.deepEqual(await said(), [true], "a row menu opening");
      // Main forgets the menu when the window loses focus; the page says it again when focus is back.
      await page.evaluate("window.dispatchEvent(new Event('focus'))");
      assert.deepEqual(
        await said(),
        [true, true],
        "focus back with the menu open"
      );
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });
      assert.deepEqual(await said(), [true, true, false], "Esc");

      await page.getByRole("button", { name: "More" }).click();
      await menu.waitFor();
      await menu.getByRole("menuitem", { name: COPY_ITEM }).click();
      await menu.waitFor({ state: "detached" });

      await page.getByRole("button", { name: "Filter by Due" }).click();
      await menu.waitFor();
      await page.keyboard.press("Escape");
      await menu.waitFor({ state: "detached" });

      // An item that takes the row out of the list closes the menu with it.
      await rows.nth(1).click({ button: "right" });
      await menu.waitFor();
      await menu.getByRole("menuitem", { name: "Mark as done" }).click();
      await until(
        page,
        "globalThis.__screens.data.captures[1].status.kind === 'done'",
        "the row marked done"
      );
      await menu.waitFor({ state: "detached" });
      await page.evaluate("window.dispatchEvent(new Event('focus'))");
      assert.deepEqual(
        await said(),
        [true, true, false, true, false, true, false, true, false],
        "each menu opens and closes once, and focus without a menu says nothing"
      );
    },
    data: { captures: CAPTURES },
    hash: `/captures/${uuid(1)}`,
    name: "library-menu-open",
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

  {
    // The icon dropdown holds main's keys while it is open, as Recent Captures' menus do. Windows has no such choice.
    act: async (page) => {
      const select = page.getByRole("combobox");

      if ((await select.count()) === 0) {
        return;
      }

      await select.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("listbox").waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("listbox").waitFor({ state: "detached" });
      assert.deepEqual(
        await page.evaluate<boolean[]>(
          "globalThis.__calls.filter((call) => call.method === 'menuOpen').map((call) => call.args[0])"
        ),
        [true, false],
        "the dropdown opening and closing"
      );
      // The closed list hands focus back to its button; the screenshot shows the window at rest.
      await until(
        page,
        "document.activeElement?.getAttribute('role') === 'combobox'",
        "focus back on the dropdown"
      );
      await select.blur();
    },
    data: { view: SETTINGS_VIEW },
    name: "settings",
    page: "settings",
  },
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
