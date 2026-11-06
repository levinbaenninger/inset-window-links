import { describe, expect, it, vi } from "vitest";

import type { KeyAction, KeyPress } from "./app-menu";
import type { KeyEvent, KeySource, KeyTarget } from "./menu-keys";
import { wireMenuKeys } from "./menu-keys";
import type { MenuPage, MenuWindow } from "./menu-open";
import { OpenMenus } from "./menu-open";

type Listener = (event: KeyEvent, input: KeyPress) => void;

/** Ctrl+N, as Windows reports it. */
const PRESS: KeyPress = {
  alt: false,
  control: true,
  isAutoRepeat: false,
  key: "n",
  meta: false,
  shift: false,
  type: "keyDown",
};

const NO_EVENT: KeyEvent = { preventDefault: () => {} };

/** A page that records its listeners, as a WebContents would hold them. */
class FakeContents implements KeyTarget, MenuPage {
  /** The key listeners. */
  readonly listeners: Listener[] = [];
  readonly others = new Map<string, Listener[]>();
  ignoresMenuShortcuts = false;
  destroyed = false;

  on(event: string, listener: Listener): this {
    if (event === "before-input-event") {
      this.listeners.push(listener);
    } else {
      this.others.set(event, [...(this.others.get(event) ?? []), listener]);
    }

    return this;
  }

  /** Fires a page event such as did-navigate. */
  emit(event: string): void {
    for (const listener of this.others.get(event) ?? []) {
      listener(NO_EVENT, PRESS);
    }
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  setIgnoreMenuShortcuts(ignore: boolean): void {
    this.ignoresMenuShortcuts = ignore;
  }

  /** Sends a key press; true when a listener kept it from the page. */
  press(input: Partial<KeyPress>): boolean {
    const event = { prevented: false, preventDefault: () => {} };

    event.preventDefault = () => {
      event.prevented = true;
    };

    const full: KeyPress = { ...PRESS, ...input };

    for (const listener of this.listeners) {
      listener(event, full);
    }

    return event.prevented;
  }
}

/** Electron's app, as far as announcing a new page goes. */
const fakeApp = () => {
  let created: ((event: KeyEvent, contents: FakeContents) => void) | null =
    null;

  const source: KeySource<FakeContents> = {
    on: (_event, listener) => {
      created = listener;
    },
  };

  return {
    create: (contents: FakeContents) =>
      created?.({ preventDefault: () => {} }, contents),
    source,
  };
};

describe(wireMenuKeys, () => {
  it("answers Ctrl+Shift+N in pages made before and after it ran", () => {
    const app = fakeApp();
    const before = new FakeContents();
    const after = new FakeContents();
    const run = vi.fn<(action: KeyAction) => void>();

    wireMenuKeys(
      app.source,
      [before],
      () => run,
      () => false
    );
    app.create(after);

    expect([
      before.press({ key: "N", shift: true }),
      after.press({ key: "N", shift: true }),
      run.mock.calls,
    ]).toStrictEqual([true, true, [["addWindows"], ["addWindows"]]]);
  });

  it("wires a page once, however often it is seen", () => {
    const app = fakeApp();
    const contents = new FakeContents();
    const run = vi.fn<(action: KeyAction) => void>();

    wireMenuKeys(
      app.source,
      [contents, contents],
      () => run,
      () => false
    );
    app.create(contents);
    contents.press({});

    expect([contents.listeners.length, run.mock.calls.length]).toStrictEqual([
      1, 1,
    ]);
  });

  it("lets keys through to the page until the actions exist, and always for other keys", () => {
    const app = fakeApp();
    const contents = new FakeContents();
    let run: ((action: KeyAction) => void) | null = null;

    wireMenuKeys(
      app.source,
      [contents],
      () => run,
      () => false
    );

    const early = contents.press({});

    run = vi.fn<(action: KeyAction) => void>();

    expect([
      early,
      contents.press({ key: "a" }),
      contents.press({}),
    ]).toStrictEqual([false, false, true]);
  });
});

/** A page's window, which can lose focus. */
const fakeWindow = () => {
  const blurs: (() => void)[] = [];

  const window: MenuWindow = {
    on: (_event, listener) => {
      blurs.push(listener);
    },
  };

  return {
    blur: () => {
      for (const listener of blurs) {
        listener();
      }
    },
    blurs,
    window,
  };
};

/** Main's app keys on Windows, as each would act on the app behind a menu. */
const APP_KEYS: readonly Partial<KeyPress>[] = [
  { key: "n" },
  { key: "N", shift: true },
  { key: "w" },
  { key: "1" },
  { key: "2" },
  { key: "," },
  { alt: true, key: "c" },
  { key: "o" },
  { key: "d", shift: true },
];

/** A page with the Windows key handling and the open-menu flag, as main wires them. */
const menuSetup = () => {
  const app = fakeApp();
  const page = new FakeContents();
  const window = fakeWindow();
  const menus = new OpenMenus<FakeContents>(() => window.window);
  const run = vi.fn<(action: KeyAction) => void>();

  wireMenuKeys(
    app.source,
    [page],
    () => run,
    (contents) => menus.isOpen(contents)
  );

  /** Which keys main kept from the page, and which actions it ran. */
  const pressAll = () => ({
    kept: APP_KEYS.map((key) => page.press(key)),
    ran: run.mock.calls.splice(0).map(([action]) => action),
  });

  return { menus, page, pressAll, window };
};

describe("main's keys while a page holds a menu open", () => {
  it("runs no app key and leaves every one to the page's menu, until the menu closes", () => {
    const { menus, page, pressAll } = menuSetup();

    menus.set(page, true);

    const held = { ...pressAll(), ignoring: page.ignoresMenuShortcuts };

    menus.set(page, false);

    expect({
      after: { ...pressAll(), ignoring: page.ignoresMenuShortcuts },
      held,
    }).toStrictEqual({
      after: {
        ignoring: false,
        kept: APP_KEYS.map(() => true),
        ran: [
          "newCapture",
          "addWindows",
          "closeWindow",
          "newCapture",
          "openRecent",
          "openSettings",
          "copyNote",
          "reopen",
          "setDue",
        ],
      },
      held: { ignoring: true, kept: APP_KEYS.map(() => false), ran: [] },
    });
  });

  it("forgets the menu when the window loses focus, so the keys work again", () => {
    const { menus, page, pressAll, window } = menuSetup();

    menus.set(page, true);
    window.blur();

    expect([
      menus.isOpen(page),
      page.ignoresMenuShortcuts,
      pressAll().ran.length,
    ]).toStrictEqual([false, false, APP_KEYS.length]);
  });

  it("forgets the menu when the page navigates, reloads or crashes", () => {
    const { menus, page } = menuSetup();

    const cleared = [
      "did-navigate",
      "did-start-loading",
      "render-process-gone",
    ].map((event) => {
      menus.set(page, true);
      page.emit(event);

      return menus.isOpen(page);
    });

    expect(cleared).toStrictEqual([false, false, false]);
  });

  it("forgets a closed page without touching it", () => {
    const { menus, page } = menuSetup();

    menus.set(page, true);
    page.destroyed = true;
    page.emit("destroyed");
    // A late message from the closing page.
    menus.set(page, true);

    expect([menus.isOpen(page), page.ignoresMenuShortcuts]).toStrictEqual([
      false,
      true,
    ]);
  });

  it("watches each page once, however often its menus open", () => {
    const { menus, page, window } = menuSetup();

    menus.set(page, true);
    menus.set(page, false);
    menus.set(page, true);

    expect([
      window.blurs.length,
      page.others.get("did-navigate")?.length,
    ]).toStrictEqual([1, 1]);
  });
});
