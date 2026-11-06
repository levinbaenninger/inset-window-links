import { SETTLE_MS } from "../shared/leave";

/** What the user picks when the last writes take too long: wait some more, or quit anyway. */
export type WritesChoice = "wait" | "quit";

export interface QuitWrites {
  /** Settles once every write queued so far has. */
  idle: () => Promise<void>;
  /** Asked each time SETTLE_MS pass with writes still on their way. */
  ask: () => Promise<WritesChoice>;
}

/** The dialog that asks, in the order its buttons show; Return waits. */
export const writesDialog = (appName: string) => ({
  buttons: ["Wait", "Quit anyway"],
  cancelId: 0,
  choices: ["wait", "quit"] as const satisfies readonly WritesChoice[],
  defaultId: 0,
  detail:
    "A change is still being written to disk. If you quit now, it may be lost.",
  message: `${appName} is still saving`,
});

/**
 * Before the app exits, the writes already sent are let finish, but never for good: after
 * SETTLE_MS the user decides, and Wait gives them another SETTLE_MS.
 */
export const settleWrites = async ({
  idle,
  ask,
}: QuitWrites): Promise<void> => {
  const { promise: late, resolve } = Promise.withResolvers<"late">();
  const timer = setTimeout(() => resolve("late"), SETTLE_MS);

  const landed = async () => {
    await idle();

    return "idle" as const;
  };

  const settled = await Promise.race([landed(), late]);

  clearTimeout(timer);

  if (settled === "idle" || (await ask()) === "quit") {
    return;
  }

  await settleWrites({ ask, idle });
};
