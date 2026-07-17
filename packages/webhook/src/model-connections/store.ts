// Tenant-scoped persistence for a customer's Bring-Your-Own model connections.
//
// Every function takes an explicit installationId (the tenant) and scopes every
// query by it — a caller can never read, mutate, or delete another tenant's row,
// even by guessing an id, because the WHERE always carries the installationId.
// This is the same discipline as the telemetry connection code; the HTTP/session
// surface that supplies a trusted installationId lives behind the dashboard's
// Auth.js session (see server.ts note — NOT mounted unauthenticated).
//
// Secrets are encrypted with the shared AES-256-GCM scheme (TELEMETRY_ENCRYPTION_KEY,
// telemetry/credentials.ts) and NEVER returned: reads expose only a key-free view
// with a `hasApiKey` boolean.

import { encryptCredentials } from '../telemetry/credentials.js'

/** The slice of the Prisma client this store needs — injected so the store is
 *  unit-testable without a real database. */
export interface ModelConnectionStorePrisma {
  modelConnection: {
    upsert(args: unknown): Promise<ModelConnectionRow>
    findMany(args: unknown): Promise<ModelConnectionRow[]>
    findUnique(args: unknown): Promise<ModelConnectionRow | null>
    deleteMany(args: unknown): Promise<{ count: number }>
  }
}

interface ModelConnectionRow {
  id: string
  installationId: string
  provider: string
  model: string
  baseUrl: string | null
  apiKeyEncrypted: string | null
  createdAt: Date
}

/** What list/get expose — deliberately key-free. `hasApiKey` tells the UI whether
 *  a credential is on file without ever surfacing the ciphertext. */
export interface ModelConnectionView {
  id: string
  provider: string
  model: string
  baseUrl: string | null
  hasApiKey: boolean
  createdAt: Date
}

export interface SaveModelConnectionInput {
  installationId: string
  provider: string
  model: string
  /** Raw key; null for keyless (self-hosted) connections. Encrypted before storage. */
  apiKey: string | null
  baseUrl: string | null
}

/** Injected validator so "test never persists a bad key" is enforced structurally:
 *  saveModelConnection calls it before any write and aborts on failure. */
export interface SaveModelConnectionDeps {
  test(candidate: { provider: string; model: string; apiKey: string; baseUrl: string | null }): Promise<TestResult>
}

export type TestResult = { ok: true } | { ok: false; detail: string }

function toView(row: ModelConnectionRow): ModelConnectionView {
  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    baseUrl: row.baseUrl,
    hasApiKey: row.apiKeyEncrypted !== null,
    createdAt: row.createdAt,
  }
}

/**
 * Validate-then-write: if an apiKey is supplied we ping the provider first and
 * refuse to persist a key that doesn't authenticate — a bad key never touches
 * the DB. Keyless connections (no apiKey) skip the ping and store null.
 */
export async function saveModelConnection(
  prisma: ModelConnectionStorePrisma,
  input: SaveModelConnectionInput,
  deps: SaveModelConnectionDeps,
): Promise<TestResult> {
  if (input.apiKey) {
    const result = await deps.test({
      provider: input.provider,
      model: input.model,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
    })
    if (!result.ok) return result
  }

  const apiKeyEncrypted = input.apiKey ? encryptCredentials({ apiKey: input.apiKey }) : null
  const data = {
    installationId: input.installationId,
    provider: input.provider,
    model: input.model,
    baseUrl: input.baseUrl,
    apiKeyEncrypted,
  }
  await prisma.modelConnection.upsert({
    where: { installationId_provider: { installationId: input.installationId, provider: input.provider } },
    create: data,
    update: { model: input.model, baseUrl: input.baseUrl, apiKeyEncrypted },
  })
  return { ok: true }
}

export async function listModelConnections(
  prisma: ModelConnectionStorePrisma,
  installationId: string,
): Promise<ModelConnectionView[]> {
  const rows = await prisma.modelConnection.findMany({
    where: { installationId },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(toView)
}

export async function getModelConnection(
  prisma: ModelConnectionStorePrisma,
  installationId: string,
  provider: string,
): Promise<ModelConnectionView | null> {
  const row = await prisma.modelConnection.findUnique({
    where: { installationId_provider: { installationId, provider } },
  })
  return row ? toView(row) : null
}

/** deleteMany (not delete) so the tenant scope is part of the filter: a row is
 *  removed only when BOTH installationId and provider match. Returns whether a
 *  row was actually deleted. */
export async function deleteModelConnection(
  prisma: ModelConnectionStorePrisma,
  installationId: string,
  provider: string,
): Promise<boolean> {
  const { count } = await prisma.modelConnection.deleteMany({
    where: { installationId, provider },
  })
  return count > 0
}
