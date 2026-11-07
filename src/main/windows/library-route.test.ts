import { describe, expect, it } from "vitest";

import { routeShowsCapture } from "./library-route";

const page = "file:///Applications/Inset.app/out/renderer/library.html";

describe(routeShowsCapture, () => {
  it("is true only on a capture's own page", () => {
    expect(
      [
        `${page}#/captures/abc`,
        `${page}#/captures/abc?foo=1`,
        `${page}#/captures/abc?view=x`,
        `${page}#/captures/abc?a=1&view=2`,
        `${page}#/`,
        `${page}#/welcome`,
        page,
      ].map(routeShowsCapture)
    ).toStrictEqual([true, true, false, false, false, false, false]);
  });

  it("is false while the window has no address yet, instead of throwing", () => {
    expect(["", "about:blank"].map(routeShowsCapture)).toStrictEqual([
      false,
      false,
    ]);
  });
});
