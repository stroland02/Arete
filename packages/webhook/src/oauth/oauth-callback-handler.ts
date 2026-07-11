import type { Request, Response } from 'express'
import { verifyOAuthState } from './oauth-state.js'
import { exchangeOAuthCode } from './oauth-token-exchange.js'
import { encryptCredentials } from '../telemetry/credentials.js'
import { prisma } from '../db.js'

/**
 * Express handler for GET /oauth/:provider/callback. Validates the signed
 * CSRF state, exchanges the authorization code for tokens, and upserts an
 * OAuth-mode TelemetryConnection row — the same table and encryption path
 * the existing API-key connectors use, just with a different credentials
 * shape and authMethod: 'oauth'.
 */
export async function handleOAuthCallback(req: Request, res: Response): Promise<void> {
  const { code, state } = req.query as { code?: string; state?: string }

  if (!state || typeof state !== 'string') {
    res.status(400).send('Invalid or missing state')
    return
  }
  const verified = verifyOAuthState(state)
  if (!verified) {
    res.status(400).send('Invalid or expired state')
    return
  }

  if (!code || typeof code !== 'string') {
    res.status(400).send('Missing authorization code')
    return
  }

  const provider = verified.provider as 'vercel' | 'posthog'
  const tokenResult = await exchangeOAuthCode(provider, code)
  if (!tokenResult) {
    res.status(502).send('Failed to complete the connection. Please try again.')
    return
  }

  const credentials = encryptCredentials({
    accessToken: tokenResult.accessToken,
    refreshToken: tokenResult.refreshToken,
    expiresAt: tokenResult.expiresAt,
    tokenType: tokenResult.tokenType,
  })

  await prisma.telemetryConnection.upsert({
    where: { installationId_provider: { installationId: verified.installationId, provider } },
    create: { installationId: verified.installationId, provider, authMethod: 'oauth', config: {}, credentials },
    update: { authMethod: 'oauth', credentials },
  })

  res.redirect('/settings/connections?connected=' + provider)
}
