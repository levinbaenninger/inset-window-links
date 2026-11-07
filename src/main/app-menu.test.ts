import type { MenuItemConstructorOptions } from "electron";
import { describe, expect, it, vi } from "vitest";

import type { MenuKeyId } from "../shared/shortcuts";
import {
  acceleratorFor,
  keyLabel,
  MENU_KEYS,
  SHEET,
} from "../shared/shortcuts";
import type { AppMenuActions, KeyPress } from "./app-menu";
import { appMenuTemplate, keyAction } from "./app-menu";

const actions = (): AppMenuActions => ({
  addWindows: vi.fn<() => void>(),
  checkForUpdates: vi.fn<() => void>(),
  closeWindow: vi.fn<() => void>(),
  copyNote: vi.fn<() => void>(),
  find: vi.fn<() => void>(),
  focusDescription: vi.fn<() => void>(),
  focusSteps: vi.fn<() => void>(),
  newCapture: vi.fn<() => void>(),
  openHelp: vi.fn<() => void>(),
  openRecent: vi.fn<() => void>(),
  openScreenSettings: vi.fn<() => void>(),
  openSettings: vi.fn<() => void>(),
  reopen: vi.fn<() => void>(),
  restartToUpdate: vi.fn<() => void>(),
  saveCapture: vi.fn<() => void>(),
  setDue: vi.fn<() => void>(),
  setFloatOnTop: vi.fn<(on: boolean) => void>(),
  showShortcuts: vi.fn<() => void>(),
  toggleDone: vi.fn<() => void>(),
  toggleSidebar: vi.fn<() => void>(),
});

const items = (menu: MenuItemConstructorOptions[]) =>
  menu.flatMap((top) => (Array.isArray(top.submenu) ? top.submenu : []));

describe(appMenuTemplate, () => {
  const menu = appMenuTemplate(
    {
      captureOpen: true,
      floatOnTop: true,
      shortcut: "⌥⌘W",
      update: { kind: "upToDate" },
    },
    actions()
  );

  it("has the menus of a Mac app", () => {
    expect(menu.map((top) => top.label ?? top.role)).toStrictEqual([
      "Inset Window Links",
      "File",
      "Edit",
      "Capture",
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
      {
        captureOpen: true,
        floatOnTop: false,
        shortcut: null,
        update: { kind: "off" },
      },
      actions()
    );

    expect([
      float?.checked,
      items(menu).some((item) => item.label === "Add a Window: ⌥⌘W"),
      items(taken).some(
        (item) => item.label === "Capture Shortcut Is Taken by Another App"
      ),
    ]).toStrictEqual([true, true, true]);
  });
});

/** Each Capture menu item's label and whether it is enabled. */
const captureItems = (captureOpen: boolean) => {
  const capture = appMenuTemplate(
    { captureOpen, floatOnTop: true, shortcut: null, update: { kind: "off" } },
    actions()
  ).find((top) => top.label === "Capture");

  return Object.fromEntries(
    (Array.isArray(capture?.submenu) ? capture.submenu : [])
      .filter((item) => item.label !== undefined)
      .map((item) => [item.label, item.enabled])
  );
};

describe("the Capture menu", () => {
  it("greys out what acts on an open capture while Recent Captures shows none", () => {
    expect([captureItems(false), captureItems(true)]).toStrictEqual([
      {
        "Copy as Text": false,
        Description: true,
        "Due…": true,
        "Mark as Done": false,
        "Next Steps": true,
        "Reopen Windows": false,
      },
      {
        "Copy as Text": true,
        Description: true,
        "Due…": true,
        "Mark as Done": true,
        "Next Steps": true,
        "Reopen Windows": true,
      },
    ]);
  });
});

describe("the app menu's update items", () => {
  it("sit under About, with the restart once an update is ready", () => {
    const [appItems] = appMenuTemplate(
      {
        captureOpen: true,
        floatOnTop: true,
        shortcut: null,
        update: { kind: "ready", version: "0.1.901" },
      },
      actions()
    );

    expect(
      (Array.isArray(appItems?.submenu) ? appItems.submenu : [])
        .slice(0, 4)
        .map((item) => item.label ?? item.type)
    ).toStrictEqual([
      "About Inset Window Links",
      "Restart to Update to v0.1.901",
      "Check for Updates…",
      "separator",
    ]);
  });
});

/** A key press as before-input-event reports it, from an accelerator such as "Shift+CommandOrControl+N". */
const pressFor = (accelerator: string): KeyPress => {
  const parts = accelerator.split("+");
  const key = parts.at(-1) ?? "";

  const press: KeyPress = {
    alt: parts.includes("Alt"),
    control: parts.includes("CommandOrControl") || parts.includes("Control"),
    isAutoRepeat: false,
    key,
    meta: false,
    shift: parts.includes("Shift"),
    type: "keyDown",
  };

  if (/^[A-Z]$/u.test(key)) {
    press.code = `Key${key}`;
  }

  return press;
};

// SAFETY: Object.keys of the key table lists exactly its ids.
const ids = Object.keys(MENU_KEYS) as MenuKeyId[];

describe(keyAction, () => {
  it("answers every menu key on Windows with the item's own action", () => {
    const all = actions();

    const answered = items(
      appMenuTemplate(
        {
          captureOpen: true,
          floatOnTop: true,
          shortcut: null,
          update: { kind: "off" },
        },
        all
      )
    )
      .flatMap((item) =>
        item.accelerator === undefined
          ? []
          : [[item, item.accelerator] as const]
      )
      .map(([item, accelerator]) => {
        const key = Object.values(MENU_KEYS).find(
          (entry) => entry.accelerator === accelerator
        );

        const action =
          key === undefined
            ? null
            : keyAction(pressFor(acceleratorFor(key, "windows")));

        return action !== null && all[action] === item.click;
      });

    expect(answered).not.toContain(false);
    expect(answered.length).toBeGreaterThan(14);
  });

  it("puts every key of the table in a menu", () => {
    const menu = appMenuTemplate(
      {
        captureOpen: true,
        floatOnTop: true,
        shortcut: null,
        update: { kind: "off" },
      },
      actions()
    );

    const shown = new Set(
      items(menu).flatMap((item) => item.accelerator ?? [])
    );

    expect(
      ids.filter((id) => !shown.has(MENU_KEYS[id].accelerator))
    ).toStrictEqual([]);
  });

  it("reads Ctrl+Shift+N as Add Windows, whatever the letter's case", () => {
    expect([
      keyAction({ ...pressFor("Shift+CommandOrControl+N"), key: "N" }),
      keyAction({ ...pressFor("Shift+CommandOrControl+N"), key: "n" }),
      keyAction({ ...pressFor("CommandOrControl+N"), key: "n" }),
    ]).toStrictEqual(["addWindows", "addWindows", "newCapture"]);
  });

  it("reads Ctrl+Shift+N on a layout that types another letter there, by the physical key", () => {
    expect([
      // Russian: the N key types Т.
      keyAction({
        ...pressFor("Shift+CommandOrControl+N"),
        code: "KeyN",
        key: "Т",
      }),
      // Greek: the N key types ν.
      keyAction({ ...pressFor("CommandOrControl+N"), code: "KeyN", key: "ν" }),
    ]).toStrictEqual(["addWindows", "newCapture"]);
  });

  it("keeps the typed letter first, so Dvorak's N is the key marked N", () => {
    expect(
      keyAction({ ...pressFor("CommandOrControl+N"), code: "KeyL", key: "n" })
    ).toBe("newCapture");
  });

  it("reads Ctrl+1 and Ctrl+2 on AZERTY, where those keys type & and é", () => {
    expect([
      keyAction({
        ...pressFor("CommandOrControl+1"),
        code: "Digit1",
        key: "&",
      }),
      keyAction({
        ...pressFor("CommandOrControl+2"),
        code: "Digit2",
        key: "é",
      }),
    ]).toStrictEqual(["newCapture", "openRecent"]);
  });

  it("reads Ctrl+/ also where / needs Shift, as on German keyboards", () => {
    expect([
      keyAction(pressFor("CommandOrControl+/")),
      keyAction({
        ...pressFor("Shift+CommandOrControl+/"),
        code: "Digit7",
      }),
    ]).toStrictEqual(["showShortcuts", "showShortcuts"]);
  });

  it("answers the field keys and the sidebar key on Windows", () => {
    expect([
      keyAction(pressFor("CommandOrControl+D")),
      keyAction(pressFor("Shift+CommandOrControl+D")),
      keyAction(pressFor("Shift+CommandOrControl+S")),
      keyAction(pressFor("CommandOrControl+S")),
      keyAction(pressFor("Control+B")),
    ]).toStrictEqual([
      "focusDescription",
      "setDue",
      "focusSteps",
      "saveCapture",
      "toggleSidebar",
    ]);
  });

  it("reads Ctrl+Alt+C as Copy as Text only when the key types C, so AltGr letters still type", () => {
    expect([
      keyAction(pressFor("Alt+CommandOrControl+C")),
      keyAction({ ...pressFor("Alt+CommandOrControl+C"), key: "C" }),
      // Polish: AltGr+C types ć.
      keyAction({ ...pressFor("Alt+CommandOrControl+C"), key: "ć" }),
      // Czech: AltGr+C types &.
      keyAction({ ...pressFor("Alt+CommandOrControl+C"), key: "&" }),
      keyAction({ ...pressFor("Alt+CommandOrControl+N"), key: "n" }),
    ]).toStrictEqual(["copyNote", "copyNote", null, null, null]);
  });

  it("leaves editing keys, the capture shortcut, repeats and key-ups to the page", () => {
    expect([
      keyAction(pressFor("CommandOrControl+A")),
      keyAction(pressFor("CommandOrControl+C")),
      keyAction(pressFor("CommandOrControl+V")),
      keyAction(pressFor("CommandOrControl+Z")),
      keyAction(pressFor("CommandOrControl+K")),
      keyAction(pressFor("CommandOrControl+Enter")),
      keyAction(pressFor("Alt+CommandOrControl+W")),
      keyAction({ ...pressFor("CommandOrControl+N"), isAutoRepeat: true }),
      keyAction({ ...pressFor("CommandOrControl+N"), type: "keyUp" }),
      keyAction({ ...pressFor("CommandOrControl+N"), control: false }),
      keyAction({ ...pressFor("CommandOrControl+N"), meta: true }),
    ]).toStrictEqual(Array.from({ length: 11 }, () => null));
  });
});

describe("the key table", () => {
  it("gives each key to one action on each platform", () => {
    const per = (platform: "macos" | "windows") =>
      ids.map((id) => acceleratorFor(MENU_KEYS[id], platform));

    expect([
      new Set(per("macos")).size,
      new Set(per("windows")).size,
    ]).toStrictEqual([ids.length, ids.length]);
  });

  it("never takes a capture shortcut of the three Inset apps", () => {
    const taken = new Set([
      "Alt+CommandOrControl+P",
      "Alt+CommandOrControl+W",
      "Control+Alt+S",
      "Alt+Control+S",
    ]);

    expect(
      ids
        .flatMap((id) =>
          (["macos", "windows"] as const).map((platform) =>
            acceleratorFor(MENU_KEYS[id], platform)
          )
        )
        .filter((accelerator) => taken.has(accelerator))
    ).toStrictEqual([]);
  });

  it("lists the sections in the order every Inset app uses", () => {
    expect(SHEET.map((group) => group.title)).toStrictEqual([
      "Capture",
      "Navigate",
      "Edit",
      "Fields",
      "Window",
    ]);
  });

  it("lists every menu key in the Keyboard Shortcuts sheet", () => {
    const listed = new Set(
      SHEET.flatMap((group) =>
        group.rows.flatMap((row) =>
          row.keys.flatMap((keys) => (keys.kind === "menu" ? [keys.id] : []))
        )
      )
    );

    expect(ids.filter((id) => !listed.has(id))).toStrictEqual([]);
  });

  it("prints keys the way each platform writes them", () => {
    expect([
      keyLabel("Shift+CommandOrControl+N", "macos"),
      keyLabel("Shift+CommandOrControl+N", "windows"),
      keyLabel("Control+Command+S", "macos"),
      keyLabel("Control+B", "windows"),
      keyLabel("CommandOrControl+/", "windows"),
      keyLabel("CommandOrControl+Enter", "macos"),
      keyLabel("Alt+CommandOrControl+C", "macos"),
      keyLabel("Alt+CommandOrControl+C", "windows"),
    ]).toStrictEqual([
      "⇧⌘N",
      "Ctrl+Shift+N",
      "⌃⌘S",
      "Ctrl+B",
      "Ctrl+/",
      "⌘↵",
      "⌥⌘C",
      "Ctrl+Alt+C",
    ]);
  });
});
