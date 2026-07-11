import { getOAuthProviderConfig } from './oauth-provider-config.js'
import { signOAuthState } from './oauth-state.js'

export function buildOAuthAuthorizeUrl(provider: 'vercel' | 'posthog', installationId: string): string {
  const config = getOAuthProviderConfig(provider)
  const state = signOAuthState(installationId, provider)

  const url = new URL(config.authorizeUrl)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('scope', config.scope)
  url.searchParams.set('state', state)
  url.searchParams.set('response_type', 'code')
  return url.toString()
}
