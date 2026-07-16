# BYO AI Models — Connections for the Agents' LLM (2026-07-16)

**Idea (user):** add "AI Models" to Connections so users connect their **own** LLM
that powers Kuma's agents — "this way we use the user's models." Support the major
providers now, local models later, and ship a free basic default.

This becomes **Wave-2 workstream I** and folds into the 3-engineer dispatch.

---

## 1. Why this is a real feature, not a setting

Today the model is a **single global env** for the whole agents service
(`config.py`: `LLM_PROVIDER=anthropic|gemini` + one key; `get_settings()` is a
process-wide `@lru_cache`; per-role tiers are Anthropic-specific `opus`/`sonnet`).
"Use the **user's** model" means the agents service must accept **per-tenant model
config at request time**, decrypted from a stored per-installation connection —
cross-package (db + webhook + agents + dashboard).

## 2. Providers at launch (user-approved)

| Provider | Auth | Notes |
|---|---|---|
| **Anthropic (Claude)** | API key | Best-in-class code reasoning; Kuma is tuned for it |
| **OpenAI** | API key | GPT-5 / o-series; most widely-held keys |
| **Google Gemini** | API key | Gemini 3 Pro / Flash; has a free tier |
| **OpenRouter** | one API key | Fronts hundreds of models incl. free `:free` variants |
| **Local / Ollama** | base URL | OSS models on the user's machine; **the default** (see §3) — Phase 2 UI, but the default path needs it |

Skip the long tail (Groq/Cerebras/DeepSeek/Mistral direct) at launch — OpenRouter fronts them with one key.

## 3. The free default — tier-aware (honest)

User's pick: **Local/Ollama** as the zero-setup default. Key constraint: **Kuma
must be able to reach the Ollama endpoint.**

- **Local-companion tier** (Kuma runs on the user's machine — the Glass Box / Live
  Preview model): default = the user's local Ollama at `http://localhost:11434`
  with a pulled code model (recommend `qwen2.5-coder`). Truly free + unlimited.
  If Ollama isn't running / no model pulled → honest empty state with a one-liner
  to `ollama pull qwen2.5-coder`, never a fabricated review.
- **SaaS tier** (hosted Kuma): a user's localhost is unreachable, so there is **no
  reachable local default** — the UI says so plainly and routes the user to either
  connect a cloud key or run the local companion. No fake "cloud free tier."

**No UI ever promises "infinite."** Local Ollama is unlimited but needs the user's
hardware; every hosted free tier is rate-limited.

## 4. Design

- **DB (`@arete/db`):** new `ModelConnection` — `installationId`, `provider`,
  `apiKeyEncrypted?` (nullable for Ollama), `model`, `baseUrl?`, timestamps;
  `@@unique([installationId, provider])`. Encrypted with the existing
  `TELEMETRY_ENCRYPTION_KEY` scheme. Tenant-scoped like `TelemetryConnection`.
- **Connections UI (dashboard):** an **"AI Models"** section above/near telemetry —
  provider picker → key (or Ollama base URL) → model select → **Test** (a cheap
  ping) → Connected badge + which model. Mirrors the existing connector cards.
- **Webhook:** the review job resolves the tenant's `ModelConnection` and passes
  `{provider, apiKey, model, baseUrl}` to `/review` (decrypt in-memory only).
- **Agents `/review`:** build the LLM client from the **passed** config, not global
  env; generalize the role-tier map beyond `opus`/`sonnet` to a
  `{provider, model}` per role. Fall back to the **local Ollama default** when no
  connection is present (companion tier) or the honest "connect a model" state
  (SaaS). `get_settings()` stays only as the platform-default fallback.
- **Security invariants:** keys encrypted at rest, never logged, decrypted only in
  memory at review time; tenancy by `installationId`; a Test call never persists a
  bad key. Same rules as telemetry secrets.

## 5. Dispatch (Wave-2 workstream I) — folds into existing lanes

- **Engineer 1 (db + webhook):** `ModelConnection` model + migration (sole schema
  writer); the review job resolves + decrypts the tenant's model config and passes
  it to `/review`; a `/api/model-connections` tenant-scoped CRUD + **Test** endpoint.
- **Engineer 3 (agents):** `/review` accepts per-request `{provider, model, apiKey,
  baseUrl}` and builds the client accordingly (Anthropic/OpenAI/Gemini/OpenRouter/
  Ollama); generalize role tiers; Ollama-default fallback + honest empty state.
- **Engineer 2 (dashboard):** the "AI Models" Connections section — provider cards,
  connect/test flow, Connected + model display; wire to Eng1's CRUD/Test endpoint.

**Sequencing:** slots alongside workstream D (telemetry connections) since it's the
same Connections surface + encryption pattern. Gate with the rest at PR #1.

**Invariants:** tenancy scoping, encrypted-at-rest secrets never logged, HITL and
anti-fabrication rules unaffected (a missing/failed model → honest empty, never a
fabricated review).
