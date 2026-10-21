export interface Size {
  width: number;
  height: number;
}

export interface Bounds extends Size {
  x: number;
  y: number;
}

const GAP = 12;

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Right of the source, else left of it, else inside its top-right corner. Top-aligned with
 * the source when there is one, top-right of the work area when there is not. Always clamped
 * to the work area, whose origin may be negative on secondary displays.
 */
export const placePopover = (
  anchor: Bounds | null,
  size: Size,
  workArea: Bounds
): Bounds => {
  const maxX = workArea.x + workArea.width - size.width;
  const maxY = workArea.y + workArea.height - size.height;

  if (anchor === null) {
    return { ...size, x: maxX - GAP, y: workArea.y + GAP };
  }

  const right = anchor.x + anchor.width + GAP;
  const left = anchor.x - GAP - size.width;
  let x = anchor.x + anchor.width - size.width - GAP;

  if (right <= maxX) {
    x = right;
  } else if (left >= workArea.x) {
    x = left;
  }

  return {
    ...size,
    x: clamp(x, workArea.x, maxX),
    y: clamp(anchor.y, workArea.y, maxY),
  };
};
