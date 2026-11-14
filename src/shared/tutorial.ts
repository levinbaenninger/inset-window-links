/**
 * The in-app tutorial's shared types: part of the portable kit with
 * src/main/tutorial/ and src/renderer/tutorial/. It imports nothing from
 * the rest of the app. An app describes its tutorial as plain data (tasks,
 * hints, spotlight steps) and marks the real controls they point at with
 * `data-coach="<anchor id>"`.
 */
import { z } from "zod";

/** Task, hint, step and anchor ids: short, lowercase, dashed. */
export const CoachIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/u);

/** One thing to learn by doing, on the Getting started checklist. */
export interface TutorialTask {
  readonly id: string;
  readonly title: string;
  /** The real shortcut or gesture, as the system writes it (⇧ ⇧, ⇧⌘4); null when it has none. */
  readonly keys: string | null;
  /** Shown in a bubble when the task is clicked: how to do it. */
  readonly how: string;
  /** The control that bubble points at, on the checklist's page; null points at the task's own row. */
  readonly anchor: string | null;
}

/**
 * Where a bubble goes beside its anchor. `inside` overlaps it, for an anchor
 * that fills its window, and goes away once the pointer moves onto the
 * anchor, so it never hides the controls it describes.
 */
export type BubblePlacement = "below" | "above" | "inside";

/** A one-time hint: shown the first time its anchor is on screen, then never again. */
export interface TutorialHint {
  readonly id: string;
  /** The window it shows in, as the app names its pages. */
  readonly page: string;
  readonly anchor: string;
  readonly title: string | null;
  readonly text: string;
  readonly placement: BubblePlacement;
  /** A task that, once done, makes the hint moot: it is no longer offered, and goes away if showing. */
  readonly task: string | null;
}

/** One stop of the spotlight walkthrough. A step whose anchor isn't on screen is skipped. */
export interface SpotlightStep {
  readonly id: string;
  readonly anchor: string;
  readonly title: string;
  readonly text: string;
}

export interface ChecklistTaskView extends TutorialTask {
  readonly done: boolean;
}

export interface ChecklistView {
  readonly title: string;
  readonly tasks: readonly ChecklistTaskView[];
  readonly done: number;
  readonly total: number;
  /** Every task done: the card says so, once, until it is closed. */
  readonly complete: boolean;
  /** What the card says then: where to bring it back from, in the app's words. */
  readonly doneText: string;
  readonly collapsed: boolean;
  /** Example items are on the shelf, so the card's menu offers to remove them. */
  readonly examples: boolean;
}

/** The bubble showing now: a one-time hint, or a task's how-to. */
export interface ShownHint {
  readonly kind: "hint" | "task";
  readonly id: string;
  readonly anchor: string;
  readonly title: string | null;
  readonly text: string;
  readonly placement: BubblePlacement;
}

/** What one page of the app sees of the tutorial. */
export interface TutorialView {
  /** Hints this page may ask to show, once their anchor is on screen; empty with tips off. */
  readonly hints: readonly TutorialHint[];
  /** The one bubble showing anywhere, when it is on this page. */
  readonly active: ShownHint | null;
  /** A bubble shows on another page, or the walkthrough runs: this page asks for no hint. */
  readonly busy: boolean;
  /** The checklist, on the page that has it; null when closed. */
  readonly checklist: ChecklistView | null;
  /** The walkthrough, on the page that runs it; `seq` changes with every start. */
  readonly spotlight: {
    readonly seq: number;
    readonly steps: readonly SpotlightStep[];
  } | null;
  /** Ids of the example items, which the page tags as examples. */
  readonly examples: readonly string[];
}

/** No tutorial: what a page shows before the first view arrives, or in a harness without one. */
export const NO_TUTORIAL: TutorialView = {
  active: null,
  busy: false,
  checklist: null,
  examples: [],
  hints: [],
  spotlight: null,
};

/** What a page tells main: every input is validated, as with any contract. */
export const TutorialActionSchema = z.discriminatedUnion("kind", [
  /** A hint's anchor is on screen and nothing else is showing: may it show? */
  z.object({ id: CoachIdSchema, kind: z.literal("requestHint") }),
  /** The bubble was drawn: the hint is seen and never comes back. */
  z.object({ id: CoachIdSchema, kind: z.literal("hintShown") }),
  /** Got it, Escape, a click elsewhere, or using the control. */
  z.object({ id: CoachIdSchema, kind: z.literal("dismissHint") }),
  /** A checklist task was clicked: its how-to. Clicking never ticks it off. */
  z.object({ id: CoachIdSchema, kind: z.literal("taskHint") }),
  z.object({ collapsed: z.boolean(), kind: z.literal("collapse") }),
  z.object({ kind: z.literal("dismissChecklist") }),
  z.object({ kind: z.literal("removeExamples") }),
  z.object({ kind: z.literal("spotlightDone") }),
]);

export type TutorialAction = z.output<typeof TutorialActionSchema>;
