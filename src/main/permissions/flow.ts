import { OnboardingStepSchema, sameStep } from "@shared/onboarding";
import type {
  OnboardingStep,
  PermissionId,
  PermissionRowState,
} from "@shared/onboarding";
import { z } from "zod";

/** The flow's shape: the permissions it asks for, in the order of their rows. */
export interface FlowConfig {
  readonly permissions: readonly PermissionId[];
}

export type Granted = (id: PermissionId) => boolean;

export const WELCOME: OnboardingStep = { kind: "welcome" };
export const ACCESS: OnboardingStep = { kind: "access" };
export const DONE: OnboardingStep = { kind: "done" };

/** Every page, in order: Welcome, Allow access (when there is anything to ask for), Done. */
export const flowSteps = (config: FlowConfig): readonly OnboardingStep[] => [
  WELCOME,
  ...(config.permissions.length > 0 ? [ACCESS] : []),
  DONE,
];

export const allGranted = (config: FlowConfig, granted: Granted): boolean =>
  config.permissions.every((id) => granted(id));

/**
 * The pages this run shows, fixed when the window opens so the dots and
 * Back don't change under the user: Allow access is left out when every
 * permission is already granted, unless the run opens on it.
 */
export const plannedSteps = (
  config: FlowConfig,
  current: OnboardingStep,
  granted: Granted
): readonly OnboardingStep[] =>
  flowSteps(config).filter(
    (step) =>
      step.kind !== "access" ||
      sameStep(step, current) ||
      !allGranted(config, granted)
  );

/** The page after `from` in the run; Done at the end. */
export const nextStep = (
  steps: readonly OnboardingStep[],
  from: OnboardingStep
): OnboardingStep => {
  const index = steps.findIndex((step) => sameStep(step, from));

  return steps[index + 1] ?? DONE;
};

/** The page before `from` in the run; Welcome at the start. */
export const previousStep = (
  steps: readonly OnboardingStep[],
  from: OnboardingStep
): OnboardingStep => {
  const index = steps.findIndex((step) => sameStep(step, from));

  return index > 0 ? (steps[index - 1] ?? WELCOME) : WELCOME;
};

/** Whether the step belongs to this flow, so a record from another version can't strand it. */
export const inFlow = (config: FlowConfig, step: OnboardingStep): boolean =>
  flowSteps(config).some((each) => sameStep(each, step));

export const OnboardingRecordSchema = z.object({
  /** Active: shown, and shown again at launch until it is finished or skipped. */
  status: z.enum(["active", "finished", "skipped"]),
  step: OnboardingStepSchema,
  version: z.literal(2),
});

export type OnboardingRecord = z.output<typeof OnboardingRecordSchema>;

export const record = (
  status: OnboardingRecord["status"],
  step: OnboardingStep
): OnboardingRecord => ({ status, step, version: 2 });

export type LaunchDecision =
  | {
      readonly kind: "none";
      /** The record to write: the first-run flag, so the flow never shows by itself again. */
      readonly write: OnboardingRecord | null;
    }
  | {
      readonly kind: "show";
      readonly step: OnboardingStep;
      readonly write: OnboardingRecord | null;
      /**
       * Allow access with every permission granted now, as after the reopen
       * Screen Recording needs: the rows show Allowed, then Done comes.
       */
      readonly advance: boolean;
    };

/**
 * What the app does at launch. On macOS a first run shows Welcome; an
 * install that ran before this flow existed (its data is there) is
 * marked done without showing it, since the app's banners already cover
 * a missing permission; a flow left active, by a quit or the reopen
 * Screen Recording asks for, goes on where it was. Elsewhere it only sets
 * the flag.
 */
export const decideLaunch = (input: {
  readonly mac: boolean;
  readonly saved: OnboardingRecord | null;
  readonly ranBefore: boolean;
  readonly config: FlowConfig;
  readonly granted: Granted;
}): LaunchDecision => {
  const { saved } = input;

  if (!input.mac) {
    return {
      kind: "none",
      write: saved === null ? record("finished", DONE) : null,
    };
  }

  if (saved === null) {
    return input.ranBefore
      ? { kind: "none", write: record("finished", DONE) }
      : {
          advance: false,
          kind: "show",
          step: WELCOME,
          write: record("active", WELCOME),
        };
  }

  if (saved.status !== "active") {
    return { kind: "none", write: null };
  }

  if (!inFlow(input.config, saved.step)) {
    return {
      advance: false,
      kind: "show",
      step: WELCOME,
      write: record("active", WELCOME),
    };
  }

  return {
    advance:
      saved.step.kind === "access" && allGranted(input.config, input.granted),
    kind: "show",
    step: saved.step,
    write: null,
  };
};

/** A row's control, from what is known about its permission. */
export const rowState = (input: {
  readonly granted: boolean;
  /** Allow was pressed since launch. */
  readonly asked: boolean;
  /** The app sees the grant while it runs. */
  readonly live: boolean;
  /** The reopen is armed and its quit under way. */
  readonly relaunching: boolean;
}): PermissionRowState => {
  if (input.granted) {
    return "allowed";
  }

  if (!input.asked) {
    return "allow";
  }

  if (input.live) {
    return "waiting";
  }

  return input.relaunching ? "reopening" : "reopen";
};
