import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// PRD §9.4 / M4.2: pages deploys live under a sub-path (e.g.
// `/knight-strike/`). Make base path env-driven so the same dist/ can target
// custom Pages URLs, while local dev keeps `/` for simplest module URLs.
const base = process.env.VITE_BASE_PATH ?? "/";

export default defineConfig({
  base,
  resolve: {
    alias: {
      "@": resolve(here, "src"),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
    target: "es2022",
  },
});
