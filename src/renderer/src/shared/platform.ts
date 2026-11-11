/**
 * The platform the page runs on, under the name the Inset kits import (`@/shared/platform`). Window
 * Links' preload tells every page its platform, which also lets the screenshot harness draw the
 * Windows look on a Mac.
 */
export const isMac = window.inset.platform === "macos";

export const isWindows = window.inset.platform === "windows";
