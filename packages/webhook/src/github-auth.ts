import { App } from '@octokit/app'
import { Octokit } from '@octokit/core'
import { restEndpointMethods } from '@octokit/plugin-rest-endpoint-methods'
import { getConfig } from './config.js'

// @octokit/app's default Octokit is the BARE @octokit/core client, which has no
// `.rest` namespace. But 24 call sites across this package (pr-fetcher,
// backfill, comment-poster, chat-handler, context-map, …) call
// `octokit.rest.pulls.*` / `.repos.*`, so with the default client every one of
// them throws `Cannot read properties of undefined (reading 'pulls')` before any
// review logic runs. That is why PR reviews had never once succeeded — the
// product's headline feature failed at fetchPRContext's first line, leaving
// Review/ReviewComment empty and every Overview dashboard blank.
//
// Building the App with a rest-enabled Octokit fixes all 24 sites at one point.
const RestOctokit = Octokit.plugin(restEndpointMethods)

export function createApp(): App {
  const config = getConfig()
  return new App({
    appId: config.appId,
    privateKey: config.privateKey,
    webhooks: { secret: config.webhookSecret },
    Octokit: RestOctokit,
  })
}

export async function getInstallationOctokit(
  app: App,
  installationId: number
): Promise<Octokit> {
  return app.getInstallationOctokit(installationId)
}

export async function getInstallationToken(app: App, installationId: number): Promise<string> {
  const auth = (await app.octokit.auth({ type: 'installation', installationId })) as { token: string }
  return auth.token
}
