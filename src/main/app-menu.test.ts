import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";

import type { AppMenuActions, KeyPress } from "./app-menu";
import { appMenuTemplate, keyAction } from "./app-menu";

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

/** A key press as before-input-event reports it, from an accelerator such as "Shift+CommandOrControl+N". */
const pressFor = (accelerator: string): KeyPress => {
  const parts = accelerator.split("+");

  return {
    alt: parts.includes("Alt"),
    control: parts.includes("CommandOrControl"),
    isAutoRepeat: false,
    key: parts.at(-1) ?? "",
    meta: false,
    shift: parts.includes("Shift"),
    type: "keyDown",
  };
};

describe(keyAction, () => {
  it("answers every menu key on Windows with the item's own action", () => {
    const all = actions();

    const answered = items(
      appMenuTemplate({ floatOnTop: true, shortcut: null }, all)
    )
      .flatMap((item) =>
        item.accelerator === undefined
          ? []
          : [[item, item.accelerator] as const]
      )
      .map(([item, accelerator]) => {
        const action = keyAction(pressFor(accelerator));

        return action !== null && all[action] === item.click;
      });

    expect(answered).not.toContain(false);
    expect(answered.length).toBeGreaterThan(6);
  });

  it("reads Ctrl+Shift+N as Add Windows, whatever the letter's case", () => {
    expect([
      keyAction({ ...pressFor("Shift+CommandOrControl+N"), key: "N" }),
      keyAction({ ...pressFor("CommandOrControl+N"), key: "n" }),
    ]).toStrictEqual(["addWindows", "newCapture"]);
  });

  it("leaves editing keys, AltGr, repeats and key-ups to the page", () => {
    expect([
      keyAction(pressFor("CommandOrControl+A")),
      keyAction(pressFor("CommandOrControl+C")),
      keyAction(pressFor("CommandOrControl+V")),
      keyAction(pressFor("CommandOrControl+Z")),
      keyAction(pressFor("CommandOrControl+Enter")),
      keyAction(pressFor("Alt+CommandOrControl+W")),
      keyAction({ ...pressFor("CommandOrControl+N"), isAutoRepeat: true }),
      keyAction({ ...pressFor("CommandOrControl+N"), type: "keyUp" }),
      keyAction({ ...pressFor("CommandOrControl+N"), control: false }),
    ]).toStrictEqual(Array.from({ length: 9 }, () => null));
  });
});
