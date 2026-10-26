import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  addressBarOrigin,
  isBrowser,
  parseAddressBars,
  windowsApp,
} from "./windows-origin";

describe(windowsApp, () => {
  it("keeps an absolute path to an .exe", () => {
    expect(
      windowsApp("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe")
    ).toBe("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
  });

  it("drops what cannot be started by path", () => {
    expect([
      windowsApp(null),
      windowsApp("chrome.exe"),
      windowsApp("C:\\Tools\\run.bat"),
      windowsApp("/Applications/Safari.app"),
      windowsApp(
        "C:\\Program Files\\WindowsApps\\Microsoft.WindowsCalculator_11.0_x64\\CalculatorApp.exe"
      ),
      windowsApp("C:\\Windows\\System32\\ApplicationFrameHost.exe"),
      windowsApp(`C:\\${"a".repeat(1100)}.exe`),
    ]).toStrictEqual(Array.from({ length: 7 }, () => null));
  });
});

describe(isBrowser, () => {
  it("knows browsers by their exe, in any case", () => {
    expect([
      isBrowser("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"),
      isBrowser(
        "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\MSEDGE.EXE"
      ),
      isBrowser("C:\\Windows\\System32\\notepad.exe"),
    ]).toStrictEqual([true, true, false]);
  });
});

describe(addressBarOrigin, () => {
  it("takes an address without a scheme as https", () => {
    expect(addressBarOrigin("example.com/docs?x=1#frag")).toStrictEqual({
      document: null,
      url: "https://example.com/docs?x=1#frag",
    });
  });

  it("takes a local address as http, port included", () => {
    expect([
      addressBarOrigin("127.0.0.1:47813/some/path?q=1").url,
      addressBarOrigin("localhost:3000/").url,
    ]).toStrictEqual([
      "http://127.0.0.1:47813/some/path?q=1",
      "http://localhost:3000/",
    ]);
  });

  it("keeps a scheme the bar shows, and a port on a named host", () => {
    expect([
      addressBarOrigin("http://intranet.example/wiki").url,
      addressBarOrigin("example.com:8443/admin").url,
    ]).toStrictEqual([
      "http://intranet.example/wiki",
      "https://example.com:8443/admin",
    ]);
  });

  it("reads a file the browser opened as a file", () => {
    expect(addressBarOrigin("file:///C:/Docs/plan.pdf")).toStrictEqual({
      document: fileURLToPath("file:///C:/Docs/plan.pdf"),
      url: null,
    });
  });

  it("ignores typed words, browser pages and other schemes", () => {
    expect([
      addressBarOrigin(""),
      addressBarOrigin("budget cap"),
      addressBarOrigin("hello"),
      addressBarOrigin("chrome://newtab"),
      addressBarOrigin("mailto:someone@example.com"),
    ]).toStrictEqual(
      Array.from({ length: 5 }, () => ({ document: null, url: null }))
    );
  });
});

describe(parseAddressBars, () => {
  it("reads one window per line, only for the windows asked about", () => {
    const output =
      "8915194\texample.com/a\r\n-3\tlocalhost:3000/\r\n77\tnot asked\r\nno tab here\r\n";

    expect([...parseAddressBars(output, [8_915_194, -3])]).toStrictEqual([
      [8_915_194, "example.com/a"],
      [-3, "localhost:3000/"],
    ]);
  });
});
