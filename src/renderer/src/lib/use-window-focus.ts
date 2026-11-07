import { useSyncExternalStore } from "react";

const subscribe = (changed: () => void) => {
  window.addEventListener("focus", changed);
  window.addEventListener("blur", changed);

  return () => {
    window.removeEventListener("focus", changed);
    window.removeEventListener("blur", changed);
  };
};

/**
 * Whether this window has the keyboard. The panel can float in front while another app has it;
 * its title then dims, as a Mac window's does, so a key pressed then is not expected to reach it.
 */
export const useWindowFocus = (): boolean =>
  useSyncExternalStore(subscribe, () => document.hasFocus());
