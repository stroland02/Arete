import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Ratchet (obs spec Phase 0, user-approved 2026-07-21): ~51 pre-existing
      // `any`s (mostly test files plus src/lib/queries.ts) kept VISIBLE as
      // warnings instead of blocking CI. Genuine-bug-class rules
      // (react-hooks/*, @next/next/*) remain at error. Same pattern as
      // no-console in packages/webhook: flip back to "error" once the debt is
      // paid. Tracked in docs/roadmap/backlog.md ("Typed debt").
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
]);

export default eslintConfig;
