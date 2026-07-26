# Internal token rotation & revocation runbook

**Audience:** operators of the Areté platform deployment (webhook, agents,
dashboard, Alertmanager). **Scope:** `INTERNAL_TOKEN_SIGNING_KEYS` /
`INTERNAL_TOKEN_ACTIVE_KID` — the signed HS256 keyset our own three services
use to authenticate to each other. `ALERTMANAGER_INGEST_TOKEN` (the separate
static Alertmanager credential) is covered at the end; it is **not** part of
this keyset and is rotated differently.

## Background — what these two variables are

- `INTERNAL_TOKEN_SIGNING_KEYS` — a JSON object mapping `kid` (key id) to
  secret material: `{ "<kid>": "<secret>", ... }`. One entry in steady
  state; **two** during a rotation window.
- `INTERNAL_TOKEN_ACTIVE_KID` — the `kid` new tokens are **signed** with.
  Must name a key present in `INTERNAL_TOKEN_SIGNING_KEYS`.
- Both are set to the **identical value** on all three of our services
  (`packages/agents`, `packages/webhook`, `packages/dashboard`) — one JSON
  blob, fanned out to three environments, the same "single host env fanned
  out" model the retired `INTERNAL_API_TOKEN` literal used.
- **Mint** (`mintInternalToken` / `arete_agents/internal_token.py`) always
  signs with `KEYS[ACTIVE_KID]`.
- **Verify** (`verifyInternalToken`) reads the `kid` out of the token's
  header and accepts **any** `kid` present in `KEYS` — not just the active
  one. This is what makes rotation possible without downtime: a token
  signed with yesterday's key still verifies today as long as that key is
  still in the object.
- Token lifetime is `INTERNAL_TOKEN_TTL_SECONDS` (default 120s, i.e. 2
  minutes) — short enough that a compromised token is only useful for a
  couple of minutes, at the cost of every internal call needing a fresh
  mint (cheap; this is an in-process JWT sign, not a network round trip).
- Empty, unparseable, or missing `INTERNAL_TOKEN_SIGNING_KEYS`, or an
  `INTERNAL_TOKEN_ACTIVE_KID` that doesn't name a key present in the
  object, is treated as **unconfigured** — every guard on every one of the
  three services fails closed with `503`, not open.

## Zero-downtime rotation

Use this to replace a signing secret on a schedule, or proactively ahead of
a suspected leak. It takes **two deploys**, spaced roughly one TTL apart at
the flip step.

1. **Generate a new secret and a new `kid`.**
   ```
   openssl rand -hex 32
   ```
   Pick a `kid` that sorts/reads unambiguously against the current one,
   e.g. a date stamp: `2026-07-21-b` following `2026-07-21-a`.

2. **Add the new kid to `INTERNAL_TOKEN_SIGNING_KEYS`, deploy.**
   Update the JSON object on the host env to contain **both** the old and
   the new key:
   ```json
   { "2026-07-21-a": "<old secret>", "2026-07-21-b": "<new secret>" }
   ```
   Leave `INTERNAL_TOKEN_ACTIVE_KID` unchanged (still `2026-07-21-a`).
   Deploy this to all three services. After this step:
   - Every service still **mints** with the old kid (`2026-07-21-a`) —
     behavior is unchanged for callers.
   - Every service now **verifies** either kid, so once this deploy has
     rolled out everywhere, no in-flight token is at risk of being
     rejected by a service that hasn't seen the new key yet.
   - **Do not skip this step or shorten it below one full rollout.** If
     any one of the three services is still running the old
     single-key config when another service starts minting with the new
     kid, that service's verify step returns `unknown_kid` and the caller
     is refused (401) — this is exactly the race this two-step rotation
     exists to avoid.

3. **Flip `INTERNAL_TOKEN_ACTIVE_KID` to the new kid, deploy.**
   ```
   INTERNAL_TOKEN_ACTIVE_KID=2026-07-21-b
   ```
   `INTERNAL_TOKEN_SIGNING_KEYS` is unchanged (still has both entries).
   Deploy to all three services. After this step, every service mints with
   the new kid; both kids still verify, so any token still in flight that
   was signed with the old kid in the seconds around the flip continues to
   be accepted.

4. **Wait at least one full `INTERNAL_TOKEN_TTL_SECONDS` (default 120s)
   after step 3's deploy has rolled out everywhere.**
   This guarantees every token minted with the old kid has expired on its
   own — there is nothing left in flight that depends on the old key still
   being accepted.

5. **Drop the old kid from `INTERNAL_TOKEN_SIGNING_KEYS`, deploy.**
   ```json
   { "2026-07-21-b": "<new secret>" }
   ```
   Deploy to all three services. Rotation is complete: exactly one key is
   live, and the retired secret is no longer honored anywhere.

**Never skip straight from step 1 to a single-key deploy of the new kid.**
That is a hard cutover, not a rotation — any service that hasn't picked up
the new key yet rejects tokens minted by a service that has, and vice
versa, producing exactly the kind of intermittent 401 storm the two-step
process (steps 2 and 3) is designed to prevent.

## Revocation (compromise / incident response)

Use this when a signing secret is known or suspected to be compromised and
you need it dead **now**, accepting a short window of reduced availability
in exchange for speed.

1. **Remove the compromised `kid` from `INTERNAL_TOKEN_SIGNING_KEYS`
   immediately.** If it is currently the active kid, also generate a
   replacement secret, add its `kid`, and set `INTERNAL_TOKEN_ACTIVE_KID`
   to the replacement — all in the same change.
2. **Deploy to all three services as fast as normal deploy mechanics
   allow.** Unlike the routine rotation above, there is deliberately no
   "wait one TTL" grace period here: the whole point is that the
   compromised key stops verifying as soon as possible, even though that
   means any token already minted with it (up to `INTERNAL_TOKEN_TTL_SECONDS`
   old) starts failing verification mid-flight the moment each service
   picks up the change. Those callers get an honest `401` and retry with a
   freshly minted token from the new key on their next call — no data is
   at risk, only availability for a few seconds.
3. **Confirm** by tailing logs/traces for `unknown_kid` verify failures
   dropping to zero (or being limited to the removed kid, if you're
   watching per-`kid` telemetry) once the deploy has reached every
   service.
4. If the underlying host env / secret store may itself be compromised
   (not just a single leaked value), rotate **all** keys in the object,
   not just the one you know about, and audit how the leak happened before
   re-provisioning.

## Flag-day note — turning signed tokens on for the first time

`INTERNAL_TOKEN_SIGNING_KEYS` / `INTERNAL_TOKEN_ACTIVE_KID` replace the
retired `INTERNAL_API_TOKEN` with **no dual-accept period** — there is no
code path left that reads `INTERNAL_API_TOKEN`, and there never was a mode
where a service accepts both the old opaque literal and the new signed
scheme at once. That means switching a deployment from "unconfigured" (or
from the old scheme) to signed tokens is a genuine flag day, not a
rolling migration:

- All four processes that participate in internal auth — `packages/agents`,
  `packages/webhook`, `packages/dashboard`, **and** Alertmanager (which
  needs its own separate `ALERTMANAGER_INGEST_TOKEN`, see below, provisioned
  at the same time) — must come up **together**, with
  `INTERNAL_TOKEN_SIGNING_KEYS` and `INTERNAL_TOKEN_ACTIVE_KID` already set
  in every one of the three services' environments before traffic flows.
- Bringing up only some of the four with the keyset set and leaving others
  on stale/absent config produces the fail-closed `503`s described above
  (unconfigured verifier) or `401`s (a caller mints with a keyset the
  verifier doesn't share) — not a graceful degrade. Treat the keyset as a
  single atomic switch flipped for the whole deployment at once, not a
  per-service setting to be rolled out incrementally.
- This is intentional (see the Phase 3 plan's scope decision on clean
  cutover): dual-accepting the retired opaque secret would keep token
  expiry inexpressible and defeats the reason this scheme exists.

## `ALERTMANAGER_INGEST_TOKEN` (separate credential, different rotation)

`ALERTMANAGER_INGEST_TOKEN` guards the one internal-auth hop we don't
originate: Alertmanager → webhook `POST /alerts/incoming`
(`packages/webhook/src/alertmanager-auth.ts`). Alertmanager cannot mint a
signed JWT — it only ever presents a fixed string sourced from a
`credentials_file` — so this is **not** part of the
`INTERNAL_TOKEN_SIGNING_KEYS` keyset above and has no `kid`/rotation-window
mechanism. It is a single static bearer, provisioned in exactly two
places:

- the webhook, which verifies it (`ALERTMANAGER_INGEST_TOKEN` env var), and
- Alertmanager, which presents it (materialized as the
  `alertmanager_ingest_token` Compose secret in `infra/docker-compose.yml`,
  read via `credentials_file` in `infra/alertmanager.yml`).

To rotate it: generate a new value (`openssl rand -hex 32`), update
`ALERTMANAGER_INGEST_TOKEN` in the host env, and redeploy **both** the
webhook and Alertmanager together — there is no old/new overlap window
here, so a value change is itself a small flag day for this one hop only
(Alertmanager retries webhook posts, so a few seconds of mismatch during
the redeploy is recoverable, not data-losing).
