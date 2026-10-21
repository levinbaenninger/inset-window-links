import type { MenuItemConstructorOptions } from "electron";
import { Menu, nativeImage, Tray } from "electron";

import type { ShortcutStatus } from "../../shared/dto";

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

const trayIcon = () => {
  const gray = process.platform === "darwin" ? 0 : 255;

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

  tray.setToolTip("Inset Window Links");
  tray.setContextMenu(menu);

  return { menu, tray };
};
