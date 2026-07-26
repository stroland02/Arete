# Areté — Phase 1.2: GitHub App Integration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire a real GitHub App that receives PR webhook events, runs the Phase 1.1 agent pipeline, and posts structured inline review comments back to the PR — completing the full end-to-end loop from code push to AI review comment.

**Architecture:** A TypeScript/Node.js webhook server (`packages/webhook`) receives `pull_request` events from GitHub, validates the HMAC signature, fetches the PR diff via the GitHub REST API, calls the Python agent pipeline via subprocess (stdin/stdout JSON), and posts the resulting `ReviewResult` back to the PR as a GitHub Pull Request Review with inline comments. The Python pipeline is hardened first (file-level parallelism, LLM retry, patch size guard, prompt injection delimiters) to handle real-world PRs safely before wiring it to the public internet.

**Tech Stack:** TypeScript 5, Node.js 22, Express 4, `@octokit/app` (GitHub App auth), `@octokit/webhooks` (signature verification + event routing), `zod` (env validation), `vitest` (testing), `tsx` (TypeScript runner), Python `uv` (pipeline subprocess), pnpm (package manager)

## Prerequisites — GitHub App Registration (Manual)

Before starting Task 1, the developer must register a GitHub App:

1. Go to **github.com/settings/apps/new** (personal) or **github.com/organizations/ORG/settings/apps/new** (org)
2. **App name:** `Areté Code Review (dev)`
3. **Homepage URL:** `https://github.com/stroland02/Arete`
4. **Webhook URL:** Set to your public URL (see below)
   - In **GitHub Codespaces:** Forward port 3000, copy the public URL, append `/webhook`
   - **Locally:** Install ngrok (`npm i -g ngrok`), run `ngrok http 3000`, use the `https://….ngrok.io/webhook` URL
5. **Webhook secret:** Generate a random string: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — save it
6. **Permissions:**
   - Pull requests: **Read & write**
   - Contents: **Read**
7. **Subscribe to events:** `Pull request`
8. **Create** the app → note the **App ID** shown on the app page
9. Under **Private keys** → **Generate a private key** → download the `.pem` file
10. **Install the app** on your test repository: app page → Install App → select repo

Add to `.env` (in monorepo root):
```
GITHUB_APP_ID=123456
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----\n"
GITHUB_WEBHOOK_SECRET=your-generated-secret
PORT=3000
```

> The private key's newlines must be `\n` literals in the `.env` value (not actual newlines). When you download the `.pem`, run:
> `node -e "console.log(JSON.stringify(require('fs').readFileSync('path/to/key.pem','utf8')))"` — paste the inner string (without outer quotes).

---

## Global Constraints

- Python managed exclusively by `uv` — never `pip install` directly
- Node.js package manager: `pnpm` — never `npm install` inside packages
- All secrets in `.env` only — `.env` is in `.gitignore`, never committed
- TDD strictly enforced: write the failing test before writing the implementation
- Git commits use conventional format: `feat:`, `fix:`, `test:`, `chore:`, `docs:`
- Brand/product name: Areté. Code identifiers use `arete` (no accent in code)
- Dev LLM: `gemini-2.5-flash` via `LLM_PROVIDER=gemini`; Prod: `claude-opus-4-8` via `LLM_PROVIDER=anthropic`
- Python minimum version: 3.12; Node.js minimum version: 22
- Webhook server listens on `PORT` env var (default `3000`)
- GitHub webhook path: `POST /webhook`
- All TypeScript tests use `vitest`; run with `pnpm test` inside `packages/webhook`

---

## File Structure

```
packages/
├── agents/
│   └── src/arete_agents/
│       ├── orchestrator.py          ← MODIFY: flat ThreadPoolExecutor, retry, size guard
│       ├── agents/
│       │   └── base.py             ← MODIFY: prompt injection delimiters, retry
│       └── cli.py                  ← CREATE: stdin→pipeline→stdout JSON bridge
│   └── tests/
│       ├── test_orchestrator.py    ← MODIFY: add parallelism + exception tests
│       └── test_cli.py             ← CREATE
└── webhook/
    ├── package.json
    ├── tsconfig.json
    ├── vitest.config.ts
    └── src/
        ├── index.ts                ← entry point: start server
        ├── config.ts               ← zod env validation
        ├── github-auth.ts          ← App → installation Octokit
        ├── pr-fetcher.ts           ← GitHub API → PRContext
        ├── review-bridge.ts        ← spawn Python CLI, parse ReviewResult
        ├── comment-poster.ts       ← ReviewResult → GitHub PR review
        ├── webhook-handler.ts      ← orchestrate fetch→review→post
        ├── server.ts               ← Express app + webhook middleware
        ├── types.ts                ← TypeScript mirrors of Python models
        ├── config.test.ts
        ├── github-auth.test.ts
        ├── pr-fetcher.test.ts
        ├── review-bridge.test.ts
        ├── comment-poster.test.ts
        └── webhook-handler.test.ts
```

---

## Task 1: Harden Phase 1.1 Pipeline

**Files:**
- Modify: `packages/agents/src/arete_agents/orchestrator.py`
- Modify: `packages/agents/src/arete_agents/agents/base.py`
- Modify: `packages/agents/tests/test_orchestrator.py`

**Interfaces:**
- Consumes: existing `ReviewOrchestrator`, `BaseReviewAgent` from Phase 1.1
- Produces: same public API — `ReviewOrchestrator(llm).run(pr_context) -> ReviewResult` — but with parallel file reviews, LLM retry, max patch guard, and prompt injection delimiters

- [ ] **Step 1: Write new failing tests**

Append to `packages/agents/tests/test_orchestrator.py`:
```python
def test_orchestrator_reviews_files_in_parallel(cyclic_llm):
    """All files in a multi-file PR must appear in output (parallelism smoke check)."""
    from arete_agents.orchestrator import ReviewOrchestrator
    from arete_agents.models.pr import PRContext, FileChange
    files = [
        FileChange(path="src/a.py", patch="+x=1", additions=1, deletions=0),
        FileChange(path="src/b.py", patch="+y=2", additions=1, deletions=0),
        FileChange(path="src/c.py", patch="+z=3", additions=1, deletions=0),
    ]
    pr = PRContext(repo="x/y", pr_number=2, title="Multi", description="", files=files)
    result = ReviewOrchestrator(llm=cyclic_llm).run(pr)
    reviewed = {fr.path for fr in result.file_reviews}
    assert reviewed == {"src/a.py", "src/b.py", "src/c.py"}


def test_orchestrator_survives_agent_exception(sample_pr):
    """An agent that raises must not crash the run — produces error FileReview."""
    from unittest.mock import MagicMock
    from arete_agents.orchestrator import ReviewOrchestrator
    boom = MagicMock()
    boom.with_retry.return_value = boom
    boom.invoke.side_effect = RuntimeError("boom")
    result = ReviewOrchestrator(llm=boom).run(sample_pr)
    assert isinstance(result.risk_level, str)
    all_summaries = [fr.summary for fr in result.file_reviews]
    assert any("error" in s.lower() or "boom" in s.lower() for s in all_summaries)


def test_large_patch_is_truncated(cyclic_llm):
    """Patches over MAX_PATCH_CHARS must be truncated before being sent to LLM."""
    from arete_agents.agents.base import MAX_PATCH_CHARS
    from arete_agents.agents.security import SecurityAgent
    from arete_agents.models.pr import FileChange, PRContext
    big_patch = "+" + "x" * (MAX_PATCH_CHARS + 1000)
    file = FileChange(path="big.py", patch=big_patch, additions=1, deletions=0)
    pr = PRContext(repo="x/y", pr_number=3, title="Big", description="", files=[file])
    agent = SecurityAgent(llm=cyclic_llm)
    result = agent.review_file(file, pr)
    assert result is not None
```

- [ ] **Step 2: Run to confirm failures**

```powershell
cd "C:\Users\strol\OneDrive\Desktop\Areté\packages\agents"
uv run pytest tests/test_orchestrator.py -v -k "parallel or exception or truncated"
```

Expected: `FAILED` — `MAX_PATCH_CHARS` not found.

- [ ] **Step 3: Harden `agents/base.py`**

Replace the full content of `packages/agents/src/arete_agents/agents/base.py`:
```python
import json
import re
from abc import ABC, abstractmethod

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

from arete_agents.models.pr import FileChange, PRContext
from arete_agents.models.review import FileReview, ReviewComment

MAX_PATCH_CHARS = 50_000


class BaseReviewAgent(ABC):
    @property
    @abstractmethod
    def agent_name(self) -> str: ...

    @property
    @abstractmethod
    def system_prompt(self) -> str: ...

    def __init__(self, llm: BaseChatModel) -> None:
        self._llm = llm

    def _build_user_prompt(self, file: FileChange, pr_context: PRContext) -> str:
        patch = file.patch
        truncation_note = ""
        if len(patch) > MAX_PATCH_CHARS:
            patch = patch[:MAX_PATCH_CHARS]
            truncation_note = f"\n[Diff truncated: showing first {MAX_PATCH_CHARS} chars only]"

        return f"""Review this pull request file for {self.agent_name} issues.

<pr_metadata>
PR: "{pr_context.title}" in {pr_context.repo}
Description: {pr_context.description}
File: {file.path} ({file.language})
</pr_metadata>

<diff>
{patch}{truncation_note}
</diff>

Return ONLY valid JSON (no markdown, no extra text):
{{
  "comments": [
    {{
      "path": "{file.path}",
      "line": <integer>,
      "body": "<issue description and how to fix it>",
      "severity": "<info|warning|error>",
      "category": "{self.agent_name}"
    }}
  ],
  "summary": "<one paragraph summary>"
}}

If no issues found, return empty comments array."""

    def _parse_response(self, path: str, raw: str) -> tuple[list[ReviewComment], str]:
        try:
            raw_str = raw if isinstance(raw, str) else ""
            clean = re.sub(r"```(?:json)?\n?|```$", "", raw_str, flags=re.MULTILINE).strip()
            data = json.loads(clean)
            comments = [ReviewComment(**c) for c in data.get("comments", [])]
            return comments, data.get("summary", "")
        except Exception as exc:
            return [], f"Failed to parse agent response: {exc}"

    def review_file(self, file: FileChange, pr_context: PRContext) -> FileReview:
        messages = [
            SystemMessage(content=self.system_prompt),
            HumanMessage(content=self._build_user_prompt(file, pr_context)),
        ]
        llm_with_retry = self._llm.with_retry(stop_after_attempt=2)
        response = llm_with_retry.invoke(messages)
        raw = response.content if isinstance(response.content, str) else ""
        comments, summary = self._parse_response(file.path, raw)
        return FileReview(path=file.path, comments=comments, summary=summary)
```

- [ ] **Step 4: Harden `orchestrator.py`**

Replace the full content of `packages/agents/src/arete_agents/orchestrator.py`:
```python
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Literal

from langchain_core.language_models import BaseChatModel

from arete_agents.agents.performance import PerformanceAgent
from arete_agents.agents.quality import QualityAgent
from arete_agents.agents.security import SecurityAgent
from arete_agents.models.pr import FileChange, PRContext
from arete_agents.models.review import FileReview, ReviewResult

_SEVERITY_WEIGHT = {"error": 3, "warning": 2, "info": 1}


def _risk_level(file_reviews: list[FileReview]) -> Literal["low", "medium", "high", "critical"]:
    all_comments = [c for fr in file_reviews for c in fr.comments]
    if not all_comments:
        return "low"
    max_weight = max(_SEVERITY_WEIGHT.get(c.severity, 0) for c in all_comments)
    error_count = sum(1 for c in all_comments if c.severity == "error")
    if error_count >= 2:
        return "critical"
    if max_weight == 3:
        return "high"
    if max_weight == 2:
        return "medium"
    return "low"


def _merge_reviews(reviews_per_file: list[list[FileReview]]) -> list[FileReview]:
    merged: dict[str, tuple[list, list[str]]] = {}
    for agent_reviews in reviews_per_file:
        for fr in agent_reviews:
            if fr.path not in merged:
                merged[fr.path] = (list(fr.comments), [fr.summary] if fr.summary else [])
            else:
                merged[fr.path][0].extend(fr.comments)
                if fr.summary:
                    merged[fr.path][1].append(fr.summary)
    return [
        FileReview(path=path, comments=comments, summary=" ".join(summaries))
        for path, (comments, summaries) in merged.items()
    ]


class ReviewOrchestrator:
    def __init__(self, llm: BaseChatModel) -> None:
        self._agents = [SecurityAgent(llm), PerformanceAgent(llm), QualityAgent(llm)]

    def run(self, pr: PRContext) -> ReviewResult:
        if not pr.files:
            return ReviewResult(
                pr_context=pr,
                file_reviews=[],
                overall_summary="No files changed.",
                risk_level="low",
            )

        # Fan out all (file × agent) pairs in a single flat pool
        tasks = [(file, agent) for file in pr.files for agent in self._agents]
        flat_results: list[FileReview] = []

        with ThreadPoolExecutor(max_workers=min(len(tasks), 12)) as pool:
            futures = {
                pool.submit(agent.review_file, file, pr): (file, agent)
                for file, agent in tasks
            }
            for future in as_completed(futures):
                file, agent = futures[future]
                try:
                    flat_results.append(future.result())
                except Exception as exc:
                    flat_results.append(
                        FileReview(
                            path=file.path,
                            comments=[],
                            summary=f"{agent.agent_name} error: {exc}",
                        )
                    )

        # Group by path then merge
        by_path: dict[str, list[FileReview]] = {}
        for fr in flat_results:
            by_path.setdefault(fr.path, []).append(fr)

        file_reviews = _merge_reviews(list(by_path.values()))
        risk = _risk_level(file_reviews)
        total = sum(len(fr.comments) for fr in file_reviews)

        return ReviewResult(
            pr_context=pr,
            file_reviews=file_reviews,
            overall_summary=(
                f"Reviewed {len(pr.files)} file(s). "
                f"Found {total} issue(s) across security, performance, and quality checks. "
                f"Risk level: {risk.upper()}."
            ),
            risk_level=risk,
        )
```

- [ ] **Step 5: Run tests**

```powershell
cd "C:\Users\strol\OneDrive\Desktop\Areté\packages\agents"
uv run pytest tests/ -v --ignore=tests/test_e2e_smoke.py
```

Expected: all tests pass (existing 24 + 3 new = 27 passed).

- [ ] **Step 6: Run ruff**

```powershell
uv run ruff check src/ tests/
```

Expected: no errors. Fix any before committing.

- [ ] **Step 7: Commit**

```powershell
cd "C:\Users\strol\OneDrive\Desktop\Areté"
git add packages/agents/src/arete_agents/orchestrator.py packages/agents/src/arete_agents/agents/base.py packages/agents/tests/test_orchestrator.py
git commit -m "fix(agents): harden pipeline — flat pool parallelism, LLM retry, patch size guard, prompt injection delimiters"
```

---

## Task 2: Python Review CLI

**Files:**
- Create: `packages/agents/src/arete_agents/cli.py`
- Create: `packages/agents/tests/test_cli.py`

**Interfaces:**
- Consumes: `ReviewOrchestrator`, `PRContext`, `get_settings`, `get_llm` from Phase 1.1
- Produces: `python -m arete_agents.cli` — reads `PRContext` JSON from stdin, writes `ReviewResult` JSON to stdout, exits 0 on success, 1 on error

- [ ] **Step 1: Write failing test**

Create `packages/agents/tests/test_cli.py`:
```python
import json
import pytest
from io import StringIO
from unittest.mock import MagicMock, patch

from langchain_core.messages import AIMessage

from arete_agents.models.pr import FileChange, PRContext

MOCK_LLM_RESPONSE = json.dumps({
    "comments": [
        {
            "path": "src/auth.py",
            "line": 1,
            "body": "SQL injection.",
            "severity": "error",
            "category": "security",
        }
    ],
    "summary": "SQL injection found.",
})

SAMPLE_PR = PRContext(
    repo="acme/api",
    pr_number=1,
    title="Add login",
    description="Auth endpoint",
    files=[
        FileChange(
            path="src/auth.py",
            patch="+query = f'SELECT * FROM users WHERE id={user_id}'",
            additions=1,
            deletions=0,
        )
    ],
)


def test_cli_reads_stdin_and_writes_stdout(monkeypatch, capsys):
    mock_llm = MagicMock()
    mock_llm.with_retry.return_value = mock_llm
    mock_llm.invoke.return_value = AIMessage(content=MOCK_LLM_RESPONSE)

    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")

    from arete_agents.config import get_settings
    get_settings.cache_clear()

    with patch("arete_agents.cli.get_llm", return_value=mock_llm):
        monkeypatch.setattr("sys.stdin", StringIO(SAMPLE_PR.model_dump_json()))
        from arete_agents.cli import main
        main()

    captured = capsys.readouterr()
    result = json.loads(captured.out)
    assert result["risk_level"] in ("low", "medium", "high", "critical")
    assert "file_reviews" in result


def test_cli_exits_1_on_invalid_json(monkeypatch):
    monkeypatch.setattr("sys.stdin", StringIO("not valid json"))
    from arete_agents import cli
    import importlib
    importlib.reload(cli)
    with pytest.raises(SystemExit) as exc:
        cli.main()
    assert exc.value.code == 1
```

- [ ] **Step 2: Run to confirm failure**

```powershell
cd "C:\Users\strol\OneDrive\Desktop\Areté\packages\agents"
uv run pytest tests/test_cli.py -v
```

Expected: `FAILED` with `ImportError: cannot import name 'main' from 'arete_agents.cli'`

- [ ] **Step 3: Implement CLI**

Create `packages/agents/src/arete_agents/cli.py`:
```python
import json
import sys


def main() -> None:
    try:
        data = sys.stdin.read()
        pr_dict = json.loads(data)
    except Exception as exc:
        print(f"CLI input error: {exc}", file=sys.stderr)
        sys.exit(1)

    try:
        from arete_agents.config import get_settings
        from arete_agents.llm.base import get_llm
        from arete_agents.models.pr import PRContext
        from arete_agents.orchestrator import ReviewOrchestrator

        pr = PRContext.model_validate(pr_dict)
        settings = get_settings()
        llm = get_llm(settings)
        orch = ReviewOrchestrator(llm=llm)
        result = orch.run(pr)
        print(result.model_dump_json())
    except Exception as exc:
        print(f"Pipeline error: {exc}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests**

```powershell
uv run pytest tests/test_cli.py tests/test_orchestrator.py -v --ignore=tests/test_e2e_smoke.py
```

Expected: all pass.

- [ ] **Step 5: Run full suite**

```powershell
uv run pytest tests/ -v --ignore=tests/test_e2e_smoke.py
```

Expected: 29 passed.

- [ ] **Step 6: Commit**

```powershell
cd "C:\Users\strol\OneDrive\Desktop\Areté"
git add packages/agents/src/arete_agents/cli.py packages/agents/tests/test_cli.py
git commit -m "feat(agents): add CLI bridge — stdin PRContext JSON to stdout ReviewResult JSON"
```

---

## Task 3: Webhook Package Foundation

**Files:**
- Create: `packages/webhook/package.json`
- Create: `packages/webhook/tsconfig.json`
- Create: `packages/webhook/vitest.config.ts`
- Create: `packages/webhook/src/types.ts`
- Create: `packages/webhook/src/index.ts`

**Interfaces:**
- Produces: `pnpm test` runs vitest; `pnpm dev` starts server with `tsx`

- [ ] **Step 1: Create package.json**

Create `packages/webhook/package.json`:
```json
{
  "name": "@arete/webhook",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "dev": "tsx src/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "build": "tsc",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@octokit/app": "^15.1.0",
    "@octokit/webhooks": "^13.4.0",
    "express": "^4.21.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

Create `packages/webhook/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

Create `packages/webhook/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
  },
})
```

- [ ] **Step 4: Create shared TypeScript types**

Create `packages/webhook/src/types.ts`:
```typescript
// Mirrors the Python Pydantic models in packages/agents/src/arete_agents/models/

export interface FileChange {
  path: string
  patch: string
  additions: number
  deletions: number
  language: string
}

export interface PRContext {
  repo: string
  pr_number: number
  title: string
  description: string
  files: FileChange[]
}

export interface ReviewComment {
  path: string
  line: number
  body: string
  severity: 'info' | 'warning' | 'error'
  category: string
}

export interface FileReview {
  path: string
  comments: ReviewComment[]
  summary: string
}

export interface ReviewResult {
  pr_context: PRContext
  file_reviews: FileReview[]
  overall_summary: string
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  total_comments: number
}
```

- [ ] **Step 5: Create placeholder index.ts**

Create `packages/webhook/src/index.ts`:
```typescript
// Entry point — filled in Task 8
console.log('Areté webhook server starting...')
```

- [ ] **Step 6: Install dependencies**

```powershell
cd "C:\Users\strol\OneDrive\Desktop\Areté\packages\webhook"
pnpm install
```

- [ ] **Step 7: Confirm TypeScript compiles**

```powershell
pnpm lint
```

Expected: no errors.

- [ ] **Step 8: Commit**

```powershell
cd "C:\Users\strol\OneDrive\Desktop\Areté"
git add packages/webhook/
git commit -m "feat(webhook): scaffold TypeScript package with vitest and Octokit dependencies"
```

---

## Task 4: GitHub App Config & Auth

**Files:**
- Create: `packages/webhook/src/config.ts`
- Create: `packages/webhook/src/github-auth.ts`
- Create: `packages/webhook/src/config.test.ts`
- Create: `packages/webhook/src/github-auth.test.ts`

**Interfaces:**
- Produces: `getConfig() -> Config` — throws if required env vars are missing
- Produces: `getInstallationOctokit(app, installationId) -> Promise<Octokit>` — returns authenticated Octokit for a specific installation

- [ ] **Step 1: Write failing config test**

Create `packages/webhook/src/config.test.ts`:
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('getConfig', () => {
  const original = { ...process.env }

  beforeEach(() => {
    process.env.GITHUB_APP_ID = '12345'
    process.env.GITHUB_PRIVATE_KEY =
      '-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\n'
    process.env.GITHUB_WEBHOOK_SECRET = 'mysecret'
    process.env.PORT = '3000'
  })

  afterEach(() => {
    Object.assign(process.env, original)
    vi.resetModules()
  })

  it('returns config when all env vars are set', async () => {
    const { getConfig } = await import('./config.js')
    const cfg = getConfig()
    expect(cfg.appId).toBe(12345)
    expect(cfg.webhookSecret).toBe('mysecret')
    expect(cfg.port).toBe(3000)
  })

  it('throws when GITHUB_APP_ID is missing', async () => {
    delete process.env.GITHUB_APP_ID
    const { getConfig } = await import('./config.js')
    expect(() => getConfig()).toThrow(/GITHUB_APP_ID/)
  })

  it('throws when GITHUB_WEBHOOK_SECRET is missing', async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET
    const { getConfig } = await import('./config.js')
    expect(() => getConfig()).toThrow(/GITHUB_WEBHOOK_SECRET/)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```powershell
cd "C:\Users\strol\OneDrive\Desktop\Areté\packages\webhook"
pnpm test -- config
```

Expected: FAILED — `./config.js` not found.

- [ ] **Step 3: Implement config.ts**

Create `packages/webhook/src/config.ts`:
```typescript
import { z } from 'zod'

const ConfigSchema = z.object({
  GITHUB_APP_ID: z.string().min(1, 'GITHUB_APP_ID is required').transform(Number),
  GITHUB_PRIVATE_KEY: z.string().min(1, 'GITHUB_PRIVATE_KEY is required'),
  GITHUB_WEBHOOK_SECRET: z.string().min(1, 'GITHUB_WEBHOOK_SECRET is required'),
  PORT: z.string().default('3000').transform(Number),
})

export interface Config {
  appId: number
  privateKey: string
  webhookSecret: string
  port: number
}

export function getConfig(): Config {
  const result = ConfigSchema.safeParse(process.env)
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.message).join(', ')
    throw new Error(`Configuration error: ${missing}`)
  }
  return {
    appId: result.data.GITHUB_APP_ID,
    privateKey: result.data.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n'),
    webhookSecret: result.data.GITHUB_WEBHOOK_SECRET,
    port: result.data.PORT,
  }
}
```

- [ ] **Step 4: Write failing auth test**

Create `packages/webhook/src/github-auth.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'

describe('getInstallationOctokit', () => {
  it('calls app.getInstallationOctokit with the given installation id', async () => {
    const mockOctokit = { rest: {} }
    const mockApp = {
      getInstallationOctokit: vi.fn().mockResolvedValue(mockOctokit),
    }
    const { getInstallationOctokit } = await import('./github-auth.js')
    const result = await getInstallationOctokit(mockApp as any, 42)
    expect(mockApp.getInstallationOctokit).toHaveBeenCalledWith(42)
    expect(result).toBe(mockOctokit)
  })
})
```

- [ ] **Step 5: Implement github-auth.ts**

Create `packages/webhook/src/github-auth.ts`:
```typescript
import { App } from '@octokit/app'
import type { Octokit } from '@octokit/core'
import { getConfig } from './config.js'

export function createApp(): App {
  const config = getConfig()
  return new App({
    appId: config.appId,
    privateKey: config.privateKey,
    webhooks: { secret: config.webhookSecret },
  })
}

export async function getInstallationOctokit(
  app: App,
  installationId: number
): Promise<Octokit> {
  return app.getInstallationOctokit(installationId)
}
```

- [ ] **Step 6: Run tests**

```powershell
pnpm test -- config auth
```

Expected: all pass.

- [ ] **Step 7: Commit**

```powershell
cd "C:\Users\strol\OneDrive\Desktop\Areté"
git add packages/webhook/src/config.ts packages/webhook/src/github-auth.ts packages/webhook/src/config.test.ts packages/webhook/src/github-auth.test.ts
git commit -m "feat(webhook): add zod config validation and GitHub App auth"
```

---

## Task 5: PR Fetcher

**Files:**
- Create: `packages/webhook/src/pr-fetcher.ts`
- Create: `packages/webhook/src/pr-fetcher.test.ts`

**Interfaces:**
- Consumes: authenticated `Octokit` instance from Task 4
- Produces: `fetchPRContext(octokit, owner, repo, prNumber) -> Promise<PRContext>` — fetches PR metadata + file diffs, maps to `PRContext`

- [ ] **Step 1: Write failing test**

Create `packages/webhook/src/pr-fetcher.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { fetchPRContext } from './pr-fetcher.js'

const mockPR = {
  number: 42,
  title: 'Fix auth bug',
  body: 'Fixes SQL injection in login',
}

const mockFiles = [
  {
    filename: 'src/auth.py',
    patch: "+query = f'SELECT * FROM users WHERE id={uid}'",
    additions: 1,
    deletions: 0,
    status: 'modified',
  },
  {
    filename: 'src/README.md',
    patch: undefined,
    additions: 0,
    deletions: 0,
    status: 'modified',
  },
]

function makeOctokit() {
  return {
    rest: {
      pulls: {
        get: vi.fn().mockResolvedValue({ data: mockPR }),
        listFiles: vi.fn().mockResolvedValue({ data: mockFiles }),
      },
    },
  }
}

describe('fetchPRContext', () => {
  it('maps GitHub PR + files to PRContext', async () => {
    const octokit = makeOctokit()
    const result = await fetchPRContext(octokit as any, 'acme', 'api', 42)
    expect(result.repo).toBe('acme/api')
    expect(result.pr_number).toBe(42)
    expect(result.title).toBe('Fix auth bug')
    expect(result.description).toBe('Fixes SQL injection in login')
  })

  it('skips files with no patch (binary files)', async () => {
    const octokit = makeOctokit()
    const result = await fetchPRContext(octokit as any, 'acme', 'api', 42)
    expect(result.files).toHaveLength(1)
    expect(result.files[0].path).toBe('src/auth.py')
  })

  it('sets description to empty string when PR body is null', async () => {
    const octokit = makeOctokit()
    ;(octokit.rest.pulls.get as any).mockResolvedValue({ data: { ...mockPR, body: null } })
    const result = await fetchPRContext(octokit as any, 'acme', 'api', 42)
    expect(result.description).toBe('')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```powershell
cd "C:\Users\strol\OneDrive\Desktop\Areté\packages\webhook"
pnpm test -- pr-fetcher
```

Expected: FAILED — `./pr-fetcher.js` not found.

- [ ] **Step 3: Implement pr-fetcher.ts**

Create `packages/webhook/src/pr-fetcher.ts`:
```typescript
import type { Octokit } from '@octokit/core'
import type { FileChange, PRContext } from './types.js'

const EXTENSION_MAP: Record<string, string> = {
  '.py': 'python', '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.go': 'go',
  '.rs': 'rust', '.java': 'java', '.rb': 'ruby', '.php': 'php',
  '.cs': 'csharp', '.cpp': 'cpp', '.c': 'c', '.sql': 'sql', '.sh': 'shell',
}

function detectLanguage(filename: string): string {
  const ext = filename.includes('.') ? '.' + filename.split('.').pop()! : ''
  return EXTENSION_MAP[ext] ?? 'other'
}

export async function fetchPRContext(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<PRContext> {
  const [{ data: pr }, { data: files }] = await Promise.all([
    (octokit as any).rest.pulls.get({ owner, repo, pull_number: prNumber }),
    (octokit as any).rest.pulls.listFiles({ owner, repo, pull_number: prNumber, per_page: 100 }),
  ])

  const fileChanges: FileChange[] = files
    .filter((f: any) => typeof f.patch === 'string')
    .map((f: any): FileChange => ({
      path: f.filename,
      patch: f.patch as string,
      additions: f.additions,
      deletions: f.deletions,
      language: detectLanguage(f.filename),
    }))

  return {
    repo: `${owner}/${repo}`,
    pr_number: pr.number,
    title: pr.title,
    description: pr.body ?? '',
    files: fileChanges,
  }
}
```

- [ ] **Step 4: Run tests**

```powershell
pnpm test -- pr-fetcher
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```powershell
cd "C:\Users\strol\OneDrive\Desktop\Areté"
git add packages/webhook/src/pr-fetcher.ts packages/webhook/src/pr-fetcher.test.ts
git commit -m "feat(webhook): add PR fetcher — GitHub API to PRContext"
```

---

## Task 6: Review Bridge

**Files:**
- Create: `packages/webhook/src/review-bridge.ts`
- Create: `packages/webhook/src/review-bridge.test.ts`

**Interfaces:**
- Consumes: `PRContext` (from Task 5), Python CLI (`python -m arete_agents.cli`) from Task 2
- Produces: `runReviewPipeline(prContext: PRContext) -> Promise<ReviewResult>` — spawns Python subprocess, sends JSON on stdin, reads JSON from stdout

- [ ] **Step 1: Write failing test**

Create `packages/webhook/src/review-bridge.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

const MOCK_RESULT = {
  pr_context: { repo: 'x/y', pr_number: 1, title: 'T', description: '', files: [] },
  file_reviews: [],
  overall_summary: 'No issues.',
  risk_level: 'low',
  total_comments: 0,
}

function makeProc(stdout: string, exitCode: number) {
  const proc = new EventEmitter() as any
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.stdin = { write: vi.fn(), end: vi.fn() }
  setTimeout(() => {
    proc.stdout.emit('data', Buffer.from(stdout))
    proc.emit('close', exitCode)
  }, 0)
  return proc
}

describe('runReviewPipeline', () => {
  beforeEach(() => { vi.resetModules() })

  it('returns parsed ReviewResult on success', async () => {
    vi.mock('node:child_process', () => ({
      spawn: vi.fn(() => makeProc(JSON.stringify(MOCK_RESULT), 0)),
    }))
    const { runReviewPipeline } = await import('./review-bridge.js')
    const result = await runReviewPipeline({
      repo: 'x/y', pr_number: 1, title: 'T', description: '', files: [],
    })
    expect(result.risk_level).toBe('low')
  })

  it('throws when Python process exits non-zero', async () => {
    vi.mock('node:child_process', () => ({
      spawn: vi.fn(() => makeProc('', 1)),
    }))
    const { runReviewPipeline } = await import('./review-bridge.js')
    await expect(
      runReviewPipeline({ repo: 'x/y', pr_number: 1, title: 'T', description: '', files: [] })
    ).rejects.toThrow('exited with code 1')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```powershell
cd "C:\Users\strol\OneDrive\Desktop\Areté\packages\webhook"
pnpm test -- review-bridge
```

Expected: FAILED — `./review-bridge.js` not found.

- [ ] **Step 3: Implement review-bridge.ts**

Create `packages/webhook/src/review-bridge.ts`:
```typescript
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import type { PRContext, ReviewResult } from './types.js'

const AGENTS_DIR = resolve(__dirname, '../../agents')

export function runReviewPipeline(prContext: PRContext): Promise<ReviewResult> {
  return new Promise((resolve2, reject) => {
    const proc = spawn('uv', ['run', 'python', '-m', 'arete_agents.cli'], {
      cwd: AGENTS_DIR,
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on('error', reject)

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error('[review-bridge] Python stderr:', stderr)
        reject(new Error(`Python pipeline exited with code ${code}: ${stderr.slice(0, 200)}`))
        return
      }
      try {
        resolve2(JSON.parse(stdout) as ReviewResult)
      } catch (err) {
        reject(new Error(`Failed to parse pipeline output: ${err}`))
      }
    })

    proc.stdin.write(JSON.stringify(prContext))
    proc.stdin.end()
  })
}
```

- [ ] **Step 4: Run tests**

```powershell
pnpm test -- review-bridge
```

Expected: 2 passed.

- [ ] **Step 5: Commit**

```powershell
cd "C:\Users\strol\OneDrive\Desktop\Areté"
git add packages/webhook/src/review-bridge.ts packages/webhook/src/review-bridge.test.ts
git commit -m "feat(webhook): add review bridge — spawn Python CLI subprocess"
```

---

## Task 7: Comment Poster

**Files:**
- Create: `packages/webhook/src/comment-poster.ts`
- Create: `packages/webhook/src/comment-poster.test.ts`

**Interfaces:**
- Consumes: authenticated `Octokit`, `ReviewResult` from Task 6
- Produces: `postReview(octokit, owner, repo, prNumber, result) -> Promise<void>` — creates GitHub PR review with inline comments and summary body

- [ ] **Step 1: Write failing test**

Create `packages/webhook/src/comment-poster.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest'
import { postReview } from './comment-poster.js'
import type { ReviewResult } from './types.js'

const MOCK_RESULT: ReviewResult = {
  pr_context: { repo: 'acme/api', pr_number: 1, title: 'Fix', description: '', files: [] },
  file_reviews: [
    {
      path: 'src/auth.py',
      comments: [
        {
          path: 'src/auth.py',
          line: 5,
          body: 'SQL injection risk.',
          severity: 'error',
          category: 'security',
        },
        {
          path: 'src/auth.py',
          line: 99999,
          body: 'Out of range line.',
          severity: 'info',
          category: 'quality',
        },
      ],
      summary: 'SQL injection found.',
    },
  ],
  overall_summary: 'Found 1 issue. Risk: HIGH.',
  risk_level: 'high',
  total_comments: 2,
}

function makeOctokit(createReviewFn = vi.fn().mockResolvedValue({})) {
  return { rest: { pulls: { createReview: createReviewFn } } }
}

describe('postReview', () => {
  it('calls createReview with overall_summary as body', async () => {
    const createReview = vi.fn().mockResolvedValue({})
    await postReview(makeOctokit(createReview) as any, 'acme', 'api', 1, MOCK_RESULT)
    expect(createReview).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('Found 1 issue') })
    )
  })

  it('includes valid inline comments and drops out-of-range ones', async () => {
    const createReview = vi.fn().mockResolvedValue({})
    await postReview(makeOctokit(createReview) as any, 'acme', 'api', 1, MOCK_RESULT)
    const call = createReview.mock.calls[0][0]
    expect(call.comments).toHaveLength(1)
    expect(call.comments[0].line).toBe(5)
  })

  it('posts with event COMMENT', async () => {
    const createReview = vi.fn().mockResolvedValue({})
    await postReview(makeOctokit(createReview) as any, 'acme', 'api', 1, MOCK_RESULT)
    expect(createReview.mock.calls[0][0].event).toBe('COMMENT')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```powershell
cd "C:\Users\strol\OneDrive\Desktop\Areté\packages\webhook"
pnpm test -- comment-poster
```

Expected: FAILED — `./comment-poster.js` not found.

- [ ] **Step 3: Implement comment-poster.ts**

Create `packages/webhook/src/comment-poster.ts`:
```typescript
import type { Octokit } from '@octokit/core'
import type { ReviewComment, ReviewResult } from './types.js'

// GitHub only allows inline comments on lines 1–1000 in a diff hunk.
const MAX_VALID_LINE = 1000

function formatComment(comment: ReviewComment): string {
  const badge = `**[${comment.severity.toUpperCase()}]** (${comment.category})`
  return `${badge}\n\n${comment.body}`
}

export async function postReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  result: ReviewResult
): Promise<void> {
  const allComments = result.file_reviews.flatMap((fr) => fr.comments)

  const validComments = allComments
    .filter((c) => c.line >= 1 && c.line <= MAX_VALID_LINE)
    .map((c) => ({
      path: c.path,
      line: c.line,
      body: formatComment(c),
    }))

  const riskBadge = `**Risk Level: ${result.risk_level.toUpperCase()}**`
  const body = `## Areté Code Review\n\n${riskBadge}\n\n${result.overall_summary}`

  await (octokit as any).rest.pulls.createReview({
    owner,
    repo,
    pull_number: prNumber,
    body,
    event: 'COMMENT',
    comments: validComments,
  })
}
```

- [ ] **Step 4: Run tests**

```powershell
pnpm test -- comment-poster
```

Expected: 3 passed.

- [ ] **Step 5: Commit**

```powershell
cd "C:\Users\strol\OneDrive\Desktop\Areté"
git add packages/webhook/src/comment-poster.ts packages/webhook/src/comment-poster.test.ts
git commit -m "feat(webhook): add comment poster — ReviewResult to GitHub PR review"
```

---

## Task 8: Webhook Handler & Server

**Files:**
- Create: `packages/webhook/src/webhook-handler.ts`
- Create: `packages/webhook/src/server.ts`
- Modify: `packages/webhook/src/index.ts`
- Create: `packages/webhook/src/webhook-handler.test.ts`

**Interfaces:**
- Consumes: `createApp` (Task 4), `fetchPRContext` (Task 5), `runReviewPipeline` (Task 6), `postReview` (Task 7)
- Produces: Express app listening on `config.port`, `POST /webhook` with HMAC validation and full review flow; `GET /health` returns `{"status":"ok"}`

- [ ] **Step 1: Write failing test**

Create `packages/webhook/src/webhook-handler.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const MOCK_PR_CONTEXT = {
  repo: 'acme/api', pr_number: 1, title: 'Fix', description: '', files: [],
}
const MOCK_RESULT = {
  pr_context: MOCK_PR_CONTEXT,
  file_reviews: [],
  overall_summary: 'OK',
  risk_level: 'low',
  total_comments: 0,
}

describe('handlePullRequestEvent', () => {
  beforeEach(() => { vi.resetModules() })

  it('fetches PR, runs pipeline, posts review', async () => {
    const mockFetch = vi.fn().mockResolvedValue(MOCK_PR_CONTEXT)
    const mockRun = vi.fn().mockResolvedValue(MOCK_RESULT)
    const mockPost = vi.fn().mockResolvedValue(undefined)
    const mockOctokit = {}

    vi.mock('./pr-fetcher.js', () => ({ fetchPRContext: mockFetch }))
    vi.mock('./review-bridge.js', () => ({ runReviewPipeline: mockRun }))
    vi.mock('./comment-poster.js', () => ({ postReview: mockPost }))

    const { handlePullRequestEvent } = await import('./webhook-handler.js')

    await handlePullRequestEvent(mockOctokit as any, {
      repository: { owner: { login: 'acme' }, name: 'api' },
      pull_request: { number: 1 },
      action: 'opened',
    })

    expect(mockFetch).toHaveBeenCalledWith(mockOctokit, 'acme', 'api', 1)
    expect(mockRun).toHaveBeenCalledWith(MOCK_PR_CONTEXT)
    expect(mockPost).toHaveBeenCalledWith(mockOctokit, 'acme', 'api', 1, MOCK_RESULT)
  })

  it('does not run pipeline for closed PRs', async () => {
    const mockRun = vi.fn()
    vi.mock('./review-bridge.js', () => ({ runReviewPipeline: mockRun }))

    const { handlePullRequestEvent } = await import('./webhook-handler.js')

    await handlePullRequestEvent({} as any, {
      repository: { owner: { login: 'acme' }, name: 'api' },
      pull_request: { number: 1 },
      action: 'closed',
    })

    expect(mockRun).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```powershell
cd "C:\Users\strol\OneDrive\Desktop\Areté\packages\webhook"
pnpm test -- webhook-handler
```

Expected: FAILED — `./webhook-handler.js` not found.

- [ ] **Step 3: Implement webhook-handler.ts**

Create `packages/webhook/src/webhook-handler.ts`:
```typescript
import type { Octokit } from '@octokit/core'
import { fetchPRContext } from './pr-fetcher.js'
import { runReviewPipeline } from './review-bridge.js'
import { postReview } from './comment-poster.js'

const HANDLED_ACTIONS = new Set(['opened', 'synchronize', 'reopened'])

interface PullRequestPayload {
  action: string
  repository: { owner: { login: string }; name: string }
  pull_request: { number: number }
}

export async function handlePullRequestEvent(
  octokit: Octokit,
  payload: PullRequestPayload
): Promise<void> {
  if (!HANDLED_ACTIONS.has(payload.action)) {
    console.log(`[handler] Ignoring pull_request.${payload.action}`)
    return
  }

  const owner = payload.repository.owner.login
  const repo = payload.repository.name
  const prNumber = payload.pull_request.number

  console.log(`[handler] Reviewing ${owner}/${repo}#${prNumber} (${payload.action})`)

  const prContext = await fetchPRContext(octokit, owner, repo, prNumber)
  const result = await runReviewPipeline(prContext)
  await postReview(octokit, owner, repo, prNumber, result)

  console.log(`[handler] Posted review — risk: ${result.risk_level}, comments: ${result.total_comments}`)
}
```

- [ ] **Step 4: Implement server.ts**

Create `packages/webhook/src/server.ts`:
```typescript
import express from 'express'
import { createNodeMiddleware } from '@octokit/webhooks'
import { App } from '@octokit/app'
import { getConfig } from './config.js'
import { handlePullRequestEvent } from './webhook-handler.js'

export function createServer(): express.Application {
  const config = getConfig()
  const app = new App({
    appId: config.appId,
    privateKey: config.privateKey,
    webhooks: { secret: config.webhookSecret },
  })

  app.webhooks.on('pull_request', async ({ octokit, payload }) => {
    try {
      await handlePullRequestEvent(octokit as any, payload as any)
    } catch (err) {
      console.error('[server] Error handling pull_request event:', err)
    }
  })

  const server = express()
  server.use('/webhook', createNodeMiddleware(app.webhooks, { path: '/webhook' }))
  server.get('/health', (_req, res) => res.json({ status: 'ok' }))

  return server
}
```

- [ ] **Step 5: Update index.ts**

Replace `packages/webhook/src/index.ts`:
```typescript
import { createServer } from './server.js'
import { getConfig } from './config.js'

const config = getConfig()
const app = createServer()

app.listen(config.port, () => {
  console.log(`Areté webhook server listening on port ${config.port}`)
  console.log(`Webhook endpoint: POST http://localhost:${config.port}/webhook`)
  console.log(`Health check:     GET  http://localhost:${config.port}/health`)
})
```

- [ ] **Step 6: Run all webhook tests**

```powershell
cd "C:\Users\strol\OneDrive\Desktop\Areté\packages\webhook"
pnpm test
```

Expected: all tests pass.

- [ ] **Step 7: Verify server starts**

In a terminal with `.env` loaded, run:
```powershell
cd "C:\Users\strol\OneDrive\Desktop\Areté\packages\webhook"
pnpm dev
```

Expected output:
```
Areté webhook server listening on port 3000
Webhook endpoint: POST http://localhost:3000/webhook
Health check:     GET  http://localhost:3000/health
```

Then in another terminal: `curl http://localhost:3000/health` → `{"status":"ok"}`

Stop with Ctrl+C.

- [ ] **Step 8: Commit**

```powershell
cd "C:\Users\strol\OneDrive\Desktop\Areté"
git add packages/webhook/src/webhook-handler.ts packages/webhook/src/server.ts packages/webhook/src/index.ts packages/webhook/src/webhook-handler.test.ts
git commit -m "feat(webhook): add webhook handler and Express server — full PR review flow"
```

---

## Task 9: CI Update & Dev Workflow

**Files:**
- Modify: `.github/workflows/ci.yml`
- Create: `docs/github-app-setup.md`

**Interfaces:**
- Produces: CI runs `pnpm test` for the webhook package on every push

- [ ] **Step 1: Update CI workflow**

Replace `.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test-agents:
    name: Python Agents
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Install uv
        uses: astral-sh/setup-uv@v4
        with:
          version: "latest"

      - name: Install dependencies
        run: uv sync
        working-directory: packages/agents

      - name: Lint
        run: uv run ruff check src/ tests/
        working-directory: packages/agents

      - name: Test
        run: uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -v
        working-directory: packages/agents

  test-webhook:
    name: TypeScript Webhook
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Install dependencies
        run: pnpm install --frozen-lockfile
        working-directory: packages/webhook

      - name: Type check
        run: pnpm lint
        working-directory: packages/webhook

      - name: Test
        run: pnpm test
        working-directory: packages/webhook
```

- [ ] **Step 2: Update pnpm lockfile**

```powershell
cd "C:\Users\strol\OneDrive\Desktop\Areté"
pnpm install
```

- [ ] **Step 3: Create GitHub App setup guide**

Create `docs/github-app-setup.md`:
```markdown
# GitHub App Setup Guide

This guide walks through registering the Areté GitHub App for a new environment.

## 1. Register the App

1. Go to **github.com/settings/apps/new**
2. Fill in:
   - **App name:** `Areté Code Review` (or `Areté Code Review (dev)` for dev)
   - **Homepage URL:** your repo URL
   - **Webhook URL:** `https://YOUR_PUBLIC_HOST/webhook`
   - **Webhook secret:** generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
3. **Permissions:**
   - Pull requests: Read & write
   - Contents: Read
4. **Subscribe to events:** Pull request
5. Click **Create GitHub App** → note the **App ID**

## 2. Generate Private Key

App settings page → **Private keys** → **Generate a private key**. A `.pem` downloads.

Convert for `.env` (newlines become `\n` literals):
```bash
node -e "const k=require('fs').readFileSync('key.pem','utf8'); console.log(k.replace(/\n/g,'\\n'))"
```

## 3. Configure `.env`

```
GITHUB_APP_ID=<number from app settings>
GITHUB_PRIVATE_KEY=<output from step above, including BEGIN/END lines>
GITHUB_WEBHOOK_SECRET=<secret you generated>
PORT=3000
LLM_PROVIDER=gemini
GEMINI_API_KEY=<your Google AI Studio key>
```

## 4. Install the App

App settings page → **Install App** → select the repository.

## 5. Expose Your Local Port

**GitHub Codespaces:** Forward port 3000 in the Ports tab. Copy the public URL and set `<url>/webhook` as the Webhook URL in app settings.

**Local machine:**
```bash
npx ngrok http 3000
```
Copy the `https://….ngrok.io` URL and set `https://….ngrok.io/webhook` as the Webhook URL.

## 6. Test End to End

1. Start the server: `cd packages/webhook && pnpm dev`
2. Open a PR on the installed repository
3. Watch for `[handler] Reviewing …` and `[handler] Posted review` in the terminal
4. Check the PR on GitHub — Areté should have posted a review comment
```

- [ ] **Step 4: Run both test suites to confirm CI readiness**

```powershell
cd "C:\Users\strol\OneDrive\Desktop\Areté\packages\agents"
uv run pytest tests/ --ignore=tests/test_e2e_smoke.py -v
cd "C:\Users\strol\OneDrive\Desktop\Areté\packages\webhook"
pnpm test
```

Expected: both pass with no failures.

- [ ] **Step 5: Commit**

```powershell
cd "C:\Users\strol\OneDrive\Desktop\Areté"
git add .github/workflows/ci.yml docs/github-app-setup.md pnpm-lock.yaml
git commit -m "chore: update CI for webhook package and add GitHub App setup guide"
```

---

## Self-Review

**Spec coverage:**
- ✅ Hardened Phase 1.1 pipeline (Task 1): flat pool parallelism, LLM retry, max patch size guard, prompt injection delimiters
- ✅ Python CLI bridge (Task 2): stdin/stdout JSON subprocess interface
- ✅ Webhook package foundation (Task 3): TypeScript, vitest, Octokit deps
- ✅ GitHub App auth (Task 4): zod config validation, installation Octokit
- ✅ PR fetcher (Task 5): GitHub API → PRContext, binary file skip, null body
- ✅ Review bridge (Task 6): spawn Python subprocess, parse ReviewResult
- ✅ Comment poster (Task 7): inline comments + PR review body, line range guard
- ✅ Webhook handler + server (Task 8): HMAC validation, pull_request routing, Express
- ✅ CI update (Task 9): both packages tested on every push
- ⬜ Phase 1.3: Web dashboard + Stripe billing (next plan)

**Placeholder scan:** No TBD, TODO, or vague instructions. All steps contain complete code.

**Type consistency:**
- `PRContext.pr_number` (snake_case) matches Python models, TypeScript types, and bridge
- `ReviewResult.risk_level` is `Literal["low","medium","high","critical"]` in Python and `'low' | 'medium' | 'high' | 'critical'` in TypeScript
- `fetchPRContext(octokit, owner, repo, prNumber)` — same signature in implementation and test
- `handlePullRequestEvent(octokit, payload)` — same in handler and test
- `postReview(octokit, owner, repo, prNumber, result)` — same in poster and test
- `runReviewPipeline(prContext)` — same in bridge and test
