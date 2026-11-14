import path from "node:path";

import type { DragTileView } from "@shared/onboarding";

/**
 * The running app's `.app` bundle, found by walking up from its executable
 * (`app.getPath("exe")`), for the tile dragged into System Settings. Null
 * when there is nothing worth dragging: a development run, an executable
 * outside a bundle, Electron's own bundle, or a copy macOS runs from a
 * randomized read-only place because it was opened straight from the
 * download (App Translocation), which System Settings would list under a
 * path that changes with every launch.
 */
export const appBundlePath = (
  exePath: string,
  options: { readonly packaged: boolean }
): string | null => {
  if (!options.packaged || exePath.includes("/AppTranslocation/")) {
    return null;
  }

  let current = path.posix.dirname(exePath);

  while (current !== path.posix.dirname(current)) {
    const name = path.posix.basename(current);

    if (name.toLowerCase().endsWith(".app")) {
      return name === "Electron.app" ? null : current;
    }

    current = path.posix.dirname(current);
  }

  return null;
};

/** The name System Settings lists the app under: its bundle's name without `.app`. */
export const bundleDisplayName = (bundlePath: string): string =>
  path.posix.basename(bundlePath).replace(/\.app$/iu, "");

/** The part of a NativeImage the tile uses. */
export interface TileIcon {
  readonly isEmpty: () => boolean;
  readonly toDataURL: () => string;
}

export interface AppTile<Icon extends TileIcon> {
  /** Reads the app's icon once; the tile shows only after it has. */
  readonly load: () => Promise<void>;
  readonly view: () => DragTileView | null;
  /** Starts the system drag of the app bundle; the page calls it from its own dragstart. */
  readonly drag: () => void;
  readonly icon: () => Icon | null;
}

/**
 * The tile dragged into a Privacy & Security list when the app isn't there
 * yet: the bundle as a file, with its icon. The drag must start at once,
 * inside the page's dragstart, so the icon is read beforehand: macOS
 * refuses a drag without one.
 */
export const createAppTile = <Icon extends TileIcon>(deps: {
  readonly bundlePath: string | null;
  readonly loadIcon: (bundlePath: string) => Promise<Icon | null>;
  readonly startDrag: (item: {
    readonly file: string;
    readonly icon: Icon;
  }) => void;
}): AppTile<Icon> => {
  let icon: Icon | null = null;
  // Encoded once: the view is built on every change.
  let iconUrl = "";

  return {
    drag: () => {
      if (deps.bundlePath !== null && icon !== null) {
        deps.startDrag({ file: deps.bundlePath, icon });
      }
    },
    icon: () => icon,
    load: async () => {
      if (deps.bundlePath === null || icon !== null) {
        return;
      }

      try {
        const loaded = await deps.loadIcon(deps.bundlePath);

        icon = loaded === null || loaded.isEmpty() ? null : loaded;
        iconUrl = icon?.toDataURL() ?? "";
      } catch {
        icon = null;
      }
    },
    view: () =>
      deps.bundlePath === null || icon === null
        ? null
        : { icon: iconUrl, name: bundleDisplayName(deps.bundlePath) },
  };
};
