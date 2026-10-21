import { describe, expect, it } from "vitest";

import { imageUrl, parseImageUrl } from "./image-url";

const CAPTURE = "6f1c2b52-3d4e-4f60-8a71-92b3c4d5e6f7";
const VIEW = "0a000000-0000-4000-8000-000000000001";

describe("image urls", () => {
  it("round-trips every kind", () => {
    expect([
      parseImageUrl(
        imageUrl({ captureId: CAPTURE, kind: "saved", viewId: VIEW })
      ),
      parseImageUrl(imageUrl({ kind: "draft", viewId: VIEW })),
      parseImageUrl(imageUrl({ candidateId: VIEW, kind: "candidate" })),
    ]).toStrictEqual([
      { captureId: CAPTURE, kind: "saved", viewId: VIEW },
      { kind: "draft", viewId: VIEW },
      { candidateId: VIEW, kind: "candidate" },
    ]);
  });

  it("rejects anything that is not exactly an id address", () => {
    expect(
      [
        `inset://image/saved/${CAPTURE}/../${VIEW}`,
        `inset://image/saved/${CAPTURE}/${VIEW}/x`,
        `inset://image/draft/${VIEW}?path=/etc/passwd`,
        `inset://other/draft/${VIEW}`,
        `file:///image/draft/${VIEW}`,
        "inset://image/draft/not-an-id",
        `inset://image/draft/${VIEW}/${VIEW}`,
        "not a url",
      ].map((url) => parseImageUrl(url))
    ).toStrictEqual([null, null, null, null, null, null, null, null]);
  });
});
