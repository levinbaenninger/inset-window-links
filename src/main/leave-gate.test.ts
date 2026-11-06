import { describe, expect, it } from "vitest";

import type { LeavePage } from "./leave-gate";
import { LeaveGate } from "./leave-gate";

/** A page that records its listeners, as a WebContents would hold them. */
class FakePage implements LeavePage {
  readonly listeners = new Map<string, (() => void)[]>();
  destroyed = false;

  on(event: string, listener: () => void): this {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);

    return this;
  }

  emit(event: string): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener();
    }
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

/** A gate whose asks and shows land in `log`, and a window close that lands there too. */
const setup = () => {
  const log: string[] = [];

  const gate = new LeaveGate<FakePage>({
    ask: (_page, reason) => log.push(`ask ${reason}`),
    show: () => log.push("show"),
  });

  const close = () => log.push("closed");

  return { close, gate, log };
};

describe(LeaveGate, () => {
  it("lets a page with nothing unsaved close and quit at once, without asking", async () => {
    const { close, gate, log } = setup();
    const page = new FakePage();
    const never = new FakePage();

    gate.report(page, true);
    gate.report(page, false);

    expect([
      gate.holdClose(page, close),
      gate.holdClose(never, close),
      await gate.request(page, "quit"),
      await gate.request(null, "quit"),
      log,
    ]).toStrictEqual([false, false, "go", "go", []]);
  });

  it("holds a close while the page has unsaved words, and closes once it lets go", async () => {
    const { close, gate, log } = setup();
    const page = new FakePage();

    gate.report(page, true);

    const held = gate.holdClose(page, close);

    gate.answer(page, "held");

    const prompting = [...log];

    gate.answer(page, "go");
    await Promise.resolve();

    expect([held, prompting, log, gate.holdClose(page, close)]).toStrictEqual([
      true,
      ["ask close", "show"],
      ["ask close", "show", "closed"],
      false,
    ]);
  });

  it("keeps the window and the words on stay, so the next close asks again", async () => {
    const { close, gate, log } = setup();
    const page = new FakePage();

    gate.report(page, true);
    gate.holdClose(page, close);
    gate.answer(page, "stay");
    await Promise.resolve();

    expect([gate.holdClose(page, close), log]).toStrictEqual([
      true,
      ["ask close", "ask close"],
    ]);
  });

  it("tells the page when a quit meets a held close, and both share the one answer", async () => {
    const { close, gate, log } = setup();
    const page = new FakePage();

    gate.report(page, true);
    gate.holdClose(page, close);

    const quit = gate.request(page, "quit");
    const closeAgain = gate.request(page, "close");

    gate.answer(page, "go");

    expect([await quit, await closeAgain, log]).toStrictEqual([
      "go",
      "go",
      ["ask close", "ask quit", "closed"],
    ]);
  });

  it.each(["did-navigate", "render-process-gone", "destroyed"])(
    "lets go of a page on %s, which holds nothing any more",
    async (event) => {
      const { close, gate } = setup();
      const page = new FakePage();

      gate.report(page, true);

      const quit = gate.request(page, "quit");

      page.emit(event);

      expect([await quit, gate.holdClose(page, close)]).toStrictEqual([
        "go",
        false,
      ]);
    }
  );

  it("ignores an answer nobody asked for, so a stray go never clears unsaved words", () => {
    const { close, gate, log } = setup();
    const page = new FakePage();

    gate.report(page, true);
    gate.answer(page, "go");
    gate.answer(page, "held");

    expect([gate.holdClose(page, close), log]).toStrictEqual([
      true,
      ["ask close"],
    ]);
  });

  it("lets a destroyed page go, and ignores its reports", async () => {
    const { close, gate } = setup();
    const page = new FakePage();

    gate.report(page, true);
    page.destroyed = true;
    gate.report(page, true);

    expect([
      await gate.request(page, "quit"),
      gate.holdClose(page, close),
    ]).toStrictEqual(["go", false]);
  });
});
