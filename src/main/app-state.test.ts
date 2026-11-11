import { setTimeout as sleep } from "node:timers/promises";

import { describe, expect, it } from "vitest";

import type { AppStateFs } from "./app-state";
import { openAppState, readAppState } from "./app-state";
import { record } from "./permissions/flow";
import { freshRecord } from "./tutorial/store";

const memoryFs = (initial?: string) => {
  const files = new Map<string, string>();
  const log: string[] = [];

  if (initial !== undefined) {
    files.set("/data/app-state.json", initial);
  }

  const fs: AppStateFs = {
    mkdir: async () => {
      await Promise.resolve();
    },
    readText: async (file) => {
      const text = files.get(file);

      if (text === undefined) {
        throw new Error("ENOENT");
      }

      return await Promise.resolve(text);
    },
    rename: async (from, to) => {
      files.set(to, files.get(from) ?? "");
      files.delete(from);
      log.push(`rename ${JSON.parse(files.get(to) ?? "{}").welcomed}`);
      await Promise.resolve();
    },
    writeText: async (file, data) => {
      // A slow disk: the second write must still land after the first.
      await sleep(5);
      files.set(file, data);
    },
  };

  return { file: () => files.get("/data/app-state.json"), fs, log };
};

describe(readAppState, () => {
  it("reads a file from before the onboarding as welcomed, with no onboarding record", () => {
    expect(readAppState('{"welcomed":true}')).toStrictEqual({
      onboarding: null,
      tutorial: null,
      welcomed: true,
    });
  });

  it("keeps the first-run flag when the onboarding record is damaged", () => {
    expect(
      readAppState('{"welcomed":true,"onboarding":{"status":"lost"}}')
    ).toStrictEqual({ onboarding: null, tutorial: null, welcomed: true });
  });

  it("reads a missing or unreadable file as a first run", () => {
    const first = { onboarding: null, tutorial: null, welcomed: false };

    expect(readAppState(null)).toStrictEqual(first);
    expect(readAppState("{nope")).toStrictEqual(first);
  });
});

describe(openAppState, () => {
  it("keeps the onboarding step in app-state.json beside the first-run flag", async () => {
    const disk = memoryFs('{"welcomed":false}');
    const state = await openAppState("/data", disk.fs);
    const step = record("active", { kind: "access" });

    await state.onboarding.write(step);

    expect(JSON.parse(disk.file() ?? "")).toStrictEqual({
      onboarding: step,
      tutorial: null,
      welcomed: false,
    });

    const reopened = await openAppState("/data", disk.fs);

    await expect(reopened.onboarding.read()).resolves.toStrictEqual(step);
  });

  it("writes one change after another, so the later one is what stays", async () => {
    const disk = memoryFs();
    const state = await openAppState("/data", disk.fs);

    await Promise.all([
      state.onboarding.write(record("finished", { kind: "done" })),
      state.update({ welcomed: true }),
    ]);

    expect(disk.log).toStrictEqual(["rename false", "rename true"]);
    expect(JSON.parse(disk.file() ?? "")).toStrictEqual({
      onboarding: record("finished", { kind: "done" }),
      tutorial: null,
      welcomed: true,
    });
  });

  it("keeps the tutorial's progress in the same file, and a damaged one never counts as a first run", async () => {
    const disk = memoryFs('{"welcomed":true}');
    const state = await openAppState("/data", disk.fs);
    const progress = { ...freshRecord(), done: ["save"], examplesSeeded: true };

    await state.tutorial.write(progress);

    const reopened = await openAppState("/data", disk.fs);

    expect([
      await reopened.tutorial.read(),
      readAppState('{"welcomed":true,"tutorial":{"done":"lost"}}'),
    ]).toStrictEqual([
      progress,
      { onboarding: null, tutorial: null, welcomed: true },
    ]);
  });
});
