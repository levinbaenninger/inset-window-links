import type {
  ShownHint,
  SpotlightStep,
  TutorialAction,
  TutorialHint,
  TutorialTask,
  TutorialView,
} from "@shared/tutorial";

import { freshRecord } from "./store";
import type { TutorialRecord, TutorialStore } from "./store";

/**
 * The app's example items: added on the very first run only, removed on
 * request. `seed` returns their ids.
 */
export interface TutorialExamples {
  readonly seed: () => readonly string[];
  readonly remove: (ids: readonly string[]) => void;
  /** Whether the item is still there; one deleted by hand is no longer an example to show or remove. */
  readonly exists: (id: string) => boolean;
}

export interface TutorialDeps {
  readonly tasks: readonly TutorialTask[];
  readonly hints: readonly TutorialHint[];
  readonly spotlight: readonly SpotlightStep[];
  /** The page that shows the checklist and runs the walkthrough: the app's main window. */
  readonly home: string;
  /** The checklist's title, "Getting started". */
  readonly title: string;
  /** What the checklist says once every task is done. */
  readonly doneText: string;
  readonly store: TutorialStore;
  /** No earlier run left data behind: the examples are added only then. */
  readonly firstRun: () => Promise<boolean>;
  readonly examples: TutorialExamples | null;
  /** Whether a page's window is on screen: a hidden window can't show the one hint there may be. */
  readonly pageVisible: (page: string) => boolean;
  /** A hint was drawn, so the app can keep its window up meanwhile (a card that would hide on its own). */
  readonly onHintShown?: (hint: TutorialHint) => void;
  readonly onChange: () => void;
  readonly warn?: (message: string) => void;
}

export interface Tutorial {
  /** Reads the saved state; on the very first run, adds the examples. */
  readonly load: () => Promise<void>;
  readonly view: (page: string) => TutorialView;
  /** The user really did a task, where the app does it: a saved selection, a linked window. */
  readonly complete: (task: string) => void;
  /** What a page asks or reports. */
  readonly act: (page: string, action: TutorialAction) => void;
  /** A window was hidden: a bubble it held lets go. */
  readonly pageClosed: (page: string) => void;
  /** Help › Getting Started: the checklist comes back. */
  readonly showChecklist: () => void;
  /** Done's Show Me Around and Help › Show Me Around. */
  readonly showMeAround: () => void;
  readonly walking: () => boolean;
  readonly tips: () => boolean;
  /** Settings › Show tips. */
  readonly setTips: (on: boolean) => void;
  /** Settings › Reset Tutorial: the checklist and hints start over; examples are never added again. */
  readonly reset: () => void;
  /** Resolves once every change so far is saved (or failed to save): saves run one at a time. */
  readonly settled: () => Promise<void>;
}

type Of<K extends TutorialAction["kind"]> = Extract<
  TutorialAction,
  { readonly kind: K }
>;

type Active =
  | (ShownHint & { readonly page: string; readonly shown: boolean })
  | null;

export const createTutorial = (deps: TutorialDeps): Tutorial => {
  let saved: TutorialRecord = freshRecord();
  let active: Active = null;
  let walk: { readonly seq: number } | null = null;
  let walkSeq = 0;
  // The checklist says "all done" from the moment the last task is done until it is closed.
  let celebrating = false;

  const tasks = new Map(deps.tasks.map((task) => [task.id, task]));
  const hints = new Map(deps.hints.map((hint) => [hint.id, hint]));

  const write = async (): Promise<void> => {
    try {
      await deps.store.write(saved);
    } catch (error) {
      deps.warn?.(
        `Tutorial not saved: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  // One save at a time: on Windows an atomic write that overlaps another fails (EPERM), and the newer state was lost.
  // A change made meanwhile is saved once the running save is done, as the state is then.
  let saving: Promise<void> | null = null;
  let saveAgain = false;

  const flush = async (): Promise<void> => {
    saveAgain = false;
    await write();

    if (saveAgain) {
      await flush();
    }
  };

  const persist = (): void => {
    if (saving !== null) {
      saveAgain = true;

      return;
    }

    saving = flush().finally(() => {
      saving = null;
    });
  };

  const change = (next: Partial<TutorialRecord>): void => {
    saved = { ...saved, ...next };
    persist();
  };

  const allDone = (): boolean =>
    deps.tasks.every((task) => saved.done.includes(task.id));

  /** A hint is offered while tips are on, it hasn't been seen, and its task isn't done. */
  const offered = (hint: TutorialHint): boolean =>
    saved.tips &&
    !saved.seen.includes(hint.id) &&
    (hint.task === null || !saved.done.includes(hint.task));

  /** The bubble lets go of a page that isn't on screen any more. */
  const settleActive = (): void => {
    if (active !== null && !deps.pageVisible(active.page)) {
      active = null;
    }
  };

  const examplesShown = (): readonly string[] =>
    deps.examples === null
      ? []
      : saved.examples.filter((id) => deps.examples?.exists(id) === true);

  const view = (page: string): TutorialView => {
    settleActive();

    const home = page === deps.home;
    const complete = allDone();

    const checklistOpen =
      home && !saved.checklistClosed && (complete ? celebrating : true);

    return {
      active:
        active?.page === page
          ? {
              anchor: active.anchor,
              id: active.id,
              kind: active.kind,
              placement: active.placement,
              text: active.text,
              title: active.title,
            }
          : null,
      busy: walk !== null || (active !== null && active.page !== page),
      checklist: checklistOpen
        ? {
            collapsed: saved.collapsed,
            complete,
            doneText: deps.doneText,
            done: deps.tasks.filter((task) => saved.done.includes(task.id))
              .length,
            examples: examplesShown().length > 0,
            tasks: deps.tasks.map((task) => ({
              ...task,
              done: saved.done.includes(task.id),
            })),
            title: deps.title,
            total: deps.tasks.length,
          }
        : null,
      examples: examplesShown(),
      hints: deps.hints.filter((hint) => hint.page === page && offered(hint)),
      spotlight:
        home && walk !== null ? { seq: walk.seq, steps: deps.spotlight } : null,
    };
  };

  const requestHint = (id: string): void => {
    const hint = hints.get(id);

    settleActive();

    if (
      hint === undefined ||
      !offered(hint) ||
      active !== null ||
      walk !== null ||
      !deps.pageVisible(hint.page)
    ) {
      return;
    }

    active = {
      anchor: hint.anchor,
      id: hint.id,
      kind: "hint",
      page: hint.page,
      placement: hint.placement,
      shown: false,
      text: hint.text,
      title: hint.title,
    };
    deps.onChange();
  };

  const markSeen = (id: string): void => {
    if (!saved.seen.includes(id)) {
      change({ seen: [...saved.seen, id] });
    }
  };

  const handlers = {
    collapse: (_page: string, action: Of<"collapse">) => {
      change({ collapsed: action.collapsed });
      deps.onChange();
    },
    dismissChecklist: () => {
      if (allDone()) {
        change({ celebrated: true });
      } else {
        change({ checklistClosed: true });
      }

      celebrating = false;

      if (active?.kind === "task") {
        active = null;
      }

      deps.onChange();
    },
    dismissHint: (page: string, action: Of<"dismissHint">) => {
      if (active?.id === action.id && active.page === page) {
        // A hint is seen once drawn (hintShown); one let go before that, because its control went away, comes back later.
        if (active.kind === "hint" && active.shown) {
          markSeen(active.id);
        }

        active = null;
        deps.onChange();
      }
    },
    hintShown: (page: string, action: Of<"hintShown">) => {
      const hint = hints.get(action.id);

      if (
        active?.kind === "hint" &&
        active.id === action.id &&
        active.page === page &&
        hint !== undefined
      ) {
        active = { ...active, shown: true };
        markSeen(action.id);
        deps.onHintShown?.(hint);
      }
    },
    removeExamples: () => {
      const ids = examplesShown();

      if (ids.length > 0) {
        deps.examples?.remove(ids);
      }

      change({ examples: [] });
      deps.onChange();
    },
    requestHint: (page: string, action: Of<"requestHint">) => {
      if (hints.get(action.id)?.page === page) {
        requestHint(action.id);
      }
    },
    spotlightDone: (page: string) => {
      if (page === deps.home && walk !== null) {
        walk = null;
        deps.onChange();
      }
    },
    taskHint: (page: string, action: Of<"taskHint">) => {
      const task = tasks.get(action.id);

      if (task === undefined || walk !== null || page !== deps.home) {
        return;
      }

      active = {
        anchor: task.anchor ?? `task-${task.id}`,
        id: task.id,
        kind: "task",
        page: deps.home,
        placement: "below",
        shown: true,
        text: task.how,
        title: task.title,
      };
      deps.onChange();
    },
  };

  const act = (page: string, action: TutorialAction): void => {
    switch (action.kind) {
      case "collapse": {
        handlers.collapse(page, action);
        break;
      }

      case "dismissChecklist": {
        handlers.dismissChecklist();
        break;
      }

      case "dismissHint": {
        handlers.dismissHint(page, action);
        break;
      }

      case "hintShown": {
        handlers.hintShown(page, action);
        break;
      }

      case "removeExamples": {
        handlers.removeExamples();
        break;
      }

      case "requestHint": {
        handlers.requestHint(page, action);
        break;
      }

      case "spotlightDone": {
        handlers.spotlightDone(page);
        break;
      }

      case "taskHint": {
        handlers.taskHint(page, action);
        break;
      }

      default: {
        break;
      }
    }
  };

  return {
    act,
    complete: (id) => {
      if (!tasks.has(id) || saved.done.includes(id)) {
        return;
      }

      change({ done: [...saved.done, id] });

      // Doing it answers its how-to, and any hint about it.
      if (
        active !== null &&
        (active.kind === "task"
          ? active.id === id
          : hints.get(active.id)?.task === id)
      ) {
        active = null;
      }

      if (allDone() && !saved.celebrated) {
        // Said once: the next launch doesn't show it again.
        celebrating = true;
        change({ celebrated: true });
      }

      deps.onChange();
    },
    load: async () => {
      const read = await deps.store.read();

      if (read !== null) {
        saved = read;

        return;
      }

      const first = await deps.firstRun();
      const ids = first && deps.examples !== null ? deps.examples.seed() : [];

      // A damaged or missing file after the first run never adds the examples again.
      saved = { ...freshRecord(), examples: [...ids], examplesSeeded: true };
      persist();
    },
    pageClosed: (page) => {
      if (active?.page === page) {
        active = null;
        deps.onChange();
      }

      if (page === deps.home && walk !== null) {
        walk = null;
        deps.onChange();
      }
    },
    reset: () => {
      saved = {
        ...freshRecord(),
        examples: saved.examples,
        examplesSeeded: saved.examplesSeeded,
      };
      celebrating = false;
      active = null;
      persist();
      deps.onChange();
    },
    settled: async () => {
      await saving;
    },
    setTips: (on) => {
      change({ tips: on });

      if (!on && active?.kind === "hint") {
        active = null;
      }

      deps.onChange();
    },
    showChecklist: () => {
      change({ checklistClosed: false });
      celebrating = allDone();
      deps.onChange();
    },
    showMeAround: () => {
      walkSeq += 1;
      walk = { seq: walkSeq };
      // The walkthrough takes the stage: a bubble showing now goes, and a hint not yet drawn can come back later.
      active = null;
      deps.onChange();
    },
    tips: () => saved.tips,
    view,
    walking: () => walk !== null,
  };
};
