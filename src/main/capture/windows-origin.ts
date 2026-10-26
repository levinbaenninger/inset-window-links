import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";

import type { ViewOrigin } from "../store/schema";
import { documentPath, webPage } from "./origin";

const MAX_PATH = 1024;

/** PowerShell alone takes over a second to start; the address is read while sources are listed. */
const TIMEOUT_MS = 5000;

/**
 * Chromium browsers, whose address bar is the first text field in their window. Firefox exposes
 * no such field to UI Automation, so its pages are not read.
 */
const BROWSERS = new Set([
  "brave.exe",
  "chrome.exe",
  "chromium.exe",
  "msedge.exe",
  "opera.exe",
  "vivaldi.exe",
]);

/**
 * An app Reopen can start again: an absolute path to an .exe. Store apps run from WindowsApps
 * and cannot be started by path, so they are dropped.
 */
export const windowsApp = (raw: string | null | undefined): string | null => {
  if (
    raw === null ||
    raw === undefined ||
    raw.length > MAX_PATH ||
    !path.win32.isAbsolute(raw) ||
    path.win32.extname(raw).toLowerCase() !== ".exe"
  ) {
    return null;
  }

  const lower = raw.toLowerCase();

  return lower.includes("\\windowsapps\\") ||
    path.win32.basename(lower) === "applicationframehost.exe"
    ? null
    : raw;
};

export const isBrowser = (appPath: string): boolean =>
  BROWSERS.has(path.win32.basename(appPath).toLowerCase());

const SCHEME = /^[a-z][\d+.a-z-]*:/iu;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/u;

/** localhost and plain IP addresses are usually served without TLS; anything else is not. */
const isLocal = (host: string) =>
  host === "localhost" || IPV4.test(host) || host.startsWith("[");

/**
 * What a browser's address bar shows: a page, or a file the browser opened. The bar hides
 * https:// (and http://), so an address without a scheme is taken as https, or http for a local
 * address. An http-only site elsewhere is stored with the wrong scheme. Typed words are not an
 * address: they have spaces, or no dot in the host.
 */
export const addressBarOrigin = (
  raw: string
): Pick<ViewOrigin, "url" | "document"> => {
  const text = raw.trim();
  const none = { document: null, url: null };

  if (text === "" || /\s/u.test(text)) {
    return none;
  }

  if (text.toLowerCase().startsWith("file:")) {
    return { document: documentPath(text), url: null };
  }

  if (SCHEME.test(text) && !/^[^/]*:\d/u.test(text)) {
    return { document: null, url: webPage(text) };
  }

  let host: string;

  try {
    host = new URL(`http://${text}`).hostname;
  } catch {
    return none;
  }

  if (isLocal(host)) {
    return { document: null, url: webPage(`http://${text}`) };
  }

  return host.includes(".")
    ? { document: null, url: webPage(`https://${text}`) }
    : none;
};

const MAX_VALUE = 4000;

/**
 * UI Automation, from Windows PowerShell: the value of the first text field in each window, one
 * "handle<TAB>value" line each. It avoids Add-Type, New-Object and ConvertTo-Json, whose module
 * takes most of a second to load.
 */
const script = (hwnds: readonly number[]) => `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[void][Reflection.Assembly]::Load("UIAutomationClient, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31bf3856ad364e35")
[void][Reflection.Assembly]::Load("UIAutomationTypes, Version=4.0.0.0, Culture=neutral, PublicKeyToken=31bf3856ad364e35")
$A = [System.Windows.Automation.AutomationElement]
$edit = [System.Windows.Automation.PropertyCondition]::new($A::ControlTypeProperty, [System.Windows.Automation.ControlType]::Edit)
foreach ($h in @(${hwnds.join(",")})) {
  try {
    $field = $A::FromHandle([IntPtr][long]$h).FindFirst([System.Windows.Automation.TreeScope]::Descendants, $edit)
    $value = $null
    if ($field -and $field.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$value)) {
      [Console]::Out.WriteLine("$h\`t" + ($value.Current.Value -replace "[\\r\\n\\t]", " "))
    }
  } catch {}
}
exit 0
`;

const POWERSHELL = path.join(
  process.env["SystemRoot"] ?? "C:\\Windows",
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe"
);

/** The script's lines, for the windows that were asked about. */
export const parseAddressBars = (
  output: string,
  hwnds: readonly number[]
): ReadonlyMap<number, string> =>
  new Map(
    output.split(/\r?\n/u).flatMap((line) => {
      const tab = line.indexOf("\t");
      const hwnd = Number(line.slice(0, tab));
      const value = line.slice(tab + 1);

      return tab > 0 && hwnds.includes(hwnd) && value.length <= MAX_VALUE
        ? [[hwnd, value] as const]
        : [];
    })
  );

/**
 * Reads the address bar of each browser window, by window handle, so nothing depends on titles.
 * One PowerShell for all of them, about a second and a half. Empty when PowerShell is missing,
 * blocked or slow.
 */
const readAddressBars = async (
  hwnds: readonly number[]
): Promise<ReadonlyMap<number, string>> => {
  const valid = hwnds.filter((hwnd) => Number.isSafeInteger(hwnd));

  if (valid.length === 0) {
    return new Map();
  }

  try {
    const child = spawn(
      POWERSHELL,
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script(valid), "utf16le").toString("base64"),
      ],
      {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: TIMEOUT_MS,
        windowsHide: true,
      }
    );

    child.stdout.setEncoding("utf-8");

    let output = "";

    for await (const chunk of child.stdout) {
      output += String(chunk);
    }

    await once(child, "close");

    return parseAddressBars(output, valid);
  } catch {
    return new Map();
  }
};

export interface WindowsWindow {
  /** get-windows' id, which is the window handle. */
  hwnd: number;
  ownerPath: string | undefined;
  bounds: ViewOrigin["bounds"];
}

/**
 * Where each window came from on Windows: its app and, when readPages allows it, the page or
 * file a browser window showed. Files other apps had open are not known.
 */
export const windowsOrigins = async (
  windows: readonly WindowsWindow[],
  readPages: boolean
): Promise<(ViewOrigin | null)[]> => {
  const apps = windows.map((window) => windowsApp(window.ownerPath));

  const browsers = readPages
    ? windows.flatMap((window, index) => {
        const app = apps[index];

        return app !== null && app !== undefined && isBrowser(app)
          ? [window.hwnd]
          : [];
      })
    : [];

  const bars = await readAddressBars(browsers);

  return windows.map((window, index) => {
    const bar = bars.get(window.hwnd);

    const origin: ViewOrigin = {
      appPath: apps[index] ?? null,
      bounds: window.bounds,
      ...(bar === undefined
        ? { document: null, url: null }
        : addressBarOrigin(bar)),
    };

    return origin.appPath === null &&
      origin.document === null &&
      origin.url === null
      ? null
      : origin;
  });
};
