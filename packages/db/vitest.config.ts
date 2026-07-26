import { defineConfig } from 'vitest/config'

// Mirrors packages/telemetry's config. This package had no test harness until
// the platform-gated incident-signal queries moved in (2026-07-22) — a security
// gate must not live somewhere it cannot be tested, and its suite came with it
// from the dashboard rather than being stranded there.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
})
