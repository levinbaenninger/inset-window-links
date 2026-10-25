import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { z } from "zod";

import { libraryApi } from "@/lib/bridge";

import { CaptureRecord } from "./capture-record";
import { Home } from "./home";
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

const homeRoute = createRoute({
  component: Home,
  getParentRoute: () => rootRoute,
  path: "/",
});

const welcomeRoute = createRoute({
  component: Home,
  getParentRoute: () => rootRoute,
  path: "/welcome",
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
  routeTree: rootRoute.addChildren([homeRoute, welcomeRoute, captureRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
