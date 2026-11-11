import type {
  TutorialAction,
  TutorialHint,
  TutorialTask,
} from "@shared/tutorial";
import { describe, expect, it } from "vitest";

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

const setUp = async (
  options: {
    readonly store?: ReturnType<typeof memoryStore>;
    readonly firstRun?: boolean;
    readonly hidden?: readonly string[];
  } = {}
) => {
  const store = options.store ?? memoryStore();
  const items = new Set<string>();
  const log: string[] = [];
  const hidden = new Set(options.hidden);
  let seeded = 0;

  const deps: TutorialDeps = {
    examples: {
      exists: (id) => items.has(id),
      remove: (ids) => {
        for (const id of ids) {
          items.delete(id);
        }

        log.push(`removed ${ids.join(",")}`);
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

    const again = await setUp({ store });

    expect(again.tutorial.view("shelf").checklist).toBeNull();
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
    const { act } = await setUp({ store });

    act("shelf", { collapsed: true, kind: "collapse" });

    const again = await setUp({ store });

    expect(again.tutorial.view("shelf").checklist?.collapsed).toBeTruthy();
  });
});

describe(createTutorialStore, () => {
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
