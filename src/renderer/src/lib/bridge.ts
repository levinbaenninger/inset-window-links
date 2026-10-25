import type {
  LibraryBridge,
  PopoverBridge,
  SettingsBridge,
} from "../../../shared/api";

declare global {
  interface Window {
    inset: PopoverBridge | LibraryBridge | SettingsBridge;
  }
}

/** Lets index.css follow the system: macOS shows the window's material, Windows its own title strip. */
export const markPlatform = (): void => {
  document.documentElement.dataset["platform"] = window.inset.platform;
};

// SAFETY: the preload exposes `inset` with only this window's role API, and main loads popover.html only in the popover role.
export const popoverApi = (): PopoverBridge => window.inset as PopoverBridge;

// SAFETY: the preload exposes `inset` with only this window's role API, and main loads library.html only in the library role.
export const libraryApi = (): LibraryBridge => window.inset as LibraryBridge;

// SAFETY: the preload exposes `inset` with only this window's role API, and main loads settings.html only in the settings role.
export const settingsApi = (): SettingsBridge => window.inset as SettingsBridge;
