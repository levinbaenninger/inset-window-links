import { readFile } from "node:fs/promises";

import { protocol } from "electron";

import type { SessionController } from "../session/controller";
import type { CaptureStore } from "../store/store";
import { IMAGE_SCHEME, parseImageUrl } from "./image-url";

/** Must run before app ready. */
export const registerImageScheme = (): void => {
  protocol.registerSchemesAsPrivileged([
    {
      privileges: { secure: true, standard: true, supportFetchAPI: true },
      scheme: IMAGE_SCHEME,
    },
  ]);
};

const png = (bytes: Uint8Array, cache: string) =>
  new Response(new Blob([new Uint8Array(bytes)], { type: "image/png" }), {
    headers: { "cache-control": cache, "content-type": "image/png" },
  });

const notFound = () => new Response("Not found", { status: 404 });

/** Serves PNGs for known ids only. A URL is never turned into a path. */
export const handleImageProtocol = (
  session: SessionController,
  store: CaptureStore
): void => {
  protocol.handle(IMAGE_SCHEME, async (request) => {
    const ref = request.method === "GET" ? parseImageUrl(request.url) : null;

    if (ref === null) {
      return notFound();
    }

    if (ref.kind !== "saved") {
      const bytes = session.imageFor(ref);

      return bytes === null ? notFound() : png(bytes, "no-store");
    }

    const file = store.imagePath(ref.captureId, ref.viewId);

    if (file === null) {
      return notFound();
    }

    try {
      return png(await readFile(file), "private, max-age=3600");
    } catch {
      return notFound();
    }
  });
};
