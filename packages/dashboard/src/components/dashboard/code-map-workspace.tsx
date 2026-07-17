"use client";

import { useState } from "react";
import { IconSearch } from "@tabler/icons-react";
import type { Topology } from "@arete/topology";
import type { NodeSensors, FindingLike } from "@/lib/sensors";
import { buildSidebarModel, type CodeMapSelection } from "@/lib/code-map-sidebar";
import type { CodeMapFilter } from "@/lib/code-map-view";
import { CodeMap } from "./code-map";
import { CodeMapDrawer } from "./code-map-drawer";

interface CodeMapWorkspaceProps {
  topology: Topology;
  sensors: Record<string, NodeSensors>;
  findings: FindingLike[];
  initialSelection: CodeMapSelection | null;
}

const FILTERS: Array<{ id: CodeMapFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "findings", label: "Findings" },
  { id: "active", label: "Active" },
];

/**
 * The full /map experience: interactive folder-cluster map + detail drawer.
 * Owns selection/filter/search state; all data rules live in the tested pure
 * libs (layoutClusters, buildSidebarModel, code-map-view).
 */
export function CodeMapWorkspace({ topology, sensors, findings, initialSelection }: CodeMapWorkspaceProps) {
  const [selection, setSelection] = useState<CodeMapSelection | null>(initialSelection);
  const [filter, setFilter] = useState<CodeMapFilter>("all");
  const [search, setSearch] = useState("");

  const model = selection ? buildSidebarModel(topology, sensors, findings, selection) : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-[220px] max-w-sm flex-1">
          <IconSearch size={14} stroke={2} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-content-muted" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search files or folders…"
            className="w-full rounded-lg border border-border-default bg-surface-1 py-1.5 pl-8 pr-3 font-mono text-[12px] text-content-primary placeholder:text-content-muted focus:border-accent-primary/50 focus:outline-none"
          />
        </label>
        <div className="flex items-center gap-1" role="group" aria-label="Filter nodes">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`rounded-full border px-3 py-1 text-[11px] font-medium transition-colors ${
                filter === f.id
                  ? "border-accent-primary/40 bg-accent-primary/10 text-accent-primary"
                  : "border-border-default bg-surface-1 text-content-muted hover:text-content-secondary"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="min-w-0 flex-1">
          <CodeMap
            topology={topology}
            sensors={sensors}
            interactive
            selected={selection}
            onSelect={setSelection}
            filter={filter}
            search={search}
          />
        </div>
        {model && <CodeMapDrawer model={model} onClose={() => setSelection(null)} onJump={setSelection} />}
      </div>
    </div>
  );
}
