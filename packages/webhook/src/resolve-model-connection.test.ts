import { describe, it, expect, vi } from 'vitest'
import {
  resolveModelConnectionForReview,
  companionDefault,
  type ResolveModelDeps,
} from './resolve-model-connection.js'

function fakeDeps(overrides: Partial<{
  installation: { id: string } | null
  connection: { provider: string; model: string; baseUrl: string | null; apiKeyEncrypted: string | null } | null
}> = {}) {
  const installationFindUnique = vi.fn().mockResolvedValue(
    'installation' in overrides ? overrides.installation : { id: 'inst_uuid_1' },
  )
  const modelConnectionFindFirst = vi.fn().mockResolvedValue(
    'connection' in overrides ? overrides.connection : null,
  )
  const decrypt = vi.fn((_c: string) => ({ apiKey: 'sk-DECRYPTED' }))
  const deps: ResolveModelDeps = {
    prisma: {
      installation: { findUnique: installationFindUnique },
      modelConnection: { findFirst: modelConnectionFindFirst },
    },
    decrypt,
  }
  return { deps, installationFindUnique, modelConnectionFindFirst, decrypt }
}

describe('resolveModelConnectionForReview', () => {
  it('maps the numeric installation id to the tenant, then reads the tenant’s active connection scoped by the internal uuid', async () => {
    const { deps, installationFindUnique, modelConnectionFindFirst } = fakeDeps({
      connection: { provider: 'openai', model: 'gpt-4o', baseUrl: null, apiKeyEncrypted: 'iv:tag:cipher' },
    })

    await resolveModelConnectionForReview(987654, deps)

    // numeric external id → Installation via the (provider, externalId) unique
    expect(installationFindUnique).toHaveBeenCalledWith({
      where: { provider_externalId: { provider: 'github', externalId: 987654 } },
      select: { id: true },
    })
    // connection read is scoped by the INTERNAL uuid, newest first (the active one)
    expect(modelConnectionFindFirst).toHaveBeenCalledWith({
      where: { installationId: 'inst_uuid_1' },
      orderBy: { createdAt: 'desc' },
    })
  })

  it('decrypts the stored key and returns {provider, model, apiKey, baseUrl}', async () => {
    const { deps, decrypt } = fakeDeps({
      connection: { provider: 'openai', model: 'gpt-4o', baseUrl: 'https://proxy/v1', apiKeyEncrypted: 'iv:tag:cipher' },
    })

    const resolved = await resolveModelConnectionForReview(987654, deps)

    expect(decrypt).toHaveBeenCalledWith('iv:tag:cipher')
    expect(resolved).toEqual({ provider: 'openai', model: 'gpt-4o', apiKey: 'sk-DECRYPTED', baseUrl: 'https://proxy/v1' })
  })

  it('returns a keyless connection without decrypting when apiKeyEncrypted is null', async () => {
    const { deps, decrypt } = fakeDeps({
      connection: { provider: 'ollama', model: 'llama3', baseUrl: 'http://ollama.internal:11434', apiKeyEncrypted: null },
    })

    const resolved = await resolveModelConnectionForReview(987654, deps)

    expect(decrypt).not.toHaveBeenCalled()
    expect(resolved).toEqual({ provider: 'ollama', model: 'llama3', apiKey: null, baseUrl: 'http://ollama.internal:11434' })
  })

  it('falls back to the Ollama companion default when the tenant has no connection — never a raw key', async () => {
    const { deps, modelConnectionFindFirst } = fakeDeps({ connection: null })

    const resolved = await resolveModelConnectionForReview(987654, deps)

    expect(modelConnectionFindFirst).toHaveBeenCalled()
    expect(resolved).toEqual(companionDefault())
    expect(resolved.provider).toBe('ollama')
    expect(resolved.apiKey).toBeNull()
  })

  it('falls back to the companion default (without touching connections) when the installation is unknown', async () => {
    const { deps, modelConnectionFindFirst } = fakeDeps({ installation: null })

    const resolved = await resolveModelConnectionForReview(111, deps)

    expect(modelConnectionFindFirst).not.toHaveBeenCalled()
    expect(resolved).toEqual(companionDefault())
  })

  it('companion default is a keyless Ollama connection (no secret ever sourced from env)', () => {
    const def = companionDefault()
    expect(def.provider).toBe('ollama')
    expect(def.apiKey).toBeNull()
    expect(def.model).toBeTruthy()
    expect(def.baseUrl).toBeTruthy()
  })
})
