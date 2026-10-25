import "../index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { markPlatform } from "@/lib/bridge";
import { followSystemTheme } from "@/lib/theme";

import { SettingsApp } from "./settings-app";

followSystemTheme();

markPlatform();

const root = document.querySelector("#root");

if (root) {
  createRoot(root).render(
    <StrictMode>
      <SettingsApp />
    </StrictMode>
  );
}
