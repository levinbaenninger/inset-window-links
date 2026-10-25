import "../index.css";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { z } from "zod";

import { libraryApi, markPlatform } from "@/lib/bridge";
import { followSystemTheme } from "@/lib/theme";

import { router } from "./router";

/** Main only asks for app routes such as /captures/<id>; anything else is ignored. */
const RouteSchema = z.string().regex(/^\/[\w/-]{0,120}$/u);

followSystemTheme();

markPlatform();

libraryApi().onChanged(() => {
  void router.invalidate();
});

libraryApi().onNavigate((route) => {
  const parsed = RouteSchema.safeParse(route);

  if (parsed.success) {
    router.history.push(parsed.data);
  }
});

const root = document.querySelector("#root");

if (root) {
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );
}
