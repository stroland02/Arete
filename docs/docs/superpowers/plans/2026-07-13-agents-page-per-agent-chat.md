# Agents Page Per-Agent Chat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/agents` open the selected specialist's own conversation — its real findings plus a live composer wired to the existing FastAPI `/chat` — and confirm `/services` as the Synthesizer's home.

**Architecture:** Add one tenant-scoped query (`getAgentActivity`) and a new client `AgentConversation` pane that replaces the account-level `SynthesizerConsole` on the Agents page. The composer POSTs to a new thin Next route (`/api/agents/[id]/chat`) that authenticates, validates the agent id, and proxies to the already-running Python `/chat` service — honestly gated to a `503`/disabled state when that service or its model key is unavailable. The Services page is unchanged (it already owns the Synthesizer).

**Tech Stack:** Next.js 16 (App Router, RSC + client components), TypeScript, Prisma, NextAuth, Vitest (environment `node`, tests via `renderToStaticMarkup`), FastAPI agents service (`POST /chat`).

## Global Constraints

- **Next.js 16 is NOT the Next you know** — before writing any Next-specific code (route handler, page), skim `node_modules/next/dist/docs/` for the relevant API. Route/page `params` and `searchParams` are **Promises** — always `await` them.
- **Anti-fabrication (house rule):** never render a fake "live" model or invented data. Findings come only from real `ReviewComment` rows. When the model/service is unreachable, the composer shows a **truthful** disabled notice — never a canned reply.
- **Tenant isolation:** every read scopes through `repository: { installationId: { in: installationIds } }`. The client never supplies the tenant. `session.installations` is `[]` today (GitHub→account linking is a later spec), so the page renders its honest empty state until that lands — expected.
- **Reuse over new infra:** the live-chat backend already exists; proxy to it. Do not add an LLM SDK to the dashboard and do not modify the Python `ChatAgent`.
- **Agents-service URL:** `process.env.PYTHON_SERVICE_URL ?? "http://127.0.0.1:8000"` (mirrors `packages/webhook/src/config.ts`). Server-only; never sent to the browser.
- **Agent ids are the six `ReviewComment.category` values:** `security`, `performance`, `quality`, `test_coverage`, `deployment_safety`, `business_logic` (see `agent-catalog.ts`).
- **Test command (from repo root):** `pnpm --filter @arete/dashboard exec vitest run <path>`; full suite: `pnpm --filter @arete/dashboard test`.
- **Commit trailer:** end every commit message with
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

### Task 1: `getAgentActivity` query

**Files:**
- Modify: `packages/dashboard/src/lib/queries.ts` (add interface + function at end)
- Test: `packages/dashboard/src/lib/agent-activity.test.ts` (new)

**Interfaces:**
- Consumes: `PrismaClient` from `@arete/db`.
- Produces:
  ```ts
  export interface AgentActivityFinding {
    reviewId: string;
    prNumber: number;
    repositoryFullName: string;
    createdAt: Date;
    category: string; // agent id
    path: string;
    line: number;
    body: string;
    severity: string;
  }
  export async function getAgentActivity(
    db: PrismaClient,
    installationIds: string[],
    limit?: number,
  ): Promise<AgentActivityFinding[]>
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/src/lib/agent-activity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getAgentActivity } from './queries';

// Self-contained fake of the one Prisma method getAgentActivity uses, built
// the same way as queries.test.ts's fake: exercise the REAL query-building
// code (the where/include shape), not a mock of it.
function makeDb(
  comments: Array<{ id: string; reviewId: string; category: string; path: string; line: number; body: string; severity: string; createdAt: Date }>,
  reviewById: Record<string, { repositoryId: string; prNumber: number }>,
  repoById: Record<string, { installationId: string; fullName: string }>,
) {
  return {
    reviewComment: {
      findMany: async ({ where, take, orderBy }: any) => {
        const ids: string[] = where.review.repository.installationId.in;
        const matched = comments.filter((c) => {
          const review = reviewById[c.reviewId];
          const repo = repoById[review.repositoryId];
          return ids.includes(repo.installationId);
        });
        matched.sort((a, b) =>
          orderBy?.createdAt === 'desc'
            ? b.createdAt.getTime() - a.createdAt.getTime()
            : a.createdAt.getTime() - b.createdAt.getTime(),
        );
        return matched.slice(0, take).map((c) => {
          const review = reviewById[c.reviewId];
          return { ...c, review: { ...review, repository: repoById[review.repositoryId] } };
        });
      },
    },
  } as any;
}

const now = new Date('2026-07-13T00:00:00Z');
const earlier = new Date('2026-07-12T00:00:00Z');

describe('getAgentActivity', () => {
  it('returns [] without querying when no installations are authorized', async () => {
    const db = makeDb([], {}, {});
    expect(await getAgentActivity(db, [])).toEqual([]);
  });

  it('never returns a finding from an installation outside the authorized set', async () => {
    const comments = [
      { id: 'c-a', reviewId: 'r-a', category: 'security', path: 'a.ts', line: 1, body: 'A finding', severity: 'error', createdAt: now },
      { id: 'c-b', reviewId: 'r-b', category: 'security', path: 'b.ts', line: 2, body: 'B finding', severity: 'error', createdAt: now },
    ];
    const reviewById = { 'r-a': { repositoryId: 'repo-a', prNumber: 11 }, 'r-b': { repositoryId: 'repo-b', prNumber: 22 } };
    const repoById = { 'repo-a': { installationId: 'inst-a', fullName: 'acme/api' }, 'repo-b': { installationId: 'inst-b', fullName: 'globex/web' } };
    const db = makeDb(comments, reviewById, repoById);

    const result = await getAgentActivity(db, ['inst-a']);

    expect(result.map((f) => f.body)).toEqual(['A finding']);
  });

  it('maps every field and orders newest-first', async () => {
    const comments = [
      { id: 'c1', reviewId: 'r1', category: 'performance', path: 'old.ts', line: 5, body: 'older', severity: 'warning', createdAt: earlier },
      { id: 'c2', reviewId: 'r1', category: 'security', path: 'new.ts', line: 9, body: 'newer', severity: 'error', createdAt: now },
    ];
    const reviewById = { 'r1': { repositoryId: 'repo-a', prNumber: 42 } };
    const repoById = { 'repo-a': { installationId: 'inst-a', fullName: 'acme/api' } };
    const db = makeDb(comments, reviewById, repoById);

    const result = await getAgentActivity(db, ['inst-a']);

    expect(result[0]).toEqual({
      reviewId: 'r1', prNumber: 42, repositoryFullName: 'acme/api', createdAt: now,
      category: 'security', path: 'new.ts', line: 9, body: 'newer', severity: 'error',
    });
    expect(result[1].body).toBe('older');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arete/dashboard exec vitest run src/lib/agent-activity.test.ts`
Expected: FAIL — `getAgentActivity is not a function` (not yet exported).

- [ ] **Step 3: Add the query to `queries.ts`**

Append to the end of `packages/dashboard/src/lib/queries.ts`:

```ts
export interface AgentActivityFinding {
  reviewId: string;
  prNumber: number;
  repositoryFullName: string;
  createdAt: Date;
  category: string;
  path: string;
  line: number;
  body: string;
  severity: string;
}

/**
 * Recent review findings across the caller's authorized installations, newest
 * first. The Agents workspace slices these by the selected agent's category
 * client-side. Scoped through the same `repository: { installationId: { in } }`
 * choke point as every other query here, so a finding from an installation
 * outside `installationIds` can never appear. Empty `installationIds` => no
 * query, `[]` (the honest empty state).
 */
export async function getAgentActivity(
  db: PrismaClient,
  installationIds: string[],
  limit = 60,
): Promise<AgentActivityFinding[]> {
  if (installationIds.length === 0) return [];

  const rows = await db.reviewComment.findMany({
    where: { review: { repository: { installationId: { in: installationIds } } } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { review: { include: { repository: true } } },
  });

  return rows.map((c) => ({
    reviewId: c.reviewId,
    prNumber: c.review.prNumber,
    repositoryFullName: c.review.repository.fullName,
    createdAt: c.createdAt,
    category: c.category,
    path: c.path,
    line: c.line,
    body: c.body,
    severity: c.severity,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arete/dashboard exec vitest run src/lib/agent-activity.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/queries.ts packages/dashboard/src/lib/agent-activity.test.ts
git commit -m "$(printf 'feat(agents): add tenant-scoped getAgentActivity query\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: `AgentConversation` center pane

**Files:**
- Create: `packages/dashboard/src/components/dashboard/agents/agent-conversation.tsx`
- Test: `packages/dashboard/src/components/dashboard/agents/agent-conversation.test.tsx`

**Interfaces:**
- Consumes: `Agent` from `./agent-catalog`; `AgentActivityFinding` from `@/lib/queries`; `cn` from `@/lib/utils`.
- Produces:
  ```ts
  export interface AgentConversationProps {
    agent: Agent;
    findings: AgentActivityFinding[]; // already filtered to this agent
    hasReviews: boolean;
    onConfigure: (agentId: string) => void;
  }
  export function AgentConversation(props: AgentConversationProps): JSX.Element
  ```

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/src/components/dashboard/agents/agent-conversation.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentConversation } from './agent-conversation';
import { AGENTS } from './agent-catalog';
import type { AgentActivityFinding } from '@/lib/queries';

const security = AGENTS.find((a) => a.id === 'security')!;
const noop = () => {};

function finding(over: Partial<AgentActivityFinding> = {}): AgentActivityFinding {
  return {
    reviewId: 'r1', prNumber: 7, repositoryFullName: 'acme/api', createdAt: new Date('2026-07-13T00:00:00Z'),
    category: 'security', path: 'src/auth/session.ts', line: 42, body: 'Refresh token written to localStorage', severity: 'error',
    ...over,
  };
}

describe('AgentConversation', () => {
  it('renders the agent header, model tier, and real finding rows', () => {
    const html = renderToStaticMarkup(
      <AgentConversation agent={security} findings={[finding()]} hasReviews onConfigure={noop} />,
    );
    expect(html).toContain('Security');
    expect(html).toContain('Opus'); // security tier
    expect(html).toContain('src/auth/session.ts:42');
    expect(html).toContain('Refresh token written to localStorage');
    expect(html).toContain('PR #7');
    // A configure control exists (decoupled from selection).
    expect(html).toContain('Configure the Security agent');
    // A real composer input, not a fabricated reply.
    expect(html).toContain('Ask Security about its findings');
  });

  it('shows an honest empty state when the agent has no findings', () => {
    const html = renderToStaticMarkup(
      <AgentConversation agent={security} findings={[]} hasReviews onConfigure={noop} />,
    );
    expect(html).toContain("hasn't flagged anything yet");
    // Never invents a finding.
    expect(html).not.toContain('localStorage');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arete/dashboard exec vitest run src/components/dashboard/agents/agent-conversation.test.tsx`
Expected: FAIL — cannot find module `./agent-conversation`.

- [ ] **Step 3: Write the component**

Create `packages/dashboard/src/components/dashboard/agents/agent-conversation.tsx`:

```tsx
"use client";

import { useState, type FormEvent } from "react";
import { IconSettings, IconSend } from "@tabler/icons-react";
import type { Agent } from "./agent-catalog";
import type { AgentActivityFinding } from "@/lib/queries";
import { cn } from "@/lib/utils";

const TIER_LABEL = { opus: "Opus", sonnet: "Sonnet" } as const;

const SEV_PILL: Record<string, string> = {
  error: "text-accent-danger border-accent-danger/30 bg-accent-danger/10",
  warning: "text-accent-warning border-accent-warning/30 bg-accent-warning/10",
  info: "text-accent-info border-accent-info/30 bg-accent-info/10",
};

interface ChatTurn {
  role: "user" | "agent";
  text: string;
}

export interface AgentConversationProps {
  agent: Agent;
  findings: AgentActivityFinding[];
  hasReviews: boolean;
  onConfigure: (agentId: string) => void;
}

/**
 * Center pane of /agents: the selected specialist's own view. Shows its REAL
 * findings from recent reviews (path:line + severity + rationale) — the honest
 * "what it's doing in the background" — plus a live composer that talks to the
 * agent via /api/agents/[id]/chat. Nothing here is fabricated: when the agents
 * service is unreachable the composer surfaces a truthful notice instead of a
 * canned reply.
 */
export function AgentConversation({ agent, findings, hasReviews, onConfigure }: AgentConversationProps) {
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [sending, setSending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const text = message.trim();
    if (!text || sending) return;
    setMessage("");
    setUnavailable(false);
    setTurns((t) => [...t, { role: "user", text }]);
    setSending(true);
    try {
      const res = await fetch(`/api/agents/${agent.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) {
        setUnavailable(true);
        return;
      }
      const data = await res.json();
      const reply = typeof data.reply === "string" ? data.reply : "";
      setTurns((t) => [...t, { role: "agent", text: reply || "(no response)" }]);
    } catch {
      setUnavailable(true);
    } finally {
      setSending(false);
    }
  }

  const status = hasReviews
    ? `Analyzed · ${findings.length} finding${findings.length === 1 ? "" : "s"}`
    : "Idle";

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={`${agent.label} conversation`}>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <span
          className={cn("h-1.5 w-1.5 rounded-full", hasReviews ? "bg-accent-success" : "bg-content-muted/40")}
          aria-hidden
        />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">{agent.label}</h2>
        <span className="rounded-full border border-accent-primary/25 bg-accent-primary/10 px-1.5 py-px text-[10px] font-medium text-accent-primary">
          {TIER_LABEL[agent.tier]}
        </span>
        <span className="ml-auto truncate font-mono text-[11px] text-content-muted">{status}</span>
        <button
          type="button"
          onClick={() => onConfigure(agent.id)}
          aria-label={`Configure the ${agent.label} agent`}
          className="ml-1 shrink-0 rounded-md p-1 text-content-muted transition-colors hover:bg-content-primary/[0.06] hover:text-content-secondary"
        >
          <IconSettings size={15} stroke={1.75} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {findings.length > 0 ? (
          <ol className="space-y-2">
            <li className="pb-1 text-[10px] uppercase tracking-wider text-content-muted">
              {agent.label}&apos;s findings from your recent reviews
            </li>
            {findings.map((f) => (
              <li
                key={`${f.reviewId}:${f.path}:${f.line}`}
                className="rounded-lg border border-border-subtle bg-surface-2/40 px-3 py-2"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-wide",
                      SEV_PILL[f.severity] ?? SEV_PILL.info,
                    )}
                  >
                    {f.severity}
                  </span>
                  <span className="font-mono text-[10.5px] text-content-muted">
                    {f.path}:{f.line}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-content-muted">PR #{f.prNumber}</span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-content-secondary">{f.body}</p>
              </li>
            ))}
          </ol>
        ) : (
          <div className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
            <p className="text-sm font-semibold text-content-primary">{agent.label} hasn&apos;t flagged anything yet</p>
            <p className="text-xs leading-5 text-content-muted">
              {hasReviews
                ? `Nothing in ${agent.label}'s lane on your recent reviews — that's a real result too.`
                : `${agent.label} runs automatically on your pull requests. Connect a repository and open a PR to see its findings here.`}
            </p>
          </div>
        )}

        {turns.length > 0 && (
          <div className="mt-4 space-y-2 border-t border-border-subtle pt-3">
            {turns.map((t, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-lg px-3 py-2 text-[12px] leading-relaxed",
                  t.role === "user" ? "bg-accent-primary/10 text-content-primary" : "bg-surface-2/60 text-content-secondary",
                )}
              >
                {t.text}
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t border-border-subtle px-3 py-2.5">
        <form
          onSubmit={handleSend}
          className="flex items-center gap-2 rounded-lg border border-border-default bg-surface-2/60 px-3 py-2"
        >
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={sending}
            placeholder={`Ask ${agent.label} about its findings…`}
            aria-label={`Message the ${agent.label} agent`}
            className="w-full bg-transparent font-mono text-xs text-content-primary placeholder:text-content-muted/70 focus:outline-none disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={sending || !message.trim()}
            aria-label="Send message"
            className="shrink-0 text-content-muted transition-colors hover:text-accent-primary disabled:opacity-40"
          >
            <IconSend size={15} stroke={1.75} />
          </button>
        </form>
        <p className="mt-1.5 px-1 font-mono text-[10px] text-content-muted/80">
          {unavailable
            ? "live chat activates when the agents service is running — nothing here is fabricated"
            : "talk to this agent about its findings, or ask it to adjust the code"}
        </p>
      </footer>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arete/dashboard exec vitest run src/components/dashboard/agents/agent-conversation.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/components/dashboard/agents/agent-conversation.tsx packages/dashboard/src/components/dashboard/agents/agent-conversation.test.tsx
git commit -m "$(printf 'feat(agents): add AgentConversation pane (real findings + live composer)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: Decouple selection from configure in `AgentRail`

**Files:**
- Modify: `packages/dashboard/src/components/dashboard/agents/agent-rail.tsx`
- Test: `packages/dashboard/src/components/dashboard/agents/agent-rail.test.tsx` (new)

**Interfaces:**
- `AgentRailProps` unchanged (`onSelect`, `onConfigure` stay). Behavior changes: the row button calls **only** `onSelect`; a new gear button calls `onConfigure`.

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/src/components/dashboard/agents/agent-rail.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgentRail } from './agent-rail';

const noop = () => {};

describe('AgentRail', () => {
  it('renders a separate select control and configure control per agent', () => {
    const html = renderToStaticMarkup(
      <AgentRail
        findingCountById={{}}
        hasReviews={false}
        selectedAgentId="security"
        onSelect={noop}
        onConfigure={noop}
      />,
    );
    // Row selection and configuration are now distinct affordances.
    expect(html).toContain('View the Security agent');
    expect(html).toContain('Configure the Security agent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arete/dashboard exec vitest run src/components/dashboard/agents/agent-rail.test.tsx`
Expected: FAIL — markup contains the old `Open the Security agent` label, not the two new labels.

- [ ] **Step 3: Restructure the rail row**

In `packages/dashboard/src/components/dashboard/agents/agent-rail.tsx`:

Add the `IconSettings` import near the top (after the `cn` import — the file currently imports nothing from `@tabler/icons-react`):

```tsx
import { IconSettings } from "@tabler/icons-react";
```

Replace the entire `return ( <li ...> ... </li> );` block inside `agents.map(...)` with this — the row `<button>` now calls only `onSelect`, and a sibling gear button calls `onConfigure`:

```tsx
          return (
            <li key={agent.id} className="relative">
              {selected && (
                <span
                  className="absolute inset-y-1 left-0 z-10 w-0.5 rounded-r bg-accent-primary"
                  aria-hidden
                />
              )}
              <div
                className={cn(
                  "group flex items-stretch transition-colors",
                  selected ? "bg-accent-primary/[0.06]" : "hover:bg-content-primary/[0.04]"
                )}
              >
                <button
                  type="button"
                  onClick={() => onSelect(agent.id)}
                  aria-current={selected ? "true" : undefined}
                  aria-label={`View the ${agent.label} agent`}
                  className="flex min-w-0 flex-1 items-start gap-2.5 py-2.5 pl-3 pr-1 text-left"
                >
                  <span
                    className={cn(
                      "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                      hasReviews ? "bg-accent-success" : "bg-content-muted/40"
                    )}
                    aria-hidden
                  />
                  <span
                    className={cn(
                      "mt-0.5 shrink-0",
                      selected ? "text-accent-primary" : "text-content-muted"
                    )}
                  >
                    <Icon size={15} stroke={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-[13px] font-medium",
                          selected ? "text-content-primary" : "text-content-secondary"
                        )}
                      >
                        {agent.label}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 rounded-full border px-1.5 py-px text-[9px] font-medium",
                          TIER_CLASS[agent.tier]
                        )}
                      >
                        {TIER_LABEL[agent.tier]}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-content-muted">
                      {status}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onConfigure(agent.id)}
                  aria-label={`Configure the ${agent.label} agent`}
                  className="flex shrink-0 items-center px-2 text-content-muted opacity-0 transition-opacity hover:text-content-secondary focus:opacity-100 group-hover:opacity-100"
                >
                  <IconSettings size={14} stroke={1.75} />
                </button>
              </div>
            </li>
          );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arete/dashboard exec vitest run src/components/dashboard/agents/agent-rail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/components/dashboard/agents/agent-rail.tsx packages/dashboard/src/components/dashboard/agents/agent-rail.test.tsx
git commit -m "$(printf 'feat(agents): decouple rail row selection from the config gear\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: Wire `AgentConversation` into the workspace and page; retire the account-level Synthesizer console

**Files:**
- Modify: `packages/dashboard/src/components/dashboard/agents/agents-workspace.tsx`
- Modify: `packages/dashboard/src/app/(dashboard)/agents/page.tsx`
- Delete: `packages/dashboard/src/components/dashboard/agents/synthesizer-console.tsx`

**Interfaces:**
- Consumes: `AgentConversation` (Task 2), `getAgentActivity`/`AgentActivityFinding` (Task 1).
- Produces: `AgentsWorkspaceProps` gains `activity: AgentActivityFinding[]`.

- [ ] **Step 1: Confirm the Synthesizer console has no other consumer**

Run: `git grep -n "synthesizer-console\|SynthesizerConsole" -- packages/dashboard/src`
Expected: matches ONLY in `agents-workspace.tsx` (and the file itself). The Services page uses its own in-file `IssueSynthesizerConsole`, not this component — so deleting this file is safe. If any other importer appears, stop and reconcile before deleting.

- [ ] **Step 2: Update `agents-workspace.tsx`**

Replace the `SynthesizerConsole` import with the `AgentConversation` import, and add the activity type import:

```tsx
import { AgentConversation } from "./agent-conversation";
import type { AgentActivityFinding } from "@/lib/queries";
```
(delete the line `import { SynthesizerConsole } from "./synthesizer-console";`)

Add `activity` to the props interface:

```tsx
export interface AgentsWorkspaceProps {
  findingCountById: Record<string, number>;
  totalFindings: number;
  hasReviews: boolean;
  activity: AgentActivityFinding[];
  latestReview?: {
    repoFullName: string;
    prNumber: number;
    riskLevel: string;
  } | null;
}
```

Destructure `activity` in the function signature (alongside the others):

```tsx
export function AgentsWorkspace({
  findingCountById,
  totalFindings,
  hasReviews,
  activity,
  latestReview = null,
}: AgentsWorkspaceProps) {
```

Immediately after the `selectedAgent`/`configAgent` lines, derive the selected agent's findings:

```tsx
  const selectedAgentFindings = activity.filter((f) => f.category === selectedAgent.id);
```

Replace the `<SynthesizerConsole ... />` element with:

```tsx
        <AgentConversation
          agent={selectedAgent}
          findings={selectedAgentFindings}
          hasReviews={hasReviews}
          onConfigure={setConfigAgentId}
        />
```

(Leave `AgentRail` and `PrPanel` exactly as they are — `PrPanel` still uses `totalFindings`.)

- [ ] **Step 3: Update the Agents page to fetch activity**

In `packages/dashboard/src/app/(dashboard)/agents/page.tsx`, add `getAgentActivity` to the queries import:

```tsx
import { getDashboardViewModel, resolveSelectedInstallationIds, getAgentActivity } from "@/lib/queries";
```

After the `const hasReviews = ...` / `const latest = ...` lines, fetch activity (scoped to the same installations, empty when no access):

```tsx
  const activity = viewModel.hasAccess
    ? await getAgentActivity(db, installationIds)
    : [];
```

Add the `activity` prop to the rendered `<AgentsWorkspace ... />`:

```tsx
      activity={activity}
```

- [ ] **Step 4: Delete the orphaned Synthesizer console**

```bash
git rm packages/dashboard/src/components/dashboard/agents/synthesizer-console.tsx
```

- [ ] **Step 5: Typecheck + run the agents-related tests**

Run: `pnpm --filter @arete/dashboard exec tsc --noEmit`
Expected: no errors (in particular, no "SynthesizerConsole" / missing-prop errors).

Run: `pnpm --filter @arete/dashboard exec vitest run src/components/dashboard/agents`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/dashboard/src/components/dashboard/agents/agents-workspace.tsx "packages/dashboard/src/app/(dashboard)/agents/page.tsx"
git commit -m "$(printf 'feat(agents): render per-agent conversation; retire account synthesizer console\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: `sendAgentChat` — the FastAPI `/chat` proxy helper

**Files:**
- Create: `packages/dashboard/src/lib/agent-chat.ts`
- Test: `packages/dashboard/src/lib/agent-chat.test.ts`

**Interfaces:**
- Consumes: `Agent` (type only) from `@/components/dashboard/agents/agent-catalog`.
- Produces:
  ```ts
  export async function sendAgentChat(args: { agent: Agent; message: string }): Promise<string>
  ```
  Resolves to the reply string on upstream `200`; throws on non-OK / network / timeout (the route maps a throw to `503`).

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/src/lib/agent-chat.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendAgentChat } from './agent-chat';
import { AGENTS } from '@/components/dashboard/agents/agent-catalog';

const security = AGENTS.find((a) => a.id === 'security')!;

afterEach(() => { vi.unstubAllGlobals(); });

describe('sendAgentChat', () => {
  it('POSTs the message to the Python /chat endpoint and returns the reply', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ reply: 'Here is my analysis.' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const reply = await sendAgentChat({ agent: security, message: 'why is this risky?' });

    expect(reply).toBe('Here is my analysis.');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/chat');
    expect(JSON.parse((init as any).body).user_reply).toBe('why is this risky?');
  });

  it('throws when the upstream returns a non-OK status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    await expect(sendAgentChat({ agent: security, message: 'hi' })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @arete/dashboard exec vitest run src/lib/agent-chat.test.ts`
Expected: FAIL — cannot find module `./agent-chat`.

- [ ] **Step 3: Write the helper**

Create `packages/dashboard/src/lib/agent-chat.ts`:

```ts
import type { Agent } from "@/components/dashboard/agents/agent-catalog";

// Mirrors packages/webhook/src/config.ts's PYTHON_SERVICE_URL default. The
// dashboard reaches the same FastAPI agents service the webhook does. Server
// -only — this module is imported only by the route handler, never a client.
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "http://127.0.0.1:8000";
const CHAT_TIMEOUT_MS = 120_000;

/**
 * Proxies one message to the Python `/chat` endpoint (the same ChatAgent the
 * webhook uses for PR-comment replies) and returns its reply text. The agent's
 * persona lives in Python — we only map our dashboard-conversation fields onto
 * ChatAgent's existing context shape, so there is a single source of truth for
 * agent behavior. Throws on any non-OK response, network error, or timeout;
 * the caller maps that to an honest 503 (never a fabricated reply).
 */
export async function sendAgentChat({ agent, message }: { agent: Agent; message: string }): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  try {
    const context = {
      pr_title: `Conversation with the ${agent.label} agent`,
      pr_description: agent.longDescription,
      file_path: "",
      diff_hunk: "",
      bot_comment: agent.description,
      user_reply: message,
    };
    const res = await fetch(`${PYTHON_SERVICE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(context),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`agent chat upstream failed (status ${res.status})`);
    }
    const data = await res.json();
    if (typeof data === "string") return data;
    if (data && typeof data.reply === "string") return data.reply;
    return "";
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @arete/dashboard exec vitest run src/lib/agent-chat.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/lib/agent-chat.ts packages/dashboard/src/lib/agent-chat.test.ts
git commit -m "$(printf 'feat(agents): add sendAgentChat proxy to the FastAPI /chat service\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 6: `POST /api/agents/[id]/chat` route handler

**Files:**
- Create: `packages/dashboard/src/app/api/agents/[id]/chat/route.ts`
- Test: `packages/dashboard/src/app/api/agents/[id]/chat/route.test.ts`

**Interfaces:**
- Consumes: `auth` from `@/lib/auth`, `AGENTS` from `@/components/dashboard/agents/agent-catalog`, `sendAgentChat` (Task 5).
- Produces: `export async function POST(req, ctx): Promise<Response>` where `ctx = { params: Promise<{ id: string }> }`.

- [ ] **Step 1: Read the Next 16 route-handler doc**

Skim `node_modules/next/dist/docs/` for the route-handler / dynamic-segment API (params is a Promise in Next 16). Confirm the `POST(req, ctx)` signature below matches.

- [ ] **Step 2: Write the failing test**

Create `packages/dashboard/src/app/api/agents/[id]/chat/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const authMock = vi.fn();
vi.mock('@/lib/auth', () => ({ auth: () => authMock() }));

const sendAgentChatMock = vi.fn();
vi.mock('@/lib/agent-chat', () => ({ sendAgentChat: (...a: any[]) => sendAgentChatMock(...a) }));

import { POST } from './route';

function req(body: unknown) {
  return new Request('http://localhost/api/agents/security/chat', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  }) as any;
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  authMock.mockReset();
  sendAgentChatMock.mockReset();
});

describe('POST /api/agents/[id]/chat', () => {
  it('401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(req({ message: 'hi' }), ctx('security'));
    expect(res.status).toBe(401);
  });

  it('400 for an unknown agent id', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    const res = await POST(req({ message: 'hi' }), ctx('not-an-agent'));
    expect(res.status).toBe(400);
  });

  it('400 for an empty message', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    const res = await POST(req({ message: '   ' }), ctx('security'));
    expect(res.status).toBe(400);
  });

  it('503 when the agents service is unavailable', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    sendAgentChatMock.mockRejectedValue(new Error('down'));
    const res = await POST(req({ message: 'hi' }), ctx('security'));
    expect(res.status).toBe(503);
  });

  it('200 with the upstream reply on success', async () => {
    authMock.mockResolvedValue({ user: { id: 'u1' } });
    sendAgentChatMock.mockResolvedValue('Here is my analysis.');
    const res = await POST(req({ message: 'hi' }), ctx('security'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reply: 'Here is my analysis.' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @arete/dashboard exec vitest run "src/app/api/agents/[id]/chat/route.test.ts"`
Expected: FAIL — cannot find module `./route`.

- [ ] **Step 4: Write the route handler**

Create `packages/dashboard/src/app/api/agents/[id]/chat/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { AGENTS } from "@/components/dashboard/agents/agent-catalog";
import { sendAgentChat } from "@/lib/agent-chat";

// Session-scoped; never statically prerendered.
export const dynamic = "force-dynamic";

/**
 * Dashboard -> agent chat. Authenticates the session, validates the agent id
 * against the real catalog, then proxies to the Python /chat service via
 * sendAgentChat. On any upstream failure (including a missing model key, which
 * makes the service refuse to start) it returns a truthful 503 — the composer
 * renders that as its honest disabled notice, never a fabricated reply.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await ctx.params;
  const agent = AGENTS.find((a) => a.id === id);
  if (!agent) {
    return NextResponse.json({ error: "Unknown agent" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) {
    return NextResponse.json({ error: "Empty message" }, { status: 400 });
  }

  try {
    const reply = await sendAgentChat({ agent, message });
    return NextResponse.json({ reply });
  } catch {
    return NextResponse.json(
      { error: "The agents service is unavailable. Live chat activates when it is running." },
      { status: 503 },
    );
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @arete/dashboard exec vitest run "src/app/api/agents/[id]/chat/route.test.ts"`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add "packages/dashboard/src/app/api/agents/[id]/chat/route.ts" "packages/dashboard/src/app/api/agents/[id]/chat/route.test.ts"
git commit -m "$(printf 'feat(agents): add POST /api/agents/[id]/chat proxy route (auth + 503 gate)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 7: Full verification + manual smoke

**Files:** none (verification only).

- [ ] **Step 1: Full dashboard test suite**

Run: `pnpm --filter @arete/dashboard test`
Expected: PASS, including the four new test files and the pre-existing suite.

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm --filter @arete/dashboard exec tsc --noEmit`
Run: `pnpm --filter @arete/dashboard lint`
Expected: no errors.

- [ ] **Step 3: Manual smoke (real behavior, per verification-before-completion)**

Start the dashboard (`pnpm --filter @arete/dashboard dev`), sign in, and open `/agents`. Confirm:
- Selecting each specialist in the rail swaps the center pane to that agent (header label + tier update); the config drawer does NOT open on row click.
- The gear on a row (and in the pane header) opens `AgentConfigDrawer`.
- With no connected installation, the center pane shows the honest empty state (no fabricated findings).
- Typing in the composer and sending with the Python service **stopped** shows the truthful "live chat activates when the agents service is running" notice — never a fabricated reply. (If a valid `ANTHROPIC_API_KEY` + running service are available, a real reply appears instead.)
- `/services` still shows the Synthesizer console unchanged.

- [ ] **Step 4: Confirm no fabrication / no orphan**

Run: `git grep -n "synthesizer-console" -- packages/dashboard/src`
Expected: no matches (file deleted, no dangling import).

---

## Self-Review

**Spec coverage:**
- IA reorg (Agents → per-agent; Services keeps Synthesizer) → Task 4 (+ Task 7 step 3 confirms Services). ✓
- `AgentConversation` (header/tier/status, real transcript, honest empty state, composer) → Task 2. ✓
- Rail select/configure decouple → Task 3. ✓
- `getAgentActivity` tenant-scoped query → Task 1. ✓
- Chat route (auth 401, unknown id 400, 503 gate, proxy to FastAPI `/chat`) → Tasks 5 + 6. ✓
- Security/data-security (tenancy, authN/Z, injection via reused `escape_for_prompt` in Python, server-only secrets, no fabrication) → Tasks 1/5/6 + verification in Task 7. ✓
- Testing (query scoping, component states, route statuses) → Tasks 1/2/3/5/6. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code and exact commands. Interactive composer network behavior is verified manually in Task 7 (the repo's Vitest env is `node`/`renderToStaticMarkup`, so this matches existing testing capability rather than inventing a jsdom harness).

**Type consistency:** `AgentActivityFinding` (Task 1) is consumed with identical field names in Tasks 2 and 4. `sendAgentChat({ agent, message }): Promise<string>` (Task 5) matches its call in Task 6. `AgentConversationProps` (Task 2) matches the element rendered in Task 4. Route `POST(req, ctx: { params: Promise<{ id: string }> })` matches the test's `ctx` shape (Task 6).

## Deferred (explicitly out of scope)

- Live "agent is running now" event stream (needs run telemetry from the Python agents).
- Chat thread persistence (replies are in-memory per session this pass).
- Finding-scoped chat (composer is free-form; the agent's recent findings are the on-screen context). Extending `ChatAgent` with a dedicated agent-conversation branch is the follow-up if free-form proves too thin.
