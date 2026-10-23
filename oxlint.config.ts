import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import react from "ultracite/oxlint/react";
import shadcn from "ultracite/oxlint/shadcn";
import tanstack from "ultracite/oxlint/tanstack";
import vitest from "ultracite/oxlint/vitest";

export default defineConfig({
  extends: [core, react, tanstack, vitest, antiSlop, shadcn],
  ignorePatterns: [...core.ignorePatterns, "src/renderer/src/components/ui/**"],
  jsPlugins: shadcn.jsPlugins,
});
