# syntax=docker/dockerfile:1
#
# Areté agents service (Python/FastAPI, packages/agents).
#
# Build context is packages/agents itself (this service has no workspace
# dependency on @arete/db or any other package):
#
#   docker build -f packages/agents/Dockerfile -t arete-agents packages/agents
#
# Runtime config comes from env vars (see arete_agents/config.py / .env.example
# at the repo root): LLM_PROVIDER, GEMINI_API_KEY or ANTHROPIC_API_KEY,
# DATABASE_URL, REDIS_URL.

FROM python:3.12-slim AS base

# --- builder: resolve + install deps with uv, using the committed lockfile ---
FROM base AS builder

RUN pip install --no-cache-dir uv==0.11.19

WORKDIR /app

# Install dependencies first (cache-friendly): only pyproject.toml + uv.lock
# are needed to resolve the dependency graph.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Now copy source and install the project itself (editable installs are not
# useful in a container — this bakes arete_agents into the venv).
COPY src ./src
COPY README.md ./README.md
RUN uv sync --frozen --no-dev

# --- codebase-memory-mcp: pinned, checksum-verified binary fetch ---
# Standard (non-UI) binary only — this is what indexer.py drives as an MCP
# stdio server during reviews. The UI-variant binary is fetched separately
# in a later task.
FROM base AS cbm-binary

RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ARG CBM_VERSION=v0.9.0
ARG CBM_LINUX_AMD64_SHA256=e2832a8d207c26beaa30efa6222ed4a37cb3f526ca4bee060bfbf336ed6fc679

RUN curl -fsSL -o /tmp/cbm.tar.gz \
      "https://github.com/DeusData/codebase-memory-mcp/releases/download/${CBM_VERSION}/codebase-memory-mcp-linux-amd64.tar.gz" \
    && echo "${CBM_LINUX_AMD64_SHA256}  /tmp/cbm.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/cbm.tar.gz -C /tmp codebase-memory-mcp \
    && install -m 0755 /tmp/codebase-memory-mcp /usr/local/bin/codebase-memory-mcp \
    && rm -rf /tmp/cbm.tar.gz /tmp/codebase-memory-mcp

# --- final: minimal runtime image ---
FROM base AS final

RUN groupadd --system arete && useradd --system --gid arete --create-home arete

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY --from=builder /app/src /app/src
COPY --from=builder /app/pyproject.toml /app/pyproject.toml

COPY --from=cbm-binary /usr/local/bin/codebase-memory-mcp /usr/local/bin/codebase-memory-mcp

# Warm cache for per-installation clones + codebase-memory-mcp indexes.
# Not a volume (deliberately lightweight — no persistent storage tier in
# v1). Created (and owned by the non-root arete user) here, before USER
# arete below, since that user can't chown it itself.
RUN mkdir -p /app/.data/repos && chown -R arete:arete /app/.data

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    CBM_CACHE_DIR=/app/.data/cbm-cache

USER arete

EXPOSE 8000

CMD ["uvicorn", "arete_agents.server:app", "--host", "0.0.0.0", "--port", "8000"]
