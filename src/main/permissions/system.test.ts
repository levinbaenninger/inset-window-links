import { describe, expect, it } from "vitest";

import { appBundlePath, bundleDisplayName, createAppTile } from "./bundle";
import { fakeMac } from "./fakes";
import {
  createPermissionChecks,
  listName,
  PANE_RETRY_MS,
  PANE_URLS,
} from "./system";

const ignore = (): void => undefined;

describe(createPermissionChecks, () => {
  it("reads Accessibility live and Screen Recording as it was at launch", () => {
    const mac = fakeMac();
    const checks = createPermissionChecks(mac.system);

    mac.grant("accessibility");
    mac.grant("screen");

    expect(checks.granted("accessibility")).toBeTruthy();
    expect(checks.granted("screen")).toBeFalsy();

    mac.relaunched();

    expect(checks.granted("screen")).toBeTruthy();
  });

  it("asks Accessibility through the system prompt", () => {
    const mac = fakeMac();

    createPermissionChecks(mac.system).prompt("accessibility");

    expect(mac.calls).toStrictEqual(["prompt accessibility"]);
  });

  it("asks Screen Recording with one tiny picture of a screen", () => {
    const mac = fakeMac();

    createPermissionChecks(mac.system).prompt("screen");

    expect(mac.calls).toStrictEqual(["getSources screen 1x1"]);
  });

  it("opens the exact pane, and once more for a System Settings that started cold", () => {
    const mac = fakeMac();

    createPermissionChecks(mac.system).openPane("screen");

    expect(mac.calls).toStrictEqual([`open ${PANE_URLS.screen}`]);

    mac.clock.advance(PANE_RETRY_MS);

    expect(mac.calls).toStrictEqual([
      `open ${PANE_URLS.screen}`,
      `open ${PANE_URLS.screen}`,
    ]);
    expect(PANE_URLS).toStrictEqual({
      accessibility:
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
      screen:
        "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
    });
  });

  it("needs nothing and asks nothing off macOS", () => {
    const mac = fakeMac({}, { platform: "win32" });
    const checks = createPermissionChecks(mac.system);

    checks.prompt("accessibility");
    checks.prompt("screen");
    checks.openPane("accessibility");

    expect(checks.granted("accessibility")).toBeTruthy();
    expect(checks.granted("screen")).toBeTruthy();
    expect(mac.calls).toStrictEqual([]);
  });
});

describe(listName, () => {
  it("names the lists as System Settings does, with macOS 27's new Accessibility name", () => {
    expect(listName("accessibility", 26)).toBe("Accessibility");
    expect(listName("accessibility", 27)).toBe(
      "Device Control and Data Access"
    );
    expect(listName("screen", 26)).toBe("Screen & System Audio Recording");
  });
});

describe(appBundlePath, () => {
  const exe = "/Applications/Inset Shelf.app/Contents/MacOS/Inset Shelf";

  it("walks up from the executable to the app bundle", () => {
    expect(appBundlePath(exe, { packaged: true })).toBe(
      "/Applications/Inset Shelf.app"
    );
    expect(bundleDisplayName("/Applications/Inset Shelf.app")).toBe(
      "Inset Shelf"
    );
  });

  it("finds the bundle of a helper's own executable", () => {
    expect(
      appBundlePath(
        "/Users/me/Apps/Inset Shelf.app/Contents/Frameworks/Inset Shelf Helper.app/Contents/MacOS/Inset Shelf Helper",
        { packaged: true }
      )
    ).toBe(
      "/Users/me/Apps/Inset Shelf.app/Contents/Frameworks/Inset Shelf Helper.app"
    );
  });

  it("offers nothing to drag in development, outside a bundle, for Electron's own bundle or a translocated copy", () => {
    expect(appBundlePath(exe, { packaged: false })).toBeNull();
    expect(
      appBundlePath("/usr/local/bin/inset-shelf", { packaged: true })
    ).toBeNull();
    expect(
      appBundlePath(
        "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
        { packaged: true }
      )
    ).toBeNull();
    expect(
      appBundlePath(
        "/private/var/folders/x/AppTranslocation/1234/d/Inset Shelf.app/Contents/MacOS/Inset Shelf",
        { packaged: true }
      )
    ).toBeNull();
  });
});

const icon = (empty = false) => ({
  isEmpty: () => empty,
  toDataURL: () => "data:image/png;base64,AAAA",
});

describe(createAppTile, () => {
  it("shows the tile once the icon is read, and drags the bundle with it", async () => {
    const drags: string[] = [];

    const tile = createAppTile({
      bundlePath: "/Applications/Inset Shelf.app",
      loadIcon: async () => await Promise.resolve(icon()),
      startDrag: ({ file }) => {
        drags.push(file);
      },
    });

    tile.drag();

    expect(tile.view()).toBeNull();
    expect(drags).toStrictEqual([]);

    await tile.load();
    tile.drag();

    expect(tile.view()).toStrictEqual({
      icon: "data:image/png;base64,AAAA",
      name: "Inset Shelf",
    });
    expect(drags).toStrictEqual(["/Applications/Inset Shelf.app"]);
  });

  it("has no tile without a bundle or an icon", async () => {
    const none = createAppTile({
      bundlePath: null,
      loadIcon: async () => await Promise.resolve(icon()),
      startDrag: ignore,
    });

    const blank = createAppTile({
      bundlePath: "/Applications/Inset Shelf.app",
      loadIcon: async () => await Promise.resolve(icon(true)),
      startDrag: ignore,
    });

    await none.load();
    await blank.load();

    expect(none.view()).toBeNull();
    expect(blank.view()).toBeNull();
  });
});
