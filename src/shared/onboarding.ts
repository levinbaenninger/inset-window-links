/**
 * The permission onboarding's shared types: part of the portable kit with
 * src/main/permissions/ and src/renderer/onboarding/. It imports nothing
 * from the rest of the app, so the kit can be copied to another Inset app
 * as these three places.
 */
import { z } from "zod";

/** The macOS privacy permissions the kit knows how to ask for. */
export const PermissionIdSchema = z.enum(["accessibility", "screen"]);

export type PermissionId = z.output<typeof PermissionIdSchema>;

/** The three pages: Welcome, Allow access (every permission on one page), Done. */
export const OnboardingStepSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("welcome") }),
  z.object({ kind: z.literal("access") }),
  z.object({ kind: z.literal("done") }),
]);

export type OnboardingStep = z.output<typeof OnboardingStepSchema>;

/**
 * A permission row's one control: Allow, then Waiting… while the user turns
 * it on in System Settings, then Allowed. A permission the app only sees
 * after a restart offers Reopen to finish instead of waiting, and Reopening…
 * while the quit is under way.
 */
export type PermissionRowState =
  | "allow"
  | "waiting"
  | "allowed"
  | "reopen"
  | "reopening";

/** One permission as the page shows it: plain data, so another app can pass its own list. */
export interface PermissionRowView {
  readonly id: PermissionId;
  readonly title: string;
  /** What the app does with it, in one sentence. */
  readonly purpose: string;
  /** The features it turns on, written to follow "to use": Double Shift, window links. */
  readonly features: readonly string[];
  /** The Privacy & Security list it is turned on in, for "Drag … into the … list". */
  readonly listName: string;
  readonly state: PermissionRowState;
}

/** The app's tile as System Settings lists it: dragged into the list when the app isn't there. */
export interface DragTileView {
  readonly name: string;
  /** The app's icon as a data URL. */
  readonly icon: string;
}

/** How Done hands over to the app: always a way to start, and a walkthrough when the app has one. */
export interface HandOff {
  readonly start: string;
  readonly showAround: string | null;
  /** Done's line with every permission allowed. */
  readonly ready: string;
  /** Done's line with some skipped: where to ask again, in the app's words. */
  readonly later: string;
}

export type HandOffChoice = "start" | "showAround";

export const HandOffChoiceSchema = z.enum(["start", "showAround"]);

export interface OnboardingView {
  readonly appName: string;
  /** Welcome's one line on what the app is. */
  readonly tagline: string;
  readonly step: OnboardingStep;
  /** The pages this run shows, in order, for the dots and Back: Allow access is left out when nothing is missing. */
  readonly steps: readonly OnboardingStep[];
  readonly permissions: readonly PermissionRowView[];
  /** The row being asked for: it stands out and offers the drag tile while it waits. */
  readonly focus: PermissionId | null;
  /** Null in development, outside an app bundle, or when the icon couldn't be read. */
  readonly tile: DragTileView | null;
  readonly handOff: HandOff;
}

/** Whether two steps are the same one. */
export const sameStep = (a: OnboardingStep, b: OnboardingStep): boolean =>
  a.kind === b.kind;
