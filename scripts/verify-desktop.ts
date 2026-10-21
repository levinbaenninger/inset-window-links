import { execFileSync } from "node:child_process";
import { on, once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { activeWindow } from "get-windows";
import type { ElectronApplication, Page } from "playwright";
import { _electron } from "playwright";

import type { DraftSnapshot } from "../src/shared/dto.ts";

interface InsetE2E {
  pressShortcut: () => void;
  showDraft: () => void;
  openRecent: () => void;
  quit: () => void;
  snapshot: () => DraftSnapshot;
  diagnostics: () => {
    screenAccess: string;
    probe: string;
    probeMs: number;
    sourcesMs: number;
  } | null;
}

declare global {
  var __insetE2E: InsetE2E;
}

interface Check {
  name: string;
  status: "pass" | "fail" | "blocked";
  observed: string;
}

interface WindowInfo {
  url: string;
  visible: boolean;
  focused: boolean;
  bounds: { x: number; y: number; width: number; height: number };
  displayId: number;
}

interface SavedRecord {
  relationship: string;
  views: readonly { title: string | null; width: number; height: number }[];
}

const ROOT = path.resolve(import.meta.dirname, "..");
const MODE = process.argv.includes("--packaged") ? "packaged" : "dev";

const PACKAGED_EXE = path.join(
  ROOT,
  "release/mac-arm64/Inset Window Links.app/Contents/MacOS/Inset Window Links"
);

const RELATIONSHIP =
  "The deadline in doc A decides which option in doc B is still possible.";

const checks: Check[] = [];
const createdDocs: string[] = [];
const observations = new Map<string, string>();

const json = <T>(value: T): string => JSON.stringify(value) ?? "undefined";

const record = (name: string, pass: boolean, observed: string) => {
  checks.push({ name, observed, status: pass ? "pass" : "fail" });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}: ${observed}`);
};

const block = (name: string, observed: string) => {
  checks.push({ name, observed, status: "blocked" });
  console.log(`BLOCKED ${name}: ${observed}`);
};

const osascript = (...lines: readonly string[]) =>
  execFileSync(
    "osascript",
    lines.flatMap((line) => ["-e", line]),
    { encoding: "utf-8" }
  ).trim();

const newTextEditDocument = (body: string) => {
  const name = osascript(
    `tell application "TextEdit" to get name of (make new document with properties {text:"${body}"})`
  );

  createdDocs.push(name);

  return name;
};

const bringToFront = async (docName: string) => {
  osascript(
    `tell application "TextEdit" to set index of window "${docName}" to 1`,
    'tell application "TextEdit" to activate'
  );
  await sleep(900);

  return osascript('tell application "TextEdit" to get name of window 1');
};

const foreground = async () => {
  const win = await activeWindow({
    accessibilityPermission: false,
    screenRecordingPermission: true,
  });

  return win === undefined
    ? null
    : {
        app: win.owner.name,
        bounds: win.bounds,
        id: win.id,
        pid: win.owner.processId,
        title: win.title,
      };
};

const waitFor = async <T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  deadline = Date.now() + 6000
): Promise<T> => {
  const value = await read();

  if (done(value) || Date.now() >= deadline) {
    return value;
  }

  await sleep(100);

  return waitFor(read, done, deadline);
};

const environment = (extra: ReadonlyMap<string, string>) => {
  const env = new Map<string, string>();

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env.set(key, value);
    }
  }

  env.set("INSET_E2E", "1");

  return Object.fromEntries([...env, ...extra]);
};

const launch = (userData: string, failWrites = false) =>
  _electron.launch({
    ...(MODE === "packaged"
      ? { args: [], executablePath: PACKAGED_EXE }
      : { args: ["."], cwd: ROOT }),
    env: environment(
      new Map([
        ["INSET_E2E_USER_DATA", userData],
        ["INSET_E2E_FAIL_WRITE", failWrites ? "1" : "0"],
      ])
    ),
  });

const windows = (app: ElectronApplication): Promise<WindowInfo[]> =>
  app.evaluate(({ BrowserWindow, screen }) =>
    BrowserWindow.getAllWindows().map((win) => ({
      bounds: win.getBounds(),
      displayId: screen.getDisplayMatching(win.getBounds()).id,
      focused: win.isFocused(),
      url: win.webContents.getURL(),
      visible: win.isVisible(),
    }))
  );

const popoverWindow = async (app: ElectronApplication) => {
  const all = await windows(app);

  return all.find((win) => win.url.includes("popover.html")) ?? null;
};

const popoverVisible = (app: ElectronApplication, visible: boolean) =>
  waitFor(
    () => popoverWindow(app),
    (win) => win?.visible === visible
  );

const snapshot = (app: ElectronApplication) =>
  app.evaluate(() => globalThis.__insetE2E.snapshot());

const press = (app: ElectronApplication) =>
  app.evaluate(() => globalThis.__insetE2E.pressShortcut());

const showDraft = async (app: ElectronApplication) => {
  await app.evaluate(() => globalThis.__insetE2E.showDraft());

  return popoverVisible(app, true);
};

/** The seam is installed at the end of startup, after the popover page has loaded. */
const popoverPage = async (app: ElectronApplication): Promise<Page> => {
  await waitFor(
    () => app.evaluate(() => "__insetE2E" in globalThis),
    (ready) => ready,
    Date.now() + 15_000
  );

  const page =
    app
      .windows()
      .find((candidate) => candidate.url().includes("popover.html")) ??
    (await app.firstWindow());

  await page.waitForLoadState("load");

  return page;
};

const pressAndWaitForViews = async (
  app: ElectronApplication,
  count: number
) => {
  const started = Date.now();

  await press(app);

  const snap = await waitFor(
    () => snapshot(app),
    (value) =>
      value.views.length === count ||
      value.notice !== null ||
      value.activity.kind === "choosing"
  );

  return { ms: Date.now() - started, snap };
};

const pngSize = (bytes: Uint8Array) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  return `${view.getUint32(16)}x${view.getUint32(20)}`;
};

const recordDirs = async (userData: string) => {
  const root = path.join(userData, "captures");
  const names = await readdir(root);

  return names
    .filter((name) => !name.startsWith("."))
    .map((name) => path.join(root, name));
};

const checkPopoverPlacement = async (
  app: ElectronApplication,
  source: Awaited<ReturnType<typeof foreground>>
) => {
  const popover = await popoverWindow(app);

  const sourceDisplay =
    source === null
      ? null
      : await app.evaluate(
          ({ screen }, bounds) => screen.getDisplayMatching(bounds).id,
          source.bounds
        );

  const size = popover?.bounds;

  record(
    "popover is visible after the press",
    popover?.visible === true,
    json(popover)
  );
  record(
    "popover width is within 340-420 and height is below 600",
    size !== undefined &&
      size.width >= 340 &&
      size.width <= 420 &&
      size.height < 600,
    json(size)
  );
  record(
    "popover is on the display that contains TextEdit",
    popover?.displayId === sourceDisplay,
    json({ popover: popover?.displayId, source: sourceDisplay })
  );
};

const checkFirstView = async (
  page: Page,
  docA: string,
  snap: DraftSnapshot
) => {
  const source = await foreground();
  const [view] = snap.views;
  const chips = await page.getByTestId("source-chip-title").allTextContents();

  const image =
    view === undefined ? null : { height: view.height, width: view.width };

  record(
    "one chip titled with the front TextEdit document",
    chips.length === 1 && chips[0] === docA,
    json(chips)
  );
  record(
    "view was captured directly, not from the fallback list",
    view?.source.kind === "direct",
    json(view?.source)
  );
  record(
    "sampledAt precedes capturedAt",
    view !== undefined && view.sampledAt <= view.capturedAt,
    json({ capturedAt: view?.capturedAt, sampledAt: view?.sampledAt })
  );

  return { image, source };
};

const checkFocusAndCopy = async (app: ElectronApplication, page: Page) => {
  const active = await foreground();
  const { pid } = app.process();
  const focusedId = (await page.locator(":focus").getAttribute("id")) ?? "";
  const label = await page.locator('label[for="relationship"]').textContent();
  const hint = (await page.getByTestId("hint").textContent()) ?? "";

  record(
    "Inset is the OS-active app after the press",
    active?.pid === pid,
    json({ active, insetPid: pid })
  );
  record(
    "relationship input has focus",
    focusedId === "relationship",
    focusedId
  );
  record(
    "label and hint copy",
    label === "What connects these views?" &&
      hint.startsWith("Switch windows and press the shortcut to add a view."),
    json({ hint, label })
  );
};

const firstCapture = async (
  app: ElectronApplication,
  page: Page,
  docA: string
) => {
  const front = await bringToFront(docA);
  const source = await foreground();

  record(
    "TextEdit document A is frontmost before the press",
    front === docA,
    json({ front, source })
  );

  const { ms, snap } = await pressAndWaitForViews(app, 1);

  const diagnostics = await app.evaluate(() =>
    globalThis.__insetE2E.diagnostics()
  );

  observations.set("firstCaptureMs", json(ms));
  observations.set("firstCaptureDiagnostics", json(diagnostics));

  if (
    snap.notice?.kind === "permissionDenied" ||
    snap.activity.kind === "choosing"
  ) {
    block(
      "direct capture of TextEdit document A",
      json({ activity: snap.activity, diagnostics, notice: snap.notice })
    );

    return false;
  }

  await checkPopoverPlacement(app, source);

  const { image } = await checkFirstView(page, docA, snap);

  record(
    "captured image is at least the window's DIP size",
    image !== null &&
      source !== null &&
      image.width >= source.bounds.width &&
      image.height >= source.bounds.height,
    json({ image, windowDip: source?.bounds })
  );
  await checkFocusAndCopy(app, page);

  return true;
};

const secondCapture = async (
  app: ElectronApplication,
  page: Page,
  docB: string
) => {
  await page
    .locator("#relationship")
    .pressSequentially(RELATIONSHIP, { delay: 5 });

  const typed = await waitFor(
    () => snapshot(app),
    (value) => value.text.relationship === RELATIONSHIP
  );

  record(
    "typed relationship is mirrored in main",
    typed.text.relationship === RELATIONSHIP,
    typed.text.relationship
  );

  const front = await bringToFront(docB);
  const hidden = await popoverVisible(app, false);
  const focus = await foreground();

  observations.set("focusAfterClickingIntoWork", json(focus));
  record(
    "activating TextEdit document B hides the popover",
    hidden?.visible === false && front === docB,
    json({ front, visible: hidden?.visible })
  );
  record(
    "focus is with TextEdit after the popover hides on blur",
    focus?.app === "TextEdit",
    json(focus)
  );

  const { ms, snap } = await pressAndWaitForViews(app, 2);
  const chips = await page.getByTestId("source-chip-title").allTextContents();
  const value = await page.locator("#relationship").inputValue();
  const ids = snap.views.map((view) => view.id);

  observations.set("secondCaptureMs", json(ms));
  record(
    "two chips with distinct view ids after the second press",
    chips.length === 2 && new Set(ids).size === 2,
    json({ chips, ids })
  );
  record(
    "relationship text survives the switch",
    value === RELATIONSHIP && snap.text.relationship === RELATIONSHIP,
    value
  );
  record("second chip is TextEdit document B", chips[1] === docB, json(chips));
};

const selfPress = async (app: ElectronApplication, page: Page) => {
  const before = await popoverWindow(app);

  await press(app);
  await sleep(1000);

  const snap = await snapshot(app);
  const after = await popoverWindow(app);
  const focus = await foreground();

  observations.set("focusAfterSelfPressHide", json(focus));
  record(
    "pressing while the popover is focused adds nothing",
    before?.focused === true && snap.views.length === 2,
    json({ focusedBefore: before?.focused, views: snap.views.length })
  );
  record(
    "pressing while the popover is focused hides it",
    after?.visible === false,
    json({ visible: after?.visible })
  );

  const shown = await showDraft(app);
  const chips = await page.getByTestId("source-chip").count();

  record(
    "Show Draft reopens the same draft without capturing",
    shown?.visible === true && chips === 2,
    json({ chips, visible: shown?.visible })
  );
};

const readSaved = async (dir: string | undefined) => {
  if (dir === undefined) {
    return { files: [], saved: null, sizes: [] };
  }

  const files = await readdir(path.join(dir, "views"));

  const saved: SavedRecord = JSON.parse(
    await readFile(path.join(dir, "record.json"), "utf-8")
  );

  const sizes = await Promise.all(
    files.map(async (file) =>
      pngSize(await readFile(path.join(dir, "views", file)))
    )
  );

  return { files, saved, sizes };
};

const saveAndVerify = async (
  app: ElectronApplication,
  page: Page,
  userData: string,
  docs: readonly string[]
) => {
  await page.locator("#relationship").focus();
  await page.keyboard.press("Meta+Enter");

  const hidden = await popoverVisible(app, false);
  const all = await windows(app);
  const focus = await foreground();
  const dirs = await recordDirs(userData);
  const { files, saved, sizes } = await readSaved(dirs[0]);
  const titles = saved?.views.map((view) => view.title) ?? [];

  const expectedSizes =
    saved?.views.map((view) => `${view.width}x${view.height}`) ?? [];

  observations.set("focusAfterSave", json(focus));
  record(
    "Cmd+Enter saves and hides the popover",
    hidden?.visible === false,
    json({ visible: hidden?.visible })
  );
  record(
    "no window is visible after save",
    all.every((win) => !win.visible),
    json(all.map((win) => [path.basename(win.url), win.visible]))
  );
  record(
    "focus returns to TextEdit after save",
    focus?.app === "TextEdit",
    json(focus)
  );
  record(
    "exactly one record directory with metadata and two PNGs",
    dirs.length === 1 && files.length === 2 && saved !== null,
    json({ dirs: dirs.length, files })
  );
  record(
    "saved metadata has the relationship and both titles",
    saved?.relationship === RELATIONSHIP && json(titles) === json(docs),
    json({ relationship: saved?.relationship, titles })
  );
  record(
    "saved PNG sizes match the metadata",
    json(sizes.toSorted()) === json(expectedSizes.toSorted()),
    json({ expectedSizes, sizes })
  );
};

const openLibrary = async (app: ElectronApplication) => {
  await app.evaluate(() => globalThis.__insetE2E.openRecent());

  return waitFor(
    () =>
      Promise.resolve(
        app
          .windows()
          .find((candidate) => candidate.url().includes("library.html")) ?? null
      ),
    (page) => page !== null
  );
};

const checkImageViewer = async (library: Page) => {
  await library.getByRole("link", { name: /^Open source 1/u }).click();

  const natural = await waitFor(
    async () =>
      String(
        await library.evaluate(
          "(() => { const img = document.querySelector('main img'); return img && img.complete ? img.naturalWidth + 'x' + img.naturalHeight : ''; })()"
        )
      ),
    (value) => value !== ""
  );

  record(
    "readable image view shows the full-resolution PNG",
    /^[1-9]\d*x[1-9]\d*$/u.test(natural),
    natural
  );
  await library.getByRole("link", { name: "Back to capture" }).click();
  await library.getByTestId("record-relationship").waitFor();
};

const reopenAndRead = async (
  app: ElectronApplication,
  docs: readonly string[]
) => {
  const library = await openLibrary(app);

  if (library === null) {
    record("Recent Captures opens after restart", false, "no library window");

    return;
  }

  await library.getByTestId("recent-item").first().click();
  await library.getByTestId("record-relationship").waitFor();

  const relationship = await library
    .getByTestId("record-relationship")
    .textContent();

  const titles = await library
    .getByTestId("record-source-title")
    .allTextContents();

  const route = library.url().split("#")[1] ?? "";

  record(
    "after restart the record shows the relationship",
    relationship === RELATIONSHIP,
    relationship ?? "none"
  );
  record(
    "after restart the record shows both source titles",
    docs.every((doc, index) => titles[index] === `${index + 1}. ${doc}`),
    json(titles)
  );
  record(
    "record URL carries only the capture id",
    /^\/captures\/[0-9a-f-]{36}$/u.test(route),
    route
  );
  await checkImageViewer(library);
  await library.getByRole("button", { name: "Copy note" }).click();

  const clipboard = await waitFor(
    () => app.evaluate(({ clipboard: board }) => board.readText()),
    (text) => text.startsWith(RELATIONSHIP)
  );

  record(
    "Copy note puts the thought first on the clipboard",
    clipboard.startsWith(RELATIONSHIP),
    clipboard.split("\n").join(" | ")
  );
  await library.close();
};

const escapeAndRestore = async (
  app: ElectronApplication,
  page: Page,
  docA: string
) => {
  await bringToFront(docA);
  await pressAndWaitForViews(app, 1);
  await page
    .locator("#relationship")
    .pressSequentially("Temporary thought", { delay: 5 });
  await page.keyboard.press("Escape");

  const hidden = await popoverVisible(app, false);
  const focus = await foreground();

  observations.set("focusAfterEscape", json(focus));
  record(
    "Escape hides the popover",
    hidden?.visible === false,
    json({ visible: hidden?.visible })
  );
  record(
    "focus returns to TextEdit after Escape",
    focus?.app === "TextEdit",
    json(focus)
  );
  await showDraft(app);

  const restored = await page.locator("#relationship").inputValue();
  const chips = await page.getByTestId("source-chip").count();

  record(
    "Show Draft restores text and views after Escape",
    restored === "Temporary thought" && chips === 1,
    json({ chips, restored })
  );
};

const discardDraft = async (app: ElectronApplication, page: Page) => {
  await page.getByRole("button", { name: "Discard" }).click();

  const discarded = await popoverVisible(app, false);

  observations.set("focusAfterDiscard", json(await foreground()));
  await showDraft(app);

  const cleared = await page.locator("#relationship").inputValue();
  const remaining = await page.getByTestId("source-chip").count();

  record(
    "Discard hides and clears the draft",
    discarded?.visible === false && cleared === "" && remaining === 0,
    json({ chips: remaining, text: cleared })
  );
  await page.keyboard.press("Escape");
};

/** Resolves only if quit returns. A native quit dialog runs a modal loop, so this stays pending while it is open. */
const requestQuit = async (app: ElectronApplication) => {
  try {
    await app.evaluate(() => globalThis.__insetE2E.quit());

    return "returned";
  } catch {
    return "app closed";
  }
};

const failedWrite = async (
  app: ElectronApplication,
  page: Page,
  userData: string,
  docA: string
) => {
  await bringToFront(docA);
  await pressAndWaitForViews(app, 1);
  await page
    .locator("#relationship")
    .pressSequentially("This save will fail", { delay: 5 });
  await page.keyboard.press("Meta+Enter");
  await page.getByTestId("save-failed").waitFor({ timeout: 6000 });

  const popover = await popoverWindow(app);
  const snap = await snapshot(app);
  const retry = await page.getByRole("button", { name: "Retry" }).count();
  const dirs = await recordDirs(userData);

  record(
    "a failed write shows Retry and keeps the popover open",
    retry === 1 && popover?.visible === true,
    json({ retry, visible: popover?.visible })
  );
  record(
    "a failed write keeps the draft",
    snap.views.length === 1 && snap.text.relationship === "This save will fail",
    json({ text: snap.text.relationship, views: snap.views.length })
  );
  record(
    "a failed write publishes no partial record",
    dirs.length === 1,
    json({ recordDirs: dirs.length })
  );

  const quitting = requestQuit(app);

  await Promise.race([quitting, sleep(1500)]);
  record(
    "quit with a meaningful draft is held for the Save, Discard, Cancel dialog",
    app.process().exitCode === null,
    json({ exitCode: app.process().exitCode })
  );
  app.process().kill("SIGKILL");
};

const closeDocuments = () => {
  for (const name of createdDocs) {
    osascript(
      `tell application "TextEdit" to close (every document whose name is "${name}") saving no`
    );
  }
};

const INSPECT_PORT = 9339;

/** Talks to the main process over the Node inspector, for an app Playwright did not launch. */
const inspectorEvaluate = async (
  socket: WebSocket,
  id: number,
  expression: string
) => {
  socket.send(
    JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: { awaitPromise: true, expression, returnByValue: true },
    })
  );

  for await (const [event] of on(socket, "message")) {
    const message: { id?: number; result?: { result?: { value?: string } } } =
      JSON.parse(String(event.data));

    if (message.id === id) {
      return message.result?.result?.value ?? "";
    }
  }

  return "";
};

/**
 * Playwright starts the app as a child of this terminal, so macOS may attribute Screen Recording
 * to the terminal. Launching through LaunchServices makes the app its own responsible process.
 */
const measureOpenLaunch = async (docA: string) => {
  const userData = await mkdtemp(path.join(tmpdir(), "iwl-verify-open-"));

  execFileSync("open", [
    "-n",
    "--env",
    "INSET_E2E=1",
    "--env",
    `INSET_E2E_USER_DATA=${userData}`,
    "-a",
    path.dirname(path.dirname(path.dirname(PACKAGED_EXE))),
    "--args",
    `--inspect=${INSPECT_PORT}`,
  ]);
  await sleep(4000);

  const response = await fetch(`http://127.0.0.1:${INSPECT_PORT}/json/list`);

  const targets: { webSocketDebuggerUrl: string }[] = JSON.parse(
    await response.text()
  );

  const socket = new WebSocket(targets[0]?.webSocketDebuggerUrl ?? "");

  await once(socket, "open");
  await bringToFront(docA);
  await inspectorEvaluate(socket, 1, "globalThis.__insetE2E.pressShortcut()");
  await sleep(4000);

  const result = await inspectorEvaluate(
    socket,
    2,
    "JSON.stringify({ diagnostics: globalThis.__insetE2E.diagnostics(), snapshot: globalThis.__insetE2E.snapshot() })"
  );

  const {
    diagnostics,
    snapshot: snap,
  }: { diagnostics: object; snapshot: DraftSnapshot } = JSON.parse(result);

  const pid = execFileSync(
    "pgrep",
    ["-f", `Inset Window Links --inspect=${INSPECT_PORT}`],
    { encoding: "utf-8" }
  ).trim();

  socket.close();
  process.kill(Number(pid.split("\n")[0]), "SIGKILL");
  observations.set(
    "openLaunch",
    json({ diagnostics, notice: snap.notice, views: snap.views.length })
  );

  if (snap.views.length === 1 && snap.views[0]?.source.kind === "direct") {
    record(
      "packaged app launched through LaunchServices captures directly",
      true,
      json(diagnostics)
    );
  } else {
    block(
      "packaged app launched through LaunchServices captures directly",
      json({
        diagnostics,
        notice: snap.notice,
        remaining:
          "Grant Screen Recording to Inset Window Links in System Settings, then relaunch.",
      })
    );
  }
};

const checkLaunch = async (app: ElectronApplication) => {
  await sleep(1500);

  const launched = await windows(app);

  const dock = await app.evaluate(
    ({ app: electronApp }) => electronApp.dock?.isVisible() ?? false
  );

  record(
    "ordinary launch shows no window",
    launched.every((win) => !win.visible),
    json(launched.map((win) => [path.basename(win.url), win.visible]))
  );
  record(
    "ordinary launch shows no dock icon",
    !dock,
    json({ dockVisible: dock })
  );
  observations.set(
    "screenAccessAtLaunch",
    json(
      await app.evaluate(({ systemPreferences }) =>
        systemPreferences.getMediaAccessStatus("screen")
      )
    )
  );
};

const run = async (userData: string) => {
  const docA = newTextEditDocument(
    "Doc A: the supplier deadline is 14 November."
  );

  const docB = newTextEditDocument(
    "Doc B: option 2 needs six weeks of lead time."
  );

  let app = await launch(userData);
  let page = await popoverPage(app);

  await checkLaunch(app);

  if (!(await firstCapture(app, page, docA))) {
    app.process().kill("SIGKILL");

    return;
  }

  await secondCapture(app, page, docB);
  await selfPress(app, page);
  await saveAndVerify(app, page, userData, [docA, docB]);
  await app.close();

  app = await launch(userData);
  page = await popoverPage(app);
  await reopenAndRead(app, [docA, docB]);
  await escapeAndRestore(app, page, docA);
  await discardDraft(app, page);
  await app.close();

  app = await launch(userData, true);
  page = await popoverPage(app);
  await failedWrite(app, page, userData, docA);

  if (MODE === "packaged") {
    await measureOpenLaunch(docA);
  }
};

if (process.platform === "darwin") {
  const userData = await mkdtemp(path.join(tmpdir(), `iwl-verify-${MODE}-`));

  try {
    await run(userData);
  } finally {
    closeDocuments();
  }

  const report = {
    checks,
    mode: MODE,
    observations: Object.fromEntries(
      [...observations].map(([key, value]) => [key, JSON.parse(value)])
    ),
    platform: `${process.platform}-${process.arch}`,
    ranAt: new Date().toISOString(),
    userData,
  };

  const out = path.join(ROOT, "release", `verify-${MODE}.json`);

  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  console.log(`Report written to ${path.relative(ROOT, out)}`);
  process.exitCode = checks.some((item) => item.status === "fail") ? 1 : 0;
} else {
  console.log(
    `verify-desktop runs on macOS only. ${process.platform} is untested by this harness.`
  );
}
