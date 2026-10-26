import { screen } from "electron";

/** The work area of the display under the pointer: where the user is working. */
export const cursorWorkArea = (): Electron.Rectangle =>
  screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
