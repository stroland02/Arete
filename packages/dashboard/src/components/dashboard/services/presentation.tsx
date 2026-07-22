"use client";

import { useState, type ReactNode } from "react";
import { IconChevronDown } from "@tabler/icons-react";
import type { Issue, Severity } from "./types";

/**
 * Shared presentation for the Services workspace: the semantic style maps, the
 * small formatting helpers, and the collapsible `PanelSection` every right-pane
 * panel is built from.
 *
 * This module is the BOTTOM of the services import graph — it must never import
 * a panel or the workspace itself, or the graph goes circular.
 */

// ── Style maps (semantic tokens — adapt to both themes) ──────────────────────
export const SEV_DOT: Record<Severity | "clear", string> = {
  critical: "bg-accent-danger", high: "bg-accent-warning", medium: "bg-accent-info", clear: "bg-accent-success",
};
export const SEV_PILL: Record<Severity, string> = {
  critical: "text-accent-danger border-accent-danger/30 bg-accent-danger/10",
  high: "text-accent-warning border-accent-warning/30 bg-accent-warning/10",
  medium: "text-accent-info border-accent-info/30 bg-accent-info/10",
};
export const SEV_LABEL: Record<Severity, string> = { critical: "Critical", high: "High", medium: "Medium" };
export const TONE_TEXT: Record<string, string> = {
  critical: "text-accent-danger", high: "text-accent-warning", medium: "text-accent-info",
  good: "text-accent-success", accent: "text-accent-primary",
};

export function markerForTone(tone: Issue["timeline"][number]["tone"]): string {
  if (tone === "good") return "✓";
  if (tone === "accent") return "◈";
  return "●"; // critical/high/medium — the telemetry source's own detection
}

// Real review riskLevel → rail dot / pill styling (risk tiers, not the sample
// Severity union). "low"/"unknown" collapse to the calm/success tone.
export const RISK_DOT: Record<string, string> = {
  critical: "bg-accent-danger",
  high: "bg-accent-warning",
  medium: "bg-accent-info",
};
export function riskDot(risk: string): string {
  return RISK_DOT[risk.toLowerCase()] ?? "bg-accent-success";
}
export const RISK_PILL: Record<string, string> = {
  critical: "text-accent-danger border-accent-danger/30 bg-accent-danger/10",
  high: "text-accent-warning border-accent-warning/30 bg-accent-warning/10",
  medium: "text-accent-info border-accent-info/30 bg-accent-info/10",
};
export function riskPill(risk: string): string {
  return RISK_PILL[risk.toLowerCase()] ?? "text-accent-success border-accent-success/30 bg-accent-success/10";
}
export function shortWhen(iso: string): string {
  // Date-only, locale-formatted; the transcript carries the precise moment.
  return new Date(iso).toLocaleDateString();
}

export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="border-b border-border-subtle">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-content-muted transition-colors hover:text-content-secondary"
      >
        <IconChevronDown
          size={12}
          stroke={2}
          className={`shrink-0 transition-transform duration-150 ${!open ? "-rotate-90" : ""}`}
          aria-hidden
        />
        {title}
      </button>
      {open && <div className="px-2 pb-3">{children}</div>}
    </div>
  );
}
