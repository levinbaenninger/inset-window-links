import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { z } from "zod";

import { libraryApi } from "@/lib/bridge";

import { CaptureRecord } from "./capture-record";
import { RecentList } from "./recent-list";
import { Shell } from "./shell";
import { Welcome } from "./welcome";

const rootRoute = createRootRoute({ component: Shell });

const recentRoute = createRoute({
  component: RecentList,
  getParentRoute: () => rootRoute,
  loader: async () => {
    const [items, shortcut] = await Promise.all([
      libraryApi().list(),
      libraryApi().shortcut(),
    ]);

    return { items, shortcut };
  },
  path: "/",
});

const welcomeRoute = createRoute({
  component: Welcome,
  getParentRoute: () => rootRoute,
  loader: async () => ({ shortcut: await libraryApi().shortcut() }),
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
  routeTree: rootRoute.addChildren([recentRoute, welcomeRoute, captureRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
