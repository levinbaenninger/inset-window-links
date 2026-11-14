import "react";

declare module "react" {
  // Dynamic values reach the tutorial's bubble (src/renderer/src/tutorial/bubble.tsx) as CSS
  // custom properties, as in Inset Shelf: --coach-x, --coach-y, --coach-arrow-x.
  interface CSSProperties {
    readonly [variable: `--${string}`]: string | number | undefined;
  }
}
