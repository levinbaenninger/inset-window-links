import type { LibraryBridge, PopoverBridge } from "../../../shared/api";

declare global {
  interface Window {
    inset: PopoverBridge | LibraryBridge;
  }
}

// SAFETY: the preload exposes `inset` with only this window's role API, and main loads popover.html only in the popover role.
export const popoverApi = (): PopoverBridge => window.inset as PopoverBridge;

// SAFETY: the preload exposes `inset` with only this window's role API, and main loads library.html only in the library role.
export const libraryApi = (): LibraryBridge => window.inset as LibraryBridge;
