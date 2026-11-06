import { z } from "zod";

/** Why main asks Recent Captures to let go: its window is closing, or the app is quitting. */
export const LeaveReasonSchema = z.enum(["close", "quit"]);

export type LeaveReason = z.infer<typeof LeaveReasonSchema>;

/**
 * The page's answer. `held` says it shows the prompt and main should bring the window forward;
 * `go` and `stay` are its last word on the request.
 */
export const LeaveAnswerSchema = z.enum(["held", "go", "stay"]);

export type LeaveAnswer = z.infer<typeof LeaveAnswerSchema>;
