import type { App } from '@octokit/app'
import { getInstallationToken } from './github-auth.js'
import { getServiceConfig } from './config.js'
import type { BackfillRepo } from './backfill.js'
import { logger } from './logger.js'
import { internalAuthHeaders } from './internal-auth.js'

const log = logger.child({ component: 'context-map' })

/**
 * Kick off a code-map (Sensorium) build for each repo the moment the Kuma app
 * is installed on it — so the dashboard's code map is built ON CONNECT instead
 * of only after the repo's first PR review. Mirrors backfillInstallationPRs:
 * called from the `installation` / `installation_repositories` webhook
 * handlers, best-effort at every level, and it must never throw into (or block)
 * the install flow.
 *
 * The agents service does the actual clone+index in a background task and
 * returns immediately, so this stays fast. A per-repo installation token is
 * minted here and passed through; it is short-lived and only used server-side.
 */
export async function triggerContextMapIndex(
  app: App,
  installationId: number,
  repos: BackfillRepo[],
): Promise<void> {
  if (repos.length === 0) return

  let token: string
  try {
    token = await getInstallationToken(app, installationId)
  } catch (err) {
    log.error(
      { err, installationId },
      'Could not mint installation token — skipping index-on-connect',
    )
    return
  }

  const baseUrl = getServiceConfig().pythonServiceUrl

  for (const repo of repos) {
    try {
      await fetch(`${baseUrl}/context-map/index`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await internalAuthHeaders()) },
        body: JSON.stringify({
          installation_id: installationId,
          repo_slug: repo.full_name,
          clone_url: `https://github.com/${repo.full_name}.git`,
          installation_token: token,
        }),
      })
      log.info({ repo: repo.full_name }, 'Requested code-map index on connect')
    } catch (err) {
      log.error({ err, repo: repo.full_name }, 'Failed to request index')
    }
  }
}
