import "../index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { followSystemTheme } from "@/lib/theme";

import { PopoverApp } from "./popover-app";

followSystemTheme();

const root = document.querySelector("#root");

if (root) {
  createRoot(root).render(
    <StrictMode>
      <PopoverApp />
    </StrictMode>
  );
}
