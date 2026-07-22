// Shared bearer token for server-to-server calls to the webhook's internal
// surface (/internal/*, /scan/trigger, /staging/send) and the agents
// service's internal surface (/chat, /context-map/*). We mint a short-lived
// signed JWT (iss: 'arete-dashboard') via @arete/internal-token — the same
// package the webhook's verifier uses, so a token minted here is accepted
// there. Server-side only — the token must never reach the browser.

import { mintInternalToken, InternalTokenNotConfigured } from '@arete/internal-token';

/** Authorization header for internal service calls, or {} when unconfigured. */
export async function internalAuthHeaders(): Promise<Record<string, string>> {
  try {
    const token = await mintInternalToken('arete-dashboard');
    return { authorization: `Bearer ${token}` };
  } catch (err) {
    if (err instanceof InternalTokenNotConfigured) return {};
    throw err;
  }
}
