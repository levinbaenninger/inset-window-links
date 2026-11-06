import { describe, expect, it } from "vitest";

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
