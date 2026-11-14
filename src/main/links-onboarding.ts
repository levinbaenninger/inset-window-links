import type { HandOff } from "../shared/onboarding";
import type { PermissionEntry } from "./permissions/onboarding";

/**
 * Inset Window Links' words for the permission onboarding (src/main/permissions/): what it is,
 * what it asks for and why, and how Done hands over. Another app passes its own.
 */
export const LINKS_TAGLINE =
  "Inset Window Links keeps one thought together with the windows it’s about.";

export const LINKS_HANDOFF: HandOff = {
  later:
    "Inset Window Links works without the permissions you skipped. Set Up Permissions… in the Help menu or the menu bar icon’s menu asks again.",
  ready:
    "Inset Window Links is ready. Getting started in Recent Captures shows the rest.",
  showAround: "Show Me Around",
  // Shorter than Inset Shelf's "Start Using …": the app's longer name wouldn't fit the window.
  start: "Start Capturing",
};

/**
 * What Inset Window Links asks for, why, and the features each one turns on. Screen Recording is
 * required: without it no window can be added. Accessibility is optional, and says so.
 */
export const LINKS_PERMISSIONS: readonly PermissionEntry[] = [
  {
    features: ["adding windows"],
    id: "screen",
    purpose: "Takes the picture of each window you add.",
  },
  {
    features: ["Reopen for pages and files"],
    id: "accessibility",
    purpose:
      "Optional. Remembers which page or file a window showed, so Reopen can bring it back.",
  },
];

/** The macOS major version, for list names macOS 27 changed. */
export const osMajor = (version: string): number => {
  const major = Math.trunc(Number(version.split(".")[0] ?? ""));

  return Number.isFinite(major) ? major : 0;
};
