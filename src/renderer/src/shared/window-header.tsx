import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { isMac } from "./platform";

/**
 * The title strip of Window Links' small windows, under the name the Inset kits import
 * (`@/shared/window-header`): 44 points tall like Settings', it moves the window and sits under the
 * traffic lights on macOS and the caption buttons on Windows.
 */
export const WindowHeader = ({
  children,
}: {
  readonly children: ReactNode;
}) => (
  <header
    className={cn(
      "drag-region relative flex h-11 shrink-0 items-center gap-1.5",
      isMac ? "pl-20" : "pl-3.5"
    )}
  >
    {children}
  </header>
);

/** The window's name: centred like a Mac window's, at the left as a Windows title is. */
export const WindowTitle = ({ children }: { readonly children: ReactNode }) => (
  <h1
    className={cn(
      "pointer-events-none text-sm font-semibold",
      isMac ? "absolute inset-x-0 text-center" : "mr-auto min-w-0 truncate"
    )}
  >
    {children}
  </h1>
);
