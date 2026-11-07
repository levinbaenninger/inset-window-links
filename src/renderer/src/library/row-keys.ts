import type { KeyPlatform, KeyPressLike } from "../../../shared/shortcuts";
import type { MenuKey } from "../lib/menu-keys";
import { menuKeyOf } from "../lib/menu-keys";

/** What a key does to a sidebar row's capture: its menu's keys, plus Space to mark it done. */
export type RowAction = MenuKey | "toggleDone";

/** The parts of a keydown the row keys read. */
export type RowKeyPress = KeyPressLike & { repeat: boolean };

/**
 * The row command a key stands for while the row has focus: the keys its menu shows, plus Space.
 * Space and ⌫ (or Delete) count only without modifiers and not held down.
 */
export const rowKey = (
  press: RowKeyPress,
  platform: KeyPlatform
): RowAction | null => {
  const plain =
    !press.metaKey && !press.ctrlKey && !press.altKey && !press.shiftKey;

  if (plain && !press.repeat && press.key === " ") {
    return "toggleDone";
  }

  return menuKeyOf(press, platform);
};

export const ROW_SELECTOR = "[data-testid='recent-item']";

/** The row focus moves on to when `row` leaves the list: the next one, else the one before. */
export const neighborRow = (row: HTMLElement): HTMLElement | null => {
  const rows = [...document.querySelectorAll<HTMLElement>(ROW_SELECTOR)];
  const at = rows.indexOf(row);

  return at === -1 ? null : (rows[at + 1] ?? rows[at - 1] ?? null);
};
