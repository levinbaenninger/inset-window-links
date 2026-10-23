import { nativeImage } from "electron";

import iconPath from "../../../build/icon.png?asset";

const scaled = (size: number) =>
  nativeImage
    .createFromPath(iconPath)
    .resize({ height: size, quality: "best", width: size });

/** The window and taskbar icon on Windows. macOS takes it from the app bundle. */
export const windowIcon = (): Electron.NativeImage => scaled(256);

/** The colour tile for the Windows notification area, at 100%, 150% and 200% scale. */
export const trayTile = (): Electron.NativeImage => {
  const image = nativeImage.createEmpty();

  for (const [scaleFactor, size] of [
    [1, 16],
    [1.5, 24],
    [2, 32],
  ] as const) {
    image.addRepresentation({
      buffer: scaled(size).toPNG(),
      height: size,
      scaleFactor,
      width: size,
    });
  }

  return image;
};
