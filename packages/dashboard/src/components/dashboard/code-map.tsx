"use client";

import { useMemo, useRef, useState } from "react";
import {
  layoutClusters,
  CHIP_W,
  CHIP_H,
  REGION_HEADER_H,
  type Topology,
} from "@arete/topology";
import { IconFolder, IconMinus, IconPlus, IconMaximize } from "@tabler/icons-react";
import type { NodeSensors } from "@/lib/sensors";
import type { CodeMapSelection } from "@/lib/code-map-sidebar";
import { nodeVisible, matchesSearch, type CodeMapFilter } from "@/lib/code-map-view";

export interface CodeMapProps {
  topology: Topology;
  sensors: Record<string, NodeSensors>;
  interactive?: boolean;
  selected?: CodeMapSelection | null;
  onSelect?: (sel: CodeMapSelection) => void;
  hrefFor?: (sel: CodeMapSelection) => string;
  filter?: CodeMapFilter;
  search?: string;
}

// Findings dot per severity — semantic tokens only (accent discipline: cobalt
// is reserved for selection/hover/activity; bronze for the folder glyph).
const SEV_DOT: Record<string, string> = {
  error: "bg-accent-danger",
  warning: "bg-accent-warning",
  info: "bg-accent-info",
};
const SEV_TEXT: Record<string, string> = {
  error: "text-accent-danger",
  warning: "text-accent-warning",
  info: "text-accent-info",
};

/**
 * The Kuma code map (Sensorium v2): File nodes grouped into folder regions via
 * layoutClusters, cross-folder edges aggregated into calm ink lines, sensor
 * overlays (pain/activity/untested/dead) on the chips. Marble & Ink native —
 * every color is a design token, both themes for free. Hand-rolled SVG, no
 * graph libraries. Spec: docs/superpowers/specs/2026-07-17-code-map-v2-design.md
 */
export function CodeMap({
  topology,
  sensors,
  interactive = false,
  selected = null,
  onSelect,
  hrefFor,
  filter = "all",
  search = "",
}: CodeMapProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const layout = useMemo(() => layoutClusters(topology), [topology]);

  // viewBox-based zoom & pan (interactive only). Non-interactive renders the
  // full extent, fit to the container width by plain SVG scaling. Hooks must
  // run unconditionally (before the empty-state early return).
  const base = { x: 0, y: 0, w: layout.extent.w, h: layout.extent.h };
  const [view, setView] = useState(base);
  const dragRef = useRef<{ startX: number; startY: number; vx: number; vy: number } | null>(null);

  if (topology.nodes.length === 0) {
    return (
      <div className="w-full rounded-xl border border-border-subtle bg-surface-1 p-10 text-center text-sm text-content-muted">
        No code map to display yet.
      </div>
    );
  }

  const vb = interactive ? view : base;

  const zoom = (factor: number, cx?: number, cy?: number) => {
    setView((v) => {
      const w = Math.min(Math.max(v.w / factor, base.w / 8), base.w * 2);
      const h = (w / v.w) * v.h;
      const fx = cx ?? v.x + v.w / 2;
      const fy = cy ?? v.y + v.h / 2;
      return { x: fx - ((fx - v.x) / v.w) * w, y: fy - ((fy - v.y) / v.h) * h, w, h };
    });
  };

  const isDim = (id: string, label: string, path?: string) =>
    !nodeVisible(sensors[id], filter) || !matchesSearch(label, path, search);

  const regionCenter = (folder: string) => {
    const r = layout.regions.find((x) => x.folder === folder)!;
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  };

  // The chip whose individual edges we reveal (hovered, else selected file).
  const focusId = hovered ?? (selected?.kind === "file" ? selected.id : null);
  const focusAdj = focusId ? layout.adjacency.get(focusId) : undefined;

  const chipInner = (nId: string, label: string, s: NodeSensors) => (
    <span
      className={`flex h-full w-full items-center gap-2 rounded-lg border px-2.5 transition-all ${
        s.dead ? "opacity-40 grayscale" : ""
      } ${s.untested ? "border-dashed" : ""} ${
        selected?.kind === "file" && selected.id === nId
          ? "border-accent-primary/50 bg-surface-2 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent-primary)_25%,transparent)]"
          : "border-border-default bg-surface-2 hover:border-border-strong"
      }`}
    >
      {s.pain ? (
        <span className="flex shrink-0 items-center gap-1" title={`${s.pain.count} open finding(s)`}>
          <span className={`h-1.5 w-1.5 rounded-full ${SEV_DOT[s.pain.maxSeverity] ?? "bg-content-muted"}`} aria-hidden />
          <span className={`font-mono text-[10px] font-semibold ${SEV_TEXT[s.pain.maxSeverity] ?? "text-content-muted"}`}>{s.pain.count}</span>
        </span>
      ) : (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong" aria-hidden />
      )}
      <span className="min-w-0 flex-1 truncate text-left font-mono text-[12px] text-content-secondary">{label}</span>
      {s.activity && (
        <span
          className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent-primary"
          title={`${s.activity.agent} is active here`}
          aria-hidden
        />
      )}
    </span>
  );

  return (
    <div className="relative w-full overflow-hidden rounded-xl border border-border-subtle bg-surface-0">
      {interactive && (
        <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1 rounded-lg border border-border-default bg-surface-1 p-1 shadow-sm">
          <button type="button" aria-label="Zoom in" onClick={() => zoom(1.25)} className="rounded p-1 text-content-secondary hover:bg-surface-2">
            <IconPlus size={14} stroke={2} />
          </button>
          <button type="button" aria-label="Zoom out" onClick={() => zoom(1 / 1.25)} className="rounded p-1 text-content-secondary hover:bg-surface-2">
            <IconMinus size={14} stroke={2} />
          </button>
          <button type="button" aria-label="Fit to view" onClick={() => setView(base)} className="rounded p-1 text-content-secondary hover:bg-surface-2">
            <IconMaximize size={14} stroke={2} />
          </button>
        </div>
      )}

      <svg
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        className={`block w-full ${interactive ? "h-full min-h-[520px] cursor-grab active:cursor-grabbing" : "h-auto"}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={interactive ? (e) => zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15) : undefined}
        onPointerDown={
          interactive
            ? (e) => {
                dragRef.current = { startX: e.clientX, startY: e.clientY, vx: view.x, vy: view.y };
                (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
              }
            : undefined
        }
        onPointerMove={
          interactive
            ? (e) => {
                const d = dragRef.current;
                if (!d) return;
                const el = e.currentTarget as SVGSVGElement;
                const scale = view.w / el.clientWidth;
                setView((v) => ({ ...v, x: d.vx - (e.clientX - d.startX) * scale, y: d.vy - (e.clientY - d.startY) * scale }));
              }
            : undefined
        }
        onPointerUp={interactive ? () => (dragRef.current = null) : undefined}
      >
        <defs>
          <pattern id="code-map-grid" width="28" height="28" patternUnits="userSpaceOnUse">
            <circle cx="1.5" cy="1.5" r="1.2" fill="color-mix(in srgb, var(--color-content-primary) 6%, transparent)" />
          </pattern>
        </defs>
        <rect x={vb.x} y={vb.y} width={vb.w} height={vb.h} fill="url(#code-map-grid)" />

        {/* Folder→folder aggregated edges: calm ink hairlines. */}
        {layout.folderEdges.map((e) => {
          const a = regionCenter(e.from);
          const b = regionCenter(e.to);
          const mx = (a.x + b.x) / 2;
          return (
            <path
              key={`${e.from}->${e.to}`}
              d={`M ${a.x},${a.y} C ${mx},${a.y} ${mx},${b.y} ${b.x},${b.y}`}
              fill="none"
              stroke="color-mix(in srgb, var(--color-border-strong) 55%, transparent)"
              strokeWidth={Math.min(1 + e.count * 0.25, 2.5)}
            />
          );
        })}

        {/* Focused file's individual edges — cobalt reveal on hover/selection. */}
        {focusId &&
          focusAdj &&
          [
            ...focusAdj.imports.map((to) => ({ from: focusId, to })),
            ...focusAdj.importedBy.map((from) => ({ from, to: focusId })),
          ].map(({ from, to }) => {
            const a = layout.chips.get(from);
            const b = layout.chips.get(to);
            if (!a || !b) return null;
            const ax = a.x + CHIP_W;
            const ay = a.y + CHIP_H / 2;
            const bx = b.x;
            const by = b.y + CHIP_H / 2;
            const mx = (ax + bx) / 2;
            return (
              <path
                key={`focus-${from}->${to}`}
                d={`M ${ax},${ay} C ${mx},${ay} ${mx},${by} ${bx},${by}`}
                fill="none"
                stroke="color-mix(in srgb, var(--color-accent-primary) 45%, transparent)"
                strokeWidth={1.5}
              />
            );
          })}

        {/* Folder regions (paper panels) + their header row. */}
        {layout.regions.map((r) => {
          const regionSel: CodeMapSelection = { kind: "folder", id: r.folder };
          const isSelected = selected?.kind === "folder" && selected.id === r.folder;
          const header = (
            <span className="flex h-full w-full items-center gap-1.5 px-3">
              <IconFolder size={13} stroke={1.75} className="shrink-0 text-accent-secondary" aria-hidden />
              <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-content-secondary">{r.folder}</span>
              <span className="ml-auto font-mono text-[10px] text-content-muted">{r.fileIds.length}</span>
            </span>
          );
          return (
            <g key={r.folder}>
              <rect
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                rx={12}
                fill="var(--color-surface-1)"
                stroke={isSelected ? "color-mix(in srgb, var(--color-accent-primary) 40%, transparent)" : "var(--color-border-subtle)"}
                strokeWidth={isSelected ? 1.5 : 1}
              />
              <foreignObject x={r.x} y={r.y} width={r.w} height={REGION_HEADER_H}>
                {onSelect ? (
                  <button type="button" onClick={() => onSelect(regionSel)} className="h-full w-full cursor-pointer hover:bg-content-primary/[0.03]" data-selected={isSelected}>
                    {header}
                  </button>
                ) : hrefFor ? (
                  <a href={hrefFor(regionSel)} className="block h-full w-full hover:bg-content-primary/[0.03]" data-selected={isSelected}>
                    {header}
                  </a>
                ) : (
                  <div className="h-full w-full" data-selected={isSelected}>{header}</div>
                )}
              </foreignObject>
            </g>
          );
        })}

        {/* File chips. */}
        {topology.nodes.map((n) => {
          const pos = layout.chips.get(n.id);
          if (!pos) return null;
          const s = sensors[n.id] ?? {};
          const path = n.meta?.path as string | undefined;
          const dim = isDim(n.id, n.label, path);
          const sel: CodeMapSelection = { kind: "file", id: n.id };
          const inner = chipInner(n.id, n.label, s);
          return (
            <foreignObject
              key={n.id}
              x={pos.x}
              y={pos.y}
              width={CHIP_W}
              height={CHIP_H}
              className="overflow-visible"
              data-dimmed={dim}
              data-selected={selected?.kind === "file" && selected.id === n.id}
              style={{ opacity: dim ? 0.2 : 1, transition: "opacity 200ms" }}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
            >
              {onSelect ? (
                <button type="button" onClick={() => onSelect(sel)} className="block h-full w-full cursor-pointer text-left">
                  {inner}
                </button>
              ) : hrefFor ? (
                <a href={hrefFor(sel)} className="block h-full w-full">
                  {inner}
                </a>
              ) : (
                <div className="h-full w-full">{inner}</div>
              )}
            </foreignObject>
          );
        })}
      </svg>
    </div>
  );
}
