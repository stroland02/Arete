// Enforcement of per-agent config on a real review (agent-config follow-on).
//
// The dashboard stores AgentConfig rows (enabled, severityThreshold, guidance)
// per (installation, agent). Until this module, they were stored and shown and
// changed nothing — a saved setting nothing enforces is decoration with a
// database row. This is where they bite:
//
//   - `severityThreshold` and `enabled` filter what is POSTED to the PR, in the
//     worker, exactly like noise_state already does: excluded from the GitHub
//     post, still persisted internally. The drawer's own label says "Only post
//     findings at or above this severity" — post, not produce.
//   - `guidance` rides the existing customRules channel into the agents
//     service, so it lands in real prompts with no contract change.
//
// Absence of a row means the pre-feature behaviour: the agent runs, everything
// posts. A config that could not be READ also means that — a broken config
// lookup must never fail or quietly reshape a review, so it degrades to
// exactly what happened before this feature existed.

import { logger } from './logger.js'
import type { ReviewResult } from './types.js'

const log = logger.child({ component: 'agent-config' })

export interface EnforcedAgentConfig {
  enabled: boolean
  severityThreshold: 'info' | 'warning' | 'error'
  guidance: string
}

const SEVERITY_RANK: Record<string, number> = { info: 0, warning: 1, error: 2 }

export interface AgentConfigDb {
  installation: { findFirst(args: unknown): Promise<{ id: string } | null> }
  agentConfig: {
    findMany(args: unknown): Promise<
      { agentId: string; enabled: boolean; severityThreshold: string; guidance: string }[]
    >
  }
}

async function defaultDb(): Promise<AgentConfigDb> {
  const { prisma } = await import('./db.js')
  return prisma as unknown as AgentConfigDb
}

/**
 * The saved configs for a tenant, keyed by agent id — or an empty map.
 *
 * Takes the provider-scoped EXTERNAL installation id (what the worker has) and
 * resolves the internal UUID itself, like persistReview does. Empty on any
 * failure, deliberately: no rows, unknown installation, or a database error all
 * mean "enforce nothing", because enforcing a guess would silently reshape a
 * review, and the pre-feature behaviour is the only honest fallback.
 */
export async function loadAgentConfigs(
  externalInstallationId: number,
  db?: AgentConfigDb,
): Promise<Map<string, EnforcedAgentConfig>> {
  try {
    const client = db ?? (await defaultDb())
    const installation = await client.installation.findFirst({
      where: { externalId: externalInstallationId },
      select: { id: true },
    })
    if (!installation) return new Map()

    const rows = await client.agentConfig.findMany({
      where: { installationId: installation.id },
      select: { agentId: true, enabled: true, severityThreshold: true, guidance: true },
    })
    return new Map(
      rows.map((r) => [
        r.agentId,
        {
          enabled: r.enabled,
          severityThreshold: (r.severityThreshold in SEVERITY_RANK
            ? r.severityThreshold
            : 'info') as EnforcedAgentConfig['severityThreshold'],
          guidance: r.guidance,
        },
      ]),
    )
  } catch (err) {
    log.error({ err, externalInstallationId }, 'agent config unreadable — enforcing nothing')
    return new Map()
  }
}

/**
 * The guidance lines to append to customRules, one per enabled agent that has
 * any. Prefixed with the agent's id so the prompt says who the steer is for —
 * customRules reach every specialist, and an unattributed instruction meant
 * for one agent reads as an instruction to all of them.
 */
export function guidanceRules(configs: Map<string, EnforcedAgentConfig>): string[] {
  return [...configs.entries()]
    .filter(([, c]) => c.enabled && c.guidance.trim().length > 0)
    .map(([agentId, c]) => `[${agentId} agent] ${c.guidance.trim()}`)
}

/**
 * The result as it should be POSTED, with per-agent filtering applied.
 *
 * Comments from a disabled agent, or below that agent's severity threshold,
 * are removed from the copy handed to postReview. The ORIGINAL result is what
 * persistReview stores — same split noise_state already established, and for
 * the same reason: the dashboard must show everything the review found, while
 * the PR shows what the tenant asked to see. Findings are never mutated, only
 * excluded; the input is never modified.
 *
 * A comment whose category matches no config passes through untouched —
 * absence of a row is the pre-feature behaviour, not a policy of "warning".
 */
export function filterResultForPosting(
  result: ReviewResult,
  configs: Map<string, EnforcedAgentConfig>,
): { result: ReviewResult; suppressed: number } {
  if (configs.size === 0) return { result, suppressed: 0 }

  let suppressed = 0
  const fileReviews = result.file_reviews.map((fr) => ({
    ...fr,
    comments: fr.comments.filter((comment) => {
      const config = configs.get(comment.category)
      if (!config) return true
      if (!config.enabled) {
        suppressed += 1
        return false
      }
      const rank = SEVERITY_RANK[comment.severity] ?? SEVERITY_RANK.error
      if (rank < SEVERITY_RANK[config.severityThreshold]) {
        suppressed += 1
        return false
      }
      return true
    }),
  }))

  return { result: { ...result, file_reviews: fileReviews }, suppressed }
}
