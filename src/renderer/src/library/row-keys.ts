import type { KeyPlatform } from "../../../shared/shortcuts";
import { acceleratorFor, MENU_KEYS } from "../../../shared/shortcuts";

/** What a key does to a sidebar row's capture, while the row has focus or its menu is open. */
export type RowAction =
  | "copyEntry"
  | "copyNote"
  | "delete"
  | "reopen"
  | "toggleDone";

/** The parts of a keydown the row keys read. */
export interface RowKeyPress {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat: boolean;
}

/** The letter pressed. ⌥ on a Mac types another character, such as "ç" for C, so the key decides then. */
const letterOf = (press: RowKeyPress): string | null =>
  /^[a-z]$/iu.test(press.key)
    ? press.key.toLowerCase()
    : (/^Key(?<letter>[A-Z])$/u
        .exec(press.code)
        ?.groups?.["letter"]?.toLowerCase() ?? null);

const CHORDS: readonly (readonly [RowAction, (p: KeyPlatform) => string])[] = [
  ["copyEntry", () => "CommandOrControl+C"],
  ["copyNote", (p) => acceleratorFor(MENU_KEYS.copyNote, p)],
  ["reopen", (p) => acceleratorFor(MENU_KEYS.reopen, p)],
];

const matches = (
  accelerator: string,
  press: RowKeyPress,
  platform: KeyPlatform
): boolean => {
  const parts = accelerator.split("+");

  const command =
    platform === "macos"
      ? press.metaKey && !press.ctrlKey
      : press.ctrlKey && !press.metaKey;

  return (
    command &&
    press.altKey === parts.includes("Alt") &&
    press.shiftKey === parts.includes("Shift") &&
    letterOf(press) === parts.at(-1)?.toLowerCase()
  );
};

/**
 * The row command a key stands for: the keys its menu shows beside its items, plus ⌘C. Space and
 * ⌫ (or Delete) count only without modifiers and not held down.
 */
export const rowKey = (
  press: RowKeyPress,
  platform: KeyPlatform
): RowAction | null => {
  const plain =
    !press.metaKey && !press.ctrlKey && !press.altKey && !press.shiftKey;

  if (plain) {
    if (press.repeat) {
      return null;
    }

    if (press.key === " ") {
      return "toggleDone";
    }

    return press.key === "Backspace" || press.key === "Delete"
      ? "delete"
      : null;
  }

  return (
    CHORDS.find(([, accelerator]) =>
      matches(accelerator(platform), press, platform)
    )?.[0] ?? null
  );
};

export const ROW_SELECTOR = "[data-testid='recent-item']";

/** The sidebar row whose right-click menu is open: that menu's keys act on it. */
export const openMenuRow = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(`${ROW_SELECTOR}[data-state='open']`);

/** The row focus moves on to when `row` leaves the list: the next one, else the one before. */
export const neighborRow = (row: HTMLElement): HTMLElement | null => {
  const rows = [...document.querySelectorAll<HTMLElement>(ROW_SELECTOR)];
  const at = rows.indexOf(row);

  return at === -1 ? null : (rows[at + 1] ?? rows[at - 1] ?? null);
};
