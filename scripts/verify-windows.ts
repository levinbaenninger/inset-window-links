// Windows smoke test of the real capture path. It drives Inset with real input: mouse clicks to
// activate test windows and SendInput keystrokes for Ctrl+Alt+W, Ctrl+Enter and Escape. The test
// windows belong to a separate fixture process, so the user's own apps are never touched. Leave the
// machine alone while it runs: it moves the mouse, takes focus, and overwrites the clipboard once.
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";

import { activeWindow } from "get-windows";
import type { ElectronApplication, Page } from "playwright";
import { _electron } from "playwright";

import type { SettingsChange } from "../src/shared/settings.ts";

// The __insetE2E global is declared in verify-desktop.ts, which shares this tsconfig.

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Doc {
  title: string;
  body: string;
  color: string;
  bounds: Rect;
}

interface Fixture {
  open: (name: string, doc: Doc) => Promise<void>;
  physical: (point: { x: number; y: number }) => { x: number; y: number };
  raise: (title: string) => void;
  close: () => void;
}

declare global {
  var fixture: Fixture;
}

interface Check {
  name: string;
  status: "pass" | "fail";
  observed: string;
}

interface SavedRecord {
  relationship: string;
  views: readonly {
    id: string;
    title: string;
    width: number;
    height: number;
  }[];
}

const ROOT = path.resolve(import.meta.dirname, "..");

/** --exe <path> runs an installed copy, for checks that need the installer's Start menu entry. */
const EXE_ARG = process.argv.indexOf("--exe");
const INSTALLED = EXE_ARG === -1 ? null : (process.argv[EXE_ARG + 1] ?? null);
const PACKAGED = process.argv.includes("--packaged") || INSTALLED !== null;

const modeName = () => {
  if (INSTALLED !== null) {
    return "installed";
  }

  return PACKAGED ? "packaged" : "dev";
};

const MODE = modeName();

const OUT = path.join(ROOT, "release", `verify-windows-${MODE}`);

/** The packaged run uses the unpacked app from `pnpm package:dir`, the same files the installer copies. */
const APP = PACKAGED
  ? {
      args: [],
      executable:
        INSTALLED ??
        path.join(ROOT, "release", "win-unpacked", "Inset Window Links.exe"),
    }
  : {
      args: ["."],
      executable: path.join(
        ROOT,
        "node_modules",
        "electron",
        "dist",
        "electron.exe"
      ),
    };

const TRAY_MENU = [
  "Capture Panel",
  "Add Windows…",
  "Recent Captures…",
  "---",
  "Add a Window: Ctrl+Alt+W",
  "---",
  "How It Works",
  "Settings…",
  "Quit Inset Window Links",
];

/**
 * The panel now stays open when another window is clicked. The harness turns click-away hiding
 * back on, so the checks that click into a document still see it hide. iconIn is macOS only.
 */
const E2E_SETTINGS: SettingsChange = {
  hideOnClickAway: true,
  iconIn: "menuBar",
};

/** Yellow, so a stray popover in Doc A's captured image is easy to detect. */
const YELLOW = [255, 214, 0] as const;

const DOC_A: Doc = {
  body: "Doc A: The Q4 budget cap is CHF 12,000.",
  bounds: { height: 700, width: 1400, x: 200, y: 120 },
  color: `rgb(${YELLOW.join(", ")})`,
  title: "Doc A - Budget",
};

const DOC_B: Doc = {
  body: "Doc B: Supplier quote, CHF 14,500.",
  bounds: { height: 500, width: 700, x: 100, y: 150 },
  color: "rgb(190, 225, 255)",
  title: "Doc B - Quote",
};

/** Click targets inside each document, outside the other one and outside the popover, centred on a 1920-wide screen. */
const CLICK_A = { x: 1450, y: 760 };
const CLICK_B = { x: 150, y: 400 };

const RELATIONSHIP = "The budget cap in A rules out the quote in B.";

const VK = {
  a: 0x41,
  alt: 0x12,
  c: 0x43,
  ctrl: 0x11,
  end: 0x23,
  enter: 0x0d,
  escape: 0x1b,
  f4: 0x73,
  n: 0x4e,
  shift: 0x10,
  up: 0x26,
  v: 0x56,
  z: 0x5a,
  w: 0x57,
} as const;

const checks: Check[] = [];
const observations = new Map<string, string>();

const json = <T>(value: T): string => JSON.stringify(value) ?? "undefined";

const record = (name: string, pass: boolean, observed: string) => {
  checks.push({ name, observed, status: pass ? "pass" : "fail" });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}: ${observed}`);
};

const waitFor = async <T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeoutMs = 6000,
  intervalMs = 50
): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  const value = await read();

  if (done(value) || Date.now() >= deadline) {
    return value;
  }

  await sleep(intervalMs);

  return waitFor(read, done, deadline - Date.now(), intervalMs);
};

const settles = async (promise: Promise<unknown>) => {
  try {
    await promise;

    return true;
  } catch {
    return false;
  }
};

const INPUT_SCRIPT = `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class In {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, UIntPtr e);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(long point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  public static uint ForegroundOwner() {
    uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return pid;
  }
  public static uint OwnerAt(int x, int y) {
    IntPtr h = GetAncestor(WindowFromPoint(((long)y << 32) | (uint)x), 2);
    uint pid; GetWindowThreadProcessId(h, out pid); return pid;
  }
}
"@
[In]::SetProcessDPIAware() | Out-Null
[Console]::Out.WriteLine("ready")
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  $parts = $line.Split(" ")
  # Clicks and drags carry the process ids allowed under the pointer. Anything else is refused.
  if ($parts[0] -eq "click" -or $parts[0] -eq "drag") {
    $owner = [In]::OwnerAt([int]$parts[1], [int]$parts[2])
    if (-not ($parts[-1].Split(",") -contains "$owner")) {
      [Console]::Out.WriteLine("refused $owner")
      continue
    }
  }
  if ($parts[0] -eq "click") {
    [In]::SetCursorPos([int]$parts[1], [int]$parts[2]) | Out-Null
    Start-Sleep -Milliseconds 60
    [In]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    [In]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  }
  if ($parts[0] -eq "drag") {
    $x1 = [int]$parts[1]; $y1 = [int]$parts[2]; $x2 = [int]$parts[3]; $y2 = [int]$parts[4]
    [In]::SetCursorPos($x1, $y1) | Out-Null
    Start-Sleep -Milliseconds 80
    [In]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
    for ($i = 1; $i -le 10; $i++) {
      [In]::SetCursorPos($x1 + ($x2 - $x1) * $i / 10, $y1 + ($y2 - $y1) * $i / 10) | Out-Null
      Start-Sleep -Milliseconds 30
    }
    [In]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  }
  if ($parts[0] -eq "shot") {
    $bmp = New-Object System.Drawing.Bitmap ([int]$parts[3]), ([int]$parts[4])
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen([int]$parts[1], [int]$parts[2], 0, 0, $bmp.Size)
    $bmp.Save(($parts[5..($parts.Length - 1)] -join " "))
  }
  # Keys go to the foreground window, so they are sent only while a harness window is in front.
  if ($parts[0] -eq "keys") {
    $owner = [In]::ForegroundOwner()
    if (-not ($parts[-1].Split(",") -contains "$owner")) {
      [Console]::Out.WriteLine("refused $owner")
      continue
    }
    $codes = $parts[1].Split(",") | ForEach-Object { [byte][Convert]::ToInt32($_, 16) }
    foreach ($c in $codes) { [In]::keybd_event($c, 0, 0, [UIntPtr]::Zero) }
    [array]::Reverse($codes)
    foreach ($c in $codes) { [In]::keybd_event($c, 0, 2, [UIntPtr]::Zero) }
  }
  [Console]::Out.WriteLine("ok")
}
`;

/** One long-lived PowerShell that sends real mouse and keyboard input through user32. */
class Input {
  readonly #shell: ChildProcessWithoutNullStreams;
  readonly #lines: AsyncIterator<string>;

  constructor() {
    this.#shell = spawn("powershell", ["-NoProfile", "-Command", "-"], {
      stdio: "pipe",
    });
    this.#shell.stdin.write(`${INPUT_SCRIPT}\n`);
    this.#lines = createInterface({ input: this.#shell.stdout })[
      Symbol.asyncIterator
    ]();
  }

  async ready() {
    await this.#lines.next();
  }

  async #send(line: string) {
    this.#shell.stdin.write(`${line}\n`);

    const next = await this.#lines.next();
    const reply = next.done === true ? "" : next.value;

    if (reply.startsWith("refused")) {
      throw new Error(
        `Refused to click: the window under the pointer belongs to process ${reply.slice(8)}, not to the harness. Is another app in front?`
      );
    }
  }

  /** Drags only if the window under `from` belongs to one of `owners`. */
  drag(
    from: { x: number; y: number },
    to: { x: number; y: number },
    owners: readonly number[]
  ) {
    return this.#send(
      `drag ${[from.x, from.y, to.x, to.y].map(Math.round).join(" ")} ${owners.join(",")}`
    );
  }

  /** Clicks only if the window under the point belongs to one of `owners`, so a stray app in front is never clicked. */
  click(point: { x: number; y: number }, owners: readonly number[]) {
    return this.#send(
      `click ${Math.round(point.x)} ${Math.round(point.y)} ${owners.join(",")}`
    );
  }

  screenshot(area: Rect, file: string) {
    return this.#send(
      `shot ${[area.x, area.y, area.width, area.height].map(Math.round).join(" ")} ${file}`
    );
  }

  /** Virtual-key codes, pressed in order and released in reverse, only while one of `owners` is in front. */
  keys(owners: readonly number[], ...codes: readonly number[]) {
    return this.#send(
      `keys ${codes.map((code) => code.toString(16)).join(",")} ${owners.join(",")}`
    );
  }

  close() {
    this.#shell.stdin.end();
  }
}

const cleanEnv = (extra: Readonly<Record<string, string>>) => {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    // Set by some hosts (T3, editor tasks); it would start Electron as plain Node.
    if (value !== undefined && key !== "ELECTRON_RUN_AS_NODE") {
      env[key] = value;
    }
  }

  return { ...env, ...extra };
};

const launchInset = async (
  userData: string,
  extra: Readonly<Record<string, string>> = {}
) => {
  await mkdir(userData, { recursive: true });
  await writeFile(
    path.join(userData, "settings.json"),
    `${JSON.stringify(E2E_SETTINGS, null, 2)}\n`
  );

  const app = await _electron.launch({
    args: APP.args,
    colorScheme: null,
    cwd: ROOT,
    executablePath: APP.executable,
    env: cleanEnv({ INSET_E2E: "1", INSET_E2E_USER_DATA: userData, ...extra }),
  });

  // Inset's own output, so an unexpected exit leaves a trace.
  const child = app.process();
  const started = Date.now();

  child.stderr?.on("data", (data: Buffer) => {
    const text = String(data).trim();

    if (/error|fatal|uncaught|exception/iu.test(text)) {
      console.log(`[inset stderr] ${text.slice(0, 500)}`);
    }
  });
  child.on("exit", (code, signal) => {
    console.log(
      `[inset exit] code=${code} signal=${signal} after ${Date.now() - started} ms`
    );
  });

  return app;
};

const seamReady = (app: ElectronApplication) =>
  waitFor(
    () => app.evaluate(() => "__insetE2E" in globalThis),
    (ready) => ready,
    20_000,
    100
  );

const snapshot = (app: ElectronApplication) =>
  app.evaluate(() => globalThis.__insetE2E.snapshot());

const viewCount = async (app: ElectronApplication) => {
  const snap = await snapshot(app);

  return snap.views.length;
};

const windowsOf = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .filter((win) => !win.isDestroyed())
      .map((win) => ({
        bounds: win.getBounds(),
        focused: win.isFocused(),
        menuBarVisible: win.isMenuBarVisible(),
        url: win.webContents.getURL(),
        visible: win.isVisible(),
      }))
  );

const windowFor = async (app: ElectronApplication, role: string) => {
  const all = await windowsOf(app);

  return all.find((win) => win.url.includes(role)) ?? null;
};

const pageFor = async (app: ElectronApplication, role: string) => {
  const page = await waitFor(
    () =>
      Promise.resolve(
        // The newest match: a window closed a moment ago can still be listed.
        app
          .windows()
          .findLast(
            (candidate) =>
              !candidate.isClosed() && candidate.url().includes(role)
          ) ?? null
      ),
    (found) => found !== null,
    8000,
    100
  );

  if (page === null) {
    throw new Error(`No ${role} page`);
  }

  await page.waitForLoadState("load");

  return page;
};

const foreground = async () => {
  const win = await activeWindow();

  return win ? { pid: win.owner.processId, title: win.title } : null;
};

const activate = async (
  input: Input,
  fixtureApp: ElectronApplication,
  point: { x: number; y: number },
  title: string
) => {
  const physical = await fixtureApp.evaluate(
    (_modules, dip) => globalThis.fixture.physical(dip),
    point
  );

  const fixturePid = await fixtureApp.evaluate(() => process.pid);

  // Another app may have come to the front since the last step; the click guard backs this up.
  await fixtureApp.evaluate(
    (_modules, name) => globalThis.fixture.raise(name),
    title
  );
  await sleep(150);
  await input.click(physical, [fixturePid]);

  return waitFor(foreground, (win) => win?.title === title, 3000);
};

/** Inset's and the fixture's main processes: the only windows the harness may click or type into. */
let harnessPids: readonly number[] = [];

const pressShortcut = (input: Input) =>
  input.keys(harnessPids, VK.ctrl, VK.alt, VK.w);

/** Quits through the seam with an empty draft, so the tray icon is removed and no ghost stays. */
const closeInset = async (app: ElectronApplication) => {
  // Playwright's process() throws once the app has exited, so take the handle first.
  const child = app.process();
  const closed = once(child, "exit");

  await settles(app.evaluate(() => globalThis.__insetE2E.quit()));
  await Promise.race([closed, sleep(4000)]);

  if (child.exitCode === null) {
    child.kill();
  }
};

const recordDirs = async (userData: string) => {
  const names = await readdir(path.join(userData, "captures")).catch(() => []);

  return names.filter((name) => !name.startsWith("."));
};

const testIdShown = (page: Page, testId: string, timeout = 3000) =>
  settles(page.getByTestId(testId).waitFor({ timeout }));

/**
 * Points in Doc A, relative to its window, where the preview popover sat over it. The popover
 * is centred on the screen now, not in Doc A's top-right corner, so the samples follow its
 * bounds. They stay 150 DIP below Doc A's top, clear of the title bar and the line of text.
 */
const overlapPoints = (popover: Rect | null) => {
  const doc = DOC_A.bounds;

  if (popover === null) {
    return [];
  }

  const left = Math.max(popover.x, doc.x);
  const right = Math.min(popover.x + popover.width, doc.x + doc.width);
  const top = Math.max(popover.y, doc.y + 150);
  const bottom = Math.min(popover.y + popover.height, doc.y + doc.height);

  if (right - left < 60 || bottom - top < 60) {
    return [];
  }

  const y = Math.round((top + bottom) / 2) - doc.y;

  return [left + 20, (left + right) / 2, right - 20].map((x) => ({
    x: Math.round(x) - doc.x,
    y,
  }));
};

/** Samples Doc A's saved image at points relative to its window. */
const overlapPixels = (
  app: ElectronApplication,
  file: string,
  points: readonly { x: number; y: number }[]
) =>
  app.evaluate(
    ({ nativeImage }, { png, width, at }) => {
      const image = nativeImage.createFromPath(png);
      const scale = image.getSize().width / width;

      return at.map((point) => {
        const [blue, green, red] = image
          .crop({
            height: 1,
            width: 1,
            x: Math.round(point.x * scale),
            y: Math.round(point.y * scale),
          })
          .toBitmap();

        return [red ?? 0, green ?? 0, blue ?? 0];
      });
    },
    { at: points, png: file, width: DOC_A.bounds.width }
  );

const isYellow = ([red, green, blue]: readonly number[]) =>
  Math.abs((red ?? 0) - YELLOW[0]) <= 12 &&
  Math.abs((green ?? 0) - YELLOW[1]) <= 12 &&
  Math.abs((blue ?? 0) - YELLOW[2]) <= 12;

const firstPress = async (
  app: ElectronApplication,
  fixtureApp: ElectronApplication,
  input: Input,
  popover: Page
) => {
  const insetPid = await app.evaluate(() => process.pid);
  const frontA = await activate(input, fixtureApp, CLICK_A, DOC_A.title);

  record(
    "a click brings Doc A to the front",
    frontA?.title === DOC_A.title,
    json(frontA)
  );

  await pressShortcut(input);

  const sent = Date.now();

  // Read in one evaluate: once source listing starts, the main process answers nothing for a second.
  const shown = await waitFor(
    () =>
      app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((each) =>
          each.webContents.getURL().includes("popover.html")
        );

        const { activity } = globalThis.__insetE2E.snapshot();

        return {
          bounds: win?.getBounds() ?? null,
          focused: win?.isFocused() ?? false,
          pending: activity.kind === "capturing" ? activity.pending : null,
          visible: win?.isVisible() ?? false,
        };
      }),
    (win) => win.visible,
    5000,
    10
  );

  const previewMs = Date.now() - sent;
  const duringPreview = await foreground();

  // Taken by the OS, not through Electron, so it shows what is on screen while capture runs.
  if (shown.bounds !== null) {
    await input.screenshot(shown.bounds, path.join(OUT, "capturing.png"));
  }

  const pendingText = shown.pending?.title ?? null;

  observations.set("pressToPopoverMs", String(previewMs));
  record(
    "the popover appears within 400 ms of a real Ctrl+Alt+W",
    shown?.visible === true && previewMs <= 400,
    json({ previewMs, visible: shown?.visible })
  );
  record(
    "while capturing, the popover names the window and leaves focus with it",
    pendingText?.includes(DOC_A.title) === true &&
      duringPreview?.title === DOC_A.title &&
      shown?.focused === false,
    json({ duringPreview, focused: shown?.focused, pendingText })
  );

  const first = await waitFor(
    () => snapshot(app),
    (snap) => snap.views.length === 1,
    8000
  );

  const diagnostics = await app.evaluate(() =>
    globalThis.__insetE2E.diagnostics()
  );

  observations.set("pressToViewMs", String(Date.now() - sent));
  observations.set("diagnostics", json(diagnostics));
  record(
    "the first press adds Doc A as a direct view",
    first.views[0]?.title === DOC_A.title &&
      first.views[0]?.source.kind === "direct",
    json(first.views.map((view) => [view.title, view.source.kind]))
  );

  const focusedAfter = await waitFor(
    foreground,
    (win) => win?.pid === insetPid,
    2000
  );

  const settled = await windowFor(app, "popover.html");

  if (settled !== null) {
    await input.screenshot(settled.bounds, path.join(OUT, "captured.png"));
  }

  const activeId = await popover.evaluate("document.activeElement?.id ?? ''");

  record(
    "after capture the popover has focus and the text field is ready",
    focusedAfter?.pid === insetPid && activeId === "relationship",
    json({ activeId, focusedAfter })
  );

  return shown.bounds;
};

const typeAndCopy = async (
  app: ElectronApplication,
  input: Input,
  popover: Page
) => {
  const before = await app.evaluate(({ clipboard }) => clipboard.readText());

  await popover.keyboard.type(RELATIONSHIP);
  await input.keys(harnessPids, VK.ctrl, VK.a);
  await input.keys(harnessPids, VK.ctrl, VK.c);
  await input.keys(harnessPids, VK.end);

  const copied = await waitFor(
    () => app.evaluate(({ clipboard }) => clipboard.readText()),
    (text) => text === RELATIONSHIP,
    2000
  );

  record(
    "Ctrl+A and Ctrl+C work in the popover's text field",
    copied === RELATIONSHIP,
    copied
  );

  // Puts back whatever text the person running the harness had copied.
  await app.evaluate(
    ({ clipboard }, text) => clipboard.writeText(text),
    before
  );
};

const secondPressAndSave = async (
  app: ElectronApplication,
  fixtureApp: ElectronApplication,
  input: Input,
  userData: string
) => {
  const insetPid = await app.evaluate(() => process.pid);
  const frontB = await activate(input, fixtureApp, CLICK_B, DOC_B.title);

  const hidden = await waitFor(
    () => windowFor(app, "popover.html"),
    (win) => win?.visible === false,
    3000
  );

  record(
    "clicking into Doc B hides the popover and gives Doc B focus",
    hidden?.visible === false && frontB?.title === DOC_B.title,
    json({ frontB, popoverVisible: hidden?.visible })
  );

  await pressShortcut(input);

  const second = await waitFor(
    () => snapshot(app),
    (snap) => snap.views.length === 2,
    8000
  );

  record(
    "the second press adds Doc B and keeps the text",
    second.views[1]?.title === DOC_B.title &&
      second.text.relationship === RELATIONSHIP,
    json({ text: second.text, titles: second.views.map((view) => view.title) })
  );

  await waitFor(foreground, (win) => win?.pid === insetPid, 2000);
  await input.keys(harnessPids, VK.ctrl, VK.enter);

  const saved = await waitFor(
    async () => ({
      dirs: await recordDirs(userData),
      popover: await windowFor(app, "popover.html"),
    }),
    (value) => value.dirs.length === 1 && value.popover?.visible === false,
    5000
  );

  const afterSave = await waitFor(
    foreground,
    (win) => win?.title === DOC_B.title,
    2000
  );

  // The save notification as Windows shows it, for a look at its title and text.
  await sleep(1200);
  await input.screenshot(
    { height: 260, width: 480, x: 1920 - 480, y: 1080 - 260 },
    path.join(OUT, "saved-notification.png")
  );

  record(
    "a real Ctrl+Enter saves one record and hides the popover",
    saved.dirs.length === 1 && saved.popover?.visible === false,
    json(saved.dirs)
  );
  record(
    "focus returns to Doc B after saving",
    afterSave?.title === DOC_B.title,
    json(afterSave)
  );

  return saved.dirs[0] ?? null;
};

const checkRecord = async (
  app: ElectronApplication,
  userData: string,
  dir: string,
  popover: Rect | null
) => {
  const recordPath = path.join(userData, "captures", dir);

  const saved: SavedRecord = JSON.parse(
    await readFile(path.join(recordPath, "record.json"), "utf-8")
  );

  record(
    "the record holds the text and both views",
    saved.relationship === RELATIONSHIP &&
      saved.views.map((view) => view.title).join("|") ===
        `${DOC_A.title}|${DOC_B.title}`,
    json(saved.views.map((view) => [view.title, view.width, view.height]))
  );

  const [viewA] = saved.views;

  if (viewA === undefined) {
    return;
  }

  const points = overlapPoints(popover);

  const sample =
    points.length === 0
      ? []
      : await overlapPixels(
          app,
          path.join(recordPath, "views", `${viewA.id}.png`),
          points
        );

  record(
    "Doc A's image shows Doc A where the preview overlapped it, not the popover",
    sample.length > 0 && sample.every(isYellow),
    json({ points, popover, sample })
  );
};

const libraryFlow = async (app: ElectronApplication) => {
  await app.evaluate(() => globalThis.__insetE2E.openRecent());

  const page = await pageFor(app, "library.html");

  const win = await waitFor(
    () => windowFor(app, "library.html"),
    (found) => found?.visible === true,
    5000
  );

  record(
    "Recent Captures opens without the File/Edit/View menu",
    win?.visible === true && win.menuBarVisible === false,
    json(win)
  );

  // Every pane header is a drag region now; the one under the caption buttons is what counts.
  const strip = String(
    await page.evaluate(
      "(() => { const header = document.elementFromPoint(innerWidth - 60, 18)?.closest('.drag-region'); return header ? header.tagName : 'none'; })()"
    )
  );

  record(
    "the window has a draggable strip under the caption buttons",
    strip === "HEADER",
    strip
  );
  await page.screenshot({ path: path.join(OUT, "recent.png") });

  await page.getByTestId("recent-item").first().click();
  await page.screenshot({ path: path.join(OUT, "record.png") });
  await page.getByTestId("record-source").first().getByRole("link").click();
  await page.waitForFunction(
    "(() => { const img = document.querySelector('[data-testid=viewer-image]'); return img?.complete && img.naturalWidth > 0; })()"
  );

  const fit: { shown: Rect; frame: Rect } = await page.evaluate(
    "(() => { const img = document.querySelector('[data-testid=viewer-image]'); return { shown: img.getBoundingClientRect().toJSON(), frame: img.closest('button').parentElement.getBoundingClientRect().toJSON() }; })()"
  );

  record(
    "the viewer fits the whole capture in the window first",
    fit.shown.width <= fit.frame.width + 1 &&
      fit.shown.height <= fit.frame.height + 1,
    json(fit)
  );
  await page.screenshot({ path: path.join(OUT, "viewer-fit.png") });

  await page.getByRole("button", { exact: true, name: "Actual size" }).click();

  const actual: { natural: number; shown: number } = await page.evaluate(
    "(() => { const img = document.querySelector('[data-testid=viewer-image]'); return { natural: img.naturalWidth / devicePixelRatio, shown: img.getBoundingClientRect().width }; })()"
  );

  record(
    "Actual size shows one image pixel per device pixel",
    Math.abs(actual.shown - actual.natural) <= 1,
    json(actual)
  );

  await page.keyboard.press("Escape");
  // The library has no How it works link any more; the tray's How It Works opens it in place.
  await app.evaluate(() => globalThis.__insetE2E.openWelcome());

  const welcome = await testIdShown(page, "welcome");

  record(
    "How It Works opens in the open Recent Captures window",
    welcome && page.url().endsWith("#/welcome"),
    json({ url: page.url(), welcome })
  );
  await page.screenshot({ path: path.join(OUT, "welcome.png") });

  const pageClosed = page.waitForEvent("close");

  await app.evaluate(({ BrowserWindow }) => {
    for (const each of BrowserWindow.getAllWindows()) {
      if (each.webContents.getURL().includes("library.html")) {
        each.close();
      }
    }
  });
  // The next flow opens a fresh window; it must not find this one still closing.
  await pageClosed;
};

const libraryWindowBounds = async (app: ElectronApplication) => {
  const win = await windowFor(app, "library.html");

  return win?.visible === true ? win.bounds : null;
};

const chromeFlow = async (
  app: ElectronApplication,
  fixtureApp: ElectronApplication,
  input: Input
) => {
  const toPhysical = (point: { x: number; y: number }) =>
    fixtureApp.evaluate(
      (_modules, dip) => globalThis.fixture.physical(dip),
      point
    );

  await app.evaluate(() => globalThis.__insetE2E.openRecent());

  const page = await pageFor(app, "library.html");

  await waitFor(
    () => libraryWindowBounds(app),
    (bounds) => bounds !== null,
    5000
  );

  // Away from the right edge, where other apps' always-on-top windows tend to sit.
  const start = { height: 700, width: 960, x: 40, y: 60 };

  await app.evaluate(({ BrowserWindow }, bounds) => {
    const win = BrowserWindow.getAllWindows().findLast(
      (each) =>
        !each.isDestroyed() &&
        each.isVisible() &&
        each.webContents.getURL().includes("library.html")
    );

    win?.setBounds(bounds);
    win?.focus();
  }, start);
  await sleep(500);

  const topLeft = await toPhysical({ x: start.x, y: start.y });

  await input.screenshot(
    { height: 120, width: start.width, x: topLeft.x, y: topLeft.y },
    path.join(OUT, "title-strip.png")
  );

  const grab = await toPhysical({ x: start.x + 400, y: start.y + 18 });

  const insetPid = await app.evaluate(() => process.pid);

  await input.drag(grab, { x: grab.x + 120, y: grab.y + 80 }, [insetPid]);

  const moved = await waitFor(
    () => libraryWindowBounds(app),
    (bounds) => bounds !== null && bounds.x !== start.x,
    2000
  );

  record(
    "dragging the strip moves Recent Captures",
    // Windows starts a drag only past a small threshold, so the window trails the pointer a little.
    moved !== null && moved.x - start.x >= 60 && moved.y - start.y >= 40,
    json(moved)
  );

  // Paste and undo, by real keys, in a window that has no Edit menu.
  await page.getByTestId("recent-item").first().click();
  await page.getByRole("button", { name: "Edit text" }).click();

  const field = page.locator("#edit-relationship");

  await field.waitFor({ timeout: 3000 });

  const original = await field.inputValue();
  const before = await app.evaluate(({ clipboard }) => clipboard.readText());
  const pasted = "Pasted by the harness.";

  await app.evaluate(
    ({ clipboard }, text) => clipboard.writeText(text),
    pasted
  );
  await input.keys(harnessPids, VK.ctrl, VK.a);
  await input.keys(harnessPids, VK.ctrl, VK.v);

  const afterPaste = await waitFor(
    () => field.inputValue(),
    (value) => value === pasted,
    2000
  );

  await input.keys(harnessPids, VK.ctrl, VK.z);

  const afterUndo = await waitFor(
    () => field.inputValue(),
    (value) => value === original,
    2000
  );

  await app.evaluate(
    ({ clipboard }, text) => clipboard.writeText(text),
    before
  );
  record(
    "Ctrl+V and Ctrl+Z work in Recent Captures without an app menu",
    afterPaste === pasted && afterUndo === original,
    json({ afterPaste, afterUndo })
  );
  await page.getByRole("button", { name: "Cancel" }).click();

  // The caption ✕ is drawn by Windows over the page. It closes the window, not the app.
  const bounds = moved ?? start;

  const close = await toPhysical({
    x: bounds.x + bounds.width - 23,
    y: bounds.y + 18,
  });

  await input.click(close, [insetPid]);

  const closed = await waitFor(
    () => libraryWindowBounds(app),
    (found) => found === null,
    3000
  );

  record(
    "the caption close button closes Recent Captures and Inset keeps running",
    closed === null && app.process().exitCode === null,
    json({ closed, exitCode: app.process().exitCode })
  );

  await app.evaluate(() => globalThis.__insetE2E.openRecent());

  const reopened = await waitFor(
    () => libraryWindowBounds(app),
    (found) => found !== null,
    5000
  );

  record(
    "Recent Captures opens again afterwards",
    reopened !== null,
    json(reopened)
  );
  await app.evaluate(({ BrowserWindow }) => {
    for (const each of BrowserWindow.getAllWindows()) {
      if (each.webContents.getURL().includes("library.html")) {
        each.close();
      }
    }
  });
};

/**
 * Windows has no menu bar, so the panel answers the Mac menu's keys itself, and Alt+F4 must only
 * hide it: the panel lives as long as the app.
 */
const panelKeys = async (
  app: ElectronApplication,
  fixtureApp: ElectronApplication,
  input: Input
) => {
  const insetPid = await app.evaluate(() => process.pid);

  await app.evaluate(() => globalThis.__insetE2E.showDraft());

  const shown = await waitFor(
    () => windowFor(app, "popover.html"),
    (win) => win?.visible === true,
    3000
  );

  if (shown === null) {
    record("the panel shows for the key checks", false, "no panel");

    return;
  }

  // A click on the header, so the keys go to the panel even if Windows kept another window in front.
  const header = await fixtureApp.evaluate(
    (_modules, dip) => globalThis.fixture.physical(dip),
    { x: shown.bounds.x + 200, y: shown.bounds.y + 20 }
  );

  await input.click(header, [insetPid]);
  await waitFor(foreground, (win) => win?.pid === insetPid, 2000);
  await input.keys(harnessPids, VK.ctrl, VK.shift, VK.n);

  const choosing = await waitFor(
    () => snapshot(app),
    (snap) => snap.activity.kind === "choosing",
    3000
  );

  await input.keys(harnessPids, VK.escape);

  const back = await waitFor(
    () => snapshot(app),
    (snap) => snap.activity.kind === "idle",
    3000
  );

  record(
    "Ctrl+Shift+N opens the window list, as ⇧⌘N does on macOS",
    choosing.activity.kind === "choosing" && back.activity.kind === "idle",
    json([choosing.activity.kind, back.activity.kind])
  );

  await input.keys(harnessPids, VK.alt, VK.f4);

  const hidden = await waitFor(
    () => windowFor(app, "popover.html"),
    (win) => win?.visible === false,
    3000
  );

  const kept = await viewCount(app);

  await app.evaluate(() => globalThis.__insetE2E.showDraft());

  const again = await waitFor(
    () => windowFor(app, "popover.html"),
    (win) => win?.visible === true,
    3000
  );

  record(
    "Alt+F4 hides the panel, keeps the draft, and the panel opens again",
    hidden?.visible === false && kept === 1 && again?.visible === true,
    json({ again: again?.visible, hidden: hidden?.visible, kept })
  );

  // Hidden again, as the quit checks after this expect.
  await input.click(header, [insetPid]);
  await waitFor(foreground, (win) => win?.pid === insetPid, 2000);
  await input.keys(harnessPids, VK.escape);
  await waitFor(
    () => windowFor(app, "popover.html"),
    (win) => win?.visible === false,
    3000
  );
};

const quitFlow = async (
  app: ElectronApplication,
  fixtureApp: ElectronApplication,
  input: Input,
  popover: Page
) => {
  await activate(input, fixtureApp, CLICK_A, DOC_A.title);
  await pressShortcut(input);
  await waitFor(
    () => viewCount(app),
    (count) => count === 1,
    8000
  );

  // The real tray menu: Up selects its last entry, Quit. The menu closing must not cancel the prompt.
  void settles(app.evaluate(() => globalThis.__insetE2E.trayPopUp()));
  await sleep(600);
  await input.keys(harnessPids, VK.up);
  await input.keys(harnessPids, VK.enter);

  const prompt = await testIdShown(popover, "quit-prompt");

  await sleep(1000);

  const stillAsking = await testIdShown(popover, "quit-prompt", 200);

  record(
    "Quit from the tray menu with a draft asks inside the popover, and the prompt stays",
    prompt && stillAsking,
    json({ prompt, stillAsking })
  );
  await popover.screenshot({ path: path.join(OUT, "quit-prompt.png") });

  await input.keys(harnessPids, VK.escape);

  const cancelled = await waitFor(
    async () => {
      const snap = await snapshot(app);
      const win = await windowFor(app, "popover.html");

      return {
        activity: snap.activity.kind,
        popover: win?.visible,
        views: snap.views.length,
      };
    },
    (value) => value.activity === "idle" && value.popover === false,
    3000
  );

  record(
    "Escape cancels the quit and keeps the app and the draft",
    cancelled.activity === "idle" &&
      cancelled.views === 1 &&
      app.process().exitCode === null,
    json(cancelled)
  );

  await panelKeys(app, fixtureApp, input);

  await app.evaluate(() => globalThis.__insetE2E.quit());

  const asked = await testIdShown(popover, "quit-prompt");

  await activate(input, fixtureApp, CLICK_A, DOC_A.title);

  const clickedAway = await waitFor(
    async () => {
      const snap = await snapshot(app);
      const win = await windowFor(app, "popover.html");

      return {
        activity: snap.activity.kind,
        popover: win?.visible,
        views: snap.views.length,
      };
    },
    (value) => value.activity === "idle" && value.popover === false,
    3000
  );

  record(
    "clicking into another window also cancels the quit and keeps the draft",
    asked &&
      clickedAway.activity === "idle" &&
      clickedAway.views === 1 &&
      app.process().exitCode === null,
    json({ asked, ...clickedAway })
  );

  await app.evaluate(() => globalThis.__insetE2E.quit());

  const again = await testIdShown(popover, "quit-prompt");

  record("Quit asks again after a cancel", again, String(again));

  const exited = once(app.process(), "exit");

  // The app can exit before the click call returns, which Playwright reports as an error.
  await settles(
    popover.getByRole("button", { name: "Discard and quit" }).click()
  );

  const quit = await Promise.race([
    exited.then(() => true),
    sleep(5000).then(() => false),
  ]);

  record("Discard and quit ends the app", quit, String(quit));
};

const firstRunFlow = async () => {
  const userData = await mkdtemp(path.join(tmpdir(), "inset-win-first-"));
  const welcome = { INSET_E2E_WELCOME: "1" };
  const app = await launchInset(userData, welcome);

  await seamReady(app);

  const shown = await waitFor(
    () => windowFor(app, "library.html"),
    (win) => win?.visible === true,
    6000
  );

  record(
    "the first launch opens How it works",
    shown?.visible === true && shown.url.endsWith("#/welcome"),
    shown?.url ?? "no window"
  );

  const page = await pageFor(app, "library.html");

  await testIdShown(page, "welcome", 5000);
  await page.screenshot({ path: path.join(OUT, "first-run.png") });
  await closeInset(app);

  const again = await launchInset(userData, welcome);

  await seamReady(again);
  await sleep(1500);

  const all = await windowsOf(again);
  const visible = all.filter((win) => win.visible);

  record(
    "the second launch opens no window",
    visible.length === 0,
    json(visible)
  );

  // Opening the app while it runs is how someone finds a hidden tray icon.
  const second = spawn(APP.executable, APP.args, {
    cwd: ROOT,
    env: cleanEnv({ INSET_E2E: "1", INSET_E2E_USER_DATA: userData }),
  });

  await once(second, "exit");

  const opened = await waitFor(
    () => windowFor(again, "library.html"),
    (win) => win?.visible === true,
    5000
  );

  record(
    "launching it again while it runs opens Recent Captures",
    opened?.visible === true,
    opened?.url ?? "no window"
  );

  await closeInset(again);
  // Chromium can still hold a file in the profile for a moment after exit.
  await settles(rm(userData, { force: true, recursive: true }));
};

const openFixtures = async () => {
  const fixtureApp = await _electron.launch({
    args: [path.join(ROOT, "scripts", "fixtures", "window-fixture.mjs")],
    env: cleanEnv({}),
  });

  await waitFor(
    () => fixtureApp.evaluate(() => "fixture" in globalThis),
    (ready) => ready,
    10_000,
    100
  );
  await fixtureApp.evaluate(
    (_modules, doc) => globalThis.fixture.open("A", doc),
    DOC_A
  );
  await fixtureApp.evaluate(
    (_modules, doc) => globalThis.fixture.open("B", doc),
    DOC_B
  );

  return fixtureApp;
};

const step = async (name: string, run: () => Promise<void>) => {
  try {
    await run();
  } catch (error) {
    record(`the ${name} flow finished without an error`, false, String(error));
  }
};

const mainFlow = async (
  app: ElectronApplication,
  fixtureApp: ElectronApplication,
  input: Input,
  userData: string
) => {
  await seamReady(app);

  const all = await windowsOf(app);
  const shown = all.filter((win) => win.visible);

  record("an ordinary launch shows no window", shown.length === 0, json(shown));

  const menu = await app.evaluate(() => globalThis.__insetE2E.trayMenu());

  record(
    "the tray menu has the expected entries",
    json(menu) === json(TRAY_MENU),
    json(menu)
  );

  harnessPids = [
    await app.evaluate(() => process.pid),
    await fixtureApp.evaluate(() => process.pid),
  ];

  const popover = await pageFor(app, "popover.html");

  const shownAt = await firstPress(app, fixtureApp, input, popover);

  await typeAndCopy(app, input, popover);

  const dir = await secondPressAndSave(app, fixtureApp, input, userData);

  if (dir !== null) {
    await checkRecord(app, userData, dir, shownAt);
  }

  // Each later flow starts from a known state, so one failure does not hide the rest.
  await step("library", () => libraryFlow(app));
  await step("window chrome", () => chromeFlow(app, fixtureApp, input));
  await step("quit", () => quitFlow(app, fixtureApp, input, popover));
};

const run = async () => {
  // A locked or idle-locked desktop takes no input; every check after this would fail confusingly.
  if ((await foreground()) === null) {
    throw new Error(
      "No window is in front. Unlock the desktop and run verify-windows again."
    );
  }

  await mkdir(OUT, { recursive: true });

  const input = new Input();

  await input.ready();

  const fixtureApp = await openFixtures();
  const userData = await mkdtemp(path.join(tmpdir(), "inset-win-verify-"));
  const app = await launchInset(userData);
  const child = app.process();

  try {
    await mainFlow(app, fixtureApp, input, userData);
    await firstRunFlow();
  } catch (error) {
    record("the run finished without an error", false, String(error));
  } finally {
    if (child.exitCode === null) {
      await settles(closeInset(app));
    }

    await settles(fixtureApp.evaluate(() => globalThis.fixture.close()));
    await settles(fixtureApp.close());
    input.close();
    // Chromium can still hold a file in the profile for a moment after exit.
    await settles(rm(userData, { force: true, recursive: true }));
  }

  await writeFile(
    path.join(ROOT, "release", `verify-windows-${MODE}.json`),
    `${json({ checks, observations: Object.fromEntries(observations) })}\n`
  );

  const failed = checks.filter((check) => check.status === "fail");

  console.log(
    `\n${checks.length - failed.length} passed, ${failed.length} failed. Report and screenshots in release/.`
  );
  console.log(json(Object.fromEntries(observations)));
  process.exitCode = failed.length === 0 ? 0 : 1;
};

/**
 * Several prototypes on this machine have desktop harnesses that take over the mouse and keyboard.
 * They share one lock: whoever creates this directory first owns the desktop until it removes it.
 * owner.txt names the holder; a lock older than 15 minutes counts as stale. Same protocol as inset-pin.
 */
const DESKTOP_LOCK = path.join(tmpdir(), "inset-desktop-test.lock");
const STALE_LOCK_MS = 15 * 60 * 1000;

const lockIsStale = async () => {
  try {
    const info = await stat(DESKTOP_LOCK);

    return Date.now() - info.mtimeMs > STALE_LOCK_MS;
  } catch {
    return false;
  }
};

const acquireDesktop = async (): Promise<void> => {
  try {
    await mkdir(DESKTOP_LOCK);
  } catch {
    if (await lockIsStale()) {
      console.log("Removing a desktop lock older than 15 minutes.");
      await rm(DESKTOP_LOCK, { force: true, recursive: true });
    } else {
      const owner = await readFile(
        path.join(DESKTOP_LOCK, "owner.txt"),
        "utf-8"
      ).catch(() => "unknown");

      console.log(`Desktop held by ${owner.trim()}. Waiting…`);
      await sleep(5000);
    }

    return acquireDesktop();
  }

  await writeFile(
    path.join(DESKTOP_LOCK, "owner.txt"),
    `inset-window-links verify-windows ${new Date().toTimeString().slice(0, 8)}
`
  );
};

const releaseDesktop = () => rm(DESKTOP_LOCK, { force: true, recursive: true });

const main = async () => {
  if (process.platform !== "win32") {
    throw new Error("verify-windows runs on Windows only");
  }

  await acquireDesktop();

  try {
    await run();
  } finally {
    await releaseDesktop();
  }
};

await main();
