import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SETTLE_MS } from "../shared/leave";
import type { WritesChoice } from "./quit-writes";
import { settleWrites, writesDialog } from "./quit-writes";

/** Writes that land when `land` is called, and a dialog whose answers come from `choices` in turn. */
const setup = (choices: WritesChoice[]) => {
  const log: string[] = [];
  const { promise: landed, resolve: land } = Promise.withResolvers<undefined>();
  let done = false;

  const settle = async () => {
    await settleWrites({
      ask: () => {
        const choice = choices.shift() ?? "wait";

        log.push(`asked, ${choice}`);

        return Promise.resolve(choice);
      },
      writes: { durable: () => landed },
    });
    done = true;
  };

  void settle();

  return { done: () => done, land, log };
};

describe(settleWrites, () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lets the app quit as soon as the last writes land, without asking", async () => {
    const { done, land, log } = setup([]);

    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1);
    land(undefined);
    await vi.advanceTimersByTimeAsync(0);

    expect([done(), log]).toStrictEqual([true, []]);
  });

  it("asks after SETTLE_MS instead of waiting for good; Wait waits SETTLE_MS more, Quit anyway quits", async () => {
    const { done, log } = setup(["wait", "quit"]);

    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    const once = [done(), [...log]];

    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect([once, done(), log]).toStrictEqual([
      [false, ["asked, wait"]],
      true,
      ["asked, wait", "asked, quit"],
    ]);
  });

  it("quits once the writes land during a Wait", async () => {
    const { done, land, log } = setup(["wait"]);

    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    land(undefined);
    await vi.advanceTimersByTimeAsync(0);

    expect([done(), log]).toStrictEqual([true, ["asked, wait"]]);
  });
});

describe(writesDialog, () => {
  it("says the app is still saving, with Wait as the default", () => {
    expect(writesDialog("Inset Window Links")).toStrictEqual({
      buttons: ["Wait", "Quit anyway"],
      cancelId: 0,
      choices: ["wait", "quit"],
      defaultId: 0,
      detail:
        "A change is still being written to disk. If you quit now, it may be lost.",
      message: "Inset Window Links is still saving",
    });
  });
});
