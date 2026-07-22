# Superlog — Security & Data-Flow Threat Model

**Date:** 2026-07-20 · **Subject:** the JEI BOM Tool's exposure through Superlog
**Basis:** source review of `github.com/superloglabs/superlog` (Apache-2.0)
**Companions:** `SUPERLOG.md` · `SUPERLOG_ARCHITECTURE.md`

---

## 0. Scope and method

This document answers one question: **what happens to JEI data once it leaves our
process, and what could go wrong?**

It is a source review, not a penetration test. Nothing was attacked; no live
system was probed beyond normal MCP queries against our own project. Findings are
either **verified in source** (cited) or explicitly marked as **not
determinable**. Severity is rated for *our* situation — a small engineering team
shipping a desktop tool to internal users — not in the abstract.

**Bottom line:** the platform's own security engineering is above average — the
SSRF guard, tenancy anti-spoofing, and query-parameterisation are genuinely well
built. Our risk comes almost entirely from **what we send it**, and from the fact
that once sent, it is kept forever.

---

## 1. Trust boundaries

```
┌──────────────────────────────────────────────┐
│ ZONE 1 — our machines (users' Windows PCs)   │
│  BT 2.5.0.exe                                │
│   • Gemini/DigiKey/Mouser API keys           │  ← real secrets live here
│   • sl_public_ ingest token (write-only)     │
│   • bom_tool.log (local, rotated)            │
└───────────────────┬──────────────────────────┘
                    │ HTTPS + x-api-key       ⟵ BOUNDARY A: egress
┌───────────────────▼──────────────────────────┐
│ ZONE 2 — Superlog Cloud (third party)        │
│  proxy → collector → ClickHouse              │
│   • spans, logs, metrics                     │
│   • exception messages + stacktraces (RAW)   │  ← our leaked key lands here
│   • retained INDEFINITELY                    │
└───────────────────┬──────────────────────────┘
                    │                          ⟵ BOUNDARY B: source access
┌───────────────────▼──────────────────────────┐
│ ZONE 3 — GitHub (via GitHub App)             │
│  investigation agent clones our repos        │
└───────────────────┬──────────────────────────┘
                    │                          ⟵ BOUNDARY C: read-back
┌───────────────────▼──────────────────────────┐
│ ZONE 4 — MCP clients (this Claude Code)      │
│  can query all our telemetry back out        │
└──────────────────────────────────────────────┘
```

Four boundaries, three of which we opened this week. Boundary B in particular is
worth stating plainly: **by connecting the GitHub App, we granted a third-party
LLM agent read access to our source code.** That is a deliberate, reasonable
trade for automated root-cause analysis — but it should be a conscious one.

---

## 2. Findings summary

| ID | Finding | Severity (for us) | Owner |
|---|---|---|---|
| **S-1** | Secrets in telemetry are stored verbatim, forever, with no deletion path | 🔴 **Critical** | **Us** (+ platform) |
| **S-2** | MCP tokens are read-**write** by default; `mcp:read` advertised but unenforced | 🟠 High | Platform / our config |
| **S-3** | Source code exposure via GitHub App is broad and implicit | 🟠 High | Us |
| **S-4** | Tenant isolation is entirely application-layer | 🟡 Medium | Platform |
| **S-5** | Ingest-key revocation lags up to ~60 s | 🟡 Medium | Platform |
| **S-6** | SSRF protections disabled wholesale by one env var | 🟡 Medium | Self-hosters |
| **S-7** | Email verification not enforced | 🟡 Medium | Platform / our org |
| **S-8** | Long-lived MCP tokens (30 d / 90 d; PATs can be eternal) | 🟡 Medium | Our config |

---

## 3. S-1 — Secrets in telemetry: verbatim, forever 🔴

### The finding

Three facts compound into the most serious issue in this review.

**(a) There is no redaction of telemetry before storage.** Span
`StatusMessage`, `exception.message`, `exception.stacktrace`, log bodies, and all
attribute maps — including `http.url` — are stored exactly as received. The
ingest mapper is a pure passthrough.

The only redaction anywhere in the platform is three narrow cases, none of which
protect customer secrets: one scrubs **Superlog's own** ingest key out of Render
syslog lines; one redacts git credentials from *log output* (not telemetry); one
strips volatile values purely to make error fingerprints group together.

There is **no** generic scrubber, no attribute allow/deny list at ingest, and no
configuration knob to add one.

**(b) The primary tables have no TTL.** `otel_traces`, `otel_logs`, and all five
`otel_metrics_*` tables carry no expiry. Only two derived rollup tables expire, at
30 days. The migration files state this explicitly.

**(c) There is no deletion path.** No erasure endpoint, no per-project telemetry
purge, no `ALTER TABLE … DELETE`. Postgres has cascading FKs, so deleting a
project cleans up control-plane rows — but the ClickHouse telemetry is
**orphaned, not deleted**. It persists carrying a `superlog.project_id` that no
longer resolves.

**(d) It reads back out.** Any MCP-connected agent can retrieve it; the tool
descriptions advertise flattened `exception_message` and `exception_stacktrace`
fields.

### Our concrete exposure

`api/gemini.py` passes the Google API key as a **URL query parameter**. Every
Gemini failure therefore captured the full URL — key included — into the span
status message, the exception message, and the stacktrace. We observed **29
failed Gemini HTTP calls** in a single enrichment run.

That key is now in Superlog's ClickHouse, indefinitely, readable by anything
holding an MCP token for our project. It is also in `bom_tool.log` locally; our
`_SecretRedactingFilter` matches `api_key=`, `token`, `password` and similar, but
**not** `?key=`.

### Actions

| Priority | Action |
|---|---|
| 🔴 Now | **Rotate the Google API key.** Assume it is compromised — it left our infrastructure and cannot be recalled. |
| 🔴 Now | Move it to the `x-goog-api-key` **header**. One change removes it from the URL, exception text, and the `http.url` span attribute at once. |
| 🟠 Soon | Audit every other provider client (`digikey.py`, `mouser.py`, `octopart.py`, `siliconexpert.py`, `google_search.py`, `netsuite.py`) for credentials in URLs. |
| 🟠 Soon | Extend `_SecretRedactingFilter` to catch `?key=`/`&key=` query patterns. |
| 🟡 Later | Consider an OTel **span processor** that scrubs `http.url` query strings and exception text before export — defence in depth at the boundary we control. |
| 🟡 Later | Ask Superlog for a retention policy and a deletion endpoint. |

The fix:

```python
url = f"{self.base_url}/models/{self.model}:generateContent"
headers = {"Content-Type": "application/json", "x-goog-api-key": self.api_key}
```

### The general lesson

**Any error-reporting pipeline exfiltrates whatever your exception strings
contain.** This is not specific to Superlog — Sentry, Datadog, and Rollbar all
have this shape, and most at least ship default scrubbers. The durable fix is to
keep secrets out of exception-reachable strings in the first place: credentials
belong in headers, never in URLs.

---

## 4. S-2 — MCP tokens are read-write by default 🟠

The OAuth metadata advertises `scopes_supported: ["mcp:read"]`. **`mcp:read` is
not enforced anywhere.** Only two scope fragments are actually interpreted:

- `superlog:org:<id>` — clamps the token to one org.
- `superlog:telemetry` — the **only** read-only mode.

Absent `superlog:telemetry`, a session also registers alert, dashboard, incident,
and agent-config tools. A holder of our MCP token can therefore create and delete
**alerts** and **dashboards**, rewrite **project context**, alter the **issue
filter** (i.e. suppress error detection), edit **agent memories** (i.e. poison
future investigations), and **register new outbound MCP servers with stored
credentials**.

That last one is the sharpest edge: it turns a read token into a pivot for
outbound integration.

Mitigations that *are* present: every tool call re-checks org scope and project
membership, so a stolen token cannot follow its user into a project they lost
access to. Consent binds a token to exactly one project with an ownership check.

**Lifetimes are long** — access 30 days, refresh 90 days, and personal access
tokens may be set to never expire.

**Actions:**
- Treat the MCP token in `~/.claude.json` as a **write credential**. It is
  currently local-scope to this project directory; keep it out of any shared
  dotfiles repo.
- If a read-only agent is ever wanted, the client must request the
  `superlog:telemetry` scope explicitly.
- Prefer OAuth (rotating refresh) over a never-expiring PAT.

**Not determinable:** whether the web consent screen offers or defaults to the
telemetry-only scope. Server-side enforcement was verified; the UI path was not
traced.

---

## 5. S-3 — Source code exposure 🟠

The investigation agent does not merely read telemetry — it **clones our
repositories**. Selection is automatic, by token-overlap score against repos
reachable through the GitHub App installation, using short-lived read tokens. It
also probes for agent-instruction files (`CLAUDE.md`, `AGENTS.md`, `.cursorrules`,
Copilot instructions) on the default branch.

This is how `honey-jackal` quoted `api/gemini.py` line numbers — and it is the
capability that makes the product valuable. But two properties deserve conscious
acceptance:

1. **Selection is heuristic, not declarative.** We do not enumerate which repos
   the agent may read; a scoring function picks from everything the installation
   grants. A repo whose name happens to token-match a service could be cloned.
2. **The agent that reads the code is the closed component.** The investigation
   runner's prompt and model are behind a dynamic import not present in the
   public repo, so the exact handling of source content is not auditable from the
   open source.

**Actions:**
- Scope the GitHub App installation to **only** the repos that back instrumented
  services — not the whole org. This is the single highest-value control here.
- Remember that `CLAUDE.md` / `AGENTS.md` in our repos are read by a third-party
  agent; keep secrets and sensitive internal notes out of them.
- Note that `api/config_manager.py.example`, network share paths in
  `app_paths/__init__.py`, and similar are all readable once a repo is cloned.

---

## 6. S-4 — Tenant isolation is application-layer only 🟡

**What is strong.** Every ClickHouse read is project-scoped, with `projectId`
bound as a parameter — roughly 35 filter sites, no unfiltered query found.
Ingest cannot spoof tenancy: client-supplied `superlog.*` attributes are
**deleted** before the authenticated project id is stamped. All 152
project-scoped HTTP routes were audited and every one resolves through an
ownership check; **no IDOR was found.**

**What is fragile.** Isolation is 100% `WHERE`-clause discipline:

- A **single privileged ClickHouse user** is shared process-wide. No row
  policies, no per-tenant credentials, no `readonly=1`.
- There are **~10 independent `requireProjectAccess` implementations** across
  modules, with **two different authorization models**: the session API requires
  the project to be in your *active* org, while MCP accepts *any* org membership.

Correct today; one forgotten helper away from not being. This is a structural
observation about maintainability, not a live vulnerability.

---

## 7. S-5 — Revocation lag 🟡

Ingest keys resolve through a cache with a **60-second TTL**, 50k entries, and
only positive results cached. A revoked ingest key therefore keeps working for up
to a minute.

For a write-only, project-scoped token the blast radius is bounded (an attacker
can inject junk telemetry into one project, not read anything). But if we ever
have to revoke `sl_public_jxkog8…` in a hurry, plan for a minute of overlap.

Related: because the token is **inlined in the exe**, revoking it means shipping
a new build. That was the correct design choice for a desktop app — there is no
server-side env var to rotate — but it makes rotation a release, not a config
change. Worth knowing before an incident, not during one.

---

## 8. S-6 — The SSRF kill switch 🟡 *(self-hosters only)*

`packages/net-guard` is genuinely good work: default-deny egress with an IPv4
CIDR blocklist covering cloud metadata (`169.254.0.0/16`), RFC1918, loopback,
CGNAT and TEST-NETs; an IPv6 **allowlist** admitting only global unicast; fail-closed
on unparseable input; http(s) only; credentials-in-URL rejected; redirects never
followed; and — the detail that shows real care — a connect-time `lookup` that
**pins the connection to the validated IP**, closing the DNS-rebinding TOCTOU
window.

It guards webhook delivery and outbound calls to customer-configured MCP servers.

**But:** a single env var, `WEBHOOK_ALLOW_PRIVATE_DESTINATIONS`, disables *all*
IP checks **and** bypasses the pinning dispatcher. Off by default. Anyone
self-hosting should assert it stays unset in production.

---

## 9. S-7 / S-8 — Account and session posture 🟡

- **Email verification is not enforced.** The config sets
  `requireEmailVerification: false` with a comment noting it should be flipped
  "once we want to gate `/api/*`." A verification mail is sent; access is not
  gated on it. An unverified address gets a full session and can accept org
  invitations.
- **RBAC is org-level only.** Roles are effectively owner/admin (manage) vs.
  member (read/use). There is **no per-project membership or project role** —
  project access derives entirely from org membership. Anyone in our org can read
  all our telemetry.
- **Platform staff impersonation exists** (Better Auth `admin()` plugin,
  `session.impersonatedBy`). Normal for a hosted SaaS; worth knowing it exists.

**Actions:** keep org membership tight, since it is the only access boundary;
prefer SSO providers over password sign-up.

---

## 10. What the platform does well

Stating this explicitly, because a threat model that only lists problems gives a
distorted picture:

| Control | Assessment |
|---|---|
| **SSRF guard** | Above industry norm — metadata-endpoint blocking, IPv6 allowlist, DNS-rebinding pin, no redirect following |
| **Tenancy anti-spoofing** | Strip-then-stamp; spoofing is structurally impossible, not merely validated |
| **SQL injection surface** | Bound parameters for attribute *keys and values*; closed union for columns; allowlist for field filters; two regex-clamped interpolation paths; **no raw-SQL tool exists** |
| **OAuth 2.1** | Mandatory PKCE S256, refresh rotation, RFC 8707 resource binding checked on every request, exact redirect match, dangerous schemes blocked, single-use 5-min codes |
| **Token storage** | All five credential families SHA-256 hashed at rest; plaintext never stored; unsalted is fine for 256-bit random tokens |
| **Integration secrets** | AES-256-GCM at rest with a key-version column |
| **Dangerous primitives** | Zero occurrences of `eval`, `new Function`, `vm.runIn*`, or unsafe deserialization |
| **Signup handshake** | Hash-first; plaintext ingest token never transmitted |
| **Code comments** | The best security documentation in the project — each control explains *why* it exists |

`SECURITY.md` is a disclosure policy (private reporting, 3-day ack, 7-day triage,
safe harbour) covering both the repo and Superlog Cloud. There is, however, **no
threat model, data-classification policy, retention policy, or operator hardening
guide** anywhere in the repository.

---

## 11. Our action plan

| # | Action | Priority | Effort |
|---|---|---|---|
| 1 | **Rotate the Google API key** | 🔴 Now | minutes |
| 2 | Move Gemini auth to the `x-goog-api-key` header | 🔴 Now | 1 line |
| 3 | Audit the other six provider clients for credentials in URLs | 🟠 This week | ~1 h |
| 4 | Scope the GitHub App to only instrumented-service repos | 🟠 This week | minutes |
| 5 | Extend `_SecretRedactingFilter` to catch `?key=` patterns | 🟠 This week | ~30 min |
| 6 | Treat the MCP token as a write credential; keep out of shared configs | 🟠 This week | policy |
| 7 | Add an OTel span processor scrubbing URL query strings pre-export | 🟡 Backlog | ~2 h |
| 8 | Ask Superlog: retention policy, deletion endpoint, redaction roadmap | 🟡 Backlog | an email |
| 9 | Document that revoking the ingest token requires an exe release | 🟡 Backlog | note |

Items 1 and 2 are the whole of the urgent work. Everything else is hardening.

---

## 12. Residual unknowns

Honest list of what a source review cannot settle:

1. **Disk/backup encryption** for Superlog Cloud's ClickHouse and Postgres —
   nothing in the repo expresses it.
2. **Actual production TTLs.** The repo shows none on primary tables; whether the
   hosted service applies retention out-of-band is not observable.
3. **Whether `sl_management_*` keys have sub-scoping.** No scope column was
   found, implying all management keys are org-admin equivalent.
4. **Rate limiting on auth endpoints.** None found in the app; may exist at the
   edge (Cloudflare/Railway/Render).
5. **The consent UI's default scope** (see S-2).
6. **The closed investigation module.** Its prompt, model, and data handling are
   not in the public repo — including exactly what it does with cloned source and
   whether any of it is retained.
7. **Superlog Cloud's operational posture** — access controls, audit logging, and
   staff access to customer telemetry.

Items 1, 2, 6 and 7 are reasonable questions to put to the vendor before this
becomes load-bearing for anything more sensitive than BOM enrichment.

---

## 13. Verdict

For our use case — telemetry from an internal engineering tool — **the residual
risk is acceptable once the API key is rotated.** The platform's security
engineering is better than most products at this stage, and the two controls that
matter most for multi-tenancy (query parameterisation and tenancy stamping) are
implemented properly.

The real finding is not about Superlog at all. It is that **we shipped a
credential in a URL**, and observability faithfully carried it somewhere we cannot
delete it from. The fix is one line, and the lesson generalises to every error
reporter we will ever connect.
