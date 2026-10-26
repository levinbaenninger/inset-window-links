export interface Size {
  width: number;
  height: number;
}

export interface Bounds extends Size {
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

const EDGE = 16;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/** How far down the work area the panel's top edge sits: high enough to grow, low enough to be seen. */
const TOP_SHARE = 0.16;

/**
 * Centred across the work area, a little above the middle, so the panel opens where the eye
 * already is instead of in a corner. The work area's origin may be negative on secondary
 * displays.
 */
export const centerPanel = (size: Size, workArea: Bounds): Bounds => ({
  ...size,
  x: Math.round(workArea.x + (workArea.width - size.width) / 2),
  y: clamp(
    Math.round(workArea.y + workArea.height * TOP_SHARE),
    workArea.y + EDGE,
    workArea.y + workArea.height - size.height - EDGE
  ),
});

/**
 * Centred in the work area, and no larger than it. Windows opens new windows on the primary
 * display; Recent Captures and Settings open here instead, on the display the user is on.
 */
export const centerIn = (size: Size, workArea: Bounds): Bounds => {
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);

  return {
    height,
    width,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
  };
};

/** A position the user dragged the panel to, pulled back inside the work area if it no longer fits. */
export const keepInside = (
  position: Point,
  size: Size,
  workArea: Bounds
): Bounds => ({
  ...size,
  x: clamp(position.x, workArea.x, workArea.x + workArea.width - size.width),
  y: clamp(position.y, workArea.y, workArea.y + workArea.height - size.height),
});

/** True when the point lies in the area; a remembered position counts only on its own display. */
export const contains = (area: Bounds, point: Point): boolean =>
  point.x >= area.x &&
  point.y >= area.y &&
  point.x < area.x + area.width &&
  point.y < area.y + area.height;
