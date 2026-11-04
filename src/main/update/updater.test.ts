import { describe, expect, it, vi } from "vitest";

import type { UpdateEvent } from "./state";
import type { UpdateFeed } from "./updater";
import { connectUpdater } from "./updater";

const ignore = (): null => null;

const fakeFeed = () => {
  let apply: (event: UpdateEvent) => void = ignore;

  const feed = {
    check: vi.fn<() => void>(),
    install: vi.fn<() => void>(),
    subscribe: (listener: (event: UpdateEvent) => void) => {
      apply = listener;
    },
  } satisfies UpdateFeed;

  const emit = (...events: UpdateEvent[]) => {
    for (const event of events) {
      apply(event);
    }
  };

  return { emit, feed };
};

const downloaded: UpdateEvent[] = [
  { type: "checking" },
  { type: "available", version: "0.1.901" },
  { percent: 100, type: "progress" },
];

describe(connectUpdater, () => {
  it("checks at once, and not again while a check runs", () => {
    const { emit, feed } = fakeFeed();
    const updater = connectUpdater(feed, () => null);

    emit({ type: "checking" });
    updater.check();

    expect(feed.check).toHaveBeenCalledOnce();
  });

  it("offers the restart only once the update is staged", () => {
    const { emit, feed } = fakeFeed();
    const updater = connectUpdater(feed, () => null);

    emit(...downloaded);

    const beforeStaging = updater.state().kind;

    emit({ type: "downloaded" });

    expect([beforeStaging, updater.state()]).toStrictEqual([
      "downloading",
      { kind: "ready", version: "0.1.901" },
    ]);
  });

  it("lets the user check again after staging fails", () => {
    const { emit, feed } = fakeFeed();
    const updater = connectUpdater(feed, () => null);

    emit(...downloaded, {
      message: "Code signature did not match",
      type: "failed",
    });
    updater.check();

    expect([updater.state(), feed.check.mock.calls.length]).toStrictEqual([
      { kind: "error", message: "Code signature did not match" },
      2,
    ]);
  });

  it("reports each change with the state before it", () => {
    const { emit, feed } = fakeFeed();
    const changes: string[] = [];

    connectUpdater(feed, (state, before) =>
      changes.push(`${before.kind}->${state.kind}`)
    );
    emit(...downloaded, { type: "downloaded" });

    expect(changes).toStrictEqual([
      "idle->checking",
      "checking->available",
      "available->downloading",
      "downloading->ready",
    ]);
  });
});
