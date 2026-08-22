/**
 * Wildwood root ESLint config (flat config format, ESLint v9).
 *
 * Loads the in-repo custom plugin from tools/eslint-plugin-wildwood and
 * enables the rules that enforce the project's hard contracts.
 *
 * v0.7.0c: enables `wildwood/no-find-then-index` to fail CI on the
 * classic fixture-stability anti-pattern.
 */

import wildwood from "./tools/eslint-plugin-wildwood/index.js";

export default [
  {
    ignores: [
      "node_modules/**",
      "artifacts/**",
      "assets/**",
      "server/**",
      "tools/**", // plugin source itself, not user code
    ],
  },
  {
    files: ["src/**/*.js", "tests/**/*.mjs", "tests/**/*.js"],
    plugins: {
      wildwood,
    },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: {
        // Browser globals (demo.html loads these directly)
        window: "readonly",
        document: "readonly",
        console: "readonly",
        // Node globals (test files)
        process: "readonly",
        globalThis: "readonly",
      },
    },
    rules: {
      // ─── Wildwood-specific (v0.7.0c) ────────────────────────────────
      // Fail the build on any `.find(pred)[N]` or
      // `const x = .find(pred); x[N]` pattern. See
      // tools/eslint-plugin-wildwood/rules/no-find-then-index.js
      // and docs/spawner-fixture-guideline.md section 2.
      "wildwood/no-find-then-index": "error",
    },
  },
];
