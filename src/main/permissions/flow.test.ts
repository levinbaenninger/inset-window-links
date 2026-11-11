import type { PermissionId } from "@shared/onboarding";
import { describe, expect, it } from "vitest";

import {
  ACCESS,
  decideLaunch,
  DONE,
  flowSteps,
  nextStep,
  plannedSteps,
  previousStep,
  record,
  rowState,
  WELCOME,
} from "./flow";
import type { FlowConfig } from "./flow";
import { createOnboardingStore } from "./store";

const SHELF: FlowConfig = { permissions: ["accessibility", "screen"] };

/** inset-pin: Screen Recording only. */
const PIN: FlowConfig = { permissions: ["screen"] };

const grantedOnly =
  (...ids: PermissionId[]) =>
  (id: PermissionId): boolean =>
    ids.includes(id);

const launch = (
  input: Partial<Parameters<typeof decideLaunch>[0]>
): ReturnType<typeof decideLaunch> =>
  decideLaunch({
    config: SHELF,
    granted: grantedOnly(),
    mac: true,
    ranBefore: false,
    saved: null,
    ...input,
  });

const memory = (initial?: string) => {
  let text = initial;

  return {
    readFile: async () => {
      if (text === undefined) {
        throw new Error("ENOENT");
      }

      return await Promise.resolve(text);
    },
    text: () => text,
    writeAtomic: async (_file: string, data: string) => {
      text = data;
      await Promise.resolve();
    },
  };
};

describe(flowSteps, () => {
  it("is Welcome, Allow access and Done, with one page for every permission", () => {
    expect(flowSteps(SHELF)).toStrictEqual([WELCOME, ACCESS, DONE]);
    expect(flowSteps(PIN)).toStrictEqual([WELCOME, ACCESS, DONE]);
    expect(flowSteps({ permissions: [] })).toStrictEqual([WELCOME, DONE]);
  });
});

describe(plannedSteps, () => {
  it("leaves out Allow access when nothing is missing, unless the run opens on it", () => {
    expect(plannedSteps(SHELF, WELCOME, grantedOnly())).toStrictEqual([
      WELCOME,
      ACCESS,
      DONE,
    ]);
    expect(
      plannedSteps(SHELF, WELCOME, grantedOnly("accessibility", "screen"))
    ).toStrictEqual([WELCOME, DONE]);
    expect(
      plannedSteps(SHELF, ACCESS, grantedOnly("accessibility", "screen"))
    ).toStrictEqual([WELCOME, ACCESS, DONE]);
  });
});

describe(nextStep, () => {
  it("goes through the run's pages and ends at Done", () => {
    const run = [WELCOME, ACCESS, DONE];

    expect(nextStep(run, WELCOME)).toStrictEqual(ACCESS);
    expect(nextStep(run, ACCESS)).toStrictEqual(DONE);
    expect(nextStep(run, DONE)).toStrictEqual(DONE);
    expect(nextStep([WELCOME, DONE], WELCOME)).toStrictEqual(DONE);
  });
});

describe(previousStep, () => {
  it("goes back through the run's pages to Welcome", () => {
    const run = [WELCOME, ACCESS, DONE];

    expect(previousStep(run, DONE)).toStrictEqual(ACCESS);
    expect(previousStep(run, ACCESS)).toStrictEqual(WELCOME);
    expect(previousStep(run, WELCOME)).toStrictEqual(WELCOME);
    expect(previousStep([WELCOME, DONE], DONE)).toStrictEqual(WELCOME);
  });
});

describe(decideLaunch, () => {
  it("shows Welcome on the first run and remembers it is under way", () => {
    expect(launch({})).toStrictEqual({
      advance: false,
      kind: "show",
      step: WELCOME,
      write: record("active", WELCOME),
    });
  });

  it("does nothing on Windows but set the first-run flag", () => {
    expect(launch({ mac: false })).toStrictEqual({
      kind: "none",
      write: record("finished", DONE),
    });
    expect(
      launch({ mac: false, saved: record("finished", DONE) })
    ).toStrictEqual({ kind: "none", write: null });
  });

  it("marks an install from before the flow as done without showing it", () => {
    expect(launch({ ranBefore: true })).toStrictEqual({
      kind: "none",
      write: record("finished", DONE),
    });
  });

  it("never shows by itself again once finished or skipped", () => {
    for (const status of ["finished", "skipped"] as const) {
      expect(launch({ saved: record(status, DONE) })).toStrictEqual({
        kind: "none",
        write: null,
      });
    }
  });

  it("goes on where a quit left it", () => {
    expect(launch({ saved: record("active", ACCESS) })).toStrictEqual({
      advance: false,
      kind: "show",
      step: ACCESS,
      write: null,
    });
  });

  it("lands on Allow access after the reopen, and moves on once every permission is granted", () => {
    expect(
      launch({
        granted: grantedOnly("accessibility", "screen"),
        saved: record("active", ACCESS),
      })
    ).toMatchObject({ advance: true, kind: "show", step: ACCESS });
    expect(
      launch({
        granted: grantedOnly("screen"),
        saved: record("active", ACCESS),
      })
    ).toMatchObject({ advance: false, kind: "show", step: ACCESS });
  });

  it("starts over at Welcome when the saved page isn't part of this flow", () => {
    expect(
      decideLaunch({
        config: { permissions: [] },
        granted: grantedOnly(),
        mac: true,
        ranBefore: false,
        saved: record("active", ACCESS),
      })
    ).toMatchObject({ kind: "show", step: WELCOME });
  });
});

describe(rowState, () => {
  it("goes Allow, Waiting…, Allowed for a permission seen live", () => {
    const base = {
      asked: false,
      granted: false,
      live: true,
      relaunching: false,
    };

    expect(rowState(base)).toBe("allow");
    expect(rowState({ ...base, asked: true })).toBe("waiting");
    expect(rowState({ ...base, asked: true, granted: true })).toBe("allowed");
  });

  it("offers Reopen to finish for one seen only after a restart", () => {
    const base = {
      asked: true,
      granted: false,
      live: false,
      relaunching: false,
    };

    expect(rowState(base)).toBe("reopen");
    expect(rowState({ ...base, relaunching: true })).toBe("reopening");
    expect(rowState({ ...base, granted: true })).toBe("allowed");
  });
});

describe(createOnboardingStore, () => {
  it("writes the record and reads it back", async () => {
    const fs = memory();
    const store = createOnboardingStore("/data/onboarding.json", fs);
    const saved = record("active", ACCESS);

    await store.write(saved);

    await expect(store.read()).resolves.toStrictEqual(saved);
  });

  it("reads a missing or damaged file as no record", async () => {
    await expect(
      createOnboardingStore("/f", memory()).read()
    ).resolves.toBeNull();
    await expect(
      createOnboardingStore("/f", memory("{nope")).read()
    ).resolves.toBeNull();
    await expect(
      createOnboardingStore(
        "/f",
        memory('{"status":"lost","version":2}')
      ).read()
    ).resolves.toBeNull();
  });

  it("reads a record from before the flow became three pages as no record", async () => {
    await expect(
      createOnboardingStore(
        "/f",
        memory('{"status":"active","step":{"kind":"tour"},"version":1}')
      ).read()
    ).resolves.toBeNull();
  });
});
