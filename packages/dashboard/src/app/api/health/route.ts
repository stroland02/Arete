/**
 * Liveness probe (spec §3 exit criteria: /health on all three services).
 * force-dynamic so `next build` never prerenders it into a static 200 —
 * a cached health check is a lie.
 */
export const dynamic = 'force-dynamic'

export function GET(): Response {
  return Response.json({ status: 'ok', service: 'arete-dashboard' })
}
