import type { LibraryApi } from "../../../shared/api";
import type { CopyRequest } from "../../../shared/copy";
import type { MutationOutcome } from "../../../shared/dto";
import type { CaptureId } from "../../../shared/ids";
import { savePending } from "./inline-saver";

/** How a copy went: copied, refused because the screen shows words that aren't saved, or failed. */
export type CopyResult =
  | { kind: "copied" }
  | { kind: "notSaved"; outcome: MutationOutcome }
  | { kind: "notCopied"; outcome: MutationOutcome };

/**
 * The one way the page copies a capture: ⌘C, Copy as text, the image buttons, menu items and keys.
 * It sends what is still being typed and waits until it is on disk. Only then does main copy the
 * stored capture, so the clipboard gets what the screen shows. When the save failed, nothing is
 * copied. Dragging an image out is the exception, since a drag can't wait.
 */
export const copyCapture = async (
  id: CaptureId,
  request: CopyRequest,
  api: Pick<LibraryApi, "copy">
): Promise<CopyResult> => {
  const saved = await savePending(id);

  if (saved.kind !== "ok") {
    return { kind: "notSaved", outcome: saved };
  }

  let copied: MutationOutcome;

  try {
    copied = await api.copy(id, request);
  } catch (error) {
    copied = { kind: "failed", message: String(error) };
  }

  return copied.kind === "ok"
    ? { kind: "copied" }
    : { kind: "notCopied", outcome: copied };
};

/**
 * What a refused copy says. On the capture's page the field that failed to save says why under
 * it, and a row is narrower than the page header. The image viewer has no field, so it says why.
 */
export const notCopiedText = (
  result: Exclude<CopyResult, { kind: "copied" }>,
  where: "row" | "page" | "viewer"
): string => {
  const { outcome } = result;

  if (outcome.kind === "missing") {
    return "This capture was deleted.";
  }

  if (result.kind === "notCopied") {
    return "Not copied";
  }

  if (where === "viewer" && outcome.kind === "failed") {
    return `Not copied: couldn’t save. ${outcome.message}`;
  }

  return where === "row"
    ? "Not copied: not saved"
    : "Not copied: changes aren’t saved";
};
