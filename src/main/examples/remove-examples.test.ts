import { describe, expect, it } from "vitest";

import type { MutationOutcome } from "../../shared/dto";
import { removeExampleCaptures } from "./remove-examples";

const SAVED = "11111111-1111-4111-8111-111111111111";
const STUCK = "22222222-2222-4222-8222-222222222222";
const GONE = "33333333-3333-4333-8333-333333333333";

/** A store holding SAVED and STUCK, whose delete of STUCK fails, and that never had GONE. */
const fakeStore = () => {
  const held = new Set([SAVED, STUCK]);

  return {
    get: (id: string) => (held.has(id) ? { kind: "current" } : undefined),
    remove: async (id: string): Promise<MutationOutcome> => {
      if (id === STUCK) {
        return await Promise.resolve({ kind: "failed", message: "EPERM" });
      }

      return await Promise.resolve({
        kind: held.delete(id) ? "ok" : "missing",
      });
    },
  };
};

describe(removeExampleCaptures, () => {
  it("reports only the examples that are gone afterwards, so one that failed stays an example", async () => {
    await expect(
      removeExampleCaptures(fakeStore(), [SAVED, STUCK, GONE, "not-an-id"])
    ).resolves.toStrictEqual([SAVED, GONE]);
  });
});
