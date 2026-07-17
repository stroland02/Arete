import { z } from 'zod'

// -----------------------------------------------------------------------------
// This module is the single validated source for every environment variable
// the webhook package reads. It is split into purpose-scoped schemas rather
// than one monolithic required schema for a deliberate reason: GITHUB_APP_ID /
// GITHUB_PRIVATE_KEY / GITHUB_WEBHOOK_SECRET are required for the process to
// start at all (see index.ts), but Stripe billing, GitLab, the Python agents
// service URL, and the database URL are each optional integrations that fail
// closed at the point of use (e.g. gitlab-handler rejects unsigned requests
// when GITLAB_WEBHOOK_SECRET is unset) rather than preventing the whole
// server from booting. Coupling all of them to one required schema would mean
// every module that only cares about, say, GITLAB_URL would also need GitHub
// App credentials configured just to read it. Keeping them as separate
// zod-validated accessors preserves that fail-closed-per-feature behavior
// while still eliminating ad-hoc `process.env.X` reads scattered across the
// handler files — everything goes through one of the getters below.
// -----------------------------------------------------------------------------

const GitHubConfigSchema = z.object({
  GITHUB_APP_ID: z
    .string({ required_error: 'GITHUB_APP_ID is required' })
    .min(1, 'GITHUB_APP_ID is required')
    .transform(Number),
  GITHUB_PRIVATE_KEY: z
    .string({ required_error: 'GITHUB_PRIVATE_KEY is required' })
    .min(1, 'GITHUB_PRIVATE_KEY is required'),
  GITHUB_WEBHOOK_SECRET: z
    .string({ required_error: 'GITHUB_WEBHOOK_SECRET is required' })
    .min(1, 'GITHUB_WEBHOOK_SECRET is required'),
  PORT: z.string().default('3000').transform(Number),
})

export interface Config {
  appId: number
  privateKey: string
  webhookSecret: string
  port: number
}

/**
 * GitHub App + server config. Required — the webhook process cannot start
 * without these (see index.ts). Throws with a descriptive message if any
 * required variable is missing or empty.
 */
export function getConfig(): Config {
  const result = GitHubConfigSchema.safeParse(process.env)
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.message).join(', ')
    throw new Error(`Configuration error: ${missing}`)
  }
  return {
    appId: result.data.GITHUB_APP_ID,
    privateKey: result.data.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n'),
    webhookSecret: result.data.GITHUB_WEBHOOK_SECRET,
    port: result.data.PORT,
  }
}

// -----------------------------------------------------------------------------
// Stripe billing
// -----------------------------------------------------------------------------

const StripeConfigSchema = z.object({
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // Stripe price IDs per paid tier. Optional — when set, stripe-handler maps a
  // completed checkout's price back to the tier name and records it on the
  // Installation as `planTier`, which billing.ts then enforces. When unset,
  // tier enforcement simply falls back to the free/grandfathered behavior.
  STRIPE_PRICE_STARTER: z.string().optional(),
  STRIPE_PRICE_PRO: z.string().optional(),
  STRIPE_PRICE_ENTERPRISE: z.string().optional(),
})

export interface StripeConfig {
  secretKey?: string
  webhookSecret?: string
  /** priceId -> tier name ("starter" | "pro" | "enterprise") for configured tiers. */
  priceToTier: Record<string, 'starter' | 'pro' | 'enterprise'>
}

/** Stripe billing config. Optional — the /stripe-webhook route fails closed
 * (400/500, never crashes the process) when unset. */
export function getStripeConfig(): StripeConfig {
  const result = StripeConfigSchema.parse(process.env)
  const priceToTier: Record<string, 'starter' | 'pro' | 'enterprise'> = {}
  if (result.STRIPE_PRICE_STARTER) priceToTier[result.STRIPE_PRICE_STARTER] = 'starter'
  if (result.STRIPE_PRICE_PRO) priceToTier[result.STRIPE_PRICE_PRO] = 'pro'
  if (result.STRIPE_PRICE_ENTERPRISE) priceToTier[result.STRIPE_PRICE_ENTERPRISE] = 'enterprise'
  return {
    secretKey: result.STRIPE_SECRET_KEY,
    webhookSecret: result.STRIPE_WEBHOOK_SECRET,
    priceToTier,
  }
}

// -----------------------------------------------------------------------------
// GitLab integration
// -----------------------------------------------------------------------------

const GitLabConfigSchema = z.object({
  GITLAB_ACCESS_TOKEN: z.string().default(''),
  GITLAB_URL: z.string().min(1).default('https://gitlab.com'),
  GITLAB_WEBHOOK_SECRET: z.string().optional(),
})

export interface GitLabConfig {
  accessToken: string
  url: string
  webhookSecret?: string
}

/** GitLab config. Optional — the /gitlab-webhook route fails closed (401)
 * when GITLAB_WEBHOOK_SECRET is unset. GITLAB_URL defaults to gitlab.com for
 * self-hosted instances it can be overridden. */
export function getGitLabConfig(): GitLabConfig {
  // GITLAB_URL historically falls back to the default on an empty string too
  // (`process.env.GITLAB_URL || default`), not just when unset — preserve
  // that by treating '' as absent before validating.
  const env = { ...process.env }
  if (env.GITLAB_URL === '') delete env.GITLAB_URL
  const result = GitLabConfigSchema.parse(env)
  return {
    accessToken: result.GITLAB_ACCESS_TOKEN,
    url: result.GITLAB_URL,
    webhookSecret: result.GITLAB_WEBHOOK_SECRET,
  }
}

// -----------------------------------------------------------------------------
// Python agents service + database
// -----------------------------------------------------------------------------

const ServiceConfigSchema = z.object({
  PYTHON_SERVICE_URL: z.string().min(1).default('http://127.0.0.1:8000'),
  DATABASE_URL: z.string().min(1).default('postgresql://arete:arete@localhost:5432/arete'),
})

export interface ServiceConfig {
  pythonServiceUrl: string
  databaseUrl: string
}

/** Python agents service URL + database connection string. Both default to
 * the local dev values used by infra/docker-compose.yml. */
export function getServiceConfig(): ServiceConfig {
  const result = ServiceConfigSchema.parse(process.env)
  return {
    pythonServiceUrl: result.PYTHON_SERVICE_URL,
    databaseUrl: result.DATABASE_URL,
  }
}

// -----------------------------------------------------------------------------
// BYO model config (forwarded to the agents /review as `llm`)
// -----------------------------------------------------------------------------

const ModelConfigSchema = z.object({
  // Optional — when MODEL_PROVIDER is unset, reviews use the agents service's
  // own default/fallback (which itself falls back to local Ollama). When set,
  // this deployment-level "connect your model" config is forwarded to
  // /review so the review runs on the operator's chosen model/key.
  MODEL_PROVIDER: z.enum(['anthropic', 'gemini', 'ollama']).optional(),
  MODEL_NAME: z.string().optional(),
  MODEL_API_KEY: z.string().optional(),
  MODEL_BASE_URL: z.string().optional(),
})

export interface ModelConfig {
  provider: 'anthropic' | 'gemini' | 'ollama'
  model?: string
  apiKey?: string
  baseUrl?: string
}

/** Deployment-level BYO model config, or undefined when MODEL_PROVIDER is
 * unset (the common case — the agents service then uses its own default /
 * Ollama fallback). The shape matches the agents /review `llm` block
 * (camelCase apiKey/baseUrl). */
export function getModelConfig(): ModelConfig | undefined {
  const result = ModelConfigSchema.parse(process.env)
  if (!result.MODEL_PROVIDER) return undefined
  return {
    provider: result.MODEL_PROVIDER,
    model: result.MODEL_NAME,
    apiKey: result.MODEL_API_KEY,
    baseUrl: result.MODEL_BASE_URL,
  }
}

// -----------------------------------------------------------------------------
// Telemetry connector credential encryption
// -----------------------------------------------------------------------------

const TelemetryConfigSchema = z.object({
  TELEMETRY_ENCRYPTION_KEY: z
    .string({ required_error: 'TELEMETRY_ENCRYPTION_KEY is required' })
    .length(64, 'TELEMETRY_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)'),
})

export interface TelemetryConfig {
  encryptionKey: string
}

/** Encryption key for TelemetryConnection.credentials (AES-256-GCM, so a
 * 32-byte/64-hex-char key). Only read when a telemetry connector is
 * actually used — connect-time and review-time, not at process startup —
 * so a deployment with no telemetry connectors configured never needs it. */
export function getTelemetryConfig(): TelemetryConfig {
  const result = TelemetryConfigSchema.safeParse(process.env)
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.message).join(', ')
    throw new Error(`Configuration error: ${missing}`)
  }
  return { encryptionKey: result.data.TELEMETRY_ENCRYPTION_KEY }
}
