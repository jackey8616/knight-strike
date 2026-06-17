import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "coverage/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/engine/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["pixi.js", "@pixi/*"],
              message:
                "engine layer must stay headless: no Pixi imports allowed (CLAUDE.md §3).",
            },
            {
              group: ["gsap", "gsap/*"],
              message:
                "engine layer must stay headless: no GSAP imports allowed (CLAUDE.md §3).",
            },
            {
              group: ["@/render/*", "@/input/*", "@/ui/*"],
              message:
                "engine layer must not depend on render/input/ui (CLAUDE.md §3).",
            },
            {
              group: ["**/render/*", "**/input/*", "**/ui/*"],
              message:
                "engine layer must not depend on render/input/ui (CLAUDE.md §3).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  prettier,
);
