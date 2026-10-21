import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from "@tanstack/react-router";
import { z } from "zod";

import { libraryApi } from "@/lib/bridge";

import { CaptureRecord } from "./capture-record";
import { RecentList } from "./recent-list";

const rootRoute = createRootRoute({ component: Outlet });

const recentRoute = createRoute({
  component: RecentList,
  getParentRoute: () => rootRoute,
  loader: () => libraryApi().list(),
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
  routeTree: rootRoute.addChildren([recentRoute, captureRoute]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
