import { SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { cn } from "cn";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { z } from "zod";

import { IconButton } from "@/components/icon-button";
import { libraryApi } from "@/lib/bridge";

export const SIDEBAR = { default: 320, max: 440, min: 220 } as const;

/** Dragging the edge this far left of the narrowest width folds the sidebar away. */
const COLLAPSE_BELOW = SIDEBAR.min - 60;
const KEY_STEP = 16;
const STORAGE_KEY = "inset.sidebar";

const SidebarStateSchema = z.object({
  collapsed: z.boolean(),
  width: z.number().min(SIDEBAR.min).max(SIDEBAR.max),
});

export type SidebarState = z.infer<typeof SidebarStateSchema>;

const initial: SidebarState = { collapsed: false, width: SIDEBAR.default };

export const clampWidth = (width: number): number =>
  Math.round(Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, width)));

/** The width and fold the window had last time; anything unreadable starts from the default. */
const load = (): SidebarState => {
  try {
    const parsed = SidebarStateSchema.safeParse(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null")
    );

    return parsed.success ? parsed.data : initial;
  } catch {
    return initial;
  }
};

interface SidebarControl {
  state: SidebarState;
  toggle: () => void;
  /** Brings a hidden sidebar back at its kept width. */
  show: () => void;
  /** `kept` is the width the sidebar comes back at if this width folds it away. */
  resize: (width: number, kept?: number) => void;
}

const SidebarContext = createContext<SidebarControl | null>(null);

export const useSidebar = (): SidebarControl => {
  const control = useContext(SidebarContext);

  if (control === null) {
    throw new Error("useSidebar needs a SidebarProvider above it");
  }

  return control;
};

const mac = (): boolean => libraryApi().platform === "macos";

/** ⌃⌘S on macOS, as in Finder and Mail; Ctrl+B on Windows. */
const isToggleKey = (event: globalThis.KeyboardEvent): boolean =>
  mac()
    ? event.ctrlKey && event.metaKey && event.key.toLowerCase() === "s"
    : event.ctrlKey &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === "b";

export const toggleKeyLabel = (): string => (mac() ? "⌃⌘S" : "Ctrl+B");

export const SidebarProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState(load);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const toggle = useCallback(() => {
    setState((current) => ({ ...current, collapsed: !current.collapsed }));
  }, []);

  const show = useCallback(() => {
    setState((current) => ({ ...current, collapsed: false }));
  }, []);

  const resize = useCallback((width: number, kept?: number) => {
    setState((current) =>
      width < COLLAPSE_BELOW
        ? { collapsed: true, width: kept ?? current.width }
        : { collapsed: false, width: clampWidth(width) }
    );
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isToggleKey(event)) {
        event.preventDefault();
        toggle();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggle]);

  const control = useMemo(
    () => ({ resize, show, state, toggle }),
    [resize, show, state, toggle]
  );

  return (
    <SidebarContext.Provider value={control}>
      {children}
    </SidebarContext.Provider>
  );
};

export const SidebarToggle = () => {
  const { state, toggle } = useSidebar();

  return (
    <IconButton
      icon={SidebarLeftIcon}
      keys={toggleKeyLabel()}
      label={state.collapsed ? "Show sidebar" : "Hide sidebar"}
      onClick={toggle}
    />
  );
};

/**
 * The sidebar's right edge: drag to resize, double-click for the default width, or focus it and
 * use the arrow keys. Dragging far enough left folds the sidebar away.
 */
export const ResizeHandle = () => {
  const { state, resize } = useSidebar();
  /** The width when the drag began: a drag that folds the sidebar away brings it back at this. */
  const [drag, setDrag] = useState<{ from: number } | null>(null);
  const dragging = drag !== null;

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ from: state.width });
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag !== null) {
      resize(event.clientX, drag.from);
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDrag(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      resize(Math.max(SIDEBAR.min, state.width - KEY_STEP));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      resize(state.width + KEY_STEP);
    }
  };

  return (
    <button
      aria-label={`Resize sidebar, ${state.width} pixels wide`}
      className={cn(
        "app-no-drag hover:bg-brand/60 focus-visible:bg-brand absolute inset-y-0 -right-1 z-10 m-0 h-full w-2 cursor-col-resize border-0 bg-transparent bg-clip-content px-0.75 transition-colors outline-none",
        dragging && "bg-brand"
      )}
      onDoubleClick={() => resize(SIDEBAR.default)}
      onKeyDown={onKeyDown}
      onPointerCancel={onPointerUp}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      title="Drag to resize, double-click for the default width"
      type="button"
    />
  );
};
