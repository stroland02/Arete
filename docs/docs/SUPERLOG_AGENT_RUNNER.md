# The Superlog Agent Runner — Reverse-Engineering the Closed Core

**Date:** 2026-07-20
**Subject:** the `AGENT_RUNNER_ANTHROPIC_MODULE` seam — what's behind it, and how to build your own
**Basis:** source review of `github.com/superloglabs/superlog` (Apache-2.0)
**Companion to:** `SUPERLOG_ARCHITECTURE.md` §5.5

---

## 0. TL;DR

The investigation agent — the thing that opened, root-caused, and resolved our
`honey-jackal` incident — is loaded by a dynamic `import()` of whatever
`AGENT_RUNNER_ANTHROPIC_MODULE` points at. That module is not published to npm
(404) and is not in the repo.

**But it is not a lock. It is a documented plugin seam**, and the open-source
repo contains:

- the **complete TypeScript interface** the module must satisfy,
- a **working reference implementation** (`community.ts`),
- **test fixtures** demonstrating a minimal valid module,
- **every tool schema and rubric** the agent is expected to honour,
- an **exported helper** that assembles the result object for you,
- the **full state machine, budgets, and error contracts**.

The honest conclusion: **the closed part is much smaller than it looks.** What is
withheld is the *harness* — system prompt, model choice, turn loop, sandbox, MCP
wiring. What is published is the *specification of a correct investigation*: what
must be produced, how confidence is calibrated, how evidence must be cited, and
what a good vs. bad summary looks like.

You cannot recover their prompt. You can build a functionally equivalent runner.

---

## 1. The seam

```ts
// apps/worker/src/infra/agent-runner/backend.ts
if (runtime === "community") return communityRunnerBackend;
if (runtime === "disabled")  return disabledRunnerBackend;
if (runtime === "anthropic") return loadConfiguredRunner("anthropic", "AGENT_RUNNER_ANTHROPIC_MODULE");
```

Three runtimes; default `community`, overridable via `DEFAULT_AGENT_RUN_PROVIDER`.
The loader memoizes on the specifier string, so changing the env var mid-process
re-imports.

Sibling seams follow the same pattern and are *also* absent from the repo:

| Env var | Purpose | Consequence if missing |
|---|---|---|
| `AGENT_RUNNER_ANTHROPIC_MODULE` | the investigation agent | `anthropic` runtime unusable |
| `AGENT_PATCH_FILE_DOWNLOADER_MODULE` | reads the unified diff back out of the agent's sandbox | PRs must carry inline patches |
| `AI_USAGE_SINK_MODULE` | LLM cost metering | no-op; stock builds emit nothing |

That third one is quietly interesting: **a stock self-hosted build does not meter
its own AI spend.**

---

## 2. The module contract

The specifier is anything `import()` resolves — a package name, a file URL, even
a `data:text/javascript,…` URL (which is exactly what the tests use). The module
must export an **object** (not a class — validation checks `typeof === "object"`,
so a constructor fails) as either a named `agentRunnerBackend` export or
`default`; named wins.

Validation is **shallow and structural** — ten required members, checked by
`typeof`. No argument or return-value type checking happens anywhere. The seam is
trust-on-first-import.

```ts
type AgentRunnerBackend = {
  name: string;
  maxRepoResources: number;                        // caps mounted repos
  start(input): Promise<{ sessionId: string }>;
  terminate(sessionId): Promise<void>;             // MUST be idempotent
  startChat(input): Promise<{ sessionId: string }>;
  sendChatMessage(sessionId, message): Promise<void>;
  collect(sessionId): Promise<AgentRunnerSnapshot>;
  resume(sessionId, message): Promise<void>;       // human reply framing
  steer(sessionId, message): Promise<void>;        // mid-turn interjection
  dispatchIntegrationToolCalls(input): Promise<number>;
  dispatchChatToolCalls(input): Promise<{ handled: number; repliesThisTurn: number }>;
  classifyDeliveryError?(err): "wedged_turn" | "session_gone" | "unknown";  // optional
  interrupt?(sessionId): Promise<void>;                                     // optional
};
```

A minimal module that passes validation is about fifteen lines — the test fixture
proves it. Everything meaningful is in the semantics, not the shape.

**`resume` vs `steer`** is a genuine design distinction, not redundancy: `resume`
carries a *human reply* and should be framed as such to the model; `steer` is a
*system interjection into a live turn* and must degrade gracefully when the
session is busy (the worker catches "busy" errors and retries next tick).

**The two optional methods matter more than "optional" suggests.** Without
`classifyDeliveryError` + `interrupt`, a session whose turn is wedged on
unanswered tool events cannot be repaired — the worker discards it and cold-starts
a follow-up run, losing all accumulated context.

---

## 3. What the runner receives

`AgentRunnerStartInput` — every field, and who fills it:

| Field | Notes |
|---|---|
| `incidentId`, `projectId`, `orgId`, `title`, `service` | identity |
| `issueSummaries[]` | title, exception type, message, `topFrame`, `normalizedFrames[]`, full `stacktrace`, `sessionId`, `lastSample`, `traceContext`, and `alertEpisode` for alert-derived issues |
| `repoCandidates[]` | `{fullName, cloneUrl, installationToken, score, instructionFiles[]}` — short-lived GitHub App read tokens |
| `mcpResource` | `${API_BASE_URL}/mcp` — the runner must wire this up itself |
| `memories[]` | durable project facts, injected **in full** |
| `predecessors[]` | prior incidents in a recurrence chain, with their findings |
| `followUp` | set when a human/PR event revives a finished investigation |
| `customInstructions`, `customPrompt` | org + project context; manual-run brief |
| `telemetryInvestigationHint` | one constant sentence about following `session.id` |
| `prPolicy`, `approvalPromptsEnabled`, `prBaseBranch`, `githubConnected` | capability flags |

`instructionFiles` is the detection of `CLAUDE.md`, `AGENTS.md`, `.cursorrules`,
`.cursor/rules/*`, and Copilot instructions on the default branch — probed for
the top 10 candidates only. The comment says runners "surface these so the agent
reads them after cloning and follows the repo's conventions."

**Note for us:** repo candidates arrive pre-scored by the worker. The agent does
not choose repositories; it receives them.

---

## 4. What the runner must return

`collect()` returns a snapshot:

```ts
{
  sessionId, status: "running"|"idle"|"terminated"|"rescheduling",
  activeSeconds, events[], result: AgentRunResult | null,
  unknownCustomTools[], latestMessage, modelUsage{...},
  // optional, for runners implementing the outcome toolset:
  pendingOutcome?, partialPullRequestDelivery?, blockingPullRequestDelivery?, sentToolAckCount?
}
```

The optional fields are explicitly documented as optional "so runners without the
outcome toolset remain source-compatible" — a real commitment to third-party
implementations.

### You don't build the result by hand

`assembleAgentRunResult()` is **exported from the open source**
(`agent-outcome-tools.ts`). Feed it `{findings, terminal, actions}` and it folds
them into the persisted result, including the state mapping:

| Terminal tool called | Resulting `state` |
|---|---|
| `propose_pr` | `awaiting_events` (PRs out for review) |
| `report_external_cause` | `awaiting_events` + `waitReason` |
| `ask_human` | `awaiting_human` + `question` |
| `complete_investigation` | `complete` |
| `resolve_incident` | `complete` + resolution + issue outcomes |

`state: "failed"` is never produced by the helper — a runner sets it directly.

Confidence is **clamped, not rejected** (`0–10`, rounded), with a comment noting
"models occasionally overshoot the range." Missing confidence defaults to 5.
Buckets: ≥8 high, ≥5 medium, else low.

---

## 5. The reference implementation

`community.ts` is 112 lines and is a **static, non-LLM stub**. It:

- mints a `sessionId`, synthesizes a finished snapshot immediately
  (`status: "terminated"`, `activeSeconds: 0`), writes it to a JSON file, returns
- always returns `state: "complete"` with `rootCause`, `estimatedImpact`, and
  every classification field explicitly `null`
- persists one JSON file per session under `COMMUNITY_AGENT_RUNNER_STATE_DIR`
- throws on `resume`, `steer`, `startChat`, `sendChatMessage` with precise
  messages
- returns 0 / empty from both dispatch methods
- declares `maxRepoResources: 3` and a model string of `"community/static"`

It is the shape reference, not a working investigator. **This is what a
self-hoster actually gets out of the box** — a runner that writes a one-sentence
summary naming the top issue and explicitly states no fix was proposed.

The `disabled` backend is the other useful reference: every lifecycle method
throws, but both *dispatch* methods return empty values rather than throwing — so
a disabled install never deadlocks a session. That asymmetry is a deliberate
robustness choice worth copying.

---

## 6. The tool surface — this is the real prompt

In a tool-calling agent, tool descriptions do most of the prompting work. Superlog
ships all of them.

### Capability gating

```
prCreation      = githubConnected && prPolicy !== "never"
approvalPrompts = approvalPromptsEnabled && approvalPromptToolsAvailable
```

- `propose_pr` appears **iff** `prCreation`
- `complete_investigation` appears **iff neither** capability is available — it is
  the escape hatch for read-only installs
- `report_findings`, `ask_human`, `report_external_cause`, `resolve_incident` are
  always present

### `report_findings` — non-terminal, callable repeatedly

Carries `summary`, `proposedTitle`, `rootCause`, `rootCauseConfidence`,
`estimatedImpact`, `impactConfidence`, `severity`, `handoffNotes`. Repeated calls
overwrite provided fields and preserve omitted ones.

The **rubrics** are the most valuable published artifact here:

> **Root-cause confidence (0–10):** 10 = every claim backed by a verbatim quote
> from a file read this session AND you observed/reproduced the failure; 7–9 =
> quote-backed, reproduction inferred; 4–6 = code path identified, mechanism is
> hypothesis; 1–3 = speculative; 0 = no evidence (prefer `ask_human` then).

> **Impact confidence (0–10):** 10 = impact backed by concrete signal (telemetry
> counts, error rates, traffic numbers from a tool call); low = inferred from the
> component name alone.

> **Severity:** SEV-1 = customer-visible outage / data loss / revenue stop.
> SEV-2 = significant degradation, major feature broken for many users. SEV-3 =
> bug or partial impact not blocking primary flows.

> **Evidence format:** cite evidence as a bold `path:line` header followed by a
> fenced code block with the language tag matching the file extension, quoting
> the file verbatim.

This is why `honey-jackal` scored exactly **9**: it quoted `api/gemini.py`
verbatim but never reproduced the 503. And it is why the write-up looked the way
it did — the format is mandated.

The `summary` and `proposedTitle` descriptions go further than most prompt
engineering ever does: they prescribe sentence count, demand the operator's
perspective over the mechanism, ban leading with a function name or exception
class, ban remediation wording ("the fix…") in summaries, require translating
raw error codes into symptom words in titles, and supply explicit Good/Bad
example pairs. Roughly a page of style guide, delivered through a JSON schema
field description.

### The terminal tools

| Tool | Effect | Notable rule |
|---|---|---|
| `propose_pr` | one validated PR per repo, then wait for review | branch must match `^superlog/`; patch must live under `/mnt/session/outputs/`; **"NOT for noise: a patch that only quiets a signal is the wrong outcome"** |
| `resolve_incident` | resolve incident + classify **every** linked issue atomically | `under_observation` requires an escalation trigger + threshold; alert issues must be resolved, not silenced |
| `report_external_cause` | park on an established external cause | leaves incident and issues open |
| `ask_human` | pause for a human answer | four enumerated legitimate uses, plus **"Never fabricate a question to avoid a harder outcome you have the evidence for"** |
| `complete_investigation` | hand findings to an external ticket workflow | only when no intervention capability exists |

Two engineering details worth stealing outright:

**Terminal side effects are dispatched server-side *before* the success ack.**
`propose_pr` and `resolve_incident` are executed and validated first; if delivery
fails, the call is rejected and **the turn stays alive** so the model can retry
only the failed entries. The agent never receives a success ack for something
that didn't happen.

**Retired tool names are error-acked with redirect guidance**, not routed to the
unknown-tool path (which hard-fails the run) — because "sessions created against
an old toolset can outlive a deploy (a parked run resumes days later)." Graceful
deprecation for a model with stale expectations.

### Cross-cutting gates

- **Findings-first:** `propose_pr`, `resolve_incident`, `complete_investigation`,
  and `report_external_cause` all require a prior `report_findings`. `ask_human`
  is exempt.
- **Validation errors are written for the model**, not for a developer — e.g.
  "`branchName` must start with `superlog/`" is returned as a tool error the
  agent can correct within the same session.
- **The turn-conclusion nudge** is a fixed marker string the worker steers in when
  a turn ends with no outcome. It is load-bearing: the worker scans the session's
  own event stream for it to avoid re-sending, and stream-replaying runners must
  exempt it from turn-boundary handling "so it never resets outcome state the turn
  already produced." **Reword it and you break the loop.**

### Memory tools

`save_memory`, `update_memory`, `list_memories` — schemas defined in the worker,
executed by the worker, declared by the runner. Kinds: `feedback`, `terminology`,
`infra`, `project`. Title ≤200 chars, body ≤4,000. Explicitly instructed not to
save incident-specific findings or secrets. Tenant guard returns `null` on an
org/project mismatch, so a mis-dispatched call cannot cross tenants.

---

## 7. Lifecycle and budgets

```
queued → repo_discovery → running ⇄ awaiting_human
                             │      ⇄ awaiting_events   (PRs under review)
                             │      ⇄ resuming          (human revived a finished run)
                             ├────→ pr_retry_queued
                             ├────→ complete
                             └────→ failed
                       (blocked_no_github = dormant, awaits webhook)
```

A single polling tick processes runs in `asc(updatedAt)` order — oldest-stalest
first — with a comment explaining that `desc(createdAt)` let the newest 20 runs
monopolise every tick. Batch 20, max concurrency 50, 90 s job timeout.

**Budgets:**

| Budget | Default | Notes |
|---|---|---|
| `maxRuntimeMinutes` | 90 | measured from provider-reported `activeSeconds` |
| Wall-clock backstop | 4× the above (6 h) | exists because idle sessions report `active_seconds: null` |
| `maxHumanResumeCount` | 3 | does **not** apply to continuations |
| Follow-up runs | 3, within 14 days | |

Time parked in `awaiting_human` is **excluded** from the wall clock, with a
comment citing the production incident that forced the fix: a run that parked on
`ask_human` was being reaped the moment it resumed, discarding a finished
investigation.

**Orphan-session protocol:** if the worker loses a compare-and-swap after the
runner returns a `sessionId`, it records a termination-pending marker and calls
`terminate()`. This is precisely why idempotent `terminate` is a hard requirement.

---

## 8. What you would have to invent

Everything below is genuinely absent from the repo:

1. **The investigation system prompt.** There is no investigation system prompt
   anywhere in the tree — only the sibling agents have them. The tool
   descriptions are the rubric; the persona, methodology, and ordering are not.
2. **Initial user-message assembly.** Nothing turns `AgentRunnerStartInput` into
   text. Field comments state intent ("injected into the initial prompt in full")
   but never format.
3. **Model selection and inference params** for the investigation agent.
4. **The turn loop** — sampling, tool plumbing, turn-boundary detection, deriving
   `status`, accounting `activeSeconds`, extracting `latestMessage`, token usage.
5. **The sandbox.** `/mnt/session/outputs/` is referenced by the schemas but
   nothing creates it. Repo cloning, filesystem/bash tooling, and egress are the
   runner's job.
6. **MCP client wiring.** `mcpResource` is a bare URL; connecting, authenticating,
   and exposing those tools to the model is on you.
7. **The patch-file downloader module** and the **chat reply tool**.
8. **Durable sessions and stream replay** across deploys.

---

## 9. What the contract reveals about the closed module

We cannot read it, but the interface constrains it heavily. Several details are
strong tells:

- **Sessions are durable and provider-hosted.** They survive worker restarts and
  resume days later; `terminate()` releases a *provider* session; `session_gone`
  is a distinct error class. This is not an in-process loop holding a message
  array.
- **`activeSeconds` is provider-reported**, and a comment states the provider
  reports it as `null` for idle sessions — which is why the wall-clock backstop
  exists. The runner is *reading* that number, not computing it.
- **A `rescheduling` status exists**, implying the provider can park and requeue
  work on its own.
- **`requires_action` and unacknowledged `custom_tool_use` events** appear in
  comments — a hosted tool-use protocol where the session blocks until tool
  results are posted back.
- **`/mnt/session/outputs/`** is a container filesystem convention, and the
  runner must download files *out* of it via a separate module.
- **Wedged turns need an explicit `interrupt`** to become deliverable again.

Together these describe a wrapper over a **managed, server-side agent session
API with a sandboxed filesystem and asynchronous tool-use acknowledgement** —
not a bespoke agent loop. The name of the env var and the `claude-sonnet-4-6`
default used by all five sibling agents make the vendor obvious.

So the closed module is likely thinner than its secrecy implies: session
lifecycle mapping, prompt assembly, tool registration, and snapshot translation
over a hosted agent runtime. The genuinely proprietary asset is **the prompt and
the accumulated tuning**, not the plumbing.

---

## 10. If you actually wanted to build one

A pragmatic path, in order:

1. **Copy `community.ts`** and keep its file-backed session store. You now have a
   valid module.
2. **Replace `start()`** with: assemble a prompt from the input, clone the top
   repo candidates, open a session against whatever agent runtime you choose.
3. **Register the tools** — the outcome definitions are exported by the worker
   (`outcomeToolDefinitionsForCapabilities`), the memory tools likewise. Do not
   rewrite the descriptions; they are the calibration.
4. **Implement `collect()`** to translate your runtime's state into a snapshot,
   using the exported `assembleAgentRunResult()` for the result object.
5. **Implement `dispatchIntegrationToolCalls`** — call `executeOutcomeAction` for
   outcome tools, honour `deferAck`, fall through for everything else.
6. **Implement `resume`/`steer`** with distinct framing, and `terminate`
   idempotently.
7. **Add `classifyDeliveryError` + `interrupt`** — skipping them costs you
   context on every wedged turn.
8. Wire `mcpResource`, and provide a patch-downloader module if you want PRs.

Realistically: a competent implementation is a few thousand lines, and the
quality ceiling is set by the prompt you write — which is the one thing you must
author yourself.

---

## 11. Scope note

This document was produced entirely from the Apache-2.0 licensed repository and
from our own incident output. No attempt was made to extract the proprietary
prompt from Superlog's running service — for example by planting injection
content in our telemetry or repository for their agent to ingest. That would be
trade-secret extraction from a third party's production system, it would likely
breach their terms, and — as this document shows — it is unnecessary. The
specification is public; only the prose is not.

If the goal is a self-hosted investigation agent, the supported path is to
implement this interface. If the goal is understanding what the closed component
does, the contract above is a near-complete answer.
