import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { defaultResource, resourceFromAttributes, type Resource } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'

/** §5 frozen service names (Lane A's three; arete-agents is Agent B's). */
export type AreteServiceName = 'arete-webhook' | 'arete-worker' | 'arete-dashboard'

/** SDK 2.x: resourceFromAttributes(), NOT `new Resource()` (removed API). */
export function buildResource(serviceName: AreteServiceName, serviceVersion: string): Resource {
  // Self-dogfooding tenancy: when ARETE_SELF_PROJECT_ID is set, stamp THIS
  // service's own telemetry with that superlog.project_id, making its spans/
  // logs visible under that tenant (e.g. the Incident Signals panel reads
  // ResourceAttributes['superlog.project_id']). OFF by default — unset leaves
  // Areté's internal telemetry untenanted (project_id ''), which the
  // tenant-scoped read paths and the exception MVs already treat as "no
  // tenant". NEVER point this at a real customer's installation id in a
  // multi-tenant deployment: it would surface Areté's internal operational
  // telemetry inside that customer's views. Intended for a dedicated internal
  // or local-dev tenant only.
  const selfProjectId = process.env.ARETE_SELF_PROJECT_ID
  return defaultResource().merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
      // production ONLY when explicitly set (spec §5)
      'deployment.environment.name': process.env.DEPLOYMENT_ENVIRONMENT ?? 'development',
      'service.instance.id':
        process.env.SERVICE_INSTANCE_ID ?? `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`,
      ...(selfProjectId ? { 'superlog.project_id': selfProjectId } : {}),
    })
  )
}
