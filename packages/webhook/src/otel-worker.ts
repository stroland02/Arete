/**
 * OTel bootstrap for the BullMQ worker process. Separate file (not an env
 * switch) so `service.name` is structurally correct per process — the §5
 * resource attribute arete-worker vs arete-webhook.
 */
import { registerEsmHook, initTelemetry } from '@arete/telemetry'

registerEsmHook()
initTelemetry('arete-worker', process.env.npm_package_version ?? '0.1.0')
