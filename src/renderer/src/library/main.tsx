import "../index.css";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { libraryApi } from "@/lib/bridge";
import { followSystemTheme } from "@/lib/theme";

import { router } from "./router";

followSystemTheme();

libraryApi().onChanged(() => {
  void router.invalidate();
});

const root = document.querySelector("#root");

if (root) {
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );
}
