import { App } from '@octokit/app'
import type { Octokit } from '@octokit/core'
import { getConfig } from './config.js'

export function createApp(): App {
  const config = getConfig()
  return new App({
    appId: config.appId,
    privateKey: config.privateKey,
    webhooks: { secret: config.webhookSecret },
  })
}

export async function getInstallationOctokit(
  app: App,
  installationId: number
): Promise<Octokit> {
  return app.getInstallationOctokit(installationId)
}
