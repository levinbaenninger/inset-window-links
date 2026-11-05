import { describe, expect, it, vi } from "vitest";

import type { KeyAction, KeyPress } from "./app-menu";
import type { KeyEvent, KeySource, KeyTarget } from "./menu-keys";
import { wireMenuKeys } from "./menu-keys";

type Listener = (event: KeyEvent, input: KeyPress) => void;

/** A page that records its key listeners, as a WebContents would hold them. */
class FakeContents implements KeyTarget {
  readonly listeners: Listener[] = [];

  on(_event: "before-input-event", listener: Listener) {
    this.listeners.push(listener);
  }

  /** Sends a key press; true when a listener kept it from the page. */
  press(input: Partial<KeyPress>): boolean {
    const event = { prevented: false, preventDefault: () => {} };

    event.preventDefault = () => {
      event.prevented = true;
    };

    const full: KeyPress = {
      alt: false,
      control: true,
      isAutoRepeat: false,
      key: "n",
      meta: false,
      shift: false,
      type: "keyDown",
      ...input,
    };

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

    wireMenuKeys(app.source, [before], () => run);
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

    wireMenuKeys(app.source, [contents, contents], () => run);
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

    wireMenuKeys(app.source, [contents], () => run);

    const early = contents.press({});

    run = vi.fn<(action: KeyAction) => void>();

    expect([
      early,
      contents.press({ key: "a" }),
      contents.press({}),
    ]).toStrictEqual([false, false, true]);
  });
});
