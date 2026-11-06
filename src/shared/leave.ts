import { z } from "zod";

/** Why main asks Recent Captures to let go: its window is closing, or the app is quitting. */
export const LeaveReasonSchema = z.enum(["close", "quit"]);

export type LeaveReason = z.infer<typeof LeaveReasonSchema>;

/**
 * What main sends the page: let go for a reason, or `cancel` once main stopped waiting for its
 * answer (the user chose Cancel in main's own dialog), so the page drops the request.
 */
export const LeavePushSchema = z.enum(["close", "quit", "cancel"]);

export type LeavePush = z.infer<typeof LeavePushSchema>;

/**
 * The page's answer.
 * - waiting: it heard the request and waits for its saves, at most SETTLE_MS;
 * - held: it shows the prompt, so main should bring the window forward;
 * - go and stay: its last word on the request.
 */
export const LeaveAnswerSchema = z.enum(["waiting", "held", "go", "stay"]);

export type LeaveAnswer = z.infer<typeof LeaveAnswerSchema>;

/** How many captures' words the page holds that main does not have. */
export const UnsavedCountSchema = z.number().int().min(0).max(100_000);

/** How long the page waits for saves on their way, on a close, a quit or Retry, before it asks. */
export const SETTLE_MS = 3000;

/** What a prompt or a refused copy says once SETTLE_MS pass without a save answering. */
export const SAVE_LATE = "Saving didn't finish in time.";

/**
 * How long main waits for the page's first answer to a request. After `waiting` it waits this
 * much longer than the page's own wait, so the two never race.
 */
export const LEAVE_ANSWER_MS = 3000;
