import type { MenuItemConstructorOptions } from "electron";
import { Menu, nativeImage, Tray } from "electron";

import type { ShortcutStatus } from "../../shared/dto";
import { trayTile } from "./icon";

/** Two overlapping window outlines, drawn as BGRA so no image asset has to ship. */
const glyph = (size: number, gray: number): Buffer => {
  const pixels = Buffer.alloc(size * size * 4);
  const stroke = size / 10;

  const frames = [
    [0.06, 0.12, 0.62, 0.62],
    [0.38, 0.38, 0.94, 0.88],
  ] as const;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size;

      const onEdge = frames.some(([left, top, right, bottom]) => {
        const inside = u >= left && u <= right && v >= top && v <= bottom;
        const edge = Math.min(u - left, right - u, v - top, bottom - v) * size;

        return inside && edge < stroke;
      });

      if (onEdge) {
        pixels.fill(gray, (y * size + x) * 4, (y * size + x) * 4 + 3);
        pixels[(y * size + x) * 4 + 3] = 255;
      }
    }
  }

  return pixels;
};

/** macOS gets a template glyph for the menu bar. Windows gets the app's colour tile, which reads on any taskbar. */
const trayIcon = () => {
  if (process.platform !== "darwin") {
    return trayTile();
  }

  const gray = 0;

  const image = nativeImage.createFromBitmap(glyph(16, gray), {
    height: 16,
    scaleFactor: 1,
    width: 16,
  });

  image.addRepresentation({
    buffer: glyph(32, gray),
    height: 32,
    scaleFactor: 2,
    width: 32,
  });
  image.setTemplateImage(true);

  return image;
};

export interface TrayActions {
  showDraft: () => void;
  addFromWindowList: () => void;
  openRecent: () => void;
  openWelcome: () => void;
  /** A left click on Windows: the draft when it holds something, else Recent Captures. */
  openHome: () => void;
  openScreenSettings: (() => void) | null;
  quit: () => void;
}

const menuFor = (
  actions: TrayActions,
  shortcut: ShortcutStatus
): MenuItemConstructorOptions[] => [
  { click: actions.showDraft, label: "Show Draft" },
  { click: actions.addFromWindowList, label: "Add View from Window List…" },
  { click: actions.openRecent, label: "Recent Captures…" },
  { click: actions.openWelcome, label: "How It Works…" },
  { type: "separator" },
  {
    enabled: false,
    label:
      shortcut.kind === "registered"
        ? `Add View Shortcut: ${shortcut.label}`
        : `Shortcut ${shortcut.label} is used by another app. Use Add View from Window List.`,
  },
  ...(actions.openScreenSettings === null
    ? []
    : [
        {
          click: actions.openScreenSettings,
          label: "Screen Recording Settings…",
        },
      ]),
  { type: "separator" },
  { click: actions.quit, label: "Quit Inset Window Links" },
];

export interface AppTray {
  tray: Tray;
  menu: Menu;
}

export const createTray = (
  actions: TrayActions,
  shortcut: ShortcutStatus
): AppTray => {
  const tray = new Tray(trayIcon());
  const menu = Menu.buildFromTemplate(menuFor(actions, shortcut));

  tray.setToolTip(
    shortcut.kind === "registered"
      ? `Inset Window Links: press ${shortcut.label} in a window to add it`
      : "Inset Window Links"
  );
  tray.setContextMenu(menu);

  // macOS opens the menu on click. Windows leaves a left click unhandled unless asked.
  if (process.platform === "win32") {
    tray.on("click", actions.openHome);
  }

  return { menu, tray };
};

const SAVED_FOR_MS = 2500;

/**
 * Save hides the panel and opens nothing, so the tray carries the confirmation. On Windows it is a
 * notification; clicking it runs onOpen for the capture saved last.
 */
export const savedConfirmer = (
  tray: Tray,
  onOpen: (captureId: string) => void
): ((captureId: string) => void) => {
  let last: string | null = null;
  let clearSaved: ReturnType<typeof setTimeout> | undefined;

  tray.on("balloon-click", () => {
    if (last !== null) {
      onOpen(last);
    }
  });

  return (captureId) => {
    last = captureId;

    if (process.platform === "darwin") {
      // A second save restarts the timer, so the first one's timeout cannot cut it short.
      clearTimeout(clearSaved);
      tray.setTitle(" Saved");
      clearSaved = setTimeout(() => tray.setTitle(""), SAVED_FOR_MS);

      return;
    }

    tray.displayBalloon({
      content:
        "Click to open it. Recent Captures in the Inset menu lists them all.",
      iconType: "none",
      noSound: true,
      title: "Capture saved",
    });
  };
};
