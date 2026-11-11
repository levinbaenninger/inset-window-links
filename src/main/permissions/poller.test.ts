import { describe, expect, it } from "vitest";

import { fakeClock } from "./fakes";
import { createPoller, FAST_POLL_MS, SLOW_POLL_MS } from "./poller";

const counting = (keepGoing: () => boolean) => {
  const clock = fakeClock();
  let checks = 0;

  const poller = createPoller({
    check: () => {
      checks += 1;

      return keepGoing();
    },
    setTimer: clock.setTimer,
  });

  return { checks: () => checks, clock, poller };
};

describe(createPoller, () => {
  it("checks at once, then every 3 s until the check is satisfied", () => {
    let trusted = false;
    const { checks, clock, poller } = counting(() => !trusted);

    poller.start();

    expect(checks()).toBe(1);

    clock.advance(SLOW_POLL_MS * 2);

    expect(checks()).toBe(3);

    trusted = true;
    clock.advance(SLOW_POLL_MS);

    expect(checks()).toBe(4);
    expect(poller.running()).toBeFalsy();

    clock.advance(SLOW_POLL_MS * 5);

    expect(checks()).toBe(4);
  });

  it("polls every 500 ms while fast, checking at once, and slows down again", () => {
    const { checks, clock, poller } = counting(() => true);

    poller.start();
    clock.advance(1000);

    expect(checks()).toBe(1);

    poller.setFast(true);

    expect(checks()).toBe(2);

    clock.advance(FAST_POLL_MS * 4);

    expect(checks()).toBe(6);

    poller.setFast(false);
    clock.advance(FAST_POLL_MS * 4);

    expect(checks()).toBe(6);

    clock.advance(SLOW_POLL_MS);

    expect(checks()).toBe(7);
  });

  it("keeps a single timer, however often the speed changes", () => {
    const { clock, poller } = counting(() => true);

    poller.start();
    poller.setFast(true);
    poller.setFast(false);
    poller.setFast(true);
    poller.setFast(true);

    expect(clock.pending()).toBe(1);
  });

  it("starts again when a step wants it fast after the poll had stopped", () => {
    let waiting = false;
    const { checks, clock, poller } = counting(() => waiting);

    poller.start();

    expect(poller.running()).toBeFalsy();

    waiting = true;
    poller.setFast(true);

    expect(checks()).toBe(2);
    expect(poller.running()).toBeTruthy();

    clock.advance(FAST_POLL_MS);

    expect(checks()).toBe(3);
  });

  it("stops", () => {
    const { checks, clock, poller } = counting(() => true);

    poller.start();
    poller.stop();
    clock.advance(SLOW_POLL_MS * 3);

    expect(checks()).toBe(1);
    expect(clock.pending()).toBe(0);
  });
});
