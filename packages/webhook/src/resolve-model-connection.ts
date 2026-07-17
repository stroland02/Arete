// Review-time resolution of a tenant's Bring-Your-Own model connection into the
// `llm` block the agents /review consumes.
//
// The review job carries the GitHub App's NUMERIC installation id
// (PRContext.installationId). ModelConnection is keyed by the INTERNAL
// Installation uuid, so we map numeric externalId -> Installation.id, then read
// the tenant's active connection (newest configured) scoped by that uuid,
// decrypt its key, and shape it as { provider, model?, apiKey?, baseUrl? }
// (camelCase, mirroring the agents Pydantic model; null/empty fields omitted).
//
// When a tenant has NO connection we return undefined and the caller omits the
// `llm` block entirely — the agents service then uses its own default (Ollama
// safety fallback). We deliberately never fabricate a key or point at a guessed
// endpoint: an unconfigured tenant runs on the service default, never on a raw
// env key.

import { decryptCredentials } from './telemetry/credentials.js'

/** The `llm` block forwarded to agents /review. Shape mirrors the agents
 *  Pydantic model — camelCase, everything but provider optional. */
export interface LlmConfig {
  provider: string
  model?: string
  apiKey?: string
  baseUrl?: string
}

export interface ResolveModelDeps {
  prisma: {
    installation: {
      findUnique(args: unknown): Promise<{ id: string } | null>
    }
    modelConnection: {
      findFirst(args: unknown): Promise<{
        provider: string
        model: string
        baseUrl: string | null
        apiKeyEncrypted: string | null
      } | null>
    }
  }
  decrypt(ciphertext: string): { apiKey: string }
}

/**
 * Resolve the `llm` block a review should run on for a given GitHub App
 * installation, or undefined when the tenant has no connection (caller omits
 * `llm`). `provider` selects the SCM side of the installation id (github today).
 */
export async function resolveModelConnectionForReview(
  externalInstallationId: number,
  deps: ResolveModelDeps,
  provider: 'github' | 'gitlab' = 'github',
): Promise<LlmConfig | undefined> {
  const installation = await deps.prisma.installation.findUnique({
    where: { provider_externalId: { provider, externalId: externalInstallationId } },
    select: { id: true },
  })
  if (!installation) return undefined

  const connection = await deps.prisma.modelConnection.findFirst({
    where: { installationId: installation.id },
    orderBy: { createdAt: 'desc' },
  })
  if (!connection) return undefined

  const apiKey = connection.apiKeyEncrypted ? deps.decrypt(connection.apiKeyEncrypted).apiKey : undefined
  return {
    provider: connection.provider,
    model: connection.model,
    ...(apiKey ? { apiKey } : {}),
    ...(connection.baseUrl ? { baseUrl: connection.baseUrl } : {}),
  }
}

/** Default deps: the real Prisma client + the shared AES-256-GCM decrypt. Split
 *  from the pure resolver above so the resolver is unit-testable without a DB. */
export function defaultResolveModelDeps(): ResolveModelDeps {
  return {
    prisma: {
      installation: {
        findUnique: async (args) => {
          const { prisma } = await import('./db.js')
          return prisma.installation.findUnique(args as never) as Promise<{ id: string } | null>
        },
      },
      modelConnection: {
        findFirst: async (args) => {
          const { prisma } = await import('./db.js')
          return prisma.modelConnection.findFirst(args as never) as Promise<{
            provider: string
            model: string
            baseUrl: string | null
            apiKeyEncrypted: string | null
          } | null>
        },
      },
    },
    decrypt: (ciphertext) => decryptCredentials<{ apiKey: string }>(ciphertext),
  }
}
