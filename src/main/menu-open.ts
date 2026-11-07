/** Listening for one event, as Electron's emitters do. */
type On<E extends string> = (event: E, listener: () => void) => void;

/** The part of a WebContents the open-menu flag needs. */
export interface MenuPage {
  on: On<"did-navigate"> &
    On<"did-start-loading"> &
    On<"render-process-gone"> &
    On<"destroyed">;
  isDestroyed: () => boolean;
  setIgnoreMenuShortcuts: (ignore: boolean) => void;
}

/** The part of a page's window the flag needs. */
export interface MenuWindow {
  on: On<"blur">;
}

/**
 * Which pages have a menu open, as each page says when its first menu opens and its last one
 * closes. While a page has one, main leaves every app key to it, and the menu runs the keys it
 * shows and swallows the rest (src/renderer/src/lib/menu-keys.ts): Windows' key handling stands
 * aside, and the Mac menu bar's keys are ignored. A page that loses focus, navigates, reloads,
 * crashes or closes never says its menu closed, so any of those clears the flag; a page whose
 * menu outlives its window losing focus says so again when the window has it back.
 */
export class OpenMenus<P extends MenuPage> {
  readonly #open = new WeakSet<P>();
  readonly #watched = new WeakSet<P>();
  readonly #windowOf: (page: P) => MenuWindow | null;

  constructor(windowOf: (page: P) => MenuWindow | null) {
    this.#windowOf = windowOf;
  }

  isOpen(page: P): boolean {
    return this.#open.has(page);
  }

  set(page: P, open: boolean): void {
    if (page.isDestroyed()) {
      this.#open.delete(page);

      return;
    }

    this.#watch(page);

    if (open) {
      this.#open.add(page);
    } else {
      this.#open.delete(page);
    }

    page.setIgnoreMenuShortcuts(open);
  }

  #watch(page: P): void {
    if (this.#watched.has(page)) {
      return;
    }

    this.#watched.add(page);

    const forget = () => this.set(page, false);

    page.on("did-navigate", forget);
    page.on("did-start-loading", forget);
    page.on("render-process-gone", forget);
    page.on("destroyed", () => this.#open.delete(page));
    this.#windowOf(page)?.on("blur", forget);
  }
}
