import { z } from 'zod'

export interface OAuthProviderConfig {
  clientId: string
  clientSecret: string
  authorizeUrl: string
  tokenUrl: string
  scope: string
  redirectUri: string
}

// Fixed per-provider endpoints and scopes — never customer-supplied, closing
// off the same class of SSRF/host-confusion risk the telemetry connectors'
// SSRF guard exists for. Only client_id/client_secret are per-deployment.
const PROVIDER_ENDPOINTS: Record<'vercel' | 'posthog', { authorizeUrl: string; tokenUrl: string; scope: string }> = {
  vercel: {
    authorizeUrl: 'https://vercel.com/integrations/install',
    tokenUrl: 'https://api.vercel.com/v2/oauth/access_token',
    scope: 'deployments:read',
  },
  posthog: {
    authorizeUrl: 'https://app.posthog.com/oauth/authorize/',
    tokenUrl: 'https://oauth.posthog.com/oauth/token/',
    scope: 'query:read insight:read',
  },
}

const RedirectBaseSchema = z.object({
  OAUTH_REDIRECT_BASE_URL: z.string({ required_error: 'OAUTH_REDIRECT_BASE_URL is required' }).min(1),
})

function redirectUriFor(provider: 'vercel' | 'posthog'): string {
  const result = RedirectBaseSchema.safeParse(process.env)
  if (!result.success) throw new Error('Configuration error: OAUTH_REDIRECT_BASE_URL is required')
  return `${result.data.OAUTH_REDIRECT_BASE_URL}/oauth/${provider}/callback`
}

/** Lazily reads a provider's OAuth app credentials — only required once
 * that provider's OAuth flow is actually invoked, matching the rest of
 * this codebase's per-feature-optional config pattern. */
export function getOAuthProviderConfig(provider: 'vercel' | 'posthog'): OAuthProviderConfig {
  const prefix = provider.toUpperCase()
  const clientId = process.env[`${prefix}_OAUTH_CLIENT_ID`]
  const clientSecret = process.env[`${prefix}_OAUTH_CLIENT_SECRET`]
  if (!clientId) throw new Error(`Configuration error: ${prefix}_OAUTH_CLIENT_ID is required`)
  if (!clientSecret) throw new Error(`Configuration error: ${prefix}_OAUTH_CLIENT_SECRET is required`)

  const endpoints = PROVIDER_ENDPOINTS[provider]
  return {
    clientId,
    clientSecret,
    authorizeUrl: endpoints.authorizeUrl,
    tokenUrl: endpoints.tokenUrl,
    scope: endpoints.scope,
    redirectUri: redirectUriFor(provider),
  }
}
