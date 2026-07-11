import { createHmac, timingSafeEqual } from 'node:crypto'
import { getTelemetryConfig } from '../config.js'

// Self-contained, signed CSRF state — no server-side session store needed
// between the authorize redirect and the callback (Express workers are
// stateless between requests). Reuses TELEMETRY_ENCRYPTION_KEY as the HMAC
// key rather than introducing a second secret.
const STATE_TTL_MS = 10 * 60 * 1000

function sign(payload: string): string {
  const key = getTelemetryConfig().encryptionKey
  return createHmac('sha256', key).update(payload).digest('hex')
}

export function signOAuthState(installationId: string, provider: string): string {
  const expiresAt = Date.now() + STATE_TTL_MS
  const payload = `${installationId}:${provider}:${expiresAt}`
  const signature = sign(payload)
  return Buffer.from(`${payload}:${signature}`).toString('base64url')
}

export function verifyOAuthState(token: string): { installationId: string; provider: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8')
    const parts = decoded.split(':')
    if (parts.length !== 4) return null
    const [installationId, provider, expiresAtStr, signature] = parts

    const payload = `${installationId}:${provider}:${expiresAtStr}`
    const expectedSignature = sign(payload)
    const sigBuf = Buffer.from(signature, 'hex')
    const expectedBuf = Buffer.from(expectedSignature, 'hex')
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null

    const expiresAt = Number(expiresAtStr)
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) return null

    return { installationId, provider }
  } catch {
    return null
  }
}
