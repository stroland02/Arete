import { refreshOAuthToken } from './oauth-token-exchange.js'
import { encryptCredentials, decryptCredentials } from '../telemetry/credentials.js'
import { prisma } from '../db.js'

interface StoredOAuthCredentials {
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  tokenType: string
}

// Refresh this many ms before actual expiry, so an in-flight API call
// never races a token that expires mid-request.
const REFRESH_SKEW_MS = 60_000

/**
 * Returns a valid (non-expired) OAuth access token for an installation's
 * connector, transparently refreshing and persisting a new one if the
 * stored token is at or near expiry. Never throws — any failure (no
 * connection, refresh rejected, decrypt error) resolves to null, matching
 * the telemetry connectors' "skip this connector, review proceeds"
 * contract.
 */
export async function getValidOAuthAccessToken(
  installationId: string,
  provider: 'vercel' | 'posthog'
): Promise<string | null> {
  try {
    const connection = await prisma.telemetryConnection.findUnique({
      where: { installationId_provider: { installationId, provider } },
    })
    if (!connection || connection.authMethod !== 'oauth') return null

    const stored = decryptCredentials<StoredOAuthCredentials>(connection.credentials)

    const isExpired = stored.expiresAt !== null && Date.now() >= stored.expiresAt - REFRESH_SKEW_MS
    if (!isExpired) return stored.accessToken

    if (!stored.refreshToken) return null
    const refreshed = await refreshOAuthToken(provider, stored.refreshToken)
    if (!refreshed) return null

    const newCredentials = encryptCredentials({
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? stored.refreshToken,
      expiresAt: refreshed.expiresAt,
      tokenType: refreshed.tokenType,
    })
    await prisma.telemetryConnection.update({
      where: { installationId_provider: { installationId, provider } },
      data: { credentials: newCredentials },
    })

    return refreshed.accessToken
  } catch {
    return null
  }
}
