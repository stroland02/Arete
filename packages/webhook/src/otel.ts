/**
 * OTel bootstrap for the webhook HTTP server process. This file is loaded
 * via `--import` (ESM package — NOT --require) so the SDK and the
 * import-in-the-middle hook are active before the first app module resolves.
 * Prod:  node --import ./dist/otel.js dist/index.js
 * Dev:   tsx --import ./src/otel.ts src/index.ts
 */
import { registerEsmHook, initTelemetry } from '@arete/telemetry'

registerEsmHook()
initTelemetry('arete-webhook', process.env.npm_package_version ?? '0.1.0')
