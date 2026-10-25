import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

import { systemPreferences } from "electron";
import { z } from "zod";

import type { ViewOrigin } from "../store/schema";

/**
 * Reads the file (AXDocument) and the web page (the first AXWebArea's AXURL) a window shows,
 * from its app's accessibility tree. The window is the one with the given title, else the
 * app's focused window. Runs as JavaScript for Automation, so no helper binary ships; it
 * needs Accessibility, and is never run without it.
 */
const SCRIPT = `
ObjC.import("AppKit");
ObjC.bindFunction("AXUIElementCreateApplication", ["id", ["int"]]);
ObjC.bindFunction("AXUIElementCopyAttributeValue", ["int", ["id", "id", "id *"]]);
function run(argv) {
  var root = $.AXUIElementCreateApplication(Number(argv[0]));
  var wanted = argv[1] || "";
  function attr(element, name) {
    var out = Ref();
    return $.AXUIElementCopyAttributeValue(element, $(name), out) === 0 ? out[0] : null;
  }
  function text(value) {
    if (!value) return "";
    var unwrapped = ObjC.unwrap(value);
    return typeof unwrapped === "string" ? unwrapped : String(ObjC.unwrap(value.absoluteString) || "");
  }
  var window = null;
  var windows = attr(root, "AXWindows");
  var count = windows ? windows.count : 0;
  for (var i = 0; i < count && wanted !== ""; i++) {
    if (text(attr(windows.objectAtIndex(i), "AXTitle")) === wanted) {
      window = windows.objectAtIndex(i);
      break;
    }
  }
  if (!window) window = attr(root, "AXFocusedWindow");
  if (!window) return JSON.stringify({ document: "", url: "" });
  var document = text(attr(window, "AXDocument"));
  var url = "";
  var queue = document === "" ? [window] : [];
  for (var seen = 0; queue.length > 0 && seen < 3000 && url === ""; seen++) {
    var element = queue.shift();
    if (text(attr(element, "AXRole")) === "AXWebArea") {
      url = text(attr(element, "AXURL"));
    }
    var children = attr(element, "AXChildren");
    var n = children ? children.count : 0;
    for (var j = 0; j < n; j++) queue.push(children.objectAtIndex(j));
  }
  return JSON.stringify({ document: document, url: url });
}
`;

const TIMEOUT_MS = 1500;

const AnswerSchema = z.object({
  document: z.string().max(4000),
  url: z.string().max(4000),
});

const MAX_URL = 2000;
const MAX_PATH = 1024;

/** Only http and https pages are kept, so nothing else can be opened again later. */
export const webPage = (raw: string | undefined): string | null => {
  if (raw === undefined || raw.length > MAX_URL) {
    return null;
  }

  try {
    const url = new URL(raw.trim());

    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
};

/** A file URL from AXDocument, as a path. Anything else is dropped. */
export const documentPath = (raw: string): string | null => {
  if (!raw.startsWith("file://")) {
    return null;
  }

  try {
    const file = fileURLToPath(raw);

    return file.length <= MAX_PATH ? file : null;
  } catch {
    return null;
  }
};

/** The app bundle a process runs from, so a nested helper still reopens the app. macOS only. */
export const appBundle = (raw: string | undefined): string | null => {
  if (raw === undefined || raw === "" || raw.length > MAX_PATH) {
    return null;
  }

  const end = raw.indexOf(".app");

  return end === -1 ? null : raw.slice(0, end + ".app".length);
};

/** Whether pages and documents can be read. Never prompts. */
export const canReadOrigins = (): boolean =>
  process.platform === "darwin" &&
  systemPreferences.isTrustedAccessibilityClient(false);

const ask = async (
  pid: number,
  title: string | null
): Promise<z.infer<typeof AnswerSchema> | null> => {
  try {
    const child = spawn(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", SCRIPT, String(pid), title ?? ""],
      { stdio: ["ignore", "pipe", "ignore"], timeout: TIMEOUT_MS }
    );

    child.stdout.setEncoding("utf-8");

    let output = "";

    for await (const chunk of child.stdout) {
      output += String(chunk);
    }

    await once(child, "close");

    if (child.exitCode !== 0) {
      return null;
    }

    const parsed = AnswerSchema.safeParse(JSON.parse(output.trim()));

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/**
 * Where a captured window came from: its app, and the page or file it showed when
 * Accessibility allows reading them. knownUrl is a browser address get-windows already read.
 */
export const readOrigin = async (window: {
  pid: number;
  ownerPath: string | undefined;
  title: string | null;
  knownUrl?: string | undefined;
}): Promise<ViewOrigin | null> => {
  if (process.platform !== "darwin") {
    return null;
  }

  const appPath = appBundle(window.ownerPath);
  const known = webPage(window.knownUrl);

  const answer =
    canReadOrigins() && known === null
      ? await ask(window.pid, window.title)
      : null;

  const origin: ViewOrigin = {
    appPath,
    document: answer === null ? null : documentPath(answer.document),
    url: known ?? (answer === null ? null : webPage(answer.url)),
  };

  return origin.appPath === null &&
    origin.document === null &&
    origin.url === null
    ? null
    : origin;
};
