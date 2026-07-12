import { getOAuthProviderConfig } from './oauth-provider-config.js'

export interface OAuthTokenResult {
  accessToken: string
  refreshToken: string | null
  /** Absolute epoch ms, or null for a long-lived token with no expiry (e.g. Vercel). */
  expiresAt: number | null
  tokenType: string
}

interface RawTokenResponse {
  access_token: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
}

function toResult(raw: RawTokenResponse): OAuthTokenResult {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? null,
    expiresAt: typeof raw.expires_in === 'number' ? Date.now() + raw.expires_in * 1000 : null,
    tokenType: raw.token_type ?? 'Bearer',
  }
}

async function postToken(
  provider: 'vercel' | 'posthog',
  bodyParams: Record<string, string>
): Promise<OAuthTokenResult | null> {
  const config = getOAuthProviderConfig(provider)
  const body = new URLSearchParams({
    ...bodyParams,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  })

  try {
    const res = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
    if (!res.ok) return null
    const raw = (await res.json()) as RawTokenResponse
    if (!raw.access_token) return null
    return toResult(raw)
  } catch {
    return null
  }
}

/** Never throws — a failed exchange resolves to null so the callback
 * handler can show a clean "connection failed" state rather than crash. */
export async function exchangeOAuthCode(
  provider: 'vercel' | 'posthog',
  code: string
): Promise<OAuthTokenResult | null> {
  const config = getOAuthProviderConfig(provider)
  return postToken(provider, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
  })
}

/** Never throws — a failed refresh resolves to null; the caller (the
 * telemetry fetch layer) treats this the same as any other connector
 * error: skip this connector, review proceeds. */
export async function refreshOAuthToken(
  provider: 'vercel' | 'posthog',
  refreshToken: string
): Promise<OAuthTokenResult | null> {
  return postToken(provider, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
}
