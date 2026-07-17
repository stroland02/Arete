// Pure, non-"use server" helpers for the per-tenant model config, so they can
// be imported by the server action AND unit-tested without Next.js/auth/db.

export const MODEL_PROVIDERS = ['anthropic', 'gemini', 'ollama'] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

export interface StoredModelConfig {
  provider: ModelProvider;
  model?: string;
  baseUrl?: string;
  /** AES-256-GCM ciphertext of { apiKey }, never the raw key. */
  apiKeyEncrypted?: string;
}

/**
 * Build the stored Installation.modelConfig shape. The API key is encrypted
 * here and only here — the plaintext key never reaches the database. Throws on
 * an unsupported provider. `encrypt` is injected (the dashboard's
 * encryptCredentials) so this stays pure and testable.
 */
export function buildStoredModelConfig(
  input: { provider: string; model?: string; baseUrl?: string; apiKey?: string },
  encrypt: (plaintext: object) => string,
): StoredModelConfig {
  if (!(MODEL_PROVIDERS as readonly string[]).includes(input.provider)) {
    throw new Error(`Unsupported provider: ${input.provider}`);
  }
  const model = input.model?.trim() || undefined;
  const baseUrl = input.baseUrl?.trim() || undefined;
  const apiKey = input.apiKey?.trim() || undefined;
  return {
    provider: input.provider as ModelProvider,
    model,
    baseUrl,
    apiKeyEncrypted: apiKey ? encrypt({ apiKey }) : undefined,
  };
}
