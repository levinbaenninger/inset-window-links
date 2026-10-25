import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";

import type { AppMenuActions } from "./app-menu";
import { appMenuTemplate } from "./app-menu";

const actions = (): AppMenuActions => ({
  addWindows: vi.fn<() => void>(),
  closeWindow: vi.fn<() => void>(),
  find: vi.fn<() => void>(),
  newCapture: vi.fn<() => void>(),
  openHelp: vi.fn<() => void>(),
  openRecent: vi.fn<() => void>(),
  openScreenSettings: vi.fn<() => void>(),
  openSettings: vi.fn<() => void>(),
  saveCapture: vi.fn<() => void>(),
  setFloatOnTop: vi.fn<(on: boolean) => void>(),
});

const items = (menu: MenuItemConstructorOptions[]) =>
  menu.flatMap((top) => (Array.isArray(top.submenu) ? top.submenu : []));

describe(appMenuTemplate, () => {
  const menu = appMenuTemplate(
    { floatOnTop: true, shortcut: "⌥⌘W" },
    actions()
  );

  it("has the menus of a Mac app", () => {
    expect(menu.map((top) => top.label ?? top.role)).toStrictEqual([
      "Inset Window Links",
      "File",
      "Edit",
      "View",
      "windowMenu",
      "help",
    ]);
  });

  it("keeps the Edit roles, so text fields still cut, copy, paste and undo", () => {
    const roles = items(menu).flatMap((item) => item.role ?? []);

    expect(roles).toStrictEqual(
      expect.arrayContaining([
        "undo",
        "redo",
        "cut",
        "copy",
        "paste",
        "selectAll",
        "quit",
      ])
    );
  });

  it("gives every shortcut to one item only", () => {
    const keys = items(menu).flatMap((item) => item.accelerator ?? []);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never takes the capture shortcut", () => {
    const keys = items(menu).flatMap((item) => item.accelerator ?? []);

    expect(keys).not.toContain("Alt+CommandOrControl+W");
  });

  it("shows the float setting and the capture shortcut", () => {
    const float = items(menu).find(
      (item) => item.label === "Keep Capture Panel on Top"
    );

    const taken = appMenuTemplate(
      { floatOnTop: false, shortcut: null },
      actions()
    );

    expect([
      float?.checked,
      items(menu).some((item) => item.label === "Add a Window: ⌥⌘W"),
      items(taken).some(
        (item) => item.label === "Capture shortcut is taken by another app"
      ),
    ]).toStrictEqual([true, true, true]);
  });
});
