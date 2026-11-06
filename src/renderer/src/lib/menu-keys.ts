import { useEffect, useEffectEvent } from "react";
import type { KeyboardEvent, RefObject } from "react";

import type {
  KeyPlatform,
  KeyPressLike,
  PageCommand,
} from "../../../shared/shortcuts";
import {
  acceleratorFor,
  COPY_ACCELERATOR,
  isAppShortcut,
  MENU_KEYS,
  pressMatches,
} from "../../../shared/shortcuts";

/** A key an open menu shows beside one of its items. It runs that item for the menu's owner. */
export type MenuKey = "copyEntry" | "copyNote" | "delete" | "reopen";

/** Runs a key for the menu's owner; false when the menu shows no item with that key. */
export type MenuKeyHandler = (key: MenuKey) => boolean;

const CHORDS: readonly (readonly [MenuKey, (p: KeyPlatform) => string])[] = [
  ["copyEntry", () => COPY_ACCELERATOR],
  ["copyNote", (p) => acceleratorFor(MENU_KEYS.copyNote, p)],
  ["reopen", (p) => acceleratorFor(MENU_KEYS.reopen, p)],
];

/** The menu key a keydown stands for: ⌘C, ⌥⌘C, ⌘O, or ⌫ (Delete too) without modifiers. */
export const menuKeyOf = (
  press: KeyPressLike & { repeat: boolean },
  platform: KeyPlatform
): MenuKey | null => {
  const plain =
    !press.metaKey && !press.ctrlKey && !press.altKey && !press.shiftKey;

  if (plain) {
    return !press.repeat &&
      (press.key === "Backspace" || press.key === "Delete")
      ? "delete"
      : null;
  }

  return (
    CHORDS.find(([, accelerator]) =>
      pressMatches(accelerator(platform), press, platform)
    )?.[0] ?? null
  );
};

interface MountedMenu {
  content: RefObject<HTMLElement | null>;
  handler: MenuKeyHandler;
}

/** Every menu the page holds, open or not. Only an open one, or one closing, has its content. */
const menus: MountedMenu[] = [];

/** The menu on screen, open or on its way out. */
const shownMenu = (): MountedMenu | undefined =>
  menus.findLast((menu) => menu.content.current !== null);

/** Open, not on its way out: a key that closed a menu is not run again as it fades. */
const isOpen = (menu: MountedMenu): boolean =>
  menu.content.current?.dataset["state"] === "open";

/** Lists a menu while its component is mounted; its content is there only while it shows. */
export const useMountedMenu = (
  content: RefObject<HTMLElement | null>,
  handler: MenuKeyHandler | undefined
): void => {
  const run = useEffectEvent((key: MenuKey) => handler?.(key) ?? false);

  useEffect(() => {
    const menu: MountedMenu = { content, handler: (key) => run(key) };

    menus.push(menu);

    return () => {
      menus.splice(menus.indexOf(menu), 1);
    };
  }, [content]);
};

/**
 * Whether a menu is on screen, which then gets the keys. It runs `key` for the menu's owner when the
 * menu shows that key and is still open. Anything else is dropped, never passed to the page under it.
 */
export const keyForMenu = (key: MenuKey | null): boolean => {
  const menu = shownMenu();

  if (menu === undefined) {
    return false;
  }

  if (key !== null && isOpen(menu)) {
    menu.handler(key);
  }

  return true;
};

/** A command main sent for a menu key while a menu is up: see keyForMenu. */
export const commandForMenu = (command: PageCommand): boolean =>
  keyForMenu(command === "copyNote" || command === "reopen" ? command : null);

let openMenus = 0;
let announce: ((open: boolean) => void) | null = null;

/**
 * Tells main when the page's first menu opens and its last one closes, so main leaves every key to
 * the menu meanwhile. Main forgets an open menu when the window loses focus, and a menu can stay
 * open across that, so the page says so again when the window has focus back.
 */
export const announceMenus = (listener: (open: boolean) => void): void => {
  announce = listener;
  window.addEventListener("focus", () => {
    if (openMenus > 0) {
      listener(true);
    }
  });
};

/** A menu is open until the returned function is called. */
export const holdMenuOpen = (): (() => void) => {
  let held = true;

  openMenus += 1;

  if (openMenus === 1) {
    announce?.(true);
  }

  return () => {
    if (!held) {
      return;
    }

    held = false;
    openMenus -= 1;

    if (openMenus === 0) {
      announce?.(false);
    }
  };
};

/** Holds the page's menus open while `shown`, for a menu root that may or may not be controlled. */
export const useMenuHold = (shown: boolean): void => {
  useEffect(() => (shown ? holdMenuOpen() : undefined), [shown]);
};

/**
 * A keydown inside a menu, before the menu itself sees it. A key the menu shows runs for its owner
 * whatever is highlighted. Space and Return are left to the menu, which picks the highlighted
 * item. Every other app key is swallowed, so it never acts on the page under the menu.
 */
export const menuKeyDown = (
  event: KeyboardEvent<HTMLElement>,
  handler: MenuKeyHandler | undefined,
  platform: KeyPlatform
): void => {
  const key = menuKeyOf(event, platform);
  const ran = key !== null && handler?.(key) === true;

  if (ran || isAppShortcut(event, platform)) {
    event.preventDefault();
    event.stopPropagation();
  }
};
