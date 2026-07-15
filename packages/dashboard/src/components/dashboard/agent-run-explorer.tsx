"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { layoutTopology } from "@arete/topology";
import type { Topology, TopologyNode, TopologyEdge } from "@arete/topology";
import { 
  IconRobot, 
  IconFileDiff, 
  IconCheck, 
  IconShieldCheck, 
  IconGauge, 
  IconSparkles, 
  IconTestPipe, 
  IconRocket, 
  IconBriefcase
} from "@tabler/icons-react";

interface AgentRunExplorerProps {
  findings: Array<{
    id: string;
    path: string;
    line: number;
    category: string;
    severity: string;
    body: string;
  }>;
}

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  security: IconShieldCheck,
  performance: IconGauge,
  quality: IconSparkles,
  test_coverage: IconTestPipe,
  deployment_safety: IconRocket,
  business_logic: IconBriefcase,
};

export function AgentRunExplorer({ findings }: AgentRunExplorerProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  // Derive a topology from the findings list
  const topology = useMemo<Topology>(() => {
    const nodes: TopologyNode[] = [
      { id: "root_diff", kind: "data", label: "Pull Request Diff", provider: "manual" }
    ];
    const edges: TopologyEdge[] = [];

    // Create unique agent nodes based on the categories present
    const agentsPresent = new Set<string>();
    findings.forEach(f => agentsPresent.add(f.category));

    agentsPresent.forEach(cat => {
      const agentId = `agent_${cat}`;
      nodes.push({
        id: agentId,
        kind: "compute",
        label: `${cat.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} Agent`,
        provider: "telemetry",
        meta: { category: cat },
      });
      edges.push({ id: `root_diff->${agentId}`, from: "root_diff", to: agentId, source: "manual" });
    });

    // Add findings nodes and connect them to their agents
    findings.forEach(f => {
      nodes.push({
        id: f.id,
        kind: "service",
        label: `${f.path}:${f.line}`,
        provider: "telemetry",
        meta: { finding: f, category: f.category }
      });
      edges.push({ id: `agent_${f.category}->${f.id}`, from: `agent_${f.category}`, to: f.id, source: "manual" });
    });

    return { nodes, edges, groups: [] };
  }, [findings]);

  const layout = useMemo(() => {
    return layoutTopology(topology, { density: "comfortable", padLeft: 40, padTop: 40 });
  }, [topology]);

  if (findings.length === 0) return null;

  return (
    <div className="w-full overflow-auto border border-border-subtle rounded-xl bg-slate-900/40 relative">
      <svg width={layout.extent.w + 80} height={layout.extent.h + 80} className="min-w-full">
        <defs>
          <pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1.5" fill="rgba(255,255,255,0.03)" />
          </pattern>
          <linearGradient id="edge-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(56, 189, 248, 0.1)" />
            <stop offset="100%" stopColor="rgba(56, 189, 248, 0.4)" />
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />

        {/* Edges */}
        {topology.edges.map(e => {
          const from = layout.positions.get(e.from);
          const to = layout.positions.get(e.to);
          if (!from || !to) return null;
          
          const isHovered = hoveredNode === e.from || hoveredNode === e.to;
          const fromNode = topology.nodes.find(n => n.id === e.from);
          const toNode = topology.nodes.find(n => n.id === e.to);
          
          const fromW = 248; // NODE_W
          const fromH = fromNode?.kind === "service" ? 156 : 96;
          const toH = toNode?.kind === "service" ? 156 : 96;

          const startX = from.x + fromW;
          const startY = from.y + fromH / 2;
          const endX = to.x;
          const endY = to.y + toH / 2;
          
          const d = `M ${startX},${startY} C ${(startX + endX)/2},${startY} ${(startX + endX)/2},${endY} ${endX},${endY}`;

          return (
            <g key={`${e.from}-${e.to}`}>
              <path 
                d={d} 
                fill="none" 
                stroke={isHovered ? "url(#edge-grad)" : "rgba(255,255,255,0.05)"} 
                strokeWidth={isHovered ? 2 : 1.5}
                className="transition-all duration-300"
              />
              {isHovered && (
                <motion.circle
                  r={3}
                  fill="#38bdf8"
                  style={{ offsetPath: `path('${d}')` }}
                  initial={{ offsetDistance: "0%" }}
                  animate={{ offsetDistance: "100%" }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                />
              )}
            </g>
          );
        })}

        {/* Nodes (rendered as foreignObjects for HTML flexibility) */}
        {topology.nodes.map(n => {
          const pos = layout.positions.get(n.id);
          if (!pos) return null;

          const w = 248;
          const h = n.kind === "service" ? 156 : 96;
          const category = (n.meta?.category as string | undefined) ?? "";
          const Icon = CATEGORY_ICONS[category] || IconRobot;
          const isFinding = n.kind === "service";
          const finding = n.meta?.finding as AgentRunExplorerProps["findings"][number] | undefined;
          
          return (
            <foreignObject 
              key={n.id} 
              x={pos.x} 
              y={pos.y} 
              width={w} 
              height={h}
              onMouseEnter={() => setHoveredNode(n.id)}
              onMouseLeave={() => setHoveredNode(null)}
              className="overflow-visible"
            >
              <div className={`w-full h-full rounded-xl border p-4 flex flex-col justify-center transition-all duration-300 shadow-lg backdrop-blur-md ${
                hoveredNode === n.id 
                  ? "border-sky-500/50 bg-sky-950/40 shadow-sky-900/20 shadow-xl translate-y-[-2px]" 
                  : "border-slate-800/60 bg-slate-900/50"
              }`}>
                {isFinding ? (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="p-1.5 rounded-md bg-rose-500/10 text-rose-400 border border-rose-500/20">
                        <IconCheck size={14} />
                      </div>
                      <span className="text-xs font-mono text-slate-300 truncate font-semibold">{n.label}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 line-clamp-3 leading-relaxed">
                      {finding?.body}
                    </p>
                    <div className="mt-auto pt-3 flex items-center justify-between border-t border-slate-800">
                      <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">{finding?.severity}</span>
                    </div>
                  </>
                ) : n.kind === "data" ? (
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shadow-inner">
                      <IconFileDiff size={24} stroke={1.5} />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-200">Diff Payload</h3>
                      <p className="text-xs text-slate-500 mt-0.5">Entry point</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20 shadow-inner">
                      <Icon size={24} stroke={1.5} />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-slate-200">{n.label}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">LangGraph Compute</p>
                    </div>
                  </div>
                )}
              </div>
            </foreignObject>
          );
        })}
      </svg>
    </div>
  );
}
