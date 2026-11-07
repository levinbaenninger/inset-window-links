import type { LibraryApi } from "../../../shared/api";
import type { CopyOutcome, CopyRequest } from "../../../shared/copy";
import { newCopyTicket } from "../../../shared/copy";
import type { MutationOutcome } from "../../../shared/dto";
import { copyProblem } from "../../../shared/errors";
import type { CaptureId } from "../../../shared/ids";
import { DISCARD_LATE } from "../../../shared/leave";
import type { DraftStore, SaveError } from "./drafts";
import { DISCARDED, LATE, reasonOf, within } from "./drafts";

/**
 * How a copy went: copied; refused because the words on screen aren't saved, because a Discard of
 * them couldn't finish, or because the title is blank and so can't be; or refused by main.
 */
export type CopyResult =
  | { kind: "copied" }
  | { kind: "notSaved"; outcome: MutationOutcome }
  | { kind: "notDiscarded"; outcome: SaveError }
  | { kind: "untitled" }
  | { kind: "notCopied"; outcome: MutationOutcome };

/**
 * A copy whose words main didn't save, or not in time. A Discard that couldn't finish, or one
 * main hasn't answered by the time the wait runs out, refuses it as not discarded, in words that
 * never say "save".
 */
const refused = (
  id: CaptureId,
  outcome: SaveError,
  drafts: DraftStore
): CopyResult => {
  if (drafts.undiscarded(id)) {
    return { kind: "notDiscarded", outcome };
  }

  return outcome === LATE && drafts.discarding(id)
    ? {
        kind: "notDiscarded",
        outcome: { kind: "failed", message: DISCARD_LATE },
      }
    : { kind: "notSaved", outcome };
};

/**
 * The one way the page copies a capture: ⌘C, Copy as text, the image buttons, menu items and keys.
 * It takes the words on screen as they are when the copy starts, and main takes the rest of the
 * capture, its due date too, as it stands then. Once main has saved those words (or later ones
 * that contain them), main copies exactly that. A capture whose words could not be saved copies
 * nothing, at once and even when its page is closed; Retry is a separate, explicit step. Dragging
 * an image out is the exception, since a drag can't wait.
 */
export const copyCapture = async (
  id: CaptureId,
  request: CopyRequest,
  api: Pick<LibraryApi, "beginCopy" | "copy">,
  drafts: DraftStore
): Promise<CopyResult> => {
  // Its save, if it sends one, goes to main before the copy begins there, so main's capture holds it.
  const snapshot = drafts.snapshot(id);

  if (snapshot.kind === "failed") {
    return { kind: "notSaved", outcome: snapshot.error };
  }

  if (snapshot.kind === "undiscarded") {
    return { kind: "notDiscarded", outcome: snapshot.error };
  }

  if (snapshot.kind === "untitled") {
    return { kind: "untitled" };
  }

  const ticket = newCopyTicket();

  api.beginCopy(ticket, id);

  switch (snapshot.kind) {
    case "pending": {
      // A save that hangs is waited for SETTLE_MS at most: then the copy is refused, with Retry.
      const saved = await within(snapshot.saved);

      if (saved.kind !== "ok") {
        return refused(id, saved, drafts);
      }

      break;
    }

    default: {
      break;
    }
  }

  let copied: CopyOutcome;

  try {
    copied = await api.copy(
      ticket,
      id,
      request,
      snapshot.kind === "pending" ? snapshot.text : null
    );
  } catch (error) {
    copied = { kind: "failed", message: copyProblem(error) };
  }

  switch (copied.kind) {
    case "ok": {
      return { kind: "copied" };
    }

    // Main's capture as the copy began was not on disk: a due date could not be written, or a
    // write before the copy did not land in time.
    case "notSaved": {
      return {
        kind: "notSaved",
        outcome: { kind: "failed", message: copied.message },
      };
    }

    default: {
      return { kind: "notCopied", outcome: copied };
    }
  }
};

/** Whether a refused copy can offer Retry: what it waited for may still be saved. */
export const canRetry = (result: CopyResult): boolean =>
  result.kind === "notSaved" &&
  result.outcome.kind === "failed" &&
  result.outcome !== DISCARDED;

/**
 * What a refused copy's button does: save the capture's words again while they are unsaved; keep
 * them after a Discard that couldn't finish (Keep changes); or else copy again, as after a due
 * date that could not be written or a write that ran late.
 */
export type RetryKind = "save" | "keep" | "copy";

export const retryOf = (
  result: CopyResult,
  id: CaptureId,
  drafts: DraftStore
): RetryKind | null => {
  if (result.kind === "notDiscarded") {
    return drafts.undiscarded(id) ? "keep" : null;
  }

  if (!canRetry(result)) {
    return null;
  }

  return drafts.draft(id) === undefined ? "copy" : "save";
};

/** What a refused copy says: that nothing was copied, and why, in plain words. */
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

  if (result.kind === "notDiscarded") {
    return `Couldn’t discard your changes, so nothing was copied. ${reasonOf(result.outcome)}`;
  }

  if (result.kind === "notCopied") {
    return outcome.kind === "failed"
      ? outcome.message
      : "This capture can’t be read, so nothing was copied.";
  }

  if (outcome === DISCARDED) {
    return "Its changes were discarded, so nothing was copied.";
  }

  return outcome.kind === "ok"
    ? "Nothing was copied."
    : `Couldn’t save your changes, so nothing was copied. ${reasonOf(outcome)}`;
};

/**
 * What a refused copy says `where`, and what its button does. On the capture's page, a failed
 * Discard's banner sits just below with its cause and Keep changes, so the refusal says only that
 * nothing was copied.
 */
export const refusalOf = (
  result: Exclude<CopyResult, { kind: "copied" }>,
  where: "row" | "page" | "viewer",
  retry: RetryKind | null
): { text: string; retry: RetryKind | null } =>
  where === "page" && retry === "keep"
    ? {
        retry: null,
        text: "Couldn’t discard your changes, so nothing was copied.",
      }
    : { retry, text: notCopiedText(result, where) };

/** The name a refused copy's button reads out. */
export const retryLabel = (kind: RetryKind): string => {
  switch (kind) {
    case "keep": {
      return "Keep changes";
    }

    case "save": {
      return "Retry saving";
    }

    default: {
      return "Retry copying";
    }
  }
};

/** Whether a refusal stays until the words are saved or given up: its button saves or keeps them. */
export const lasts = (kind: RetryKind | null | undefined): boolean =>
  kind === "save" || kind === "keep";

/** What a refused copy's button says. */
export const retryText = (kind: RetryKind): string =>
  kind === "keep" ? "Keep changes" : "Retry";
