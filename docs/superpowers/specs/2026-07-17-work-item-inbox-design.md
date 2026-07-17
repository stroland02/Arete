# The Work-Item Inbox — Kuma Discovers, You Decide, Kuma Delivers (2026-07-17)

**Idea (user):** Services should work like an email inbox. Connecting a service is like adding a
mailbox: it surfaces the problems, errors, tests, and improvement opportunities that service holds.
Kuma is not only reactive (reviewing PRs humans open) — it proactively **finds issues and
opportunities in the connected repo, the user selects what to pursue, and Kuma resolves it through
the orchestration and creates the pull request.** Self-healing (fix what's broken) + self-improving
(implement what could be better), growing with the state-of-the-art orchestration already built.

**Approved approach:** extend the existing orchestration (approach A). Discovery is a new entry
door into the SAME specialists → verify → compose → HITL pipeline; no parallel machinery.

**User rulings captured:**
- V1 sources: repo scan by the agents + existing PR-review findings + telemetry errors (when
  ingestion is live). Premium "improvement services" catalog (refactor / scaling / deep-audit
  campaigns) is FUTURE — designed for, not built.
- Scan trigger: **auto-scan on connect** (repo + model both present) + **manual re-scan** button.
- PR shape: **one PR per work item.**
- Triage v1: Fix/Implement or Dismiss only (no snooze/assign).

---

## 1. The WorkItem — one concept, everything orbits it

New persisted, tenant-scoped record (Eng1 schema lane):

```
WorkItem {
  id            String   @id
  installationId String                       // tenancy scope — every query filters on it
  kind          "issue" | "opportunity" | "error" | "pr_finding"   // + "campaign" later
  source        "scan" | "review" | "telemetry"                    // + "catalog" later
  title         String                        // one-line, inbox subject
  detail        String                        // what & why, from the agents
  evidence      Json                          // [{ path, line, excerpt? }] — REAL file:line refs
  dimension     String                        // one of the 6 review dimensions
  confidence    Float                         // REAL, from agent+critic — never synthesized
  state         "open" | "fixing" | "staged" | "posted" | "dismissed"
                // (selection is UI-only, never persisted; Fix moves open → fixing)
  containerId   String?                       // set when fixing starts (IssueContainer link)
  scanRunId     String?                       // which scan produced it
  createdAt / updatedAt
}

ScanRun {
  id, installationId, repositoryId,
  status: "running" | "complete" | "failed" | "no_findings",
  startedAt, finishedAt?, error?              // honest status, always
}
```

Dedup: a re-scan matches on (installationId, dimension, evidence-path fingerprint) — existing open
items update rather than duplicate; dismissed items stay dismissed (a dismissal is a decision).

## 2. Discovery — how the inbox fills

- **Agents `/scan` endpoint** (Eng3): briefs the six specialists on the WHOLE repo — code map for
  structure + targeted file reads — instead of a PR diff. Same per-request `llm` block (BYO model),
  same critic verification. Returns findings in WorkItem shape. A finding without real file:line
  evidence is dropped by the critic, never surfaced.
- **Auto-scan on connect** (Eng1, webhook): fires when BOTH the repo install AND a ModelConnection
  exist (a scan cannot think without a model). Connect order doesn't matter — whichever completes
  the pair triggers the first scan. Recorded as a ScanRun.
- **Manual re-scan**: `POST /api/scan` (session-authenticated, tenant-scoped) + a "Scan" button on
  Services. Re-scan while one is running → 409.
- **Other sources**: existing PR-review findings sync into WorkItems as `source: "review",
  kind: "pr_finding"`; telemetry errors become `source: "telemetry", kind: "error"` once ingestion
  is live (schema-ready now, populated later).
- **Honest empty state:** a completed scan with nothing found shows "No issues found — Kuma
  rescanned <time>. Rescan anytime." NEVER a fabricated finding to fill the inbox.

## 3. Services = the inbox (UI reframe, Eng2)

Each connected service is a mailbox in the rail:
- **Git repo**: unread-style badge counts — issues & opportunities from scans, grouped
  `Issues (N) / Opportunities (M)`, plus the existing PR reviews list.
- **Telemetry services** (when live): their error work items.
- Item row: kind chip, title, dimension, confidence; selecting shows detail + evidence (file:line)
  in the Kuma pane.
- **Triage:** `Fix it` (issues/errors) / `Implement it` (opportunities) → starts the pipeline;
  `Dismiss` → state: dismissed. Nothing else in v1.
- Scan status line: last ScanRun status + "Scan" button. Account-State Contract: a connected,
  scanned-clean repo is `connected_idle` — populated ("no issues found"), never blank.

## 4. Resolution — the pipeline that already exists

`Fix it` on a WorkItem →
1. Create IssueContainer (Eng2's persistence work; container born from the item's evidence —
   real target, repo, files) and link `workItem.containerId`; state → `fixing`.
2. `driveContainer` runs: specialists propose → each verified → synthesizer composes. The Kuma
   console streams every step live (glass box, unchanged).
3. Fix staged as **one PR per item** on branch `kuma/<kind>-<shortId>`; item state → `staged`.
4. **HITL gate unchanged:** only the human approves (`solution_approved`); Send PR posts it;
   item state → `posted` with the PR link. Kuma never sends or merges on its own.

## 5. Ownership (current lanes, no reassignment)

- **Eng1** (db + webhook): WorkItem + ScanRun schema/migrations; auto-scan trigger at the
  connect choke points; `POST /api/scan`; review-findings → WorkItem sync.
- **Eng3** (agents): `/scan` endpoint — repo-context specialist runs, critic-grounded findings,
  honest no_findings; reuses get_llms_by_role_from_config.
- **Eng2** (dashboard): inbox UI (rail mailboxes, item rows, triage actions, scan status);
  WorkItem → IssueContainer wiring on Fix; state transitions surfaced live.
- **PM**: integration, Account-State Contract updates, gate.

## 6. Error handling & integrity

- Scan failure → ScanRun `failed` with the reason shown ("scan failed: <reason> — retry");
  never a partial inbox presented as complete.
- Model missing → scan doesn't run; inbox shows "connect a model to let Kuma scan" (three-state
  rule; the agents empty-state already points there).
- Fix pipeline failure → item returns to `open` with the failure noted on the container stream;
  never silently dropped.
- Tenancy on every query; secrets/keys untouched by this feature; scan costs ride the tenant's
  connected model (BYO — the platform pays nothing).

## 7. Testing

TDD per package: WorkItem state-machine transitions (valid/invalid); dedup-on-rescan; scan
trigger fires only when repo+model both present; /scan drops evidence-free findings (agents test);
inbox state-matrix tests (open/dismissed/staged renders; scanned-clean honest empty); one-PR-per-
item; HITL: staged never auto-sends.

## 8. Future (designed-for, not built)

- **Premium improvement-services catalog**: `kind: "campaign"`, `source: "catalog"` — full-suite
  refactors, scaling overhauls, deep-audit sweeps offered as selectable services per repo.
- Scheduled/background scans with cost controls; telemetry ingestion feeding `error` items;
  batch-into-one-PR option; snooze/assign triage.
