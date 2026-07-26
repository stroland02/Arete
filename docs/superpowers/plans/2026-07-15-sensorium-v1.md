# Sensorium v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the authenticated dashboard home (`/overview`) into a live, *fully-ours* map of the codebase — nodes from the existing `codebase-memory-mcp` code-graph, with our own live "sensor" overlays (pain, activity, pulse, vitality, necrosis) — rendered with the existing `@arete/topology` + `agent-run-explorer` pipeline.

**Architecture:** This builds **on top of** the shipped context-mapping foundation (`docs/superpowers/plans/2026-07-13-context-mapping-foundation.md`) — reusing `context_map` (repo cache, indexer, `ensure_indexed`, the `mcp/client.py` session helpers) and the per-installation index. We add (1) an agents-side endpoint that returns **normalized graph JSON** (not a viewer URL) via the already-allowlisted read tools, (2) index **persistence** so the graph is queryable outside a live review, (3) a `codeGraphProvider` for `@arete/topology`, (4) a dashboard **sensor-join** view-model, and (5) a `SensoriumMap` client component wired into `/overview`.

**Tech Stack:** Python 3.12 (`arete_agents`, pytest, FastAPI), TypeScript/Node (`@arete/topology` via `tsx --test`; `@arete/dashboard` Next.js 16 + Vitest), the shipped `codebase-memory-mcp` v0.9.0 binary, ClickHouse + Prisma/Postgres (existing clients), Docker Compose (persistence volume).

## Global Constraints

- **Build on the foundation, never rebuild it.** Do NOT re-create `repo_cache.py`, `indexer.py`, `ensure_indexed`, `mcp/client.py` helpers, the Dockerfile binary bake, or `/context-map/ui-url`. They exist and pass tests. Reuse `mcp_client.call_tool_sync` / `get_or_create_session` and the `context-map-{installation_id}` server name + `install-{installation_id}` project name conventions from that plan verbatim.
- **Anti-fabrication (inherited).** Never render a placeholder graph when no index exists, and never imply a sensor is "live" when its source isn't running. Missing graph → honest empty state. Missing sensor source → that overlay is simply absent, not zeroed-in-a-way-that-looks-real.
- **Tenancy scoping is load-bearing.** Every dashboard read takes `db` + `installationIds` and filters through `repository: { installationId: { in: installationIds } }` (the single choke point at `packages/dashboard/src/lib/queries.ts:68-82`). ClickHouse reads filter `project_id IN (installationIds)`. Empty `installationIds` ⇒ no query + `{ hasAccess: false }`. The graph endpoint is called with an installation id the session is already authorized for (validated via `resolveSelectedInstallationIds`, `queries.ts:13-22`) — never a raw URL param.
- **Fully ours, not an iframe.** Render via `@arete/topology` (`layoutTopology`) + our own SVG (the `agent-run-explorer.tsx` pipeline). Do not embed `codebase-memory-mcp`'s 3D viewer (`/context-map/ui-url`) in Sensorium.
- **Read-only graph tools only.** Query exclusively the allowlisted tools (`context_map/tools.py:5-14`): `get_architecture`, `search_graph`, `trace_path`, `get_code_snippet`, `search_code`, `semantic_query`. Never a mutation tool.
- **Reuse the design system.** No net-new visual design system; reuse existing dashboard primitives/tokens. This is a service/data task, not a visual redesign. Do NOT touch the pre-login marketing landing page.
- **Testing convention.** Python: fake the MCP boundary with `unittest.mock` (never require the real binary/network). Topology: `tsx --test` (see `packages/topology/src/*.test.ts`). Dashboard: Vitest, co-located `*.test.ts(x)`, the in-memory fake-Prisma pattern (`queries.test.ts:13-70`); the ClickHouse client is a module-level singleton, so mock it with `vi.mock('@/lib/clickhouse')`.
- **Ownership lane (Engineer 2, this wave):** primary `packages/dashboard`; additive-only into `packages/agents/src/arete_agents/context_map/` + `server.py` and `packages/topology`. Declare these agents-side files in `.claude/ade-coordination.md` before editing, and land Tasks 1–3 **early** while Engineer 1 is still in SuperLog research (Engineer 1 must not touch `context_map/` or `server.py`).

---

## Pre-flight (Engineer 2 — do before Task 1)

- [ ] Fetch fresh `origin/main`; confirm the context-mapping foundation is present: `packages/agents/src/arete_agents/context_map/{repo_cache,indexer,ui}.py`, `context_map/__init__.py::ensure_indexed`, and `mcp/client.py::get_or_create_session`/`call_tool_sync` all exist. If any is missing, STOP and tell the PM — this plan assumes them.
- [ ] In `.claude/ade-coordination.md`, add a Wave-1 row claiming: `packages/dashboard` + (additive) `packages/agents/.../context_map/graph_export.py`, `packages/agents/.../server.py` (one route), `packages/topology/src/code-provider.ts`. Note that Engineer 1 must avoid `context_map/` and `server.py`.
- [ ] Run the baselines green before starting: `pnpm --filter @arete/dashboard test` (23), `cd packages/agents && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py`, `cd packages/topology && pnpm test`.

---

### Task 1: Normalize the MCP code-graph → `GraphExport` (agents)

**Files:**
- Create: `packages/agents/src/arete_agents/context_map/graph_export.py`
- Create: `packages/agents/tests/fixtures/cbm_get_architecture.json` (captured once from the real binary — see Step 1)
- Create: `packages/agents/tests/test_graph_export.py`

**Interfaces:**
- Consumes: `mcp_client.call_tool_sync` (from `mcp/client.py`, foundation). The per-installation server name `context-map-{installation_id}` (already connected during a review).
- Produces: `GraphExportError(Exception)`; `build_graph_export(installation_id: int) -> dict` returning the **stable JSON contract** the endpoint (Task 2) and the dashboard (Task 5) depend on:
  ```json
  {
    "project": "install-42",
    "generatedAt": "2026-07-15T00:00:00Z",
    "nodes": [{"id": "str", "kind": "File|Class|Function|Method|Package|...", "name": "str",
               "path": "src/x.py | null", "qualifiedName": "str | null", "degree": 0,
               "untested": false, "dead": false}],
    "edges": [{"source": "nodeId", "target": "nodeId", "kind": "CALLS|IMPORTS|TESTS|..."}]
  }
  ```
  `untested` = node has no incoming `TESTS` edge (feeds the *vitality* sensor). `dead` = MCP dead-code/unreachable flag or zero call-degree non-entrypoint (feeds *necrosis*). Both are derived here so the dashboard never re-implements graph logic.

- [ ] **Step 1: Capture the real tool payload as a fixture (discovery — do this once, honestly)**

The exact JSON shape of `get_architecture` / `search_graph` is defined by the `codebase-memory-mcp` binary, not by us — do not guess it. Index this very repo locally and capture the real payload:

```bash
# from repo root, with the codebase-memory-mcp binary on PATH (or CBM_BINARY_PATH set)
cd packages/agents
uv run python - <<'PY'
from arete_agents.mcp import client as mcp
import shutil
mcp.get_or_create_session("context-map-0", shutil.which("codebase-memory-mcp"))
mcp.call_tool_sync("context-map-0", "index_repository", {"repo_path": "../..", "project": "install-0"})
arch = mcp.call_tool_sync("context-map-0", "get_architecture", {"project": "install-0"})
open("tests/fixtures/cbm_get_architecture.json", "w").write(arch.content[0].text)
print("captured", len(arch.content[0].text), "bytes")
PY
```

Commit the captured `tests/fixtures/cbm_get_architecture.json`. This is real recorded output (no secrets — it's structural graph data for this open repo), and it makes the normalizer test hermetic (no binary needed in CI).

- [ ] **Step 2: Write the failing test against the fixture**

Create `packages/agents/tests/test_graph_export.py`:

```python
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

FIXTURE = Path(__file__).parent / "fixtures" / "cbm_get_architecture.json"


def _tool_result(text: str):
    block = MagicMock()
    block.text = text
    result = MagicMock()
    result.content = [block]
    return result


@patch("arete_agents.context_map.graph_export.mcp_client")
def test_build_graph_export_shape(mock_client):
    from arete_agents.context_map.graph_export import build_graph_export

    mock_client.call_tool_sync.return_value = _tool_result(FIXTURE.read_text())
    export = build_graph_export(installation_id=42)

    assert export["project"] == "install-42"
    assert isinstance(export["nodes"], list) and len(export["nodes"]) > 0
    assert isinstance(export["edges"], list)
    node = export["nodes"][0]
    assert {"id", "kind", "name"} <= node.keys()
    assert "untested" in node and "dead" in node
    ids = {n["id"] for n in export["nodes"]}
    assert all(e["source"] in ids and e["target"] in ids for e in export["edges"])


@patch("arete_agents.context_map.graph_export.mcp_client")
def test_build_graph_export_raises_when_not_indexed(mock_client):
    from arete_agents.context_map.graph_export import GraphExportError, build_graph_export

    mock_client.call_tool_sync.side_effect = RuntimeError("No MCP session for server 'context-map-42'.")
    with pytest.raises(GraphExportError):
        build_graph_export(installation_id=42)
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/agents && uv run pytest tests/test_graph_export.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'arete_agents.context_map.graph_export'`.

- [ ] **Step 4: Implement `graph_export.py` against the captured fixture**

Write the module to parse the *actual* keys present in `cbm_get_architecture.json` (inspect the fixture — the field names below like `nodes`/`edges`/`qualified_name` are the expected `get_architecture` schema, but adapt the extraction to whatever the fixture actually shows; the JSON contract in **Interfaces** is what must come out regardless of input keys):

```python
import json
from datetime import datetime, timezone
from typing import Any

from arete_agents.mcp import client as mcp_client

_SERVER = "context-map-{}"
_PROJECT = "install-{}"


class GraphExportError(Exception):
    """Raised when no index/session exists for this installation, or the
    tool payload can't be parsed. The endpoint (Task 2) turns this into an
    honest {available: false}, never a fabricated graph."""


def _parse(result: Any) -> dict:
    return json.loads(result.content[0].text)


def build_graph_export(installation_id: int) -> dict:
    server = _SERVER.format(installation_id)
    project = _PROJECT.format(installation_id)
    try:
        raw = _parse(mcp_client.call_tool_sync(server, "get_architecture", {"project": project}))
    except Exception as exc:  # no session / not indexed / parse failure
        raise GraphExportError(f"No queryable graph for installation {installation_id}: {exc}") from exc

    # --- Adapt these extractions to the real fixture keys ---
    raw_nodes = raw.get("nodes", [])
    raw_edges = raw.get("edges", [])

    tested = {e["target"] for e in raw_edges if e.get("kind") == "TESTS"}
    called = {e["target"] for e in raw_edges if e.get("kind") in ("CALLS", "ASYNC_CALLS")}

    nodes = []
    for n in raw_nodes:
        nid = str(n.get("id") or n.get("qualified_name") or n.get("name"))
        kind = n.get("kind") or n.get("label") or "Unknown"
        nodes.append({
            "id": nid,
            "kind": kind,
            "name": n.get("name") or nid,
            "path": n.get("path"),
            "qualifiedName": n.get("qualified_name"),
            "degree": int(n.get("degree", 0)),
            "untested": kind in ("Function", "Method", "Class") and nid not in tested,
            "dead": bool(n.get("unreachable")) or (kind in ("Function", "Method") and nid not in called),
        })

    node_ids = {n["id"] for n in nodes}
    edges = [
        {"source": str(e["source"]), "target": str(e["target"]), "kind": e.get("kind", "RELATED")}
        for e in raw_edges
        if str(e.get("source")) in node_ids and str(e.get("target")) in node_ids
    ]

    return {
        "project": project,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "nodes": nodes,
        "edges": edges,
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/agents && uv run pytest tests/test_graph_export.py -v`
Expected: PASS (2 passed). If the shape assertions fail, adjust the extraction in Step 4 to the fixture's real keys — the test is the spec for the *output*, the fixture is the truth for the *input*.

- [ ] **Step 6: Commit**

```bash
git add packages/agents/src/arete_agents/context_map/graph_export.py \
  packages/agents/tests/test_graph_export.py packages/agents/tests/fixtures/cbm_get_architecture.json
git commit -m "feat(sensorium): normalize codebase-memory-mcp graph into a stable GraphExport JSON"
```

---

### Task 2: `GET /context-map/graph/{installation_id}` endpoint (agents)

**Files:**
- Modify: `packages/agents/src/arete_agents/server.py`
- (No route-level test — same convention as the existing `/review`, `/chat`, `/context-map/ui-url` routes, which delegate to independently-tested logic. `build_graph_export` is covered by Task 1.)

**Interfaces:**
- Consumes: `build_graph_export`, `GraphExportError` (Task 1).
- Produces: `GET /context-map/graph/{installation_id}` → `{"available": true, "graph": <GraphExport>}` or `{"available": false, "graph": null, "reason": "..."}`. Mirrors the `/context-map/ui-url` response envelope exactly.

- [ ] **Step 1: Add the endpoint**

In `packages/agents/src/arete_agents/server.py`, add the import:

```python
from arete_agents.context_map.graph_export import GraphExportError, build_graph_export
```

Add after the existing `/context-map/ui-url/{installation_id}` endpoint:

```python
@app.get("/context-map/graph/{installation_id}")
def context_map_graph(installation_id: int):
    try:
        return {"available": True, "graph": build_graph_export(installation_id)}
    except GraphExportError as exc:
        return {"available": False, "graph": None, "reason": str(exc)}
```

- [ ] **Step 2: Confirm no regressions**

Run: `cd packages/agents && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py`
Expected: all passing, 0 failed.

- [ ] **Step 3: Commit**

```bash
git add packages/agents/src/arete_agents/server.py
git commit -m "feat(sensorium): add /context-map/graph JSON endpoint for the dashboard"
```

---

### Task 3: Persist the per-installation index across restarts (infra)

The foundation deliberately used no volume ("a restart means re-clone"), which is fine mid-review but means the graph endpoint has nothing to query after a restart. Persist the clone cache + `codebase-memory-mcp` on-disk index so the graph survives and is queryable outside a live review.

**Files:**
- Modify: `docker-compose.prod.yml` (and `infra/docker-compose.yml` if the dev stack defines the `agents` service)

**Interfaces:**
- Consumes: the `CBM_CACHE_DIR=/app/.data/cbm-cache` and `/app/.data/repos` paths already established by the foundation's Dockerfile.
- Produces: a named volume mounted at `/app/.data` on the `agents` service.

- [ ] **Step 1: Add the volume**

In the `agents` service definition of `docker-compose.prod.yml`, add a volume mount and declare the named volume:

```yaml
  agents:
    # ...existing config...
    volumes:
      - agents_context_map:/app/.data

volumes:
  agents_context_map:
```

(Merge into the existing top-level `volumes:` block if one exists; do not duplicate the key.)

- [ ] **Step 2: Verify compose config is valid**

Run: `docker compose -f docker-compose.prod.yml config >/dev/null && echo OK`
Expected: `OK` (no YAML/schema error).

- [ ] **Step 3: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "feat(sensorium): persist context-map index via a named volume so the graph survives restarts"
```

---

### Task 4: `codeGraphProvider` for `@arete/topology`

**Files:**
- Modify: `packages/topology/src/topology.ts` (extend `EdgeSource` union — additive)
- Create: `packages/topology/src/code-provider.ts`
- Create: `packages/topology/src/code-provider.test.ts`

**Interfaces:**
- Consumes: `Topology`, `TopologyNode`, `TopologyEdge`, `emptyTopology`, `edgeId` from `./topology`. The `GraphExport` JSON contract (Task 1).
- Produces: `type CodeGraphExport` (the TS mirror of the Task-1 JSON); `codeGraphProvider(export: CodeGraphExport): Topology`. Task 5 consumes this.

- [ ] **Step 1: Extend `EdgeSource` (additive, backward-compatible)**

In `packages/topology/src/topology.ts`, add `'code'` to the `EdgeSource` union (currently `'telemetry' | 'infra' | 'manual' | 'suggested'`):

```ts
export type EdgeSource = 'telemetry' | 'infra' | 'manual' | 'suggested' | 'code'
```

- [ ] **Step 2: Write the failing test**

Create `packages/topology/src/code-provider.test.ts`:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { codeGraphProvider } from './code-provider.ts'

const sample = {
  project: 'install-42',
  generatedAt: '2026-07-15T00:00:00Z',
  nodes: [
    { id: 'f1', kind: 'File', name: 'a.ts', path: 'src/a.ts', qualifiedName: null, degree: 2, untested: false, dead: false },
    { id: 'fn1', kind: 'Function', name: 'doThing', path: 'src/a.ts', qualifiedName: 'a.doThing', degree: 1, untested: true, dead: false },
  ],
  edges: [{ source: 'f1', target: 'fn1', kind: 'DEFINES' }],
}

test('maps code nodes and edges into a Topology', () => {
  const t = codeGraphProvider(sample)
  assert.equal(t.nodes.length, 2)
  const fn = t.nodes.find((n) => n.id === 'fn1')!
  assert.equal(fn.kind, 'Function')
  assert.equal(fn.meta?.path, 'src/a.ts')
  assert.equal(fn.meta?.untested, true)
  assert.equal(t.edges.length, 1)
  assert.equal(t.edges[0].source, 'f1')
  assert.equal(t.edges[0].kind, 'DEFINES')
})

test('is a pure function of its input (no throw on empty)', () => {
  const t = codeGraphProvider({ project: 'install-0', generatedAt: '', nodes: [], edges: [] })
  assert.equal(t.nodes.length, 0)
  assert.equal(t.edges.length, 0)
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/topology && pnpm test`
Expected: FAIL — cannot find `./code-provider.ts`.

- [ ] **Step 4: Implement `code-provider.ts`**

```ts
import { type Topology, type TopologyNode, type TopologyEdge, emptyTopology, edgeId } from './topology.ts'

export interface CodeGraphNode {
  id: string; kind: string; name: string
  path?: string | null; qualifiedName?: string | null
  degree?: number; untested?: boolean; dead?: boolean
}
export interface CodeGraphEdge { source: string; target: string; kind: string }
export interface CodeGraphExport {
  project: string; generatedAt: string
  nodes: CodeGraphNode[]; edges: CodeGraphEdge[]
}

/**
 * Translate a codebase-memory-mcp GraphExport (see the agents-side
 * /context-map/graph endpoint) into a domain-agnostic Topology. Pure: same
 * input → same output, never throws. Sensor overlays are applied later
 * (dashboard), NOT here — this is structure only. Node `status` is left
 * 'unknown'; the dashboard sets it from the sensor join.
 */
export function codeGraphProvider(exp: CodeGraphExport): Topology {
  const t = emptyTopology()
  t.nodes = exp.nodes.map<TopologyNode>((n) => ({
    id: n.id,
    kind: n.kind,
    label: n.name,
    status: 'unknown',
    meta: {
      path: n.path ?? undefined,
      qualifiedName: n.qualifiedName ?? undefined,
      degree: n.degree ?? 0,
      untested: n.untested ?? false,
      dead: n.dead ?? false,
    },
  }))
  const ids = new Set(t.nodes.map((n) => n.id))
  t.edges = exp.edges
    .filter((e) => ids.has(e.source) && ids.has(e.target))
    .map<TopologyEdge>((e) => ({
      id: edgeId(e.source, e.target),
      source: e.source,
      target: e.target,
      kind: e.kind,
      source_kind: 'code',
    }))
  return t
}
```

> Note: match the exact `TopologyNode`/`TopologyEdge` field names in `topology.ts` (e.g. whether the edge's provenance field is `source` vs `source_kind`/`origin`). Adjust the literals above to the real type; the test pins the observable behavior.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/topology && pnpm test`
Expected: PASS (all topology tests, incl. 2 new).

- [ ] **Step 6: Commit**

```bash
git add packages/topology/src/topology.ts packages/topology/src/code-provider.ts packages/topology/src/code-provider.test.ts
git commit -m "feat(sensorium): add codeGraphProvider to @arete/topology"
```

---

### Task 5: Sensor-join view-model (dashboard)

**Files:**
- Create: `packages/dashboard/src/lib/context-map-client.ts` (fetch graph JSON from the agents service)
- Create: `packages/dashboard/src/lib/sensors.ts` (join sensors onto nodes by path)
- Modify: `packages/dashboard/src/lib/queries.ts` (add `getFindingsByPath`)
- Create: `packages/dashboard/src/lib/sensorium.ts` (`getSensoriumViewModel`)
- Create: `packages/dashboard/src/lib/sensors.test.ts`
- Modify: `packages/dashboard/src/lib/queries.test.ts` (tenancy test for `getFindingsByPath`)

**Interfaces:**
- Consumes: `codeGraphProvider` + `CodeGraphExport` (`@arete/topology`); `layoutTopology` (`@arete/topology`); `getAgentActivity` (`queries.ts:600-625`), `getAgentEventsPerMinute` (`queries.ts:636-665`); the fake-Prisma test pattern.
- Produces:
  - `fetchCodeGraph(installationId: number): Promise<CodeGraphExport | null>` — GETs `${AGENTS_URL}/context-map/graph/{id}`; returns `null` when `available:false` or on any fetch error (honest empty, never throws into the page).
  - `type NodeSensors = { pain?: { count: number; maxSeverity: 'error'|'warning'|'info' }; activity?: { agent: string }; untested?: boolean; dead?: boolean }`.
  - `joinSensors(topology, { findings, activity }): Record<string, NodeSensors>` — keyed by node id, matched to findings/activity by `meta.path`.
  - `getSensoriumViewModel(db, installationIds, deps?) : Promise<SensoriumViewModel>` where `SensoriumViewModel = { hasAccess: false } | { hasAccess: true; available: boolean; reason?: string; topology?: Topology; sensors?: Record<string, NodeSensors>; pulse: AgentEventData[] }`.

- [ ] **Step 1: Write the failing test for `joinSensors`**

Create `packages/dashboard/src/lib/sensors.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { joinSensors } from './sensors'
import type { Topology } from '@arete/topology'

const topo: Topology = {
  nodes: [
    { id: 'n1', kind: 'File', label: 'a.ts', status: 'unknown', meta: { path: 'src/a.ts', untested: true, dead: false } },
    { id: 'n2', kind: 'File', label: 'b.ts', status: 'unknown', meta: { path: 'src/b.ts', untested: false, dead: true } },
  ],
  edges: [],
  groups: [],
}

describe('joinSensors', () => {
  it('attaches pain from findings by path and carries untested/dead', () => {
    const sensors = joinSensors(topo, {
      findings: [
        { path: 'src/a.ts', line: 1, severity: 'error', category: 'security', body: 'x' },
        { path: 'src/a.ts', line: 9, severity: 'warning', category: 'quality', body: 'y' },
      ],
      activity: [],
    })
    expect(sensors.n1.pain).toEqual({ count: 2, maxSeverity: 'error' })
    expect(sensors.n1.untested).toBe(true)
    expect(sensors.n2.dead).toBe(true)
    expect(sensors.n2.pain).toBeUndefined()
  })

  it('attaches activity by path', () => {
    const sensors = joinSensors(topo, {
      findings: [],
      activity: [{ path: 'src/b.ts', agentName: 'SecurityAgent' } as any],
    })
    expect(sensors.n2.activity).toEqual({ agent: 'SecurityAgent' })
  })
})
```

- [ ] **Step 2: Run it, verify it fails** — Run: `pnpm --filter @arete/dashboard test sensors` → FAIL (no `./sensors`).

- [ ] **Step 3: Implement `sensors.ts`**

```ts
import type { Topology } from '@arete/topology'

const SEV_RANK = { error: 3, warning: 2, info: 1 } as const
type Sev = keyof typeof SEV_RANK

export interface FindingLike { path: string; line: number; severity: string; category: string; body: string }
export interface ActivityLike { path?: string; agentName?: string }
export interface NodeSensors {
  pain?: { count: number; maxSeverity: Sev }
  activity?: { agent: string }
  untested?: boolean
  dead?: boolean
}

export function joinSensors(
  topology: Topology,
  sources: { findings: FindingLike[]; activity: ActivityLike[] },
): Record<string, NodeSensors> {
  const byPath = new Map<string, string[]>() // path -> nodeIds
  for (const n of topology.nodes) {
    const p = n.meta?.path as string | undefined
    if (!p) continue
    byPath.set(p, [...(byPath.get(p) ?? []), n.id])
  }

  const out: Record<string, NodeSensors> = {}
  for (const n of topology.nodes) {
    out[n.id] = {
      untested: (n.meta?.untested as boolean) || undefined,
      dead: (n.meta?.dead as boolean) || undefined,
    }
  }

  for (const f of sources.findings) {
    for (const id of byPath.get(f.path) ?? []) {
      const sev = (f.severity in SEV_RANK ? f.severity : 'info') as Sev
      const cur = out[id].pain
      out[id].pain = cur
        ? { count: cur.count + 1, maxSeverity: SEV_RANK[sev] > SEV_RANK[cur.maxSeverity] ? sev : cur.maxSeverity }
        : { count: 1, maxSeverity: sev }
    }
  }
  for (const a of sources.activity) {
    if (!a.path || !a.agentName) continue
    for (const id of byPath.get(a.path) ?? []) out[id].activity = { agent: a.agentName }
  }
  return out
}
```

- [ ] **Step 4: Run it, verify it passes** — Run: `pnpm --filter @arete/dashboard test sensors` → PASS.

- [ ] **Step 5: Implement `context-map-client.ts` (fetch, fail-soft)**

```ts
import type { CodeGraphExport } from '@arete/topology'

const AGENTS_URL = process.env.AGENTS_SERVICE_URL ?? 'http://localhost:8000'

export async function fetchCodeGraph(installationId: number): Promise<CodeGraphExport | null> {
  try {
    const res = await fetch(`${AGENTS_URL}/context-map/graph/${installationId}`, { cache: 'no-store' })
    if (!res.ok) return null
    const body = (await res.json()) as { available: boolean; graph: CodeGraphExport | null }
    return body.available ? body.graph : null
  } catch {
    return null // honest empty — never break the page on a context-map hiccup
  }
}
```

- [ ] **Step 6: Add `getFindingsByPath` to `queries.ts` + a tenancy test**

Add to `packages/dashboard/src/lib/queries.ts` (follow the existing scoping choke point — filter through `review.repository.installationId IN installationIds`):

```ts
export async function getFindingsByPath(
  db: PrismaClient,
  installationIds: string[],
): Promise<FindingLike[]> {
  if (installationIds.length === 0) return []
  return db.reviewComment.findMany({
    where: { review: { repository: { installationId: { in: installationIds } } }, noiseState: 'OPEN' },
    select: { path: true, line: true, severity: true, category: true, body: true },
    take: 2000,
  })
}
```

Add a test to `queries.test.ts` mirroring the existing tenancy tests: seed comments under two installations, assert `getFindingsByPath(fakeDb, [instA])` returns only instA's paths and `[]` for an empty id list.

- [ ] **Step 7: Implement `getSensoriumViewModel` in `sensorium.ts`**

```ts
import { codeGraphProvider, layoutTopology, type Topology } from '@arete/topology'
import type { PrismaClient } from '@arete/db'
import { fetchCodeGraph } from './context-map-client'
import { joinSensors, type NodeSensors } from './sensors'
import { getFindingsByPath, getAgentActivity, getAgentEventsPerMinute, type AgentEventData } from './queries'

export type SensoriumViewModel =
  | { hasAccess: false }
  | { hasAccess: true; available: boolean; reason?: string; topology?: Topology; sensors?: Record<string, NodeSensors>; pulse: AgentEventData[] }

export async function getSensoriumViewModel(
  db: PrismaClient,
  installationIds: string[],
  deps: { fetchGraph?: typeof fetchCodeGraph } = {},
): Promise<SensoriumViewModel> {
  if (installationIds.length === 0) return { hasAccess: false }
  const fetchGraph = deps.fetchGraph ?? fetchCodeGraph

  const graph = await fetchGraph(Number(installationIds[0])) // one graph per installation for v1
  const pulse = await getAgentEventsPerMinute(installationIds).catch(() => [] as AgentEventData[])

  if (!graph) {
    return { hasAccess: true, available: false, reason: 'Code map builds after your first review.', pulse }
  }

  const topology = layoutTopology(codeGraphProvider(graph))
  const [findings, activity] = await Promise.all([
    getFindingsByPath(db, installationIds),
    getAgentActivity(db, installationIds).catch(() => []),
  ])
  const sensors = joinSensors(topology, { findings, activity: activity as any })
  return { hasAccess: true, available: true, topology, sensors, pulse }
}
```

- [ ] **Step 8: Run the full dashboard suite** — Run: `pnpm --filter @arete/dashboard test` → all green (baseline 23 + new).

- [ ] **Step 9: Commit**

```bash
git add packages/dashboard/src/lib/context-map-client.ts packages/dashboard/src/lib/sensors.ts \
  packages/dashboard/src/lib/sensors.test.ts packages/dashboard/src/lib/queries.ts \
  packages/dashboard/src/lib/queries.test.ts packages/dashboard/src/lib/sensorium.ts
git commit -m "feat(sensorium): sensor-join view-model over the code graph"
```

---

### Task 6: `SensoriumMap` client component (dashboard)

**Files:**
- Create: `packages/dashboard/src/components/dashboard/sensorium-map.tsx`
- Create: `packages/dashboard/src/components/dashboard/sensorium-map.test.tsx`

**Interfaces:**
- Consumes: the serialized `topology` + `sensors` from `getSensoriumViewModel`. Reuse the SVG layout/render approach in `agent-run-explorer.tsx` (bezier edges, `foreignObject` node cards, `NODE_W`/`NODE_H`/`nodeCardHeight` from `@arete/topology`).
- Produces: `<SensoriumMap topology={...} sensors={...} />` — a `"use client"` component. Sensor → visual encoding: pain (`maxSeverity` → red/amber/blue ring + `count` badge), activity (pulsing outline + agent label), untested (dashed border), dead (dimmed).

- [ ] **Step 1: Write the failing test**

Create `packages/dashboard/src/components/dashboard/sensorium-map.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SensoriumMap } from './sensorium-map'

const topology = {
  nodes: [{ id: 'n1', kind: 'File', label: 'a.ts', status: 'unknown', x: 0, y: 0, meta: { path: 'src/a.ts' } }],
  edges: [], groups: [],
} as any

describe('SensoriumMap', () => {
  it('renders a node label and a pain badge when a node has pain', () => {
    render(<SensoriumMap topology={topology} sensors={{ n1: { pain: { count: 3, maxSeverity: 'error' } } }} />)
    expect(screen.getByText('a.ts')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run it, verify it fails.** Run: `pnpm --filter @arete/dashboard test sensorium-map` → FAIL.

- [ ] **Step 3: Implement `sensorium-map.tsx`** — a `"use client"` SVG map: iterate `topology.nodes` (already laid out with `x`/`y` from `layoutTopology`), render each as a `foreignObject` card showing `label`, apply the sensor encodings above, draw edges as beziers. Reuse `NODE_W`/`NODE_H`/`nodeCardHeight` from `@arete/topology`, exactly as `agent-run-explorer.tsx` does. Render the pain `count` as a small badge element (the text the test asserts).

- [ ] **Step 4: Run it, verify it passes.** Run: `pnpm --filter @arete/dashboard test sensorium-map` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dashboard/src/components/dashboard/sensorium-map.tsx packages/dashboard/src/components/dashboard/sensorium-map.test.tsx
git commit -m "feat(sensorium): SensoriumMap client renderer with sensor overlays"
```

---

### Task 7: Wire Sensorium into `/overview` (dashboard)

**Files:**
- Modify: `packages/dashboard/src/app/(dashboard)/overview/page.tsx`

**Interfaces:**
- Consumes: `getSensoriumViewModel` (Task 5), `SensoriumMap` (Task 6), the existing `auth()` + `resolveSelectedInstallationIds` + `db` pattern already in this page.

- [ ] **Step 1: Render the map at the top of the home**

In `overview/page.tsx` (already `force-dynamic`, already resolves `installationIds`), after resolving `installationIds`, add:

```tsx
const sensorium = await getSensoriumViewModel(db, installationIds)
```

Render at the top of the authenticated home, above the existing StatTiles/onboarding stack:
- if `sensorium.hasAccess && sensorium.available` → `<SensoriumMap topology={sensorium.topology!} sensors={sensorium.sensors!} />`
- if `sensorium.hasAccess && !sensorium.available` → an honest empty-state card using `sensorium.reason` (e.g. "Your code map builds after your first review."). Do NOT render a fake graph.
- keep the existing cards below.

- [ ] **Step 2: Build + test**

Run: `pnpm --filter @arete/dashboard build` → 0 errors.
Run: `pnpm --filter @arete/dashboard test` → all green.

- [ ] **Step 3: Commit**

```bash
git add "packages/dashboard/src/app/(dashboard)/overview/page.tsx"
git commit -m "feat(sensorium): render the live code map on the dashboard home"
```

---

## Gate (Engineer 2 → PM, before integration)

Report to the PM via the uniform status contract (`scope→progress→blockers→done+verification`) with:

- **Full matrix green:** `pnpm --filter @arete/webhook test`; `cd packages/agents && uv run pytest tests/ --ignore=tests/test_e2e_smoke.py`; `pnpm --filter @arete/dashboard build` **and** `test`; `cd packages/topology && pnpm test`.
- **Drove the real flow (required — the wave's non-negotiable):** with the `agents` service running and at least one installation indexed (trigger one review, or run the Task-1 capture against a real checkout), load `/overview` behind login and confirm: the map renders **real** nodes from `get_architecture`, at least one **pain** overlay reflects a real `ReviewComment`, and the **unavailable** path shows the honest empty state (not a fake graph) for a never-reviewed installation. Capture what you observed.

---

## Self-review (against `docs/superpowers/specs/2026-07-15-kuma-team-workflow-and-wave1-design.md` §3)

- **Nodes = body:** Tasks 1–4 (MCP graph → GraphExport → codeGraphProvider → Topology). ✅
- **Sensors = vitals:** pain (`ReviewComment` via `getFindingsByPath`), activity (`getAgentActivity`), pulse (`getAgentEventsPerMinute`), vitality/untested + necrosis/dead (derived in `graph_export.py` from `TESTS` edges + dead-code). ✅ *Heat/churn* is deferred — no clean source wired in v1 (git-churn ingestion would be net-new); documented as the one §3 sensor not in v1, honest-absent rather than faked.
- **Fully ours, not iframe:** Task 6 renders via `@arete/topology` + our SVG; the MCP viewer is untouched. ✅
- **Honest empty states / anti-fabrication:** `fetchCodeGraph` returns `null` on any failure; the `available:false` branch shows a reason, never a fake graph. ✅
- **Tenancy:** `getFindingsByPath` + `getAgentEventsPerMinute` scope by `installationIds`; page uses `resolveSelectedInstallationIds`. ✅
- **Builds on the foundation, no duplication:** reuses `context_map` + `mcp/client.py`; only additive files agents-side. ✅

## Out of scope (v1) / follow-ups
- **Heat/churn sensor** (git-churn ingestion).
- **Multi-installation** map (v1 uses the first authorized installation).
- **On-demand indexing from the dashboard** (needs clone creds the dashboard doesn't hold) — graph is available only after a review indexes the installation; persistence (Task 3) keeps it warm.
- Verifying OTel spans actually carry `superlog.project_id` so the ClickHouse *pulse* is per-tenant-accurate (flagged in the survey; if unattributed, pulse degrades to honest-empty).
