# Repo Conventions (AGENTS.md/CONVENTIONS.md) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch a repo's own `AGENTS.md` (falling back to `CONVENTIONS.md`) from the PR's base branch and inject it into every review agent's prompt as authoritative project-specific guidance.

**Architecture:** A new `fetchAgentsDoc` function in `pr-fetcher.ts`, structurally identical to the existing `fetchAreteYaml`'s fetch-then-fallback-then-null pattern, wired into `fetchPRContext` alongside it. The result flows through a new optional `repoConventions`/`repo_conventions` field on `PRContext` (TS + Python) to a new prompt-injection block in `agents/base.py`, following the exact pattern already used for `predecessor_handoff_notes`.

**Tech Stack:** TypeScript/Express (`packages/webhook`, vitest), Python 3.12 (`packages/agents`, pytest).

## Global Constraints

- **Fetch from `pr.base.sha`, never the PR head SHA** — a PR must not be able to edit its own conventions doc to weaken the review of itself. Matches `fetchAreteYaml`'s existing rationale exactly.
- **Fail-open on any fetch problem:** neither file existing, or any non-404 API error, results in `repoConventions`/`repo_conventions` being absent (`undefined`/`None`) — never throws, never delays or fails the review.
- **Size cap:** the fetched content is truncated to `20_000` characters before being attached to `PRContext`, so an unusually large `AGENTS.md` can't blow up every agent's prompt size.
- **No YAML parsing** — unlike `.arete.yml`, this is markdown/plain text read verbatim.
- **Testing convention:** mirrors the existing `pr-fetcher.test.ts` mocking style (a `getContent` mock keyed by requested `path`) on the webhook side; the existing fake-LLM pattern on the agents side.

---

### Task 1: `fetchAgentsDoc` + wiring into `fetchPRContext`

**Files:**
- Modify: `packages/webhook/src/pr-fetcher.ts`
- Modify: `packages/webhook/src/types.ts`
- Modify: `packages/webhook/src/pr-fetcher.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `fetchAgentsDoc(octokit: Octokit, owner: string, repo: string, ref: string): Promise<string | null>`. `fetchPRContext`'s return type gains `repoConventions?: string`. Task 2/3 (Python side) consume this via the JSON payload's `repoConventions` key.

- [ ] **Step 1: Write the failing tests**

Add to `packages/webhook/src/pr-fetcher.test.ts` (this file already imports `describe, it, expect, vi` from `vitest` and `fetchPRContext` from `./pr-fetcher.js`, and defines a module-level `mockPR` with `base: { sha: 'basesha-trusted', ref: 'main' }` and `head: { sha: 'headsha-attacker-controlled' }` — reuse both):

```ts
function makeContentAwareOctokit(fileContents: Record<string, string>) {
  return {
    rest: {
      pulls: {
        get: vi.fn().mockResolvedValue({ data: mockPR }),
        listFiles: vi.fn().mockResolvedValue({ data: [] }),
      },
      repos: {
        getContent: vi.fn().mockImplementation(async ({ path }: { path: string }) => {
          if (path in fileContents) {
            return {
              data: {
                type: 'file',
                encoding: 'base64',
                content: Buffer.from(fileContents[path]).toString('base64'),
              },
            }
          }
          const err: any = new Error('Not Found')
          err.status = 404
          throw err
        }),
      },
    },
  }
}

describe('fetchAgentsDoc (via fetchPRContext)', () => {
  it('returns AGENTS.md content when present', async () => {
    const octokit = makeContentAwareOctokit({ 'AGENTS.md': '# Project conventions\nUse tabs.' })
    const result = await fetchPRContext(octokit as any, 'acme', 'api', 42)
    expect(result.repoConventions).toBe('# Project conventions\nUse tabs.')
  })

  it('falls back to CONVENTIONS.md when AGENTS.md is absent', async () => {
    const octokit = makeContentAwareOctokit({ 'CONVENTIONS.md': 'Use spaces.' })
    const result = await fetchPRContext(octokit as any, 'acme', 'api', 42)
    expect(result.repoConventions).toBe('Use spaces.')
  })

  it('leaves repoConventions undefined when neither file exists', async () => {
    const octokit = makeContentAwareOctokit({})
    const result = await fetchPRContext(octokit as any, 'acme', 'api', 42)
    expect(result.repoConventions).toBeUndefined()
  })

  it('fetches AGENTS.md from the base branch SHA, never the PR head SHA', async () => {
    const octokit = makeContentAwareOctokit({ 'AGENTS.md': 'convention text' })
    await fetchPRContext(octokit as any, 'acme', 'api', 42)
    const calls = (octokit.rest.repos.getContent as any).mock.calls
    const agentsCall = calls.find((call: any[]) => call[0].path === 'AGENTS.md')
    expect(agentsCall).toBeDefined()
    expect(agentsCall[0].ref).toBe('basesha-trusted')
    expect(agentsCall[0].ref).not.toBe('headsha-attacker-controlled')
  })

  it('truncates an oversized AGENTS.md to the 20,000 character cap', async () => {
    const hugeContent = 'x'.repeat(30_000)
    const octokit = makeContentAwareOctokit({ 'AGENTS.md': hugeContent })
    const result = await fetchPRContext(octokit as any, 'acme', 'api', 42)
    expect(result.repoConventions?.length).toBe(20_000)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @arete/webhook test pr-fetcher -- -t "fetchAgentsDoc"`
Expected: FAIL — `repoConventions` is `undefined` in every case (the field/function don't exist yet), so the `toBe(...)` assertions fail.

- [ ] **Step 3: Implement fetchAgentsDoc and wire it into fetchPRContext**

In `packages/webhook/src/pr-fetcher.ts`, add this constant near the top of the file (alongside `EXTENSION_MAP`):

```ts
const MAX_REPO_CONVENTIONS_CHARS = 20_000
```

Add this function right after `fetchAreteYaml` (before `listAllFiles`):

```ts
export async function fetchAgentsDoc(octokit: Octokit, owner: string, repo: string, ref: string): Promise<string | null> {
  const tryFetch = async (path: string): Promise<string | null> => {
    try {
      const res = await (octokit as any).rest.repos.getContent({ owner, repo, path, ref });
      if (res.data.type === 'file' && res.data.content) {
        return Buffer.from(res.data.content, res.data.encoding || 'base64').toString('utf8');
      }
    } catch (err: any) {
      if (err.status !== 404) {
        console.error(`Error fetching ${path}:`, err);
      }
    }
    return null;
  };

  const agentsResult = await tryFetch('AGENTS.md');
  if (agentsResult !== null) return agentsResult;

  const conventionsResult = await tryFetch('CONVENTIONS.md');
  if (conventionsResult !== null) return conventionsResult;

  return null;
}
```

Then change `fetchPRContext` from:

```ts
  // Fetch .arete.yml from the base branch, never the PR head: otherwise a PR could edit .arete.yml to weaken the rules used to review itself.
  const areteYaml = await fetchAreteYaml(octokit, owner, repo, pr.base.sha);

  return {
    repo: `${owner}/${repo}`,
    pr_number: pr.number,
    title: pr.title,
    description: pr.body ?? '',
    files: fileChanges,
    customRules: areteYaml.customRules,
    telemetryConnectors: areteYaml.telemetryConnectors,
  }
}
```

to:

```ts
  // Fetch .arete.yml and the repo's own AGENTS.md/CONVENTIONS.md from the
  // base branch, never the PR head: otherwise a PR could edit either file
  // to weaken the rules/conventions used to review itself.
  const [areteYaml, repoConventionsRaw] = await Promise.all([
    fetchAreteYaml(octokit, owner, repo, pr.base.sha),
    fetchAgentsDoc(octokit, owner, repo, pr.base.sha),
  ]);
  const repoConventions = repoConventionsRaw !== null
    ? repoConventionsRaw.slice(0, MAX_REPO_CONVENTIONS_CHARS)
    : undefined;

  return {
    repo: `${owner}/${repo}`,
    pr_number: pr.number,
    title: pr.title,
    description: pr.body ?? '',
    files: fileChanges,
    customRules: areteYaml.customRules,
    telemetryConnectors: areteYaml.telemetryConnectors,
    repoConventions,
  }
}
```

In `packages/webhook/src/types.ts`, add one field to the `PRContext` interface, right after `telemetryConnectors?: TelemetryConnectorConfig[]`:

```ts
  repoConventions?: string
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @arete/webhook test pr-fetcher -- -t "fetchAgentsDoc"`
Expected: PASS (5 passed)

- [ ] **Step 5: Run the full webhook suite to confirm no regressions**

Run: `pnpm --filter @arete/webhook test`
Expected: all passing, 0 new failures (existing tests that mock `getContent` broadly don't assert on `repoConventions`, so they're unaffected by the new field existing).

- [ ] **Step 6: Commit**

```bash
git add packages/webhook/src/pr-fetcher.ts packages/webhook/src/types.ts packages/webhook/src/pr-fetcher.test.ts
git commit -m "feat(webhook): fetch repo's own AGENTS.md/CONVENTIONS.md into PRContext"
```

---

### Task 2: `PRContext.repo_conventions` (Python)

**Files:**
- Modify: `packages/agents/src/arete_agents/models/pr.py`
- Modify: `packages/agents/tests/test_models.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `PRContext.repo_conventions: str | None = Field(None, alias="repoConventions")`. Task 3 reads this field.

- [ ] **Step 1: Write the failing test**

Add to `packages/agents/tests/test_models.py` (append at end of file):

```python
def test_pr_context_accepts_repo_conventions_field():
    from arete_agents.models.pr import FileChange, PRContext

    pr = PRContext.model_validate({
        "repo": "acme/api", "pr_number": 1, "title": "t", "description": "d",
        "files": [], "repoConventions": "# Conventions\nUse tabs.",
    })
    assert pr.repo_conventions == "# Conventions\nUse tabs."


def test_pr_context_repo_conventions_defaults_to_none():
    from arete_agents.models.pr import PRContext

    pr = PRContext(repo="acme/api", pr_number=1, title="t", description="d", files=[])
    assert pr.repo_conventions is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/agents && uv run pytest tests/test_models.py -k repo_conventions -v`
Expected: FAIL — `ValidationError` (unexpected field, since `populate_by_name` doesn't help if the field doesn't exist at all) or `AttributeError` on `pr.repo_conventions`.

- [ ] **Step 3: Add the field**

In `packages/agents/src/arete_agents/models/pr.py`, add one field to `PRContext`, at the end of the class (after `project_memories`):

```python
    repo_conventions: str | None = Field(None, alias="repoConventions")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/agents && uv run pytest tests/test_models.py -k repo_conventions -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Run the full agents suite to confirm no regressions**

Run: `cd packages/agents && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -q`
Expected: all passing (baseline + 2 new, 0 failed).

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/arete_agents/models/pr.py packages/agents/tests/test_models.py
git commit -m "feat(agents): add repo_conventions field to PRContext"
```

---

### Task 3: Prompt injection in `agents/base.py`

**Files:**
- Modify: `packages/agents/src/arete_agents/agents/base.py`
- Modify: `packages/agents/tests/test_agents.py`

**Interfaces:**
- Consumes: `PRContext.repo_conventions` (Task 2).
- Produces: no new public interface — `_build_user_prompt`'s existing signature and return type (`str`) are unchanged; the returned prompt string now includes one more conditional block.

- [ ] **Step 1: Write the failing tests**

Add to `packages/agents/tests/test_agents.py` (uses the file's existing `make_mock_llm`/`make_file`/`make_pr` helpers):

```python
def test_review_file_prompt_includes_repo_conventions_when_present():
    from arete_agents.agents.security import SecurityAgent
    from arete_agents.models.pr import PRContext

    mock_llm = make_mock_llm('{"comments": [], "summary": "ok"}')
    agent = SecurityAgent(llm=mock_llm)

    pr = PRContext(
        repo="acme/api", pr_number=1, title="t", description="",
        files=[make_file()], repo_conventions="Always use parameterized queries.",
    )
    agent.review_file(make_file(), pr)

    human_message = mock_llm.invoke.call_args[0][0][1]
    assert "<repo_conventions>" in human_message.content
    assert "Always use parameterized queries." in human_message.content


def test_review_file_prompt_omits_repo_conventions_block_when_absent():
    from arete_agents.agents.security import SecurityAgent

    mock_llm = make_mock_llm('{"comments": [], "summary": "ok"}')
    agent = SecurityAgent(llm=mock_llm)

    agent.review_file(make_file(), make_pr())

    human_message = mock_llm.invoke.call_args[0][0][1]
    assert "<repo_conventions>" not in human_message.content
```

- [ ] **Step 2: Run tests to verify the first fails**

Run: `cd packages/agents && uv run pytest tests/test_agents.py -k repo_conventions -v`
Expected: the first test FAILS (`<repo_conventions>` not in the prompt yet); the second test PASSES already (nothing to omit yet — confirm it passes for the right reason, not by accident).

- [ ] **Step 3: Add the prompt-injection block**

In `packages/agents/src/arete_agents/agents/base.py`, inside `_build_user_prompt`, find this block:

```python
        predecessor_block = ""
        if pr_context.predecessor_handoff_notes or pr_context.predecessor_root_cause:
            predecessor_block = "\n<predecessor_context>\nThis is a follow-up review on a previously flagged PR. Use this context from the prior agent review pass to avoid repeating past mistakes or feedback:\n"
            if pr_context.predecessor_root_cause:
                predecessor_block += f"Prior Root Cause:\n{escape_for_prompt(pr_context.predecessor_root_cause)}\n"
            if pr_context.predecessor_handoff_notes:
                predecessor_block += f"Handoff Notes:\n{escape_for_prompt(pr_context.predecessor_handoff_notes)}\n"
            predecessor_block += "</predecessor_context>\n"
```

and add this new block right after it (still before the `return f"""..."""`):

```python
        repo_conventions_block = ""
        if pr_context.repo_conventions:
            repo_conventions_block = (
                "\n<repo_conventions>\n"
                "This repository has its own authoritative AGENTS.md/CONVENTIONS.md. "
                "Follow its guidance over generic advice where the two conflict:\n"
                f"{escape_for_prompt(pr_context.repo_conventions)}\n"
                "</repo_conventions>\n"
            )
```

Then find the line inside the `return f"""..."""` block:

```python
{predecessor_block}{self._build_pr_manifest(file, pr_context)}{self._build_telemetry_block(pr_context)}
```

and change it to:

```python
{predecessor_block}{repo_conventions_block}{self._build_pr_manifest(file, pr_context)}{self._build_telemetry_block(pr_context)}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/agents && uv run pytest tests/test_agents.py -k repo_conventions -v`
Expected: PASS (2 passed)

- [ ] **Step 5: Run the full agents suite to confirm no regressions**

Run: `cd packages/agents && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -q`
Expected: all passing (baseline + 2 new, 0 failed).

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/arete_agents/agents/base.py packages/agents/tests/test_agents.py
git commit -m "feat(agents): inject repo_conventions into the review prompt when present"
```
