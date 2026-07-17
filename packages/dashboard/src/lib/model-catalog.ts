/**
 * Static catalog of the AI model providers the review pipeline can run on.
 * Wave-2 AI Models section. Like connector-catalog.ts this describes what is
 * connectABLE, not a tenant's actual connections — the real per-tenant state
 * comes from Eng1's /api/model-connections (see model-connections-client.ts).
 *
 * HONESTY (product rulings, not invented):
 *  - Ollama is the FREE DEFAULT (runs on your own hardware) — but it is NEVER
 *    described as "infinite" or "unlimited"; it is bounded by your machine.
 *  - Anthropic is Kuma's native verification model. For any NON-Anthropic
 *    provider, verification runs on YOUR connected model (the critic-fallback
 *    ruling) — surfaced as `verifyOnConnectedModel`.
 */

export type ModelAuthKind = "api-key" | "base-url";

export interface ModelProviderDef {
  id: string;
  name: string;
  /** api-key providers store a key; base-url (Ollama) points at a local server. */
  authKind: ModelAuthKind;
  /** Field label + placeholder for the connect form. */
  authLabel: string;
  authPlaceholder: string;
  tagline: string;
  /** Suggested selectable models. For openrouter/ollama any model id is valid. */
  models: string[];
  /** Whether a model id outside `models` is accepted (routers / local runtimes). */
  customModelAllowed: boolean;
  /** Ollama: the free, run-it-yourself default. */
  freeDefault: boolean;
  /** True only for Anthropic — Kuma's native verification model. */
  isAnthropic: boolean;
  /** The honest per-provider note shown on the card. */
  note: string;
}

export const MODEL_PROVIDERS: ModelProviderDef[] = [
  {
    id: "anthropic",
    name: "Anthropic",
    authKind: "api-key",
    authLabel: "API key",
    authPlaceholder: "sk-ant-...",
    tagline: "Claude — Kuma's native review and verification model.",
    models: ["claude-opus-4-8", "claude-sonnet-5", "claude-haiku-4-5"],
    customModelAllowed: false,
    freeDefault: false,
    isAnthropic: true,
    note: "Kuma's native model — reviews and verification run on Claude directly.",
  },
  {
    id: "openai",
    name: "OpenAI",
    authKind: "api-key",
    authLabel: "API key",
    authPlaceholder: "sk-...",
    tagline: "Run reviews on GPT models with your own OpenAI key.",
    models: ["gpt-4o", "gpt-4o-mini", "o3"],
    customModelAllowed: false,
    freeDefault: false,
    isAnthropic: false,
    note: "Verification runs on your connected model.",
  },
  {
    id: "gemini",
    name: "Gemini",
    authKind: "api-key",
    authLabel: "API key",
    authPlaceholder: "AIza...",
    tagline: "Run reviews on Google's Gemini models with your own key.",
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
    customModelAllowed: false,
    freeDefault: false,
    isAnthropic: false,
    note: "Verification runs on your connected model.",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    authKind: "api-key",
    authLabel: "API key",
    authPlaceholder: "sk-or-...",
    tagline: "One key, many models — route reviews to any model OpenRouter offers.",
    models: ["anthropic/claude-opus-4-8", "openai/gpt-4o", "google/gemini-2.5-pro"],
    customModelAllowed: true,
    freeDefault: false,
    isAnthropic: false,
    note: "Verification runs on your connected model. Any OpenRouter model id is accepted.",
  },
  {
    id: "ollama",
    name: "Local · Ollama",
    authKind: "base-url",
    authLabel: "Base URL",
    authPlaceholder: "http://127.0.0.1:11434",
    tagline: "Run reviews locally on your own hardware — the free default.",
    models: ["qwen2.5-coder", "llama3.1", "deepseek-r1"],
    customModelAllowed: true,
    freeDefault: true,
    isAnthropic: false,
    note: "Free default — runs on your own machine, bounded by your hardware. Install Ollama, run `ollama pull qwen2.5-coder`, and keep it running; Kuma auto-detects it at 127.0.0.1:11434 (use 127.0.0.1, not localhost). Verification runs on your connected model.",
  },
];

export function getModelProvider(id: string): ModelProviderDef | undefined {
  return MODEL_PROVIDERS.find((p) => p.id === id);
}
