import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

// Pages deploys to a custom domain (knight-strike.clo5de.info, see public/CNAME)
// which serves from the root, so base is `/`. Kept env-driven so the same dist/
// can still target a sub-path Pages URL (e.g. `/knight-strike/`) if the custom
// domain is ever dropped. Build/deploy details: MILESTONES M4 / CLAUDE.md §9.
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
