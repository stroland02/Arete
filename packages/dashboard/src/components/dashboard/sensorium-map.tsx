"use client";

import { useMemo, useState } from "react";
import { layoutTopology, NODE_W, nodeCardHeight, type Topology } from "@arete/topology";
import type { NodeSensors } from "@/lib/sensors";

interface SensoriumMapProps {
  topology: Topology;
  sensors: Record<string, NodeSensors>;
}

// Pain severity -> ring color. Mirrors the dashboard's existing severity palette
// (rose/amber/sky) so the map reads the same as the rest of the product.
const PAIN_RING: Record<string, string> = {
  error: "border-rose-500/70 shadow-rose-900/30",
  warning: "border-amber-500/70 shadow-amber-900/30",
  info: "border-sky-500/70 shadow-sky-900/30",
};
const PAIN_BADGE: Record<string, string> = {
  error: "bg-rose-500 text-white",
  warning: "bg-amber-500 text-slate-950",
  info: "bg-sky-500 text-white",
};

/**
 * The Sensorium map: our own SVG render of the code graph (from
 * codeGraphProvider) with live sensor overlays, laid out with @arete/topology's
 * layoutTopology exactly as agent-run-explorer.tsx does (layout is client-side
 * because layoutTopology's positions Map doesn't cross the RSC boundary). This
 * is fully ours — NOT an embedded codebase-memory-mcp 3D viewer.
 *
 * Sensor → visual encoding:
 *   pain      severity-colored ring + a count badge (real OPEN ReviewComments)
 *   activity  pulsing sky outline + the agent's name (real recent findings)
 *   untested  dashed border   (only when the graph exposes it; absent in v1)
 *   dead      dimmed          (only when the graph exposes it; absent in v1)
 * A node with no sensor data renders plain — honest, never a fake signal.
 */
export function SensoriumMap({ topology, sensors }: SensoriumMapProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  const layout = useMemo(
    () => layoutTopology(topology, { density: "comfortable", padLeft: 40, padTop: 40, maxWidth: 1600 }),
    [topology],
  );

  if (topology.nodes.length === 0) {
    return (
      <div className="w-full rounded-xl border border-border-subtle bg-slate-900/40 p-10 text-center text-sm text-slate-400">
        No code map to display yet.
      </div>
    );
  }

  return (
    <div className="w-full overflow-auto rounded-xl border border-border-subtle bg-slate-900/40 relative">
      <svg width={layout.extent.w + 80} height={layout.extent.h + 80} className="min-w-full">
        <defs>
          <pattern id="sensorium-grid" width="30" height="30" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1.5" fill="rgba(255,255,255,0.03)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#sensorium-grid)" />

        {/* Edges */}
        {topology.edges.map((e) => {
          const from = layout.positions.get(e.from);
          const to = layout.positions.get(e.to);
          if (!from || !to) return null;
          const fromNode = topology.nodes.find((n) => n.id === e.from);
          const toNode = topology.nodes.find((n) => n.id === e.to);
          const fromH = fromNode ? nodeCardHeight(fromNode) : 96;
          const toH = toNode ? nodeCardHeight(toNode) : 96;

          const startX = from.x + NODE_W;
          const startY = from.y + fromH / 2;
          const endX = to.x;
          const endY = to.y + toH / 2;
          const d = `M ${startX},${startY} C ${(startX + endX) / 2},${startY} ${(startX + endX) / 2},${endY} ${endX},${endY}`;
          const isCall = e.kind === "CALLS";
          const isHovered = hovered === e.from || hovered === e.to;

          return (
            <path
              key={e.id}
              d={d}
              fill="none"
              stroke={isHovered ? "rgba(56,189,248,0.5)" : isCall ? "rgba(56,189,248,0.18)" : "rgba(255,255,255,0.06)"}
              strokeWidth={isCall ? 1.5 : 1}
            />
          );
        })}

        {/* Nodes */}
        {topology.nodes.map((n) => {
          const pos = layout.positions.get(n.id);
          if (!pos) return null;
          const h = nodeCardHeight(n);
          const s = sensors[n.id] ?? {};
          const path = n.meta?.path as string | undefined;

          const ring = s.pain ? PAIN_RING[s.pain.maxSeverity] ?? "border-slate-700" : "border-slate-800/60";
          const border = [
            ring,
            s.activity ? "ring-2 ring-sky-400/60 animate-pulse" : "",
            s.untested ? "border-dashed" : "",
            s.dead ? "opacity-40 grayscale" : "",
            hovered === n.id ? "translate-y-[-2px] shadow-xl" : "",
          ].join(" ");

          return (
            <foreignObject
              key={n.id}
              x={pos.x}
              y={pos.y}
              width={NODE_W}
              height={h}
              className="overflow-visible"
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
            >
              <div
                className={`relative w-full h-full rounded-xl border ${border} bg-slate-900/60 p-3 flex flex-col justify-center shadow-lg backdrop-blur-md transition-all`}
              >
                {s.pain && (
                  <span
                    className={`absolute -top-2 -right-2 min-w-5 h-5 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center ${PAIN_BADGE[s.pain.maxSeverity] ?? "bg-slate-600 text-white"}`}
                    title={`${s.pain.count} open finding(s), max severity ${s.pain.maxSeverity}`}
                  >
                    {s.pain.count}
                  </span>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">{n.kind}</span>
                </div>
                <span className="text-sm font-mono font-semibold text-slate-200 truncate">{n.label}</span>
                {path && path !== n.label && (
                  <span className="text-[10px] text-slate-500 truncate">{path}</span>
                )}
                {s.activity && (
                  <span className="mt-1 text-[10px] text-sky-400 truncate">▶ {s.activity.agent}</span>
                )}
              </div>
            </foreignObject>
          );
        })}
      </svg>
    </div>
  );
}
