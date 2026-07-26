# Areté — Phase 1.1: Project Foundation & AI Agent Pipeline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Initialize the Areté monorepo and build a fully-tested Python AI agent pipeline that takes a GitHub PR diff as input and returns structured code review comments from three specialized agents running in parallel.

**Architecture:** pnpm monorepo with two packages — `packages/agents` (Python/LangGraph) and `packages/webhook` (TypeScript/Node.js, built in Plan 1.2). The agent pipeline accepts a `PRContext` object and produces `ReviewResult` containing inline comments and a PR summary. LLM provider is swappable via a single env var: `LLM_PROVIDER=gemini` (free/dev) or `LLM_PROVIDER=anthropic` (production). Agents run in parallel via Python `ThreadPoolExecutor`.

**Tech Stack:** Python 3.12, uv, langchain-google-genai (Gemini 2.5 Flash), langchain-anthropic (Claude claude-opus-4-8), pydantic 2.x, pydantic-settings, pytest, pytest-asyncio, Docker Compose (PostgreSQL 16 + Redis 7), pnpm 9

## Global Constraints

- Python managed exclusively by `uv` — never `pip install` directly
- Node.js package manager: `pnpm` — never `npm install` inside packages
- All secrets in `.env` only — `.env` is in `.gitignore`, never committed
- TDD strictly enforced: write the failing test before writing the implementation
- Git commits use conventional format: `feat:`, `fix:`, `test:`, `chore:`, `docs:`
- Brand/product name: Areté. Code identifiers use `arete` (no accent in code)
- Free LLM during development: Gemini 2.5 Flash (`gemini-2.5-flash`)
- Production LLM: `claude-opus-4-8` via Anthropic SDK (swapped via `LLM_PROVIDER=anthropic`)
- Python minimum version: 3.12
- All agent prompts instruct the LLM to return **only valid JSON** — never freeform text
- Every PR file review is isolated: agents receive one file at a time, results merged by orchestrator

---

## File Structure

```
arete/                              <- monorepo root (C:\Users\strol\OneDrive\Desktop\TYME)
|- packages/
|  |- agents/                       <- Python LangGraph agent pipeline
|  |  |- src/
|  |  |  `- arete_agents/
|  |  |     |- __init__.py
|  |  |     |- config.py            <- env/settings via pydantic-settings
|  |  |     |- llm/
|  |  |     |  |- __init__.py
|  |  |     |  |- base.py           <- get_llm() factory (LangChain BaseChatModel)
|  |  |     |  |- gemini.py         <- ChatGoogleGenerativeAI provider
|  |  |     |  `- anthropic.py      <- ChatAnthropic provider
|  |  |     |- models/
|  |  |     |  |- __init__.py
|  |  |     |  |- pr.py             <- PRContext, FileChange
|  |  |     |  `- review.py         <- ReviewComment, FileReview, ReviewResult
|  |  |     |- agents/
|  |  |     |  |- __init__.py
|  |  |     |  |- base.py           <- BaseReviewAgent ABC
|  |  |     |  |- security.py       <- SecurityAgent
|  |  |     |  |- performance.py    <- PerformanceAgent
|  |  |     |  `- quality.py        <- QualityAgent
|  |  |     `- orchestrator.py      <- Parallel ReviewOrchestrator
|  |  |- tests/
|  |  |  |- conftest.py             <- shared fixtures
|  |  |  |- test_config.py
|  |  |  |- test_llm.py
|  |  |  |- test_models.py
|  |  |  |- test_agents.py
|  |  |  |- test_orchestrator.py
|  |  |  `- test_e2e_smoke.py       <- real API, skipped in CI
|  |  `- pyproject.toml
|  `- webhook/                      <- TypeScript webhook (Plan 1.2)
|     `- .gitkeep
|- infra/
|  `- docker-compose.yml            <- PostgreSQL 16 + Redis 7
|- .github/
|  `- workflows/
|     `- ci.yml
|- .env.example
|- .gitignore
|- pnpm-workspace.yaml
`- package.json
```

---

## Task 1: Monorepo Foundation

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `infra/docker-compose.yml`
- Create: `.github/workflows/ci.yml`
- Create: `packages/agents/pyproject.toml`
- Create: `packages/webhook/.gitkeep`

**Interfaces:**
- Produces: runnable `pnpm install`, `docker compose up -d`, and `uv run pytest` from repo root
- Produces: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `LLM_PROVIDER`, `DATABASE_URL`, `REDIS_URL` documented in `.env.example`

- [ ] **Step 1: Initialize git**

Open a terminal in `C:\Users\strol\OneDrive\Desktop\TYME` and run:

```powershell
git init
git checkout -b main
```

- [ ] **Step 2: Create pnpm workspace config**

Create `pnpm-workspace.yaml`:
```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 3: Create root package.json**

Create `package.json`:
```json
{
  "name": "arete",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev:webhook": "pnpm --filter webhook dev",
    "test:webhook": "pnpm --filter webhook test",
    "infra:up": "docker compose -f infra/docker-compose.yml up -d",
    "infra:down": "docker compose -f infra/docker-compose.yml down"
  },
  "packageManager": "pnpm@9.15.9"
}
```

- [ ] **Step 4: Create .gitignore**

Create `.gitignore`:
```
# Environment
.env
.env.local
*.env

# Python
__pycache__/
*.pyc
*.pyo
.venv/
.pytest_cache/
*.egg-info/
dist/
.ruff_cache/

# Node
node_modules/
.next/
out/

# OS
.DS_Store
Thumbs.db

# IDE
.vscode/settings.json
.idea/
*.swp
```

- [ ] **Step 5: Create .env.example**

Create `.env.example`:
```bash
# LLM Provider: "gemini" (free, dev) or "anthropic" (production)
LLM_PROVIDER=gemini

# Gemini API Key -- get free key at aistudio.google.com
GEMINI_API_KEY=your_gemini_api_key_here

# Anthropic API Key -- production only
ANTHROPIC_API_KEY=your_anthropic_api_key_here

# Database (Docker Compose provides this locally)
DATABASE_URL=postgresql://arete:arete@localhost:5432/arete

# Redis (Docker Compose provides this locally)
REDIS_URL=redis://localhost:6379

# GitHub App (Phase 1.2 -- leave blank for now)
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY_PATH=
GITHUB_WEBHOOK_SECRET=
```

- [ ] **Step 6: Copy .env.example and fill in your Gemini key**

```powershell
Copy-Item .env.example .env
```

Open `.env` and replace `your_gemini_api_key_here` with your key from aistudio.google.com (free — sign in with Google, click "Get API key").

- [ ] **Step 7: Create Docker Compose for local infrastructure**

Create `infra/docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: arete
      POSTGRES_PASSWORD: arete
      POSTGRES_DB: arete
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U arete"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
  redis_data:
```

- [ ] **Step 8: Initialize the Python package**

```powershell
New-Item -ItemType Directory -Force packages/agents
New-Item -ItemType Directory -Force packages/webhook
"" | Out-File packages/webhook/.gitkeep
cd packages/agents
uv init --package --name arete-agents --python 3.12
cd ../..
```

Then replace all of `packages/agents/pyproject.toml` with:
```toml
[project]
name = "arete-agents"
version = "0.1.0"
description = "Arete AI code review agent pipeline"
requires-python = ">=3.12"
dependencies = [
    "langchain-google-genai>=2.1.0",
    "langchain-anthropic>=0.3.0",
    "langchain-core>=0.3.0",
    "pydantic>=2.9.0",
    "pydantic-settings>=2.6.0",
    "python-dotenv>=1.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.3.0",
    "pytest-asyncio>=0.24.0",
    "pytest-mock>=3.14.0",
    "ruff>=0.8.0",
]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]

[tool.ruff.lint]
select = ["E", "F", "I"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/arete_agents"]
```

- [ ] **Step 9: Install Python dependencies**

```powershell
cd packages/agents
uv sync --extra dev
```

Expected: uv resolves and installs all packages into `.venv/`.

- [ ] **Step 10: Create package directory structure**

```powershell
New-Item -ItemType Directory -Force src/arete_agents/llm
New-Item -ItemType Directory -Force src/arete_agents/models
New-Item -ItemType Directory -Force src/arete_agents/agents
New-Item -ItemType Directory -Force tests
"" | Out-File src/arete_agents/__init__.py
"" | Out-File src/arete_agents/llm/__init__.py
"" | Out-File src/arete_agents/models/__init__.py
"" | Out-File src/arete_agents/agents/__init__.py
"" | Out-File tests/__init__.py
```

- [ ] **Step 11: Create CI workflow**

Create `.github/workflows/ci.yml`:
```yaml
name: CI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test-agents:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: packages/agents

    steps:
      - uses: actions/checkout@v4

      - uses: astral-sh/setup-uv@v4
        with:
          python-version: "3.12"

      - run: uv sync --extra dev

      - run: uv run ruff check src/ tests/

      - run: uv run pytest tests/ -v --ignore=tests/test_e2e_smoke.py
        env:
          LLM_PROVIDER: gemini
          GEMINI_API_KEY: test-key-not-real
```

- [ ] **Step 12: Verify imports**

```powershell
cd packages/agents
uv run python -c "import langchain_google_genai; import langchain_anthropic; import pydantic; print('All imports OK')"
```

Expected: `All imports OK`

- [ ] **Step 13: Initial commit**

From repo root:
```powershell
cd ..\..
git add .
git commit -m "chore: initialize Arete monorepo with Python agents package and Docker infra"
```

---

## Task 2: Configuration & Settings

**Files:**
- Create: `packages/agents/src/arete_agents/config.py`
- Create: `packages/agents/tests/test_config.py`

**Interfaces:**
- Produces: `get_settings() -> Settings` — call at app startup, returns validated config object
- Produces: `Settings.llm_provider: Literal["gemini", "anthropic"]`
- Produces: `Settings.gemini_api_key: str`
- Produces: `Settings.anthropic_api_key: str`

- [ ] **Step 1: Write the failing tests**

Create `packages/agents/tests/test_config.py`:
```python
import pytest
from unittest.mock import patch


def test_settings_loads_gemini_provider():
    with patch.dict("os.environ", {"LLM_PROVIDER": "gemini", "GEMINI_API_KEY": "test-key"}):
        from arete_agents.config import get_settings
        get_settings.cache_clear()
        settings = get_settings()
        assert settings.llm_provider == "gemini"
        assert settings.gemini_api_key == "test-key"


def test_settings_loads_anthropic_provider():
    with patch.dict("os.environ", {
        "LLM_PROVIDER": "anthropic",
        "ANTHROPIC_API_KEY": "sk-ant-test",
        "GEMINI_API_KEY": "",
    }):
        from arete_agents.config import get_settings
        get_settings.cache_clear()
        settings = get_settings()
        assert settings.llm_provider == "anthropic"
        assert settings.anthropic_api_key == "sk-ant-test"


def test_settings_gemini_requires_api_key():
    with patch.dict("os.environ", {"LLM_PROVIDER": "gemini", "GEMINI_API_KEY": ""}):
        from arete_agents.config import get_settings
        get_settings.cache_clear()
        with pytest.raises(Exception):
            get_settings()
```

- [ ] **Step 2: Run test to confirm it fails**

```powershell
cd packages/agents
uv run pytest tests/test_config.py -v
```

Expected: `FAILED` with `ImportError: cannot import name 'get_settings'`

- [ ] **Step 3: Implement config**

Create `packages/agents/src/arete_agents/config.py`:
```python
from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    llm_provider: Literal["gemini", "anthropic"] = "gemini"
    gemini_api_key: str = ""
    anthropic_api_key: str = ""

    database_url: str = "postgresql://arete:arete@localhost:5432/arete"
    redis_url: str = "redis://localhost:6379"

    @field_validator("gemini_api_key")
    @classmethod
    def gemini_key_required(cls, v: str, info) -> str:
        if info.data.get("llm_provider") == "gemini" and not v:
            raise ValueError("GEMINI_API_KEY is required when LLM_PROVIDER=gemini")
        return v

    @field_validator("anthropic_api_key")
    @classmethod
    def anthropic_key_required(cls, v: str, info) -> str:
        if info.data.get("llm_provider") == "anthropic" and not v:
            raise ValueError("ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic")
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 4: Run tests to confirm they pass**

```powershell
uv run pytest tests/test_config.py -v
```

Expected: `3 passed`

- [ ] **Step 5: Commit**

```powershell
git add packages/agents/src/arete_agents/config.py packages/agents/tests/test_config.py
git commit -m "feat(agents): add pydantic-settings config with LLM provider validation"
```

---

## Task 3: Data Models

**Files:**
- Create: `packages/agents/src/arete_agents/models/pr.py`
- Create: `packages/agents/src/arete_agents/models/review.py`
- Create: `packages/agents/tests/test_models.py`

**Interfaces:**
- Produces: `FileChange(path: str, patch: str, additions: int, deletions: int)` with computed `language: str`
- Produces: `PRContext(repo: str, pr_number: int, title: str, description: str, files: list[FileChange])`
- Produces: `ReviewComment(path: str, line: int, body: str, severity: Literal["info","warning","error"], category: str)`
- Produces: `FileReview(path: str, comments: list[ReviewComment], summary: str)`
- Produces: `ReviewResult(pr_context: PRContext, file_reviews: list[FileReview], overall_summary: str, risk_level: Literal["low","medium","high","critical"])` with computed `total_comments: int`

- [ ] **Step 1: Write the failing tests**

Create `packages/agents/tests/test_models.py`:
```python
import pytest
from arete_agents.models.pr import PRContext, FileChange
from arete_agents.models.review import ReviewComment, FileReview, ReviewResult


def test_file_change_detects_python_language():
    fc = FileChange(path="src/auth.py", patch="+def login():\n+    pass", additions=2, deletions=0)
    assert fc.language == "python"


def test_file_change_detects_typescript():
    fc = FileChange(path="src/api/routes.ts", patch="+export const handler", additions=1, deletions=0)
    assert fc.language == "typescript"


def test_file_change_unknown_extension_is_other():
    fc = FileChange(path="Makefile", patch="+build:", additions=1, deletions=0)
    assert fc.language == "other"


def test_pr_context_holds_files():
    ctx = PRContext(
        repo="acme/api",
        pr_number=42,
        title="Add payment endpoint",
        description="Implements Stripe checkout",
        files=[FileChange(path="src/payments.py", patch="+def charge():\n+    pass", additions=2, deletions=0)],
    )
    assert len(ctx.files) == 1
    assert ctx.files[0].path == "src/payments.py"


def test_review_comment_rejects_invalid_severity():
    with pytest.raises(Exception):
        ReviewComment(path="src/auth.py", line=10, body="Bad", severity="critical_bad", category="security")


def test_review_result_computes_total_comments():
    from arete_agents.models.pr import PRContext
    result = ReviewResult(
        pr_context=PRContext(repo="r/r", pr_number=1, title="t", description="d", files=[]),
        file_reviews=[
            FileReview(path="a.py", comments=[
                ReviewComment(path="a.py", line=1, body="Issue", severity="error", category="security"),
                ReviewComment(path="a.py", line=5, body="Note", severity="info", category="quality"),
            ], summary="Two issues"),
        ],
        overall_summary="Found 2 issues",
        risk_level="medium",
    )
    assert result.total_comments == 2
```

- [ ] **Step 2: Run to confirm failure**

```powershell
uv run pytest tests/test_models.py -v
```

Expected: `FAILED` with `ImportError`

- [ ] **Step 3: Implement PR models**

Create `packages/agents/src/arete_agents/models/pr.py`:
```python
from pydantic import BaseModel, computed_field

_EXTENSION_MAP: dict[str, str] = {
    ".py": "python", ".ts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".jsx": "javascript", ".go": "go",
    ".rs": "rust", ".java": "java", ".rb": "ruby", ".php": "php",
    ".cs": "csharp", ".cpp": "cpp", ".c": "c", ".sql": "sql", ".sh": "shell",
}


class FileChange(BaseModel):
    path: str
    patch: str
    additions: int
    deletions: int

    @computed_field
    @property
    def language(self) -> str:
        suffix = "." + self.path.rsplit(".", 1)[-1] if "." in self.path else ""
        return _EXTENSION_MAP.get(suffix, "other")


class PRContext(BaseModel):
    repo: str
    pr_number: int
    title: str
    description: str
    files: list[FileChange]
```

- [ ] **Step 4: Implement Review models**

Create `packages/agents/src/arete_agents/models/review.py`:
```python
from __future__ import annotations
from typing import TYPE_CHECKING, Literal
from pydantic import BaseModel, computed_field

if TYPE_CHECKING:
    from arete_agents.models.pr import PRContext


class ReviewComment(BaseModel):
    path: str
    line: int
    body: str
    severity: Literal["info", "warning", "error"]
    category: str


class FileReview(BaseModel):
    path: str
    comments: list[ReviewComment]
    summary: str


class ReviewResult(BaseModel):
    pr_context: PRContext
    file_reviews: list[FileReview]
    overall_summary: str
    risk_level: Literal["low", "medium", "high", "critical"]

    @computed_field
    @property
    def total_comments(self) -> int:
        return sum(len(fr.comments) for fr in self.file_reviews)
```

- [ ] **Step 5: Run tests**

```powershell
uv run pytest tests/test_models.py -v
```

Expected: `6 passed`

- [ ] **Step 6: Commit**

```powershell
git add packages/agents/src/arete_agents/models/ packages/agents/tests/test_models.py
git commit -m "feat(agents): add PRContext and ReviewResult data models with computed fields"
```

---

## Task 4: LLM Abstraction Layer

**Files:**
- Create: `packages/agents/src/arete_agents/llm/base.py`
- Create: `packages/agents/src/arete_agents/llm/gemini.py`
- Create: `packages/agents/src/arete_agents/llm/anthropic.py`
- Create: `packages/agents/tests/test_llm.py`

**Interfaces:**
- Consumes: `Settings` from Task 2
- Produces: `get_llm(settings: Settings) -> BaseChatModel` — returns a LangChain-compatible chat model
- Produces: The returned model responds to `.invoke([SystemMessage(...), HumanMessage(...)])` returning `AIMessage`

- [ ] **Step 1: Write failing tests**

Create `packages/agents/tests/test_llm.py`:
```python
import pytest
from unittest.mock import MagicMock


def test_get_llm_returns_gemini_when_provider_gemini():
    from arete_agents.config import get_settings
    get_settings.cache_clear()

    import os
    os.environ["LLM_PROVIDER"] = "gemini"
    os.environ["GEMINI_API_KEY"] = "test-key"

    from arete_agents.llm.base import get_llm
    llm = get_llm(get_settings())
    module = type(llm).__module__
    assert "google" in module.lower() or "gemini" in type(llm).__name__.lower()


def test_get_llm_returns_anthropic_when_provider_anthropic():
    from arete_agents.config import get_settings
    get_settings.cache_clear()

    import os
    os.environ["LLM_PROVIDER"] = "anthropic"
    os.environ["ANTHROPIC_API_KEY"] = "sk-ant-test"
    os.environ["GEMINI_API_KEY"] = ""

    from arete_agents.llm.base import get_llm
    llm = get_llm(get_settings())
    assert "anthropic" in type(llm).__module__.lower()


def test_get_llm_raises_on_unknown_provider():
    from arete_agents.llm.base import get_llm
    mock_settings = MagicMock()
    mock_settings.llm_provider = "openai"
    with pytest.raises(ValueError, match="Unknown LLM provider"):
        get_llm(mock_settings)
```

- [ ] **Step 2: Run to confirm failure**

```powershell
uv run pytest tests/test_llm.py -v
```

Expected: `FAILED` with `ImportError`

- [ ] **Step 3: Implement Gemini provider**

Create `packages/agents/src/arete_agents/llm/gemini.py`:
```python
from langchain_google_genai import ChatGoogleGenerativeAI


def build_gemini_llm(api_key: str) -> ChatGoogleGenerativeAI:
    return ChatGoogleGenerativeAI(
        model="gemini-2.5-flash",
        google_api_key=api_key,
        temperature=0.1,
        max_tokens=8192,
    )
```

- [ ] **Step 4: Implement Anthropic provider**

Create `packages/agents/src/arete_agents/llm/anthropic.py`:
```python
from langchain_anthropic import ChatAnthropic


def build_anthropic_llm(api_key: str) -> ChatAnthropic:
    return ChatAnthropic(
        model="claude-opus-4-8",
        api_key=api_key,
        temperature=0.1,
        max_tokens=8192,
    )
```

- [ ] **Step 5: Implement LLM factory**

Create `packages/agents/src/arete_agents/llm/base.py`:
```python
from langchain_core.language_models import BaseChatModel
from arete_agents.config import Settings


def get_llm(settings: Settings) -> BaseChatModel:
    if settings.llm_provider == "gemini":
        from arete_agents.llm.gemini import build_gemini_llm
        return build_gemini_llm(settings.gemini_api_key)
    elif settings.llm_provider == "anthropic":
        from arete_agents.llm.anthropic import build_anthropic_llm
        return build_anthropic_llm(settings.anthropic_api_key)
    else:
        raise ValueError(f"Unknown LLM provider: {settings.llm_provider!r}")
```

- [ ] **Step 6: Run tests**

```powershell
uv run pytest tests/test_llm.py -v
```

Expected: `3 passed`

- [ ] **Step 7: Commit**

```powershell
git add packages/agents/src/arete_agents/llm/ packages/agents/tests/test_llm.py
git commit -m "feat(agents): add LLM abstraction supporting Gemini 2.5 Flash and Claude claude-opus-4-8"
```

---

## Task 5: Base Agent Framework & SecurityAgent

**Files:**
- Create: `packages/agents/src/arete_agents/agents/base.py`
- Create: `packages/agents/src/arete_agents/agents/security.py`
- Create: `packages/agents/tests/test_agents.py`

**Interfaces:**
- Consumes: `BaseChatModel` from Task 4, `FileChange`/`PRContext` from Task 3, `FileReview`/`ReviewComment` from Task 3
- Produces: `BaseReviewAgent(llm: BaseChatModel)` — abstract class, cannot instantiate directly
- Produces: `BaseReviewAgent.review_file(file: FileChange, pr_context: PRContext) -> FileReview`
- Produces: `SecurityAgent(llm: BaseChatModel)` — concrete, `agent_name == "security"`

- [ ] **Step 1: Write failing tests**

Create `packages/agents/tests/test_agents.py`:
```python
import pytest
from unittest.mock import MagicMock
from langchain_core.messages import AIMessage

from arete_agents.models.pr import PRContext, FileChange
from arete_agents.models.review import FileReview


def make_mock_llm(json_response: str):
    mock = MagicMock()
    mock.invoke.return_value = AIMessage(content=json_response)
    return mock


def make_file(path: str = "src/auth.py", patch: str = "+def login():\n+    return True") -> FileChange:
    return FileChange(path=path, patch=patch, additions=2, deletions=0)


def make_pr(files: list[FileChange] | None = None) -> PRContext:
    return PRContext(repo="acme/api", pr_number=1, title="Add login", description="Adds auth", files=files or [make_file()])


def test_base_agent_is_abstract():
    from arete_agents.agents.base import BaseReviewAgent
    with pytest.raises(TypeError):
        BaseReviewAgent(llm=MagicMock())


def test_security_agent_returns_file_review():
    from arete_agents.agents.security import SecurityAgent
    mock_llm = make_mock_llm('{"comments": [{"path": "src/auth.py", "line": 1, "body": "SQL injection risk.", "severity": "error", "category": "security"}], "summary": "SQL injection found."}')
    agent = SecurityAgent(llm=mock_llm)
    result = agent.review_file(make_file(), make_pr())
    assert isinstance(result, FileReview)
    assert len(result.comments) == 1
    assert result.comments[0].severity == "error"
    assert result.comments[0].category == "security"


def test_agent_handles_empty_comments():
    from arete_agents.agents.security import SecurityAgent
    mock_llm = make_mock_llm('{"comments": [], "summary": "No security issues."}')
    agent = SecurityAgent(llm=mock_llm)
    result = agent.review_file(make_file(), make_pr())
    assert result.comments == []


def test_agent_handles_invalid_json_gracefully():
    from arete_agents.agents.security import SecurityAgent
    mock_llm = make_mock_llm("Sorry, I cannot help with this.")
    agent = SecurityAgent(llm=mock_llm)
    result = agent.review_file(make_file(), make_pr())
    assert isinstance(result, FileReview)
    assert result.comments == []
    assert "error" in result.summary.lower() or "parse" in result.summary.lower()
```

- [ ] **Step 2: Run to confirm failure**

```powershell
uv run pytest tests/test_agents.py -v
```

Expected: `FAILED` with `ImportError`

- [ ] **Step 3: Implement BaseReviewAgent**

Create `packages/agents/src/arete_agents/agents/base.py`:
```python
import json
import re
from abc import ABC, abstractmethod

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage

from arete_agents.models.pr import FileChange, PRContext
from arete_agents.models.review import FileReview, ReviewComment


class BaseReviewAgent(ABC):
    @property
    @abstractmethod
    def agent_name(self) -> str: ...

    @property
    @abstractmethod
    def system_prompt(self) -> str: ...

    def __init__(self, llm: BaseChatModel) -> None:
        self._llm = llm

    def _build_user_prompt(self, file: FileChange, pr: PRContext) -> str:
        return f"""Review this pull request file for {self.agent_name} issues.

PR: "{pr.title}" in {pr.repo}
Description: {pr.description}
File: {file.path} ({file.language})

Diff:
```diff
{file.patch}
```

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
            clean = re.sub(r"```(?:json)?\n?", "", raw).strip().rstrip("`").strip()
            data = json.loads(clean)
            comments = [ReviewComment(**c) for c in data.get("comments", [])]
            return comments, data.get("summary", "")
        except Exception as exc:
            return [], f"Failed to parse agent response: {exc}"

    def review_file(self, file: FileChange, pr: PRContext) -> FileReview:
        messages = [
            SystemMessage(content=self.system_prompt),
            HumanMessage(content=self._build_user_prompt(file, pr)),
        ]
        response = self._llm.invoke(messages)
        comments, summary = self._parse_response(file.path, response.content)
        return FileReview(path=file.path, comments=comments, summary=summary)
```

- [ ] **Step 4: Implement SecurityAgent**

Create `packages/agents/src/arete_agents/agents/security.py`:
```python
from arete_agents.agents.base import BaseReviewAgent


class SecurityAgent(BaseReviewAgent):
    @property
    def agent_name(self) -> str:
        return "security"

    @property
    def system_prompt(self) -> str:
        return """You are a senior security engineer performing a code security review.

Identify security vulnerabilities including:
- OWASP Top 10: SQL injection, XSS, broken authentication, insecure deserialization
- Hardcoded secrets, API keys, or passwords in code
- Weak cryptography (MD5/SHA1 for passwords, weak random generation)
- Missing input validation or sanitization
- Unsafe file operations or path traversal risks
- Missing authentication or authorization checks

Only flag real, exploitable issues. Include the exact line and a concrete fix."""
```

- [ ] **Step 5: Run tests**

```powershell
uv run pytest tests/test_agents.py -v
```

Expected: `4 passed`

- [ ] **Step 6: Commit**

```powershell
git add packages/agents/src/arete_agents/agents/base.py packages/agents/src/arete_agents/agents/security.py packages/agents/tests/test_agents.py
git commit -m "feat(agents): add BaseReviewAgent with JSON parsing and SecurityAgent"
```

---

## Task 6: Performance & Quality Agents

**Files:**
- Create: `packages/agents/src/arete_agents/agents/performance.py`
- Create: `packages/agents/src/arete_agents/agents/quality.py`
- Modify: `packages/agents/tests/test_agents.py` (append two test functions)

**Interfaces:**
- Consumes: `BaseReviewAgent` from Task 5
- Produces: `PerformanceAgent(llm) -> BaseReviewAgent` with `agent_name == "performance"`
- Produces: `QualityAgent(llm) -> BaseReviewAgent` with `agent_name == "quality"`

- [ ] **Step 1: Add tests for PerformanceAgent and QualityAgent**

Append to the bottom of `packages/agents/tests/test_agents.py`:
```python
def test_performance_agent_returns_file_review():
    from arete_agents.agents.performance import PerformanceAgent
    mock_llm = make_mock_llm(
        '{"comments": [{"path": "src/orders.py", "line": 12, "body": "N+1 query in loop.", "severity": "warning", "category": "performance"}], "summary": "N+1 found."}'
    )
    agent = PerformanceAgent(llm=mock_llm)
    file = FileChange(path="src/orders.py", patch="+for o in orders:\n+    print(o.user.name)", additions=2, deletions=0)
    result = agent.review_file(file, make_pr([file]))
    assert result.comments[0].category == "performance"
    assert result.comments[0].severity == "warning"


def test_quality_agent_returns_file_review():
    from arete_agents.agents.quality import QualityAgent
    mock_llm = make_mock_llm(
        '{"comments": [{"path": "src/utils.py", "line": 3, "body": "Name x is unclear.", "severity": "info", "category": "quality"}], "summary": "Naming issue."}'
    )
    agent = QualityAgent(llm=mock_llm)
    file = FileChange(path="src/utils.py", patch="+x = get_user()", additions=1, deletions=0)
    result = agent.review_file(file, make_pr([file]))
    assert result.comments[0].category == "quality"
```

- [ ] **Step 2: Run new tests to confirm they fail**

```powershell
uv run pytest tests/test_agents.py::test_performance_agent_returns_file_review tests/test_agents.py::test_quality_agent_returns_file_review -v
```

Expected: `FAILED` with `ImportError`

- [ ] **Step 3: Implement PerformanceAgent**

Create `packages/agents/src/arete_agents/agents/performance.py`:
```python
from arete_agents.agents.base import BaseReviewAgent


class PerformanceAgent(BaseReviewAgent):
    @property
    def agent_name(self) -> str:
        return "performance"

    @property
    def system_prompt(self) -> str:
        return """You are a senior performance engineer performing a code performance review.

Identify performance issues including:
- N+1 database query patterns (queries inside loops — use batch fetch or ORM join)
- Missing database indexes implied by new WHERE clause patterns
- Unnecessary network calls or missing request batching
- Memory leaks (unclosed resources, unbounded collection growth)
- Algorithmic regressions (O(n^2) where O(n) is achievable)
- Blocking I/O in async contexts
- Large object allocation inside hot loops

Quantify impact when possible: "adds one DB query per loop iteration at scale"."""
```

- [ ] **Step 4: Implement QualityAgent**

Create `packages/agents/src/arete_agents/agents/quality.py`:
```python
from arete_agents.agents.base import BaseReviewAgent


class QualityAgent(BaseReviewAgent):
    @property
    def agent_name(self) -> str:
        return "quality"

    @property
    def system_prompt(self) -> str:
        return """You are a senior software engineer performing a code quality review.

Identify quality issues including:
- Unclear variable, function, or class names that obscure intent
- Functions doing more than one thing (violates single responsibility)
- Dead code, commented-out blocks, or unused imports
- Bare except clauses or swallowed exceptions without logging
- Complex nested logic that can be flattened or extracted
- Missing edge case handling (null input, empty collections, boundary values)
- Magic numbers or strings that should be named constants
- Duplicated logic that should be a shared function

Be constructive: suggest the specific improvement, not just the problem."""
```

- [ ] **Step 5: Run all agent tests**

```powershell
uv run pytest tests/test_agents.py -v
```

Expected: `6 passed`

- [ ] **Step 6: Commit**

```powershell
git add packages/agents/src/arete_agents/agents/performance.py packages/agents/src/arete_agents/agents/quality.py packages/agents/tests/test_agents.py
git commit -m "feat(agents): add PerformanceAgent and QualityAgent"
```

---

## Task 7: Parallel Orchestrator

**Files:**
- Create: `packages/agents/src/arete_agents/orchestrator.py`
- Create: `packages/agents/tests/conftest.py`
- Create: `packages/agents/tests/test_orchestrator.py`

**Interfaces:**
- Consumes: `SecurityAgent`, `PerformanceAgent`, `QualityAgent` from Tasks 5-6; `PRContext` from Task 3; `BaseChatModel` from Task 4
- Produces: `ReviewOrchestrator(llm: BaseChatModel)`
- Produces: `ReviewOrchestrator.run(pr_context: PRContext) -> ReviewResult`

- [ ] **Step 1: Create shared test fixtures**

Create `packages/agents/tests/conftest.py`:
```python
import pytest
from unittest.mock import MagicMock
from langchain_core.messages import AIMessage
from arete_agents.models.pr import PRContext, FileChange

SEC = '{"comments": [{"path": "src/auth.py", "line": 5, "body": "SQL injection.", "severity": "error", "category": "security"}], "summary": "SQL injection."}'
PERF = '{"comments": [], "summary": "No performance issues."}'
QUAL = '{"comments": [{"path": "src/auth.py", "line": 2, "body": "Use snake_case.", "severity": "info", "category": "quality"}], "summary": "Naming issue."}'


@pytest.fixture
def sample_pr():
    return PRContext(
        repo="acme/api", pr_number=7, title="Fix login", description="Addresses auth bug",
        files=[FileChange(path="src/auth.py", patch="+SELECT * FROM users WHERE id='"+"+user_id", additions=1, deletions=0)],
    )


@pytest.fixture
def cyclic_llm():
    mock = MagicMock()
    mock.invoke.side_effect = [AIMessage(content=r) for r in [SEC, PERF, QUAL] * 20]
    return mock
```

- [ ] **Step 2: Write failing orchestrator tests**

Create `packages/agents/tests/test_orchestrator.py`:
```python
from arete_agents.models.review import ReviewResult


def test_orchestrator_returns_review_result(sample_pr, cyclic_llm):
    from arete_agents.orchestrator import ReviewOrchestrator
    result = ReviewOrchestrator(llm=cyclic_llm).run(sample_pr)
    assert isinstance(result, ReviewResult)
    assert result.pr_context.pr_number == 7


def test_orchestrator_reviews_all_files(sample_pr, cyclic_llm):
    from arete_agents.orchestrator import ReviewOrchestrator
    result = ReviewOrchestrator(llm=cyclic_llm).run(sample_pr)
    reviewed = {fr.path for fr in result.file_reviews}
    expected = {f.path for f in sample_pr.files}
    assert reviewed == expected


def test_orchestrator_merges_comments_from_all_agents(sample_pr, cyclic_llm):
    from arete_agents.orchestrator import ReviewOrchestrator
    result = ReviewOrchestrator(llm=cyclic_llm).run(sample_pr)
    categories = {c.category for fr in result.file_reviews for c in fr.comments}
    assert "security" in categories
    assert "quality" in categories


def test_orchestrator_sets_risk_level(sample_pr, cyclic_llm):
    from arete_agents.orchestrator import ReviewOrchestrator
    result = ReviewOrchestrator(llm=cyclic_llm).run(sample_pr)
    assert result.risk_level in ("low", "medium", "high", "critical")


def test_orchestrator_handles_empty_pr(cyclic_llm):
    from arete_agents.orchestrator import ReviewOrchestrator
    from arete_agents.models.pr import PRContext
    empty = PRContext(repo="x/y", pr_number=1, title="Empty", description="", files=[])
    result = ReviewOrchestrator(llm=cyclic_llm).run(empty)
    assert result.file_reviews == []
    assert result.total_comments == 0
```

- [ ] **Step 3: Run to confirm failure**

```powershell
uv run pytest tests/test_orchestrator.py -v
```

Expected: `FAILED` with `ImportError`

- [ ] **Step 4: Implement the orchestrator**

Create `packages/agents/src/arete_agents/orchestrator.py`:
```python
from concurrent.futures import ThreadPoolExecutor, as_completed

from langchain_core.language_models import BaseChatModel

from arete_agents.agents.performance import PerformanceAgent
from arete_agents.agents.quality import QualityAgent
from arete_agents.agents.security import SecurityAgent
from arete_agents.models.pr import FileChange, PRContext
from arete_agents.models.review import FileReview, ReviewResult

_SEVERITY_WEIGHT = {"error": 3, "warning": 2, "info": 1}


def _risk_level(file_reviews: list[FileReview]) -> str:
    all_comments = [c for fr in file_reviews for c in fr.comments]
    if not all_comments:
        return "low"
    max_weight = max(_SEVERITY_WEIGHT.get(c.severity, 0) for c in all_comments)
    error_count = sum(1 for c in all_comments if c.severity == "error")
    if error_count >= 3 or (max_weight == 3 and error_count >= 2):
        return "critical"
    if max_weight == 3:
        return "high"
    if max_weight == 2:
        return "medium"
    return "low"


def _merge_reviews(reviews_per_agent: list[list[FileReview]]) -> list[FileReview]:
    merged: dict[str, tuple[list, list[str]]] = {}
    for agent_reviews in reviews_per_agent:
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

    def _review_file(self, file: FileChange, pr: PRContext) -> list[FileReview]:
        results: list[FileReview] = []
        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = {pool.submit(agent.review_file, file, pr): agent for agent in self._agents}
            for future in as_completed(futures):
                try:
                    results.append(future.result())
                except Exception as exc:
                    agent = futures[future]
                    results.append(FileReview(path=file.path, comments=[], summary=f"{agent.agent_name} error: {exc}"))
        return results

    def run(self, pr: PRContext) -> ReviewResult:
        if not pr.files:
            return ReviewResult(pr_context=pr, file_reviews=[], overall_summary="No files changed.", risk_level="low")

        all_reviews = [self._review_file(f, pr) for f in pr.files]
        file_reviews = _merge_reviews(all_reviews)
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

- [ ] **Step 5: Run all orchestrator tests**

```powershell
uv run pytest tests/test_orchestrator.py -v
```

Expected: `5 passed`

- [ ] **Step 6: Run full test suite**

```powershell
uv run pytest tests/ -v --ignore=tests/test_e2e_smoke.py
```

Expected: All non-smoke tests pass (approximately 21 passed)

- [ ] **Step 7: Run linter**

```powershell
uv run ruff check src/ tests/
```

Expected: No errors. Fix any before committing.

- [ ] **Step 8: Commit**

```powershell
git add packages/agents/src/arete_agents/orchestrator.py packages/agents/tests/conftest.py packages/agents/tests/test_orchestrator.py
git commit -m "feat(agents): add parallel ReviewOrchestrator merging all three agents"
```

---

## Task 8: End-to-End Smoke Test with Real Gemini API

**Files:**
- Create: `packages/agents/tests/test_e2e_smoke.py`

**Interfaces:**
- Consumes: Complete pipeline from Tasks 1-7
- Produces: Verified real output from Gemini 2.5 Flash reviewing an intentionally vulnerable code sample

> This test calls the real Gemini API and is skipped in CI to avoid costs. Run it locally to verify the full pipeline works.

- [ ] **Step 1: Write the smoke test**

Create `packages/agents/tests/test_e2e_smoke.py`:
```python
import os
import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("GEMINI_API_KEY") or os.getenv("CI") == "true",
    reason="Skipped: GEMINI_API_KEY not set or running in CI",
)


def test_full_pipeline_catches_sql_injection():
    """Verifies real Gemini API flags obvious SQL injection in a PR diff."""
    from arete_agents.config import get_settings
    from arete_agents.llm.base import get_llm
    from arete_agents.models.pr import FileChange, PRContext
    from arete_agents.orchestrator import ReviewOrchestrator

    get_settings.cache_clear()
    settings = get_settings()
    llm = get_llm(settings)
    orch = ReviewOrchestrator(llm=llm)

    pr = PRContext(
        repo="acme/demo",
        pr_number=1,
        title="Add user login endpoint",
        description="Implements login with database lookup",
        files=[
            FileChange(
                path="src/auth.py",
                patch=(
                    "+def login(username, password):\n"
                    "+    query = f\"SELECT * FROM users WHERE username='{username}' AND password='{password}'\"\n"
                    "+    return db.execute(query).fetchone()\n"
                ),
                additions=3,
                deletions=0,
            )
        ],
    )

    result = orch.run(pr)

    # SQL injection is obvious -- expect at least one error-level security comment
    error_comments = [c for fr in result.file_reviews for c in fr.comments if c.severity == "error"]

    print(f"\n--- Smoke Test Output ---")
    print(f"Risk Level: {result.risk_level.upper()}")
    print(f"Summary: {result.overall_summary}")
    for fr in result.file_reviews:
        for c in fr.comments:
            print(f"  [{c.severity.upper()}] {c.path}:{c.line} ({c.category})")
            print(f"    {c.body}")

    assert result.total_comments > 0, "Expected at least one comment on the SQL injection"
    assert len(error_comments) > 0, "Expected at least one error-severity comment for SQL injection"
    assert result.risk_level in ("high", "critical"), f"SQL injection should be high/critical, got {result.risk_level}"
```

- [ ] **Step 2: Run the smoke test**

```powershell
cd packages/agents
uv run pytest tests/test_e2e_smoke.py -v -s
```

Expected: `1 passed` with printed output showing Gemini's real review flagging the SQL injection.

This is your first real Areté code review. If the test passes, the entire agent pipeline is verified end-to-end.

- [ ] **Step 3: Commit**

```powershell
git add packages/agents/tests/test_e2e_smoke.py
git commit -m "test(agents): add E2E smoke test verifying Gemini catches SQL injection"
```

---

## Self-Review

**Spec coverage:**
- [x] Monorepo foundation (Task 1)
- [x] LLM abstraction — Gemini + Anthropic swappable (Task 4)
- [x] PR data models — PRContext, FileChange, FileReview, ReviewResult (Task 3)
- [x] SecurityAgent (Task 5)
- [x] PerformanceAgent (Task 6)
- [x] QualityAgent (Task 6)
- [x] Parallel orchestration with risk level computation (Task 7)
- [x] End-to-end verification with real LLM (Task 8)
- [x] CI/CD pipeline with lint + test (Task 1)
- [x] Docker Compose for local PostgreSQL + Redis (Task 1)
- [ ] GitHub App + webhook handler -- Plan 1.2
- [ ] GitHub PR comment posting -- Plan 1.2
- [ ] Web dashboard -- Plan 1.3
- [ ] Stripe billing -- Plan 1.3

**Placeholder scan:** None. All code steps contain complete, runnable implementations.

**Type consistency:**
- `FileChange` fields (`path`, `patch`, `additions`, `deletions`, `language`) used identically in models, agents, orchestrator, and all tests
- `ReviewComment.category` always set to `agent.agent_name` string — consistent across all three agents
- `ReviewResult.total_comments` computed via `@computed_field` — no manual counting elsewhere
- `BaseReviewAgent.review_file(file: FileChange, pr: PRContext) -> FileReview` — signature used identically in orchestrator and all tests

---

**Plan saved to:** `docs/superpowers/plans/2026-07-10-phase-1-1-foundation-agent-pipeline.md`

**Next plans:**
- `2026-07-10-phase-1-2-github-app-integration.md` — webhook handler + GitHub PR comment posting
- `2026-07-10-phase-1-3-dashboard-billing.md` — Next.js dashboard + Stripe
