import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";

import type {
  TutorialAction,
  TutorialHint,
  TutorialTask,
} from "@shared/tutorial";
import { describe, expect, it, vi } from "vitest";

import { createTutorialStore, freshRecord } from "./store";
import type { TutorialRecord } from "./store";
import { createTutorial } from "./tutorial";
import type { TutorialDeps } from "./tutorial";

const TASKS: readonly TutorialTask[] = [
  {
    anchor: null,
    how: "Tap Shift twice.",
    id: "double-shift",
    keys: "⇧ ⇧",
    title: "Save text",
  },
  {
    anchor: "add-button",
    how: "Press ⇧⌘L.",
    id: "window-link",
    keys: "⇧⌘L",
    title: "Link a window",
  },
];

const hint = (
  id: string,
  page: string,
  task: string | null = null
): TutorialHint => ({
  anchor: `${id}-anchor`,
  id,
  page,
  placement: "below",
  task,
  text: `About ${id}.`,
  title: null,
});

const HINTS = [
  hint("picker", "picker", "window-link"),
  hint("drawing", "drawing"),
  hint("details", "shelf"),
];

const memoryStore = (initial: TutorialRecord | null = null) => {
  let saved = initial;

  return {
    read: async () => await Promise.resolve(saved),
    saved: () => saved,
    write: async (next: TutorialRecord) => {
      saved = next;
      await Promise.resolve();
    },
  };
};

/** As Windows' atomic write: a save that starts while another is still writing fails (EPERM on the rename). */
const exclusiveStore = () => {
  let saved: TutorialRecord | null = null;
  let writing = false;

  return {
    read: async () => await Promise.resolve(saved),
    saved: () => saved,
    write: async (next: TutorialRecord) => {
      if (writing) {
        throw new Error("EPERM: operation not permitted, rename");
      }

      writing = true;
      await sleep(5);
      saved = next;
      writing = false;
    },
  };
};

const setUp = async (
  options: {
    readonly store?: ReturnType<typeof memoryStore>;
    readonly firstRun?: boolean;
    readonly hidden?: readonly string[];
    /** The app's items, kept across a restart. */
    readonly items?: Set<string>;
    /** Items the app fails to remove. */
    readonly stuck?: ReadonlySet<string>;
    /** A removal waits for this, as a queued delete does. */
    readonly removing?: Promise<unknown>;
  } = {}
) => {
  const store = options.store ?? memoryStore();
  const items = options.items ?? new Set<string>();
  const log: string[] = [];
  const hidden = new Set(options.hidden);
  let seeded = 0;

  const deps: TutorialDeps = {
    examples: {
      exists: (id) => items.has(id),
      remove: async (ids) => {
        log.push(`removed ${ids.join(",")}`);
        await options.removing;

        const removed = ids.filter((id) => options.stuck?.has(id) !== true);

        for (const id of removed) {
          items.delete(id);
        }

        return removed;
      },
      seed: () => {
        seeded += 1;

        const ids = [`example-${seeded}a`, `example-${seeded}b`];

        for (const id of ids) {
          items.add(id);
        }

        return ids;
      },
    },
    firstRun: async () => await Promise.resolve(options.firstRun ?? true),
    hints: HINTS,
    home: "shelf",
    onChange: () => {
      log.push("change");
    },
    onHintShown: (shown) => {
      log.push(`shown ${shown.id}`);
    },
    pageVisible: (page) => !hidden.has(page),
    spotlight: [
      { anchor: "list", id: "list", text: "Your list.", title: "The shelf" },
    ],
    store,
    tasks: TASKS,
    doneText: "All done.",
    title: "Getting started",
    warn: (message) => {
      log.push(`warn ${message}`);
    },
  };

  const tutorial = createTutorial(deps);

  await tutorial.load();

  const act = (page: string, action: TutorialAction): void => {
    tutorial.act(page, action);
  };

  /** What a page shows: its bubble, or that it asks for none (busy), or that it may ask (free). */
  const state = (page: string): string => {
    const { active, busy } = tutorial.view(page);

    if (active !== null) {
      return active.id;
    }

    return busy ? "busy" : "free";
  };

  const bubbles = () =>
    Object.fromEntries(
      ["shelf", "picker", "drawing"].map((page) => [page, state(page)])
    );

  return { act, bubbles, hidden, items, log, store, tutorial };
};

describe(createTutorial, () => {
  it("ticks a task off only when the app says it was done, and keeps it across restarts", async () => {
    const store = memoryStore();
    const { act, tutorial } = await setUp({ store });

    act("shelf", { id: "double-shift", kind: "taskHint" });
    tutorial.complete("nope");

    expect(tutorial.view("shelf").checklist?.done).toBe(0);

    tutorial.complete("double-shift");

    // A restart reads what is saved: every change so far.
    await tutorial.settled();

    const again = await setUp({ store });

    expect({
      checklist: again.tutorial
        .view("shelf")
        .checklist?.tasks.map((task) => task.done),
      done: again.tutorial.view("shelf").checklist?.done,
    }).toStrictEqual({ checklist: [true, false], done: 1 });
  });

  it("says once that every task is done, then stays away", async () => {
    const store = memoryStore();
    const { act, tutorial } = await setUp({ store });

    tutorial.complete("double-shift");
    tutorial.complete("window-link");

    expect(tutorial.view("shelf").checklist).toMatchObject({
      complete: true,
      done: 2,
    });

    act("shelf", { kind: "dismissChecklist" });

    expect(tutorial.view("shelf").checklist).toBeNull();

    // A restart reads what is saved: every change so far.
    await tutorial.settled();

    const again = await setUp({ store });

    expect(again.tutorial.view("shelf").checklist).toBeNull();
  });

  it("saves one change at a time, so the last task's 'all done' is kept where saves can't overlap", async () => {
    const store = exclusiveStore();
    const { log, tutorial } = await setUp({ store });

    tutorial.complete("double-shift");
    // The last task: done, then celebrated, two changes in a row.
    tutorial.complete("window-link");

    await vi.waitFor(() => {
      expect(store.saved()).toMatchObject({
        celebrated: true,
        done: ["double-shift", "window-link"],
      });
    });
    expect(log.filter((line) => line.startsWith("warn"))).toStrictEqual([]);
  });

  it("lets a page release a bubble whose control isn't there, and offers a hint never drawn again", async () => {
    const { act, bubbles, tutorial } = await setUp();

    act("shelf", { id: "details", kind: "requestHint" });
    // Its control went away before the bubble was drawn: the page lets it go.
    act("shelf", { id: "details", kind: "dismissHint" });

    expect({
      bubbles: bubbles(),
      offered: tutorial.view("shelf").hints.map((each) => each.id),
    }).toStrictEqual({
      bubbles: { drawing: "free", picker: "free", shelf: "free" },
      offered: ["details"],
    });
  });

  it("closes the checklist, and Getting Started brings it back", async () => {
    const { act, tutorial } = await setUp();

    act("shelf", { kind: "dismissChecklist" });

    expect(tutorial.view("shelf").checklist).toBeNull();

    tutorial.showChecklist();

    expect(tutorial.view("shelf").checklist?.complete).toBeFalsy();
  });

  it("shows one bubble at a time, and the next once the first is gone", async () => {
    const { act, bubbles } = await setUp();

    act("picker", { id: "picker", kind: "requestHint" });
    act("drawing", { id: "drawing", kind: "requestHint" });

    expect(bubbles()).toStrictEqual({
      drawing: "busy",
      picker: "picker",
      shelf: "busy",
    });

    act("picker", { id: "picker", kind: "hintShown" });
    act("picker", { id: "picker", kind: "dismissHint" });
    act("drawing", { id: "drawing", kind: "requestHint" });

    expect(bubbles()).toStrictEqual({
      drawing: "drawing",
      picker: "busy",
      shelf: "busy",
    });
  });

  it("never shows a hint again once it was drawn, even across restarts", async () => {
    const store = memoryStore();
    const { act, log, tutorial } = await setUp({ store });

    act("picker", { id: "picker", kind: "requestHint" });
    act("picker", { id: "picker", kind: "hintShown" });
    act("picker", { id: "picker", kind: "dismissHint" });
    act("picker", { id: "picker", kind: "requestHint" });

    expect({
      active: tutorial.view("picker").active,
      offered: tutorial.view("picker").hints,
      shown: log.filter((line) => line.startsWith("shown")),
    }).toStrictEqual({ active: null, offered: [], shown: ["shown picker"] });

    // A restart reads what is saved: every change so far.
    await tutorial.settled();

    const again = await setUp({ store });

    expect(again.tutorial.view("picker").hints).toStrictEqual([]);
  });

  it("lets go of a bubble whose window was hidden before it was drawn, so other hints aren't blocked and it can come back", async () => {
    const { act, bubbles, hidden, tutorial } = await setUp();

    act("picker", { id: "picker", kind: "requestHint" });
    hidden.add("picker");
    tutorial.pageClosed("picker");
    act("drawing", { id: "drawing", kind: "requestHint" });

    expect(bubbles()).toMatchObject({ drawing: "drawing" });
    expect(tutorial.view("picker").hints.map((each) => each.id)).toStrictEqual([
      "picker",
    ]);
  });

  it("refuses a hint for a window that isn't on screen", async () => {
    const { act, bubbles } = await setUp({ hidden: ["shelf"] });

    act("shelf", { id: "details", kind: "requestHint" });

    expect(bubbles()).toMatchObject({ shelf: "free" });
  });

  it("refuses a hint asked for from another page", async () => {
    const { act, bubbles } = await setUp();

    act("shelf", { id: "picker", kind: "requestHint" });

    expect(bubbles()).toMatchObject({ picker: "free", shelf: "free" });
  });

  it("holds every hint while the walkthrough runs, and drops one not yet drawn", async () => {
    const { act, bubbles, tutorial } = await setUp();

    act("picker", { id: "picker", kind: "requestHint" });
    tutorial.showMeAround();

    expect({
      bubbles: bubbles(),
      spotlight: tutorial.view("shelf").spotlight?.seq,
    }).toStrictEqual({
      bubbles: { drawing: "busy", picker: "busy", shelf: "busy" },
      spotlight: 1,
    });

    act("drawing", { id: "drawing", kind: "requestHint" });
    act("shelf", { kind: "spotlightDone" });
    act("picker", { id: "picker", kind: "requestHint" });

    expect(bubbles()).toMatchObject({ picker: "picker" });
  });

  it("offers no hints with tips off, and takes one away that shows", async () => {
    const { act, bubbles, tutorial } = await setUp();

    act("picker", { id: "picker", kind: "requestHint" });
    tutorial.setTips(false);
    act("drawing", { id: "drawing", kind: "requestHint" });

    expect({
      bubbles: bubbles(),
      offered: tutorial.view("drawing").hints,
    }).toStrictEqual({
      bubbles: { drawing: "free", picker: "free", shelf: "free" },
      offered: [],
    });
  });

  it("shows a task's how-to when it is clicked, and doing the task takes it and its hint away", async () => {
    const { act, tutorial } = await setUp();

    act("shelf", { id: "window-link", kind: "taskHint" });

    expect(tutorial.view("shelf").active).toMatchObject({
      anchor: "add-button",
      kind: "task",
      text: "Press ⇧⌘L.",
    });

    tutorial.complete("window-link");

    expect({
      active: tutorial.view("shelf").active,
      picker: tutorial.view("picker").hints,
    }).toStrictEqual({ active: null, picker: [] });
  });

  it("points a task without its own anchor at its checklist row", async () => {
    const { act, tutorial } = await setUp();

    act("shelf", { id: "double-shift", kind: "taskHint" });

    expect(tutorial.view("shelf").active?.anchor).toBe("task-double-shift");
  });

  it("adds the examples on the very first run only, and never again once removed", async () => {
    const store = memoryStore();
    const { act, items, log, tutorial } = await setUp({ store });

    expect({
      examples: tutorial.view("shelf").examples,
      menu: tutorial.view("shelf").checklist?.examples,
    }).toStrictEqual({
      examples: ["example-1a", "example-1b"],
      menu: true,
    });

    act("shelf", { kind: "removeExamples" });
    // A restart reads what is saved: every change so far.
    await tutorial.settled();

    expect({
      examples: tutorial.view("shelf").examples,
      items: [...items],
      log: log.filter((line) => line.startsWith("removed")),
    }).toStrictEqual({
      examples: [],
      items: [],
      log: ["removed example-1a,example-1b"],
    });

    const again = await setUp({ store });

    expect(again.items.size).toBe(0);
  });

  it("keeps an example the app couldn't remove tagged, and offers to remove it again, after a restart too", async () => {
    const store = memoryStore();
    const items = new Set<string>();
    const first = await setUp({ items, store, stuck: new Set(["example-1b"]) });

    first.act("shelf", { kind: "removeExamples" });
    await first.tutorial.settled();

    const kept = {
      examples: first.tutorial.view("shelf").examples,
      offered: first.tutorial.view("shelf").checklist?.examples,
    };

    const again = await setUp({ items, store });

    again.act("shelf", { kind: "removeExamples" });
    await again.tutorial.settled();

    expect({
      after: again.tutorial.view("shelf").examples,
      items: [...items],
      kept,
      tried: again.log.filter((line) => line.startsWith("removed")),
    }).toStrictEqual({
      after: [],
      items: [],
      kept: { examples: ["example-1b"], offered: true },
      tried: ["removed example-1b"],
    });
  });

  it("keeps examples tagged while their removal is under way, and starts it once", async () => {
    const queue = new EventTarget();

    const { act, log, tutorial } = await setUp({
      removing: once(queue, "done"),
    });

    act("shelf", { kind: "removeExamples" });
    act("shelf", { kind: "removeExamples" });

    const during = tutorial.view("shelf").examples;

    queue.dispatchEvent(new Event("done"));
    await tutorial.settled();

    expect({
      after: tutorial.view("shelf").examples,
      during,
      tried: log.filter((line) => line.startsWith("removed")).length,
    }).toStrictEqual({
      after: [],
      during: ["example-1a", "example-1b"],
      tried: 1,
    });
  });

  it("adds no examples to an install that ran before, nor after a damaged file", async () => {
    const before = await setUp({ firstRun: false });
    const damaged = await setUp({ firstRun: false, store: memoryStore(null) });

    expect({
      before: before.items.size,
      damaged: damaged.items.size,
      seeded: before.store.saved()?.examplesSeeded,
    }).toStrictEqual({ before: 0, damaged: 0, seeded: true });
  });

  it("drops an example deleted by hand from the list it tags", async () => {
    const { items, tutorial } = await setUp();

    items.delete("example-1a");

    expect(tutorial.view("shelf").examples).toStrictEqual(["example-1b"]);
  });

  it("starts the checklist and hints over on Reset, with tips on, and keeps the examples as they are", async () => {
    const { act, tutorial } = await setUp();

    tutorial.complete("double-shift");
    act("picker", { id: "picker", kind: "requestHint" });
    act("picker", { id: "picker", kind: "hintShown" });
    act("shelf", { kind: "dismissChecklist" });
    tutorial.setTips(false);
    tutorial.reset();

    expect({
      checklist: tutorial.view("shelf").checklist?.done,
      examples: tutorial.view("shelf").examples.length,
      hints: tutorial.view("picker").hints.map((each) => each.id),
      tips: tutorial.tips(),
    }).toStrictEqual({
      checklist: 0,
      examples: 2,
      hints: ["picker"],
      tips: true,
    });
  });

  it("collapses the checklist and remembers it", async () => {
    const store = memoryStore();
    const { act, tutorial } = await setUp({ store });

    act("shelf", { collapsed: true, kind: "collapse" });

    // A restart reads what is saved: every change so far.
    await tutorial.settled();

    const again = await setUp({ store });

    expect(again.tutorial.view("shelf").checklist?.collapsed).toBeTruthy();
  });
});

describe(createTutorialStore, () => {
  it("writes one record at a time, in order, so the newest is the one kept, even after a failed write", async () => {
    let text = "";
    let calls = 0;
    let writing = 0;
    let most = 0;

    // The first write is slow and fails: an unordered second write would land first, then be overwritten or lost.
    const store = createTutorialStore("/data/tutorial.json", {
      readFile: async () => await Promise.resolve(text),
      writeAtomic: async (_file: string, data: string) => {
        calls += 1;

        const call = calls;

        writing += 1;
        most = Math.max(most, writing);
        await sleep(call === 1 ? 30 : 1);
        writing -= 1;

        if (call === 1) {
          throw new Error("EPERM: operation not permitted, rename");
        }

        text = data;
      },
    });

    const newest = { ...freshRecord(), celebrated: true };

    const results = await Promise.allSettled([
      store.write(freshRecord()),
      store.write(newest),
    ]);

    expect({
      most,
      saved: await store.read(),
      statuses: results.map((result) => result.status),
    }).toStrictEqual({
      most: 1,
      saved: newest,
      statuses: ["rejected", "fulfilled"],
    });
  });

  it("reads a missing or damaged file as no record, and writes one back", async () => {
    let text: string | undefined;

    const fs = {
      readFile: async () => {
        if (text === undefined) {
          throw new Error("ENOENT");
        }

        return await Promise.resolve(text);
      },
      writeAtomic: async (_file: string, data: string) => {
        text = data;
        await Promise.resolve();
      },
    };

    const store = createTutorialStore("/data/tutorial.json", fs);

    await expect(store.read()).resolves.toBeNull();

    text = "{nope";

    await expect(store.read()).resolves.toBeNull();

    await store.write(freshRecord());

    await expect(store.read()).resolves.toStrictEqual(freshRecord());
  });
});
