import { describe, expect, it } from "vitest";

import { isAppShortcut } from "../../../shared/shortcuts";
import { menuKeyOf } from "../lib/menu-keys";
import type { RowKeyPress } from "./row-keys";
import { rowKey } from "./row-keys";

const press = (overrides: Partial<RowKeyPress>): RowKeyPress => ({
  altKey: false,
  code: "",
  ctrlKey: false,
  key: "",
  metaKey: false,
  repeat: false,
  shiftKey: false,
  ...overrides,
});

describe(rowKey, () => {
  it("reads the row menu's chords with ⌘ on a Mac", () => {
    expect(
      rowKey(press({ code: "KeyC", key: "c", metaKey: true }), "macos")
    ).toBe("copyEntry");
    expect(
      rowKey(
        press({ altKey: true, code: "KeyC", key: "c", metaKey: true }),
        "macos"
      )
    ).toBe("copyNote");
    expect(
      rowKey(press({ code: "KeyO", key: "o", metaKey: true }), "macos")
    ).toBe("reopen");
  });

  it("reads ⌥⌘C by the key when ⌥ types another character", () => {
    expect(
      rowKey(
        press({ altKey: true, code: "KeyC", key: "ç", metaKey: true }),
        "macos"
      )
    ).toBe("copyNote");
  });

  it("reads the same chords with Ctrl on Windows, and not with ⌘ there", () => {
    expect(
      rowKey(press({ code: "KeyC", ctrlKey: true, key: "c" }), "windows")
    ).toBe("copyEntry");
    expect(
      rowKey(
        press({ altKey: true, code: "KeyC", ctrlKey: true, key: "c" }),
        "windows"
      )
    ).toBe("copyNote");
    expect(
      rowKey(press({ code: "KeyC", key: "c", metaKey: true }), "windows")
    ).toBeNull();
    expect(
      rowKey(press({ code: "KeyC", ctrlKey: true, key: "c" }), "macos")
    ).toBeNull();
  });

  it("leaves chords with other modifiers alone", () => {
    expect(
      rowKey(
        press({ code: "KeyC", key: "C", metaKey: true, shiftKey: true }),
        "macos"
      )
    ).toBeNull();
    expect(
      rowKey(press({ code: "KeyV", key: "v", metaKey: true }), "macos")
    ).toBeNull();
  });

  it("takes Space for done and ⌫ or Delete for delete, only without modifiers", () => {
    expect(rowKey(press({ code: "Space", key: " " }), "macos")).toBe(
      "toggleDone"
    );
    expect(
      rowKey(press({ code: "Backspace", key: "Backspace" }), "macos")
    ).toBe("delete");
    expect(rowKey(press({ code: "Delete", key: "Delete" }), "windows")).toBe(
      "delete"
    );
    expect(
      rowKey(
        press({ code: "Backspace", key: "Backspace", metaKey: true }),
        "macos"
      )
    ).toBeNull();
    expect(
      rowKey(press({ code: "Space", key: " ", shiftKey: true }), "macos")
    ).toBeNull();
  });

  it("ignores Space and ⌫ held down, so one press acts on one row", () => {
    expect(
      rowKey(press({ code: "Space", key: " ", repeat: true }), "macos")
    ).toBeNull();
    expect(
      rowKey(
        press({ code: "Backspace", key: "Backspace", repeat: true }),
        "macos"
      )
    ).toBeNull();
  });

  it("ignores letters typed without ⌘", () => {
    expect(rowKey(press({ code: "KeyC", key: "c" }), "macos")).toBeNull();
  });
});

describe(menuKeyOf, () => {
  it("leaves Space and Return to the menu, which picks the highlighted item", () => {
    expect([
      menuKeyOf(press({ code: "Space", key: " " }), "macos"),
      menuKeyOf(press({ code: "Enter", key: "Enter" }), "macos"),
      menuKeyOf(press({ code: "Enter", key: "Enter" }), "windows"),
    ]).toStrictEqual([null, null, null]);
  });

  it("reads the keys a row menu shows: ⌘C, ⌥⌘C, ⌘O and ⌫", () => {
    expect([
      menuKeyOf(press({ code: "KeyC", key: "c", metaKey: true }), "macos"),
      menuKeyOf(
        press({ altKey: true, code: "KeyC", key: "ç", metaKey: true }),
        "macos"
      ),
      menuKeyOf(press({ code: "KeyO", ctrlKey: true, key: "o" }), "windows"),
      menuKeyOf(press({ code: "Backspace", key: "Backspace" }), "macos"),
    ]).toStrictEqual(["copyEntry", "copyNote", "reopen", "delete"]);
  });
});

describe(isAppShortcut, () => {
  it("counts every other app key, so an open menu can swallow it", () => {
    const mac = [
      press({ code: "KeyD", key: "D", metaKey: true, shiftKey: true }),
      press({ code: "KeyD", key: "d", metaKey: true }),
      press({ code: "KeyS", key: "S", metaKey: true, shiftKey: true }),
      press({ code: "KeyF", key: "f", metaKey: true }),
      press({ code: "Digit1", key: "1", metaKey: true }),
      press({ code: "Comma", key: ",", metaKey: true }),
      press({ code: "KeyS", ctrlKey: true, key: "s", metaKey: true }),
      // "/" is Shift+7 on a German keyboard.
      press({ code: "Digit7", key: "/", metaKey: true, shiftKey: true }),
    ];

    expect([
      ...mac.map((key) => isAppShortcut(key, "macos")),
      isAppShortcut(
        press({ code: "KeyB", ctrlKey: true, key: "b" }),
        "windows"
      ),
    ]).toStrictEqual([...mac.map(() => true), true]);
  });

  it("leaves menu navigation, typing and system keys alone", () => {
    const keys = [
      press({ code: "Space", key: " " }),
      press({ code: "Enter", key: "Enter" }),
      press({ code: "ArrowDown", key: "ArrowDown" }),
      press({ code: "KeyM", key: "m" }),
      press({ code: "KeyQ", key: "q", metaKey: true }),
      press({ code: "KeyD", ctrlKey: true, key: "d" }),
    ];

    expect(keys.map((key) => isAppShortcut(key, "macos"))).toStrictEqual(
      keys.map(() => false)
    );
  });
});
