import type { OnboardingView, PermissionRowState } from "@shared/onboarding";
import { describe, expect, it } from "vitest";

import { fakeMac } from "./fakes";
import { ACCESS, DONE, record, WELCOME } from "./flow";
import type { OnboardingRecord } from "./flow";
import { ADVANCE_MS, createOnboarding } from "./onboarding";
import type { Closed, OnboardingDeps, Presentation } from "./onboarding";
import { createPoller, FAST_POLL_MS } from "./poller";
import { createPermissionChecks, PANE_URLS } from "./system";

const memoryStore = (initial: OnboardingRecord | null = null) => {
  let saved = initial;

  return {
    read: async () => await Promise.resolve(saved),
    saved: () => saved,
    write: async (next: OnboardingRecord) => {
      saved = next;
      await Promise.resolve();
    },
  };
};

/** Inset Shelf's quit hold as the flow sees it: one pending quit, Cancel drops it. */
const heldQuit = () => {
  let finish: (() => void) | null = null;
  const log: string[] = [];

  return {
    exit: () => {
      const run = finish;

      finish = null;
      run?.();
      log.push("exit");
    },
    held: () => finish !== null,
    log,
    quit: (atExit: () => void) => {
      finish = atExit;
    },
    replace: () => {
      finish = () => {};
    },
  };
};

type Mac = ReturnType<typeof fakeMac>;

const setUp = (
  options: {
    readonly mac?: Mac;
    readonly store?: ReturnType<typeof memoryStore>;
    readonly ranBefore?: boolean;
    readonly isMac?: boolean;
  } = {}
) => {
  const mac = options.mac ?? fakeMac();
  const store = options.store ?? memoryStore();
  const checks = createPermissionChecks(mac.system);
  const quit = heldQuit();
  const presented: Presentation[] = [];
  const events: (Closed | "ended" | "hide")[] = [];
  let latest: OnboardingView | null = null;
  let fast = false;

  // The shared Accessibility poll, as the app wires it: the flow reads the grant on every check.
  let onboardingRef: ReturnType<typeof createOnboarding> | null = null;

  const poller = createPoller({
    check: () => {
      onboardingRef?.observe();

      return !checks.granted("accessibility");
    },
    setTimer: mac.clock.setTimer,
  });

  const deps: OnboardingDeps = {
    appName: "Inset Shelf",
    checks,
    handOff: {
      later: "Ask again later.",
      ready: "Ready.",
      showAround: "Show Me Around",
      start: "Start Using Inset Shelf",
    },
    mac: options.isMac ?? true,
    onClosed: (how) => {
      events.push(how);
    },
    onEnded: () => {
      events.push("ended");
    },
    onView: (view) => {
      latest = view;
    },
    osMajor: 26,
    permissions: [
      {
        features: ["Double Shift"],
        id: "accessibility",
        purpose: "Notices Double Shift.",
      },
      {
        features: ["window links"],
        id: "screen",
        purpose: "Shows window titles.",
      },
    ],
    pollFast: (on) => {
      fast = on;
      poller.setFast(on);
    },
    quit: quit.quit,
    ranBefore: async () => await Promise.resolve(options.ranBefore ?? false),
    relaunch: () => {
      quit.log.push("relaunch");
    },
    setTimer: mac.clock.setTimer,
    store,
    tagline: "A list beside your work.",
    tile: () => null,
    window: {
      hide: () => {
        events.push("hide");
      },
      present: (presentation) => {
        presented.push(presentation);
      },
    },
  };

  const onboarding = createOnboarding(deps);

  onboardingRef = onboarding;
  poller.start();

  const rows = (): Record<string, PermissionRowState> =>
    Object.fromEntries(
      onboarding.view().permissions.map((row) => [row.id, row.state])
    );

  /** Everything a page shows at once, compared whole. */
  const now = () => ({
    fast,
    focus: onboarding.view().focus,
    open: onboarding.isOpen(),
    presented: presented.at(-1) ?? null,
    rows: rows(),
    step: onboarding.view().step.kind,
    steps: onboarding.view().steps.map((step) => step.kind),
  });

  return {
    events,
    latest: () => latest,
    mac,
    now,
    onboarding,
    quit,
    rows,
    store,
  };
};

const CENTERED = { floating: false, focus: true, place: "center" } as const;

describe(createOnboarding, () => {
  it("shows Welcome on the first run, focused in the middle, with three pages", async () => {
    const { events, now, onboarding, store } = setUp();

    await expect(onboarding.launch()).resolves.toBeTruthy();

    expect(now()).toStrictEqual({
      fast: false,
      focus: "accessibility",
      open: true,
      presented: CENTERED,
      rows: { accessibility: "allow", screen: "allow" },
      step: "welcome",
      steps: ["welcome", "access", "done"],
    });
    expect({
      events,
      saved: store.saved(),
      settled: onboarding.settled(),
    }).toStrictEqual({
      events: [],
      saved: record("active", WELCOME),
      settled: false,
    });
  });

  it("does nothing on Windows but set the first-run flag", async () => {
    const { onboarding, store } = setUp({ isMac: false });

    await expect(onboarding.launch()).resolves.toBeFalsy();

    onboarding.open("accessibility");

    expect({
      open: onboarding.isOpen(),
      saved: store.saved(),
      settled: onboarding.settled(),
    }).toStrictEqual({
      open: false,
      saved: record("finished", DONE),
      settled: true,
    });
  });

  it("leaves out Allow access when every permission is granted", async () => {
    const { now, onboarding } = setUp({
      mac: fakeMac({ accessibility: true, screen: true }),
    });

    await onboarding.launch();
    onboarding.next();

    expect(now()).toMatchObject({ step: "done", steps: ["welcome", "done"] });
  });

  it("asks for Accessibility beside System Settings, then picks out the permission still missing", async () => {
    const { mac, now, onboarding } = setUp();

    await onboarding.launch();
    onboarding.next();

    expect(now()).toMatchObject({
      fast: true,
      presented: { floating: true, focus: true, place: "keep" },
      step: "access",
    });

    onboarding.allow("accessibility");

    expect({ calls: mac.calls, now: now() }).toMatchObject({
      calls: ["prompt accessibility", `open ${PANE_URLS.accessibility}`],
      now: {
        focus: "accessibility",
        presented: { floating: true, focus: false, place: "edge" },
        rows: { accessibility: "waiting" },
      },
    });

    mac.grant("accessibility");
    mac.clock.advance(FAST_POLL_MS);
    mac.clock.advance(ADVANCE_MS * 2);

    // Screen Recording is still missing: the page stays, with it picked out.
    expect(now()).toMatchObject({
      fast: false,
      focus: "screen",
      rows: { accessibility: "allowed", screen: "allow" },
      step: "access",
    });
  });

  it("comes to Done a beat after the last permission turns green", async () => {
    const { mac, now, onboarding } = setUp({ mac: fakeMac({ screen: true }) });

    await onboarding.launch();
    onboarding.next();
    onboarding.allow("accessibility");
    mac.grant("accessibility");
    mac.clock.advance(FAST_POLL_MS);

    expect(now()).toMatchObject({
      rows: { accessibility: "allowed" },
      step: "access",
    });

    mac.clock.advance(ADVANCE_MS);

    expect(now()).toMatchObject({ presented: CENTERED, step: "done" });
  });

  it("goes back a page from Allow access and from Done", async () => {
    const { now, onboarding } = setUp();

    await onboarding.launch();
    onboarding.next();
    onboarding.next();

    expect(now().step).toBe("done");

    onboarding.back();

    expect(now()).toMatchObject({
      presented: { floating: true },
      step: "access",
    });

    onboarding.back();
    onboarding.back();

    expect(now()).toMatchObject({ presented: CENTERED, step: "welcome" });
  });

  it("offers Reopen to finish for Screen Recording, and a cancelled quit takes it back", async () => {
    const { mac, onboarding, quit, rows, store } = setUp({
      mac: fakeMac({ accessibility: true }),
    });

    await onboarding.launch();
    onboarding.next();
    onboarding.allow("screen");
    mac.grant("screen");
    // Not seen until the app starts again.
    mac.clock.advance(FAST_POLL_MS * 10);

    expect({ calls: mac.calls, rows: rows() }).toMatchObject({
      // The pane opens again in case System Settings started cold.
      calls: [
        "getSources screen 1x1",
        `open ${PANE_URLS.screen}`,
        `open ${PANE_URLS.screen}`,
      ],
      rows: { screen: "reopen" },
    });

    await onboarding.reopen();

    expect({
      held: quit.held(),
      rows: rows(),
      saved: store.saved(),
    }).toStrictEqual({
      held: true,
      rows: { accessibility: "allowed", screen: "reopening" },
      saved: record("active", ACCESS),
    });

    // The quit is held and the user cancels it.
    onboarding.quitCancelled();

    expect(rows().screen).toBe("reopen");

    // A later plain quit never relaunches.
    quit.replace();
    quit.exit();

    expect(quit.log).toStrictEqual(["exit"]);
  });

  it("relaunches at the exit of the quit, and the reopened app lands on Allow access, then Done", async () => {
    const mac = fakeMac({ accessibility: true });
    const store = memoryStore();
    const first = setUp({ mac, store });

    await first.onboarding.launch();
    first.onboarding.next();
    first.onboarding.allow("screen");
    mac.grant("screen");
    await first.onboarding.reopen();
    first.quit.exit();

    expect(first.quit.log).toStrictEqual(["relaunch", "exit"]);

    mac.relaunched();

    const second = setUp({ mac, store });

    await expect(second.onboarding.launch()).resolves.toBeTruthy();

    expect(second.now()).toMatchObject({
      rows: { accessibility: "allowed", screen: "allowed" },
      step: "access",
      steps: ["welcome", "access", "done"],
    });

    mac.clock.advance(ADVANCE_MS);

    expect(second.now()).toMatchObject({ presented: CENTERED, step: "done" });
  });

  it("hands over to the app from Done, with the walkthrough when asked, and lets held-back work start once", async () => {
    const { events, onboarding, store } = setUp({
      mac: fakeMac({ accessibility: true, screen: true }),
    });

    await onboarding.launch();
    onboarding.next();
    onboarding.finish("showAround");

    expect({ events, saved: store.saved() }).toStrictEqual({
      events: ["hide", "ended", "showAround"],
      saved: record("finished", DONE),
    });

    onboarding.open();
    onboarding.next();
    onboarding.close();

    expect(events).toStrictEqual([
      "hide",
      "ended",
      "showAround",
      "hide",
      "start",
    ]);
  });

  it("can be skipped from any page, and never shows by itself again", async () => {
    const store = memoryStore();
    const { events, onboarding } = setUp({ store });

    await onboarding.launch();
    onboarding.next();
    onboarding.close();

    expect({ events, saved: store.saved() }).toStrictEqual({
      events: ["hide", "ended", "skipped"],
      saved: record("skipped", DONE),
    });

    await expect(setUp({ store }).onboarding.launch()).resolves.toBeFalsy();
  });

  it("stays quiet on an install that ran before it existed", async () => {
    const { onboarding, store } = setUp({ ranBefore: true });

    await expect(onboarding.launch()).resolves.toBeFalsy();

    expect(store.saved()).toStrictEqual(record("finished", DONE));
  });

  it("opens Set Up Permissions… and the deep links at Allow access, with that row picked out", async () => {
    const { mac, now, onboarding } = setUp({
      mac: fakeMac({ accessibility: true }),
      ranBefore: true,
    });

    await onboarding.launch();
    onboarding.open("accessibility");
    mac.clock.advance(ADVANCE_MS * 3);

    expect(now()).toMatchObject({
      focus: "accessibility",
      open: true,
      presented: { floating: true },
      rows: { accessibility: "allowed" },
      step: "access",
      steps: ["welcome", "access", "done"],
    });

    onboarding.open();

    expect(now().focus).toBe("screen");
  });

  it("keeps a flow opened again from the menu from coming back at launch, except from Allow access", async () => {
    const store = memoryStore(record("skipped", DONE));
    const { onboarding } = setUp({ store });

    await onboarding.launch();
    onboarding.open();

    expect(store.saved()).toStrictEqual(record("active", ACCESS));

    onboarding.next();

    expect(store.saved()).toStrictEqual(record("skipped", DONE));
  });

  it("stops the beat when the flow ends before it", async () => {
    const { mac, onboarding } = setUp({ mac: fakeMac({ screen: true }) });

    await onboarding.launch();
    onboarding.next();
    onboarding.allow("accessibility");
    mac.grant("accessibility");
    mac.clock.advance(FAST_POLL_MS);
    onboarding.skip();
    mac.clock.advance(ADVANCE_MS);

    expect(onboarding.isOpen()).toBeFalsy();
  });

  it("pushes every change to the page", async () => {
    const { latest, mac, onboarding } = setUp();

    await onboarding.launch();
    onboarding.next();
    onboarding.allow("accessibility");
    mac.grant("accessibility");
    mac.clock.advance(FAST_POLL_MS);

    expect(latest()).toStrictEqual(onboarding.view());
  });
});
