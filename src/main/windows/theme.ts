import { nativeTheme } from "electron";

/** The page background and text colours of the shadcn preset, as hex for native window chrome. */
const palette = {
  dark: { background: "#0a0a0a", foreground: "#fafafa" },
  light: { background: "#ffffff", foreground: "#0a0a0a" },
} as const;

export const themeColors = () =>
  nativeTheme.shouldUseDarkColors ? palette.dark : palette.light;

export const TITLE_BAR_HEIGHT = 36;

/** Windows draws only its caption buttons over the page; the page supplies the draggable strip. */
export const titleBarOverlay = (): Electron.TitleBarOverlayOptions => {
  const { background, foreground } = themeColors();

  return {
    color: background,
    height: TITLE_BAR_HEIGHT,
    symbolColor: foreground,
  };
};
