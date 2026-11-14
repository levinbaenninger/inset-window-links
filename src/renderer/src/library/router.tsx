import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { z } from "zod";

import { libraryApi } from "@/lib/bridge";

import { CaptureRecord } from "./capture-record";
import { Newest } from "./home";
import { Shell } from "./shell";

/** The sidebar's list and the shortcut's label, reloaded whenever the store changes. */
const rootRoute = createRootRoute({
  component: Shell,
  loader: async () => {
    const [items, shortcut] = await Promise.all([
      libraryApi().list(),
      libraryApi().shortcut(),
    ]);

    return { items, shortcut };
  },
});

/** Opens on the newest capture; an empty library says how to add one. Getting started explains the rest. */
const homeRoute = createRoute({
  component: Newest,
  getParentRoute: () => rootRoute,
  path: "/",
});

/** The search param holds only a view id, never text, image data, or paths. */
const captureRoute = createRoute({
  component: CaptureRecord,
  getParentRoute: () => rootRoute,
  loader: ({ params }) => libraryApi().get(params.captureId),
  path: "/captures/$captureId",
  validateSearch: z.object({ view: z.string().max(64).optional() }),
});

export const router = createRouter({
  history: createHashHistory(),
  routeTree: rootRoute.addChildren([homeRoute, captureRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
