# The Telemetry-Tenancy Contract — one law for who may see Kuma's own telemetry (2026-07-22)

**The problem this exists to prevent.** Kuma's self-telemetry is now readable from two dashboard surfaces
that were built in parallel by two sessions, and they encode *different* laws over the same ClickHouse
tables. `lib/errors.ts` gates on the platform installation and then reads unfiltered. `lib/telemetry-queries.ts`
filters `superlog.project_id IN (installationIds)` and calls that "tenant isolation". Underneath, **which
installation may see Kuma's internals is decided by two independent environment variables that nothing
reconciles** — `ARETE_PLATFORM_INSTALLATION_ID` and `ARETE_SELF_PROJECT_ID`. They agree today only because
`scripts/dev/dev-all.mjs` hardcodes one into the other in dev. Let them diverge in a real deployment and
either a customer sees Kuma's internal errors through the Incident Signals panel, or the platform sees
nothing and believes it is healthy. Both failures are silent.

This is the same discipline we already applied to connection state in
`docs/superpowers/specs/2026-07-17-account-state-contract.md`: **a single source of truth**, an **explicit
law every surface obeys**, and **tests as the gate**. Two surfaces disagreeing about a security boundary is
not a style problem; it is the boundary being undefined.

---

## 1. What `superlog.project_id` actually means (today)

It is **not tenant data.** Nothing ingests customer telemetry yet — tenant OTLP ingest is Phase 3, deliberately
deferred (`docs/roadmap/2026-07-15-superlog-phased-roadmap.md`). Every row in `superlog.otel_traces` /
`otel_logs` is emitted by Kuma's own four services.

`superlog.project_id` is a **self-observability tag**: the optional `ARETE_SELF_PROJECT_ID` stamped onto
Kuma's own resource attributes (`packages/telemetry/src/resource.ts`,
`packages/dashboard/src/instrumentation.ts`, `packages/agents/.../observability.py`). It answers exactly one
question — *under which installation should Kuma's own telemetry be visible?* — and its own comment already
says "never point at a real customer tenant in prod."

Therefore a `project_id` filter is **not** a tenant-isolation mechanism today. Treating it as one is the
mistake this contract closes: it reads as security while providing none, which is worse than no filter at all.

## 2. The single source of truth

The platform installation is a **database fact**, not a string comparison:
`Installation.isPlatform` → `packages/dashboard/src/lib/platform-installation.ts`.

```
resolvePlatformInstallationId(db): Promise<string | null>   // null when unflagged or ambiguous
isPlatformInstallation(db, installationIds): Promise<boolean>
```

Rules, all fail-closed:
- **No flagged row** → not platform. (`ARETE_PLATFORM_INSTALLATION_ID` remains a transitional fallback and
  logs that the deployment should adopt the flag.)
- **More than one flagged row** → not platform, and log it loudly. Never pick one arbitrarily.
- `ARETE_SELF_PROJECT_ID` set to anything other than the resolved platform installation is a
  **misconfiguration** and must be reported, because that is precisely the divergence that leaks internals.

No surface may re-derive "is this the platform?" locally. One resolver, one truth.

## 3. The law every telemetry surface obeys

| Data | Scope rule | What the surface shows | Forbidden |
|---|---|---|---|
| **Kuma self-telemetry** (`otel_traces`, `otel_logs`, `otel_exceptions` today) | `isPlatformInstallation` **first**, before any query | real spans/logs/errors | showing it to a non-platform installation; using `project_id` *as* the access check |
| **Tenant telemetry** (Phase 3, not yet ingested) | `project_id` scoping, once it genuinely carries a tenant id | that tenant's data only | mixing it with self-telemetry in one result set |
| **Either, when the gate fails** | — | an explicit "not available for this account" | `[]` — see §4 |

**A `project_id` filter is a partitioning convenience, never the access decision.** The access decision is
§2. When Phase 3 lands and `project_id` becomes real tenant data, the second row activates and this document
is amended — the law changes deliberately, in one place, rather than drifting per-surface.

## 4. `null` is not `[]`

`null` means *this surface is unavailable to you*. `[]` means *you have zero errors*. Returning `[]` on a
gate failure tells the user a comforting lie, so the reads return `null` and the UI says so
(`lib/errors.ts` already does this; every telemetry read must). This is the anti-fabrication rule of the
account-state contract §3 applied to telemetry: never let an access outcome masquerade as a data outcome.

## 5. One fingerprint, one normalizer

Grouping "the same error seen many times" must not depend on which surface you look at.
`packages/dashboard/src/lib/error-fingerprint.ts` (mirroring `packages/webhook/src/fingerprint.ts`) is the
**only** normalizer. Whether a fingerprint is computed at read time (today) or stamped at emit time as
`superlog.issue_fingerprint` (backlog, unclaimed), it must come from that function. Two algorithms would
split one error into two groups and quietly break "resolve these together".

Note `superlog.otel_exceptions` is empty today but **not broken**: its materialized views filter
`ResourceAttributes['superlog.project_id'] != ''` and MVs do not backfill, so it fills once stamping is on
and new exceptions occur — as `events_per_minute` already demonstrated (0 → populated).

## 6. How the roles uphold this

- **Software (architecture):** the resolver (§2) and the law (§3). Enforced in code, not convention.
- **Engineers (SDLC):** any new telemetry read gates via `isPlatformInstallation` and cites this contract.
  A read that filters only on `project_id` is rejected in review.
- **PM (Definition of Done):** a telemetry surface is not done until it is correct for platform, non-platform,
  and backend-unavailable.
- **CI/CD (the gate):** `platform-installation.test.ts` encodes §2's fail-closed cases; the misconfiguration
  case (flagged installation absent from the caller's set ⇒ `null`) is an assertion, not a comment.

## 7. Adoption checklist

- [ ] `Installation.isPlatform` + migration (`migrate deploy`; never `db push` — shared Postgres).
- [ ] `platform-installation.ts` resolver + fail-closed tests, env fallback logged as transitional.
- [ ] `lib/errors.ts` consumes the resolver instead of the env string.
- [ ] `lib/telemetry-queries.ts` gates on `isPlatformInstallation` before its `project_id` filter, and its
      header stops describing that filter as tenant isolation. *(Engineer B's file — declare in
      `.claude/ade-coordination.md` before editing.)*
- [ ] `ARETE_SELF_PROJECT_ID` / platform-installation divergence reported rather than silently tolerated.
- [ ] Backlog: emit-time `superlog.issue_fingerprint` stamping, using §5's normalizer.
- [ ] Amend §3 when Phase 3 tenant ingest lands.
