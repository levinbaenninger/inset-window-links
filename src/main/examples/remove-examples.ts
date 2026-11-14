import type { MutationOutcome } from "../../shared/dto";
import { DraftIdSchema } from "../../shared/ids";
import type { CaptureId } from "../../shared/ids";

interface ExampleStore {
  readonly get: (id: string) => object | undefined;
  readonly remove: (id: CaptureId) => Promise<MutationOutcome>;
}

/**
 * Remove Examples for the tutorial kit: deletes each example capture, then resolves with the ids
 * whose capture is gone. One whose delete failed is still in the store, so it stays an example.
 */
export const removeExampleCaptures = async (
  store: ExampleStore,
  ids: readonly string[]
): Promise<readonly string[]> => {
  const parsed = ids.flatMap((id) => {
    const result = DraftIdSchema.safeParse(id);

    return result.success ? [result.data] : [];
  });

  await Promise.all(parsed.map(async (id) => await store.remove(id)));

  return parsed.filter((id) => store.get(id) === undefined);
};
