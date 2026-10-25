import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const renderer = path.resolve(import.meta.dirname, "src/renderer");

export default defineConfig({
  main: {},
  preload: {
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
          popover: path.join(renderer, "popover.html"),
          settings: path.join(renderer, "settings.html"),
        },
      },
    },
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.join(renderer, "src"),
      },
    },
  },
});
