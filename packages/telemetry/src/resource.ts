import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { defaultResource, resourceFromAttributes, type Resource } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'

/** §5 frozen service names (Lane A's three; arete-agents is Agent B's). */
export type AreteServiceName = 'arete-webhook' | 'arete-worker' | 'arete-dashboard'

/** SDK 2.x: resourceFromAttributes(), NOT `new Resource()` (removed API). */
export function buildResource(serviceName: AreteServiceName, serviceVersion: string): Resource {
  return defaultResource().merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
      // production ONLY when explicitly set (spec §5)
      'deployment.environment.name': process.env.DEPLOYMENT_ENVIRONMENT ?? 'development',
      'service.instance.id':
        process.env.SERVICE_INSTANCE_ID ?? `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`,
    })
  )
}
