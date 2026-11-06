import type { LibraryApi } from "../../../shared/api";
import type { CopyRequest } from "../../../shared/copy";
import type { MutationOutcome } from "../../../shared/dto";
import type { CaptureId } from "../../../shared/ids";
import type { DraftStore } from "./drafts";

/**
 * How a copy went: copied; refused because the words on screen aren't saved, or because the title
 * is blank and so can't be; or refused by main.
 */
export type CopyResult =
  | { kind: "copied" }
  | { kind: "notSaved"; outcome: MutationOutcome }
  | { kind: "untitled" }
  | { kind: "notCopied"; outcome: MutationOutcome };

/**
 * The one way the page copies a capture: ⌘C, Copy as text, the image buttons, menu items and keys.
 * It takes the words on screen as they are when the copy starts, waits until main has saved them
 * (or later words that contain them), and has main copy exactly those words. A capture whose
 * words could not be saved copies nothing, even when its page is closed. Dragging an image out is
 * the exception, since a drag can't wait.
 */
export const copyCapture = async (
  id: CaptureId,
  request: CopyRequest,
  api: Pick<LibraryApi, "copy">,
  drafts: DraftStore
): Promise<CopyResult> => {
  const snapshot = drafts.snapshot(id);

  switch (snapshot.kind) {
    case "failed": {
      return { kind: "notSaved", outcome: snapshot.error };
    }

    case "untitled": {
      return { kind: "untitled" };
    }

    case "pending": {
      const saved = await snapshot.saved;

      if (saved.kind !== "ok") {
        return { kind: "notSaved", outcome: saved };
      }

      break;
    }

    default: {
      break;
    }
  }

  let copied: MutationOutcome;

  try {
    copied = await api.copy(
      id,
      request,
      snapshot.kind === "pending" ? snapshot.text : null
    );
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
  if (result.kind === "untitled") {
    return where === "row" ? "Not copied: no title" : "Not copied: add a title";
  }

  const { outcome } = result;

  if (outcome.kind === "missing") {
    return "This capture was deleted.";
  }

  if (result.kind === "notCopied") {
    return outcome.kind === "failed"
      ? `Not copied: ${outcome.message}`
      : "Not copied: this capture can’t be read.";
  }

  if (where === "viewer" && outcome.kind === "failed") {
    return `Not copied: couldn’t save. ${outcome.message}`;
  }

  return where === "row"
    ? "Not copied: not saved"
    : "Not copied: changes aren’t saved";
};
