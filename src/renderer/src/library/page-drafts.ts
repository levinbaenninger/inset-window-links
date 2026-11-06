import { libraryApi } from "../lib/bridge";
import { DraftStore } from "./drafts";
import { LeaveFlow } from "./leave";

/** The unsaved words of every capture in Recent Captures, for as long as the window is open. */
export const drafts = new DraftStore(() => libraryApi());

/** Holds the window's close, and the app's quit, while some of those words could not be saved. */
export const leaving = new LeaveFlow(drafts, () => libraryApi());
