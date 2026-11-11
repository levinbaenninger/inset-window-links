import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const renderer = path.resolve(import.meta.dirname, "src/renderer");

// The onboarding and tutorial kits, shared with the other Inset apps, import their types as @shared/….
const shared = path.resolve(import.meta.dirname, "src/shared");

export default defineConfig({
  main: {
    resolve: { alias: { "@shared": shared } },
  },
  preload: {
    resolve: { alias: { "@shared": shared } },
    build: {
      rolldownOptions: {
        output: { format: "cjs" },
      },
    },
  },
  renderer: {
    build: {
      rolldownOptions: {
        input: {
          library: path.join(renderer, "library.html"),
          onboarding: path.join(renderer, "onboarding.html"),
          popover: path.join(renderer, "popover.html"),
          settings: path.join(renderer, "settings.html"),
        },
      },
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.join(renderer, "src"),
        "@shared": shared,
      },
    },
  },
});
