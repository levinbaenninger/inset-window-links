import "../index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { markPlatform, popoverApi } from "@/lib/bridge";
import { listenForCommands } from "@/lib/commands";
import { followSystemTheme } from "@/lib/theme";

import { PopoverApp } from "./popover-app";

followSystemTheme();

markPlatform();

listenForCommands((listener) => popoverApi().onCommand(listener));

const root = document.querySelector("#root");

if (root) {
  createRoot(root).render(
    <StrictMode>
      <PopoverApp />
    </StrictMode>
  );
}
