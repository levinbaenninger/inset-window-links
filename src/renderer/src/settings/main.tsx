import "../index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { markPlatform, settingsApi } from "@/lib/bridge";
import { announceMenus } from "@/lib/menu-keys";
import { followSystemTheme } from "@/lib/theme";

import { SettingsApp } from "./settings-app";

followSystemTheme();

markPlatform();

announceMenus((open) => settingsApi().menuOpen(open));

const root = document.querySelector("#root");

if (root) {
  createRoot(root).render(
    <StrictMode>
      <SettingsApp />
    </StrictMode>
  );
}
