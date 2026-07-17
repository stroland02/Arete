-- Per-tenant BYO model config ("connect your model"). Nullable and additive:
-- existing rows default to NULL (use the service default / Ollama fallback).
-- Shape: { provider, model?, baseUrl?, apiKeyEncrypted? } — the API key is
-- AES-256-GCM encrypted, never stored in plaintext.
ALTER TABLE "Installation" ADD COLUMN "modelConfig" JSONB;
