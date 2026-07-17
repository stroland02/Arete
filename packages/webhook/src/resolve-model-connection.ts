// Review-time resolution of a tenant's Bring-Your-Own model connection.
//
// The review job carries the GitHub App's NUMERIC installation id
// (PRContext.installationId). ModelConnection is keyed by the INTERNAL
// Installation uuid, so we map numeric externalId -> Installation.id first, then
// read the tenant's active connection (newest configured) scoped by that uuid,
// decrypt its key, and hand {provider, model, apiKey, baseUrl} to /review.
//
// When a tenant has no connection (or the installation is unknown) we fall back
// to the local Ollama companion — a KEYLESS connection. We deliberately never
// source a provider API key from process.env as a default: an unconfigured
// tenant runs on the self-hosted companion, not on someone else's shared key.

import { decryptCredentials } from './telemetry/credentials.js'

export interface ResolvedModelConnection {
  provider: string
  model: string
  apiKey: string | null
  baseUrl: string | null
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

/** The local Ollama companion — a keyless default. baseUrl/model are non-secret
 *  config with safe fallbacks; there is deliberately no apiKey path here. */
export function companionDefault(): ResolvedModelConnection {
  return {
    provider: 'ollama',
    model: process.env.COMPANION_MODEL ?? 'llama3.1',
    apiKey: null,
    baseUrl: process.env.COMPANION_MODEL_URL ?? 'http://localhost:11434',
  }
}

/**
 * Resolve the model connection a review should run on for a given GitHub App
 * installation. Returns the decrypted connection, or the Ollama companion
 * default when the tenant has none. `provider` selects the SCM side of the
 * installation id (github today; gitlab review-model resolution is a
 * fast-follow).
 */
export async function resolveModelConnectionForReview(
  externalInstallationId: number,
  deps: ResolveModelDeps,
  provider: 'github' | 'gitlab' = 'github',
): Promise<ResolvedModelConnection> {
  const installation = await deps.prisma.installation.findUnique({
    where: { provider_externalId: { provider, externalId: externalInstallationId } },
    select: { id: true },
  })
  if (!installation) return companionDefault()

  const connection = await deps.prisma.modelConnection.findFirst({
    where: { installationId: installation.id },
    orderBy: { createdAt: 'desc' },
  })
  if (!connection) return companionDefault()

  const apiKey = connection.apiKeyEncrypted ? deps.decrypt(connection.apiKeyEncrypted).apiKey : null
  return {
    provider: connection.provider,
    model: connection.model,
    apiKey,
    baseUrl: connection.baseUrl,
  }
}

/** Default deps: the real Prisma client + the shared AES-256-GCM decrypt. Split
 *  from the pure resolver above so the resolver is unit-testable without a DB. */
export function defaultResolveModelDeps(): ResolveModelDeps {
  return {
    // Lazily require prisma so importing this module never forces a DB client
    // at load time (mirrors server.ts' lazy db access).
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
