# Areté — Telemetry Connectors Design Spec

**Status:** Approved, ready for implementation planning
**Date:** 2026-07-10

## 1. Goal

Give the `BusinessLogicAgent` real production/business context when reviewing a pull request — so a review can say "this service's CI has failed repeatedly this month" or "this feature area has low user engagement" instead of reviewing code in total isolation from what actually happens when it ships and runs. This is Areté's core stated differentiator versus CodeRabbit, which has no automated telemetry correlation baked into its review pipeline (confirmed by research — CodeRabbit's Slack Agent can *reactively* fetch from tools like Datadog/Sentry on-demand in chat, but that's a separate product from the PR review itself).

## 2. Background

### Competitive research

- **CodeRabbit**: pure diff-analysis reviewer, no automated telemetry correlation in the review path itself.
- **SuperLog** (open source, `github.com/superloglabs/superlog`): a genuinely useful architectural reference in the adjacent monitoring space — TypeScript monorepo with a dedicated `apps/worker` for background agent orchestration separate from intake, `packages/fingerprint` for telemetry dedup/clustering, and their own self-hosted OTLP intake proxy. Reactive-only (incident → investigate → fix PR), no code-review integration, no business-metric correlation — doesn't overlap with what we're building, but the `apps/worker`-as-separate-process pattern is worth noting since Areté's own webhook layer now has an equivalent (`packages/webhook/src/worker.ts`).
- **MCP landscape**: Model Context Protocol was donated by Anthropic to the Linux Foundation (Dec 2025) and is now a cross-vendor standard (OpenAI, Google DeepMind also adopted it), with 5,000+ community servers as of March 2026. Nearly every major service in this space now ships an **official, first-party, remote-hosted MCP server**: Datadog, Sentry (`mcp.sentry.dev`), GitHub, Linear, Slack, Stripe, PostHog, Vercel, PagerDuty, and AWS (via the `awslabs/mcp` org) all confirmed. This validates building Areté as an MCP *client* rather than hand-writing bespoke REST integrations per service.

### Prioritized connector order (full list, only the first two are in v1 scope — see §4)

Datadog → AWS (CloudWatch) → GitHub Actions → Sentry → Slack → Linear → PostHog → Stripe → Vercel/Netlify → Google Cloud Monitoring/Azure Monitor → PagerDuty/Jira, originally ranked by adoption likelihood at a 5-25 developer startup (the stated ICP) and value to the review pipeline. **V1 selection deviates from this raw ranking — see §4 for why.**

## 3. Design history — what changed and why

The first design pass placed the telemetry fetch **inside the Python LangGraph pipeline**, as a new graph node. An adversarial architecture review found this was not actually buildable: the Python agents service is deliberately stateless (no DB access, no credential storage — confirmed by inspecting `server.py`, which accepts only a `PRContext` body) while credentials and Prisma access live entirely on the Node/webhook side. Putting the fetch in Python meant either giving Python direct DB+encryption-key access (destroys the stateless design) or passing raw decrypted secrets through the internal `/review` request body (a credential-in-logs risk).

That review also found: the proposed thread-pool-based timeout doesn't actually cancel hung network calls in synchronous Python (a hung connector could silently stall the whole review despite an intended "always time out" guarantee); telemetry text is attacker-influenceable free text that needs the same prompt-injection escaping already applied to PR titles/CI logs; a customer-configured provider endpoint is a real SSRF vector into internal infrastructure; and the originally proposed rigid 3-field snapshot schema (`error_count`, `latency_p95`, `incident_count`) doesn't fit non-APM providers (Stripe revenue data, GitHub Actions deploy status) and, more importantly, throws away exactly the linked/textual detail ("which incident, which function, a link to it") the feature's core value proposition depends on.

The review's other major finding was scope: designing a generic 11-provider connector abstraction before a single concrete connector exists is speculative generality — the right abstraction is only discoverable after two real implementations reveal what actually varies (auth model, data shape, pagination). This spec adopts that recommendation.

Since that review, the underlying architecture changed in a way that resolves the placement problem for free: `packages/webhook/src/worker.ts` now exists (added while fixing the webhook execution architecture) and already runs `fetchPRContext → runReviewPipeline → postReview → persistReview` as a background job consumer with Prisma access. Telemetry fetch fits as a new step between the first two, Node-side, with zero architectural tension.

**Second pivot — connector choice.** Datadog and Sentry were the original v1 picks by raw ICP-adoption ranking, but both typically require the *customer* org to be on a paid/enterprise-tier plan for their MCP server to return anything meaningful, and reproducing that for our own development/spike work means an actual business relationship, not a self-serve signup. That's the wrong fit for an ICP that includes individual developers and small self-serve teams. V1 connectors are now **GitHub Actions and PostHog** instead — both fully self-serve, no enterprise relationship required, and PostHog specifically restores the "business/product-metric correlation" angle from the original pitch (revenue, conversion, feature usage) rather than just APM-style error counts.

## 4. Scope (v1)

**Build exactly two connectors, concretely, not through a shared abstraction: GitHub Actions and PostHog.** No generic `TelemetryConnector` interface is designed or built in v1 — it gets extracted after both are working, from what they actually have in common, not from speculation.

**GitHub Actions needs no new credential storage at all.** Areté already holds an installation-scoped GitHub App token for every repo it reviews — GitHub Actions workflow-run history is fetched with that same token, not a new `TelemetryConnection` row. This connector answers "how healthy has this repo's CI been recently" (e.g. failure rate over the last 30 days), which is distinct from the existing `CIAgent`/`check_run` flow (that diagnoses one specific failing run tied to a PR; this is aggregate historical health context fed to the `BusinessLogicAgent`).

**PostHog uses a static API key. No OAuth in v1.** This sidesteps the OAuth token-refresh problem entirely (a real unsolved question flagged in the earlier review: does per-installation, no-human-in-the-loop OAuth refresh even work server-side, and what happens on a concurrent-refresh race between two overlapping reviews for the same installation). OAuth-only providers (Slack, Linear, Stripe) remain deferred until this is solved.

**Remote HTTP MCP transport only.** Both connectors are reached over HTTP (`mcp.posthog.com`; GitHub's own API/MCP surface) — no local/stdio MCP server support is needed or built.

**All 9 other connectors on the priority list, including Datadog and Sentry, are explicitly deferred** — worth reconsidering specifically once Areté has a customer whose org already pays for one of them, at which point the enterprise-relationship problem doesn't apply.

## 5. Pre-build spike (required before writing production code)

A short, throwaway spike must confirm, before the connectors are built for real:

1. **PostHog attribution granularity** — does the data returned actually attribute to a specific feature/funnel/event tied to a service, or only account-wide aggregates? This determines the honesty ceiling of what a review comment can claim. If only account-wide data is available, review comments must say "this product's overall engagement has shifted" — never "this specific feature you changed caused N fewer conversions" (a stronger claim than the data supports).
2. **PostHog static API key sufficiency** — confirm a customer-provided API key is genuinely enough to call the relevant MCP tools server-side, with no interactive/human-present step required.
3. **GitHub Actions data shape** — confirm workflow-run history is queryable per-repo with the existing installation token (via REST/GraphQL or GitHub's own MCP server — pick whichever is simpler given we already have Octokit wired up) without needing any additional GitHub App permission scopes beyond what's already granted.

If an assumption fails for a given provider, that provider's rollout is re-scoped or deferred — this spike gates the real build, it isn't optional groundwork.

## 6. Architecture

```
worker.ts job processing:
  fetchPRContext(octokit, ...)
    → fetchTelemetryContext(installation, repo)   [NEW STEP]
        - reads .arete.yml's telemetry_connectors for this repo
        - looks up each connector's credentials from TelemetryConnection (Prisma)
        - calls the provider's MCP server per connector, with an HTTP-client-level
          timeout (5-10s) — not a thread-pool timeout, which does not actually
          cancel a hung connection
        - normalizes each response into a TelemetrySnapshot (see §7)
        - any failure/timeout/missing config for one connector never blocks
          another connector or the review itself — swallowed, logged, reviewed
          proceeds with whatever telemetry did come back (possibly none)
    → runReviewPipeline(prContext)   [prContext now carries `telemetry: TelemetrySnapshot[]`,
                                       same pattern as the existing `custom_rules` field]
    → postReview(...)
    → persistReview(...)
```

Python stays fully stateless — it receives normalized telemetry data in the same request body it already receives `custom_rules` in, never touches a credential, never makes an outbound connector call itself.

### Fetch timing and cost control

- **Deduplicate to unique `(provider, service)` pairs per PR** before fetching — a PR touching 20 files mapped to the same PostHog project fetches once, not 20 times.
- **Cache results per `(installation, provider, source_ref)` with a TTL** (~15 minutes) — this subsumes the per-PR dedup above and, more importantly, protects the customer's own API quota. Many provider MCP servers meter against the customer's account; uncached per-PR fetching across many reviews/day could exhaust a customer's own budget.
- **Per-provider circuit breaker** — after 5 consecutive failures for a provider (across all installations, not per-installation — a provider-wide outage affects everyone at once), short-circuit to "no telemetry" for that provider for a 5-minute cooldown, so a provider-wide outage doesn't pile up hung/slow requests across every customer's reviews simultaneously.

## 7. Data model

### `.arete.yml` extension (customer-facing config, base-branch-only per the existing trust boundary)

```yaml
telemetry_connectors:
  - provider: github_actions
    # no extra config needed — uses the repo's own existing GitHub App installation token
  - provider: posthog
    project: production-app
```

Reused: the existing rule that `.arete.yml` is fetched from the PR's **base branch only**, never the PR's own head commit — a PR cannot add itself a new connector to influence its own review.

### New Prisma model — `TelemetryConnection`

Only needed for PostHog in v1 — GitHub Actions reuses the existing installation-scoped Octokit client and has no row in this table.

- `installationId`, `provider`, `config` (JSON — provider-specific non-secret config like the PostHog project id), `credentials` (encrypted JSON blob, provider-specific shape — for v1, just an API key; the loose shape avoids a schema migration when non-API-key auth is added later), `createdAt`.
- Credentials validated against a per-provider schema **at connect/authorize time** (when the customer first adds the connector), not at review time — silently discovering a malformed credential mid-review (and then swallowing that failure per the "never block the review" rule) would make telemetry silently and permanently never appear with zero signal to anyone.
- Encrypted at rest; encryption key from env vars for v1 (envelope encryption / KMS-backed per-connection keys is a noted future hardening step once there's real customer credential volume — not required for 1-2 initial customers).

### New Pydantic model (Python side) — `TelemetrySnapshot`

Deliberately loose, not over-normalized — the feature's value depends on preserving linked, textual detail, which a rigid scalar schema would destroy:

```python
class TelemetrySnapshot(BaseModel):
    provider: str
    source_ref: str            # the service/project id the data is about
    summary_text: str          # provider-authored natural-language summary
    metrics: dict[str, float] = {}   # optional typed metrics, provider-specific keys
    links: list[str] = []      # deep links to the incident/issue in the provider's UI
    fetched_at: datetime
```

**Security:** `summary_text` (and any other free-text field) is treated as untrusted, attacker-influenceable content — anyone who can cause an error message string in the customer's monitored app could otherwise inject fake instructions into the reviewing LLM. It must pass through the existing `escape_for_prompt()` at the point it's folded into an agent's prompt, the same tier as PR title/description/CI logs.

## 8. Security

- **SSRF prevention**: a strict `provider → allowlisted hostname(s)` map. No customer-supplied URLs are ever accepted — `.arete.yml` specifies a `service`/`project` identifier, never an endpoint. Block RFC-1918/link-local/cloud-metadata IP ranges at the HTTP layer (resolve-then-check, not string matching against the hostname), and either disable HTTP redirects for these calls or re-validate every redirect target against the same allowlist.
- **Credential-safe error handling**: connector I/O is wrapped so exceptions never carry credential material (many HTTP clients embed request URLs, sometimes headers, in exception messages) — no token ever appears in a URL, only in headers that the existing logging path doesn't serialize.
- **Prompt injection**: covered in §7 — all free text escaped before reaching an LLM prompt, same tier as existing untrusted PR content.

## 9. Testing strategy

- Mock MCP responses per provider for unit tests of the normalize-to-`TelemetrySnapshot` mapping and the escaping/prompt-folding logic.
- Mocks alone are not sufficient for ongoing confidence, since they encode an assumption about a third-party API that will drift over time. Add, as part of the initial build (not a deferred nice-to-have): a small number of recorded-cassette tests against a sandbox PostHog account and a real (low-traffic) GitHub Actions-enabled test repo, and a synthetic canary installation with both connectors configured, alerted on if its telemetry silently goes empty — necessary specifically because the "never block, swallow failures silently" design means a provider schema change would otherwise break the feature in production with zero signal.
- Standard graceful-degradation tests already used throughout this codebase: timeout, missing config, invalid credentials, one connector down while another succeeds.

## 10. Explicitly out of scope for this build

- All other connectors from the priority list, including Datadog and Sentry (deferred specifically due to the enterprise-relationship problem in §3 — reconsider once a customer already pays for one).
- OAuth-based auth entirely (blocks Slack/Linear/Stripe until solved).
- A generic pluggable `TelemetryConnector` interface (extracted later, from real implementations).
- Local/stdio MCP transport.
- Envelope/KMS-backed per-connection encryption (env-var key is sufficient for initial customer volume; also moot for GitHub Actions, which stores no credential at all).
- Any UI for customers to configure connectors beyond editing `.arete.yml` directly (a dashboard settings page for this is a natural follow-up, not part of this spec).

## 11. Recommended build order

0. Spike (§5) — throwaway, gates everything below.
1. GitHub Actions connector, concrete: `fetchTelemetryContext` step in `worker.ts` reusing the existing installation Octokit client — no new credential storage, no `TelemetryConnection` row needed for this one. Simplest possible first connector, proves the pipeline placement end to end.
2. `TelemetryConnection` Prisma model + connect-time credential validation, for PostHog.
3. PostHog connector, concrete: HTTP-client timeout, hostname allowlist + private-IP/metadata block, credential-safe error handling.
4. `TelemetrySnapshot` normalization + `escape_for_prompt()` wiring into `BusinessLogicAgent`'s prompt, for both connectors.
5. Per-`(installation, provider, source_ref)` cache with TTL, per-provider circuit breaker.
6. Synthetic canary + cassette/contract tests against sandbox accounts.
7. Ship to real customers; extract the generic interface only once a third connector is actually requested; revisit Datadog/Sentry once a customer already has one under contract.
