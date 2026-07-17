import { prisma } from './db.js'
import { decryptCredentials } from './telemetry/credentials.js'

/** Resolved per-tenant BYO model config, ready to forward to the agents
 * /review as the `llm` block (apiKey decrypted). */
export interface ResolvedModelConfig {
  provider: 'anthropic' | 'gemini' | 'ollama'
  model?: string
  apiKey?: string
  baseUrl?: string
}

/** The stored shape of Installation.modelConfig — the API key is encrypted at
 * rest (AES-256-GCM), never plaintext. */
interface StoredModelConfig {
  provider?: 'anthropic' | 'gemini' | 'ollama'
  model?: string
  baseUrl?: string
  apiKeyEncrypted?: string
}

/**
 * Load the per-installation "connect your model" config and decrypt its API
 * key for use in a review. Returns undefined when the installation has no
 * config (the common case — the agents service then uses its own default /
 * Ollama safety fallback).
 *
 * A decrypt failure yields the config WITHOUT a key rather than a wrong/garbage
 * key: the agents service then reports an honest auth failure instead of the
 * review silently running on the wrong credentials.
 */
export async function resolveInstallationModelConfig(
  installationExternalId: number,
): Promise<ResolvedModelConfig | undefined> {
  const installation = await prisma.installation.findUnique({
    where: {
      provider_externalId: { provider: 'github', externalId: installationExternalId },
    },
    select: { modelConfig: true },
  })

  const stored = installation?.modelConfig as StoredModelConfig | null | undefined
  if (!stored || !stored.provider) return undefined

  let apiKey: string | undefined
  if (stored.apiKeyEncrypted) {
    try {
      apiKey = decryptCredentials<{ apiKey: string }>(stored.apiKeyEncrypted).apiKey
    } catch {
      apiKey = undefined
    }
  }

  return {
    provider: stored.provider,
    model: stored.model,
    baseUrl: stored.baseUrl,
    apiKey,
  }
}
