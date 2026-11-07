import { clipboard, ClipboardItem } from "electron";

import type { Clip } from "./store/copy";

/**
 * The only code that writes the clipboard; a test keeps it that way. It is reached through the
 * page's copy gate, which first makes sure what the screen shows is saved.
 */
export const writeClip = async (clip: Clip): Promise<void> => {
  // Electron's clipboard writes resolve later; the page says Copied only once this has.
  if (clip.kind === "text") {
    await clipboard.writeText(clip.text);

    return;
  }

  const png = new Blob([clip.png], { type: "image/png" });

  await clipboard.write([new ClipboardItem({ "image/png": png })]);
};
