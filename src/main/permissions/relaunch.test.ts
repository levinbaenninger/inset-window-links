import { describe, expect, it } from "vitest";

import { createSafeRelaunch } from "./relaunch";

const ignore = (): void => undefined;

/**
 * A quit path like Inset Shelf's quit hold: one pending quit, the latest
 * request's finish wins, Cancel drops it and says so, and only an exit
 * runs the finish.
 */
const heldQuit = () => {
  const log: string[] = [];
  let finish: (() => void) | null = null;
  let onCancel = ignore;

  return {
    cancel: () => {
      finish = null;
      onCancel();
    },
    exit: () => {
      const run = finish;

      finish = null;
      run?.();
    },
    log,
    onCancel: (listener: () => void) => {
      onCancel = listener;
    },
    plainQuit: () => {
      finish = () => {
        log.push("exit");
      };
    },
    request: (atExit: () => void) => {
      finish = () => {
        atExit();
        log.push("exit");
      };
    },
  };
};

const setUp = () => {
  const quit = heldQuit();
  const changes: boolean[] = [];

  const relaunch = createSafeRelaunch({
    onChange: (pending) => {
      changes.push(pending);
    },
    quit: quit.request,
    relaunch: () => {
      quit.log.push("relaunch");
    },
  });

  quit.onCancel(relaunch.disarm);

  return { changes, quit, relaunch };
};

describe(createSafeRelaunch, () => {
  it("relaunches at the exit, just before it, once the quit goes ahead", () => {
    const { quit, relaunch } = setUp();

    relaunch.request();

    expect(quit.log).toStrictEqual([]);
    expect(relaunch.pending()).toBeTruthy();

    quit.exit();

    expect(quit.log).toStrictEqual(["relaunch", "exit"]);
  });

  it("never relaunches after a cancelled quit, not even at a later plain quit", () => {
    const { changes, quit, relaunch } = setUp();

    relaunch.request();
    quit.cancel();

    expect(relaunch.pending()).toBeFalsy();
    expect(changes).toStrictEqual([true, false]);

    quit.plainQuit();
    quit.exit();

    expect(quit.log).toStrictEqual(["exit"]);
  });

  it("doesn't relaunch when a plain Quit replaces the held reopen", () => {
    const { quit, relaunch } = setUp();

    relaunch.request();
    quit.plainQuit();
    quit.exit();

    expect(quit.log).toStrictEqual(["exit"]);
  });

  it("ignores the exit of a reopen that was disarmed, even if a quit path still runs it", () => {
    let pendingExit = ignore;
    let relaunched = 0;

    const relaunch = createSafeRelaunch({
      quit: (atExit) => {
        pendingExit = atExit;
      },
      relaunch: () => {
        relaunched += 1;
      },
    });

    relaunch.request();
    relaunch.disarm();
    pendingExit();

    expect(relaunched).toBe(0);
  });

  it("relaunches once for the second of two reopens", () => {
    const { quit, relaunch } = setUp();

    relaunch.request();
    quit.cancel();
    relaunch.request();
    quit.exit();

    expect(quit.log).toStrictEqual(["relaunch", "exit"]);
  });
});
