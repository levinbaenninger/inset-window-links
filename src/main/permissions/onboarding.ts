import type {
  DragTileView,
  HandOff,
  HandOffChoice,
  OnboardingStep,
  OnboardingView,
  PermissionId,
} from "@shared/onboarding";

import {
  ACCESS,
  allGranted,
  decideLaunch,
  DONE,
  nextStep,
  plannedSteps,
  previousStep,
  record,
  rowState,
  WELCOME,
} from "./flow";
import type { FlowConfig, OnboardingRecord } from "./flow";
import { createSafeRelaunch } from "./relaunch";
import type { OnboardingStore } from "./store";
import { DEFAULT_TITLES, listName, SEEN_LIVE } from "./system";
import type { PermissionChecks } from "./system";

/** The beat between the last row turning green and Done. */
export const ADVANCE_MS = 700;

/** One permission the app asks for, with what it does with it. */
export interface PermissionEntry {
  readonly id: PermissionId;
  /** What the app does with it, in one sentence. */
  readonly purpose: string;
  /** Defaults to the permission's usual name. */
  readonly title?: string;
  /** The features it turns on, written to follow "to use": Double Shift, window links. */
  readonly features?: readonly string[];
}

/**
 * Where and how the window shows. Allow access floats above everything on
 * every Space; once System Settings is open the window moves to the edge
 * of the screen and shows without taking the keyboard from it.
 */
export interface Presentation {
  readonly floating: boolean;
  /** `keep` stays where it is, centred when it wasn't showing. */
  readonly place: "center" | "edge" | "keep";
  readonly focus: boolean;
}

export interface OnboardingWindow {
  readonly present: (presentation: Presentation) => void;
  readonly hide: () => void;
}

/** How the window closed: Done's two ways into the app, or Not now. */
export type Closed = HandOffChoice | "skipped";

export interface OnboardingDeps {
  readonly appName: string;
  /** Welcome's one line on what the app is. */
  readonly tagline: string;
  /** Done's buttons: start using the app, and a walkthrough when the app has one. */
  readonly handOff: HandOff;
  readonly mac: boolean;
  readonly osMajor: number;
  readonly permissions: readonly PermissionEntry[];
  readonly checks: PermissionChecks;
  readonly store: OnboardingStore;
  /** The app has run before this flow existed: its data is there. */
  readonly ranBefore: () => Promise<boolean>;
  readonly window: OnboardingWindow;
  /** The app's tile for dragging into System Settings, or null. */
  readonly tile: () => DragTileView | null;
  readonly setTimer: (run: () => void, ms: number) => () => void;
  /** The app's normal quit, running `atExit` just before it exits; see createSafeRelaunch. */
  readonly quit: (atExit: () => void) => void;
  readonly relaunch: () => void;
  /** The shared permission poll speeds up while Allow access waits on a live permission. */
  readonly pollFast: (on: boolean) => void;
  /** The first-run flow is over, finished or skipped: work it held back (prompts of its own) can start. */
  readonly onEnded: () => void;
  /** Every close: the app takes over, with its walkthrough for `showAround`. */
  readonly onClosed: (how: Closed) => void;
  readonly onView: (view: OnboardingView) => void;
  readonly warn?: (message: string) => void;
}

export interface Onboarding {
  /** Decides at launch whether to show; true when it does. */
  readonly launch: () => Promise<boolean>;
  /** Set Up Permissions…, the banner or the picker: Allow access, with that permission's row picked out. */
  readonly open: (focus?: PermissionId) => void;
  /** Back: the page before. */
  readonly back: () => void;
  /** A row's Allow (and Waiting…, which asks again). */
  readonly allow: (id: PermissionId) => void;
  /** Reopen to finish: quits through the app's quit path and opens again. */
  readonly reopen: () => Promise<void>;
  /** Get Started, Continue, or Not now on Allow access: the next page. */
  readonly next: () => void;
  /** Not now on Welcome: ends the flow. */
  readonly skip: () => void;
  /** Done's buttons. */
  readonly finish: (how: HandOffChoice) => void;
  /** The window's close button or ⌘W: Done on the last page, else Not now for the whole flow. */
  readonly close: () => void;
  /** Reads the permissions again; the shared poll calls it. */
  readonly observe: () => void;
  /** The quit the reopen started was cancelled. */
  readonly quitCancelled: () => void;
  /** The first-run flow is over, or never was: held-back work may start. */
  readonly settled: () => boolean;
  readonly isOpen: () => boolean;
  readonly view: () => OnboardingView;
}

export const createOnboarding = (deps: OnboardingDeps): Onboarding => {
  const config: FlowConfig = {
    permissions: deps.permissions.map((entry) => entry.id),
  };

  let step: OnboardingStep = WELCOME;
  let steps: readonly OnboardingStep[] = [WELCOME, ACCESS, DONE];
  let focus: PermissionId | null = null;
  let open = false;
  let settled = false;
  // How the flow last ended; once it has, a flow opened again saves its place only on Allow access.
  let endedAs: "finished" | "skipped" = "finished";
  // Allow was pressed for these since launch.
  const asked = new Set<PermissionId>();
  // What each permission was at the last look, so a grant is seen as it happens.
  const seen = new Map<PermissionId, boolean>();
  let cancelAdvance: (() => void) | null = null;

  const emit = (): void => {
    // oxlint-disable-next-line no-use-before-define -- the view is built from the state below.
    deps.onView(view());
  };

  const relaunch = createSafeRelaunch({
    onChange: emit,
    quit: deps.quit,
    relaunch: deps.relaunch,
  });

  const granted = (id: PermissionId): boolean => deps.checks.granted(id);

  const view = (): OnboardingView => ({
    appName: deps.appName,
    focus,
    handOff: deps.handOff,
    permissions: deps.permissions.map((entry) => ({
      features: entry.features ?? [],
      id: entry.id,
      listName: listName(entry.id, deps.osMajor),
      purpose: entry.purpose,
      state: rowState({
        asked: asked.has(entry.id),
        granted: granted(entry.id),
        live: SEEN_LIVE[entry.id],
        relaunching: relaunch.pending(),
      }),
      title: entry.title ?? DEFAULT_TITLES[entry.id],
    })),
    step,
    steps,
    tagline: deps.tagline,
    tile: deps.tile(),
  });

  const save = async (saved: OnboardingRecord): Promise<void> => {
    try {
      await deps.store.write(saved);
    } catch (error) {
      deps.warn?.(
        `Onboarding not saved: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const stopAdvance = (): void => {
    cancelAdvance?.();
    cancelAdvance = null;
  };

  /** Allow access is open on a permission the app sees as it is granted. */
  const watching = (): boolean =>
    open &&
    step.kind === "access" &&
    config.permissions.some((id) => SEEN_LIVE[id] && !granted(id));

  const firstMissing = (): PermissionId | null =>
    config.permissions.find((id) => !granted(id)) ?? null;

  const remember = (): void => {
    for (const id of config.permissions) {
      seen.set(id, granted(id));
    }
  };

  /** Shows a page: Allow access floats above everything, the others come to the middle. */
  const show = (
    next: OnboardingStep,
    presentation: Omit<Presentation, "floating">
  ): void => {
    stopAdvance();
    step = next;
    open = true;
    remember();
    deps.window.present({ ...presentation, floating: next.kind === "access" });
    deps.pollFast(watching());
    // A flow opened again after it ended comes back at the next launch only from Allow access, for the reopen Screen Recording needs.
    void save(
      settled && next.kind !== "access"
        ? record(endedAs, DONE)
        : record("active", next)
    );
    emit();
  };

  /** Goes to a page; after a grant the user is still in System Settings, so the window doesn't take the keyboard. */
  const goTo = (
    next: OnboardingStep,
    options: { readonly fromGrant: boolean }
  ): void => {
    if (next.kind === "access") {
      show(next, { focus: !options.fromGrant, place: "keep" });
    } else {
      show(next, { focus: true, place: "center" });
    }
  };

  const advanceSoon = (): void => {
    stopAdvance();
    cancelAdvance = deps.setTimer(() => {
      cancelAdvance = null;
      goTo(nextStep(steps, step), { fromGrant: true });
    }, ADVANCE_MS);
  };

  /** Fixes the pages of this run, from the page it opens on. */
  const plan = (from: OnboardingStep): void => {
    steps = plannedSteps(config, from, granted);
  };

  const end = (how: "finished" | "skipped"): void => {
    stopAdvance();
    open = false;
    deps.window.hide();
    deps.pollFast(false);
    void save(record(how, DONE));
    endedAs = how;

    if (!settled) {
      settled = true;
      deps.onEnded();
    }
  };

  const skip = (): void => {
    end("skipped");
    deps.onClosed("skipped");
  };

  const finish = (how: HandOffChoice): void => {
    end("finished");
    deps.onClosed(
      how === "showAround" && deps.handOff.showAround !== null ? how : "start"
    );
  };

  return {
    allow: (id) => {
      if (!deps.mac || granted(id)) {
        return;
      }

      stopAdvance();
      asked.add(id);
      focus = id;
      step = ACCESS;
      deps.checks.prompt(id);
      deps.checks.openPane(id);
      // System Settings takes the screen's middle: the window moves aside and stays above it without taking the keyboard.
      deps.window.present({ floating: true, focus: false, place: "edge" });
      deps.pollFast(watching());
      void save(record("active", step));
      emit();
    },
    back: () => {
      if (open && step.kind !== "welcome") {
        goTo(previousStep(steps, step), { fromGrant: false });
      }
    },
    close: () => {
      if (step.kind === "done") {
        finish("start");
      } else {
        skip();
      }
    },
    finish,
    isOpen: () => open,
    launch: async () => {
      const saved = await deps.store.read();

      const decision = decideLaunch({
        config,
        granted,
        mac: deps.mac,
        ranBefore: await deps.ranBefore(),
        saved,
      });

      if (decision.write !== null) {
        await save(decision.write);
      }

      if (decision.kind === "none") {
        settled = true;
        endedAs = saved?.status === "skipped" ? "skipped" : "finished";

        return false;
      }

      plan(decision.step);
      focus = firstMissing();
      show(decision.step, { focus: true, place: "center" });

      if (decision.advance) {
        advanceSoon();
      }

      return true;
    },
    next: () => {
      if (open) {
        goTo(nextStep(steps, step), { fromGrant: false });
      }
    },
    observe: () => {
      let changed = false;

      for (const id of config.permissions) {
        const now = granted(id);
        const before = seen.get(id) ?? now;

        seen.set(id, now);

        if (now !== before) {
          changed = true;
        }
      }

      if (!changed) {
        return;
      }

      if (open && step.kind === "access") {
        if (allGranted(config, granted)) {
          // The last row turns green; a beat later Done comes.
          advanceSoon();
        } else if (focus !== null && granted(focus)) {
          focus = firstMissing();
        }
      }

      deps.pollFast(watching());
      emit();
    },
    open: (target) => {
      if (!deps.mac) {
        return;
      }

      plan(ACCESS);
      focus = target ?? firstMissing();
      show(ACCESS, { focus: true, place: open ? "keep" : "center" });
    },
    quitCancelled: () => {
      relaunch.disarm();
    },
    reopen: async () => {
      if (relaunch.pending() || step.kind !== "access") {
        return;
      }

      stopAdvance();
      // Written before the quit starts: the reopened app lands on this page and sees it granted.
      await save(record("active", ACCESS));
      relaunch.request();
    },
    settled: () => settled,
    skip,
    view,
  };
};
