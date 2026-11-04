import { describe, expect, it, vi } from "vitest";

import type { UpdateActions, UpdateEvent, UpdateState } from "./state";
import { reduceUpdate, updateMenuItems } from "./state";

const run = (from: UpdateState, events: UpdateEvent[]) => {
  let state = from;

  for (const event of events) {
    state = reduceUpdate(state, event);
  }

  return state;
};

const idle: UpdateState = { kind: "idle" };

describe(reduceUpdate, () => {
  it("walks a found update from check to ready", () => {
    expect(
      run(idle, [
        { type: "checking" },
        { type: "available", version: "0.1.901" },
        { percent: 41.7, type: "progress" },
        { percent: 100, type: "progress" },
        { type: "downloaded", version: "0.1.901" },
      ])
    ).toStrictEqual({ kind: "ready", version: "0.1.901" });
  });

  it("reports the whole percent while downloading", () => {
    expect(
      run(idle, [
        { type: "checking" },
        { type: "available", version: "0.1.901" },
        { percent: 41.7, type: "progress" },
      ])
    ).toStrictEqual({ kind: "downloading", percent: 41, version: "0.1.901" });
  });

  it("settles on up to date or on the error message", () => {
    expect([
      run(idle, [{ type: "checking" }, { type: "notAvailable" }]),
      run(idle, [{ type: "checking" }, { message: "offline", type: "failed" }]),
    ]).toStrictEqual([
      { kind: "upToDate" },
      { kind: "error", message: "offline" },
    ]);
  });

  it("keeps a downloaded update ready through later checks and failures", () => {
    expect(
      run({ kind: "ready", version: "0.1.901" }, [
        { type: "checking" },
        { type: "notAvailable" },
        { message: "offline", type: "failed" },
      ])
    ).toStrictEqual({ kind: "ready", version: "0.1.901" });
  });

  it("moves ready to a newer download", () => {
    expect(
      run({ kind: "ready", version: "0.1.901" }, [
        { type: "downloaded", version: "0.1.902" },
      ])
    ).toStrictEqual({ kind: "ready", version: "0.1.902" });
  });

  it("stays off whatever the updater reports", () => {
    expect(
      run({ kind: "off" }, [
        { type: "checking" },
        { type: "downloaded", version: "0.1.901" },
      ])
    ).toStrictEqual({ kind: "off" });
  });

  it("ignores progress that arrives without a known version", () => {
    expect(
      run(idle, [{ type: "checking" }, { percent: 10, type: "progress" }])
    ).toStrictEqual({ kind: "checking" });
  });

  it("returns the same state when nothing changed, so menus are not rebuilt", () => {
    const downloading: UpdateState = {
      kind: "downloading",
      percent: 41,
      version: "0.1.901",
    };

    expect(reduceUpdate(downloading, { percent: 41.9, type: "progress" })).toBe(
      downloading
    );
  });
});

const actions = (): UpdateActions => ({
  check: vi.fn<() => void>(),
  restart: vi.fn<() => void>(),
});

const labels = (state: UpdateState) =>
  updateMenuItems(state, actions()).map((item) => [
    item.label,
    item.enabled ?? true,
  ]);

describe(updateMenuItems, () => {
  it("offers the restart once an update is ready, and no second check", () => {
    expect(labels({ kind: "ready", version: "0.1.901" })).toStrictEqual([
      ["Restart to Update to v0.1.901", true],
      ["Check for Updates…", false],
    ]);
  });

  it("shows the download and blocks a second check meanwhile", () => {
    expect(
      labels({ kind: "downloading", percent: 41, version: "0.1.901" })
    ).toStrictEqual([
      ["Downloading v0.1.901… 41%", false],
      ["Check for Updates…", false],
    ]);
  });

  it("lets the user check again after a result or a failure", () => {
    expect([
      labels({ kind: "upToDate" }),
      labels({ kind: "error", message: "offline" }),
    ]).toStrictEqual([
      [
        ["Up to Date", false],
        ["Check for Updates…", true],
      ],
      [
        ["Update Failed", false],
        ["Check for Updates…", true],
      ],
    ]);
  });

  it("keeps the check item but disables it where updates are off", () => {
    expect(labels({ kind: "off" })).toStrictEqual([
      ["Check for Updates…", false],
    ]);
  });

  it("gives the restart and check items their own actions", () => {
    const all = actions();

    expect(
      updateMenuItems({ kind: "ready", version: "0.1.901" }, all).map(
        (item) => item.click
      )
    ).toStrictEqual([all.restart, all.check]);
  });
});
