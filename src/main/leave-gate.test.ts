import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LEAVE_ANSWER_MS, SETTLE_MS } from "../shared/leave";
import type { LateChoice, LeavePage } from "./leave-gate";
import { LeaveGate, lateDialog } from "./leave-gate";

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

/**
 * A gate whose asks, shows, dialogs and cancels land in `log`, and a window close that lands
 * there too. Main's dialog answers with `choose`, in turn, once the test calls `pick`.
 */
const setup = () => {
  const log: string[] = [];
  const picks: ((choice: LateChoice) => void)[] = [];

  const gate = new LeaveGate<FakePage>({
    ask: (_page, reason) => log.push(`ask ${reason}`),
    cancel: () => log.push("cancel"),
    confirm: (_page, reason, count, signal) => {
      log.push(`dialog ${reason} ${String(count)}`);

      const { promise, resolve } = Promise.withResolvers<LateChoice>();

      picks.push(resolve);
      signal.addEventListener("abort", () => {
        log.push("dialog closed");
        resolve("cancel");
      });

      return promise;
    },
    show: () => log.push("show"),
  });

  const close = () => log.push("closed");

  /** Picks in the dialog on screen. */
  const pick = async (choice: LateChoice) => {
    picks.shift()?.(choice);
    await Promise.resolve();
  };

  return { close, gate, log, pick };
};

describe(LeaveGate, () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets a page with nothing unsaved close and quit at once, without asking", async () => {
    const { close, gate, log } = setup();
    const page = new FakePage();
    const never = new FakePage();

    gate.report(page, 2);
    gate.report(page, 0);

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

    gate.report(page, 1);

    const held = gate.holdClose(page, close);

    gate.answer(page, "waiting");
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

    gate.report(page, 1);
    gate.holdClose(page, close);
    gate.answer(page, "stay");
    await Promise.resolve();

    expect([gate.holdClose(page, close), log]).toStrictEqual([
      true,
      ["ask close", "ask close"],
    ]);
  });

  it("asks again on each request, as a quit once one is, and every request shares the one answer", async () => {
    const { close, gate, log } = setup();
    const page = new FakePage();

    gate.report(page, 1);
    gate.holdClose(page, close);

    const quit = gate.request(page, "quit");
    const closeAgain = gate.request(page, "close");

    gate.answer(page, "go");

    expect([await quit, await closeAgain, log]).toStrictEqual([
      "go",
      "go",
      ["ask close", "ask quit", "ask quit", "closed"],
    ]);
  });

  it.each(["did-navigate", "render-process-gone", "destroyed"])(
    "lets go of a page on %s, which holds nothing any more",
    async (event) => {
      const { close, gate } = setup();
      const page = new FakePage();

      gate.report(page, 1);

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

    gate.report(page, 1);
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

    gate.report(page, 1);
    page.destroyed = true;
    gate.report(page, 1);

    expect([
      await gate.request(page, "quit"),
      gate.holdClose(page, close),
    ]).toStrictEqual(["go", false]);
  });

  it("never takes a page that doesn't answer as saved: after LEAVE_ANSWER_MS main asks the user", async () => {
    const { gate, log } = setup();
    const page = new FakePage();
    let answer = "none yet";

    gate.report(page, 2);

    const asking = async () => {
      answer = await gate.request(page, "quit");
    };

    void asking();
    await vi.advanceTimersByTimeAsync(LEAVE_ANSWER_MS - 1);

    const before = [...log];

    await vi.advanceTimersByTimeAsync(1);
    // However long the dialog stays up, nothing goes by itself.
    await vi.advanceTimersByTimeAsync(60_000);

    expect([before, log, answer]).toStrictEqual([
      ["ask quit"],
      ["ask quit", "dialog quit 2"],
      "none yet",
    ]);
  });

  it("Quit anyway lets go; Cancel stays and tells the page to drop the request", async () => {
    const { gate, log, pick } = setup();
    const quitting = new FakePage();
    const closing = new FakePage();

    gate.report(quitting, 1);
    gate.report(closing, 1);

    const quit = gate.request(quitting, "quit");

    await vi.advanceTimersByTimeAsync(LEAVE_ANSWER_MS);
    await pick("go");

    const close = gate.request(closing, "close");

    await vi.advanceTimersByTimeAsync(LEAVE_ANSWER_MS);
    await pick("cancel");

    expect([await quit, await close, log]).toStrictEqual([
      "go",
      "stay",
      ["ask quit", "dialog quit 1", "ask close", "dialog close 1", "cancel"],
    ]);
  });

  it("Wait gives the page another LEAVE_ANSWER_MS, then asks again", async () => {
    const { gate, log, pick } = setup();
    const page = new FakePage();

    gate.report(page, 1);
    void gate.request(page, "close");
    await vi.advanceTimersByTimeAsync(LEAVE_ANSWER_MS);
    await pick("wait");
    await vi.advanceTimersByTimeAsync(LEAVE_ANSWER_MS - 1);

    const waiting = [...log];

    await vi.advanceTimersByTimeAsync(1);

    expect([waiting, log]).toStrictEqual([
      ["ask close", "dialog close 1"],
      ["ask close", "dialog close 1", "dialog close 1"],
    ]);
  });

  it("closes its dialog when the page answers after all, and goes by the page's answer", async () => {
    const { gate, log } = setup();
    const page = new FakePage();

    gate.report(page, 1);

    const quit = gate.request(page, "quit");

    await vi.advanceTimersByTimeAsync(LEAVE_ANSWER_MS);
    gate.answer(page, "held");
    gate.answer(page, "stay");

    expect([await quit, log]).toStrictEqual([
      "stay",
      ["ask quit", "dialog quit 1", "dialog closed", "show"],
    ]);
  });

  it("waits SETTLE_MS longer for a page that said it is waiting for its saves", async () => {
    const { gate, log } = setup();
    const page = new FakePage();

    gate.report(page, 1);
    void gate.request(page, "close");
    gate.answer(page, "waiting");
    await vi.advanceTimersByTimeAsync(SETTLE_MS + LEAVE_ANSWER_MS - 1);

    const before = [...log];

    await vi.advanceTimersByTimeAsync(1);

    expect([before, log]).toStrictEqual([
      ["ask close"],
      ["ask close", "dialog close 1"],
    ]);
  });

  it("goes without a dialog when the page last said it holds nothing", async () => {
    const { gate, log } = setup();
    const page = new FakePage();

    gate.report(page, 1);

    const close = gate.request(page, "close");

    gate.report(page, 0);
    await vi.advanceTimersByTimeAsync(LEAVE_ANSWER_MS);

    expect([await close, log]).toStrictEqual(["go", ["ask close"]]);
  });

  it("notices a page that stops answering while its prompt is up, once asked again", async () => {
    const { gate, log } = setup();
    const page = new FakePage();

    gate.report(page, 1);
    void gate.request(page, "close");
    gate.answer(page, "held");
    // The prompt is up: the user takes their time, and main waits for them.
    await vi.advanceTimersByTimeAsync(60_000);

    const prompting = [...log];

    void gate.request(page, "quit");
    await vi.advanceTimersByTimeAsync(LEAVE_ANSWER_MS);

    expect([prompting, log]).toStrictEqual([
      ["ask close", "show"],
      ["ask close", "show", "ask quit", "dialog quit 1"],
    ]);
  });
});

describe(lateDialog, () => {
  it("names the app and what is lost, with Wait first and Cancel last", () => {
    expect([
      lateDialog("Inset Window Links", "quit", 1),
      lateDialog("Inset Window Links", "close", 3).buttons,
    ]).toStrictEqual([
      {
        buttons: ["Wait", "Quit anyway", "Cancel"],
        cancelId: 2,
        choices: ["wait", "go", "cancel"],
        defaultId: 0,
        detail:
          "Recent Captures isn't answering. It last had 1 change that wasn't saved. If you quit anyway, it is lost.",
        message: "Inset Window Links couldn't confirm your changes were saved",
      },
      ["Wait", "Close anyway", "Cancel"],
    ]);
  });
});
