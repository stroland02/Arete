// `.mts`, not `.ts`, only because `@arete/db` is the one workspace package
// with `"type": "commonjs"` (its dist is required by consumers). Vite would
// otherwise load this config through its deprecated CJS Node API and say so on
// every run. The contents are @arete/webhook's vitest.config.ts verbatim.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    passWithNoTests: true,
  },
})
