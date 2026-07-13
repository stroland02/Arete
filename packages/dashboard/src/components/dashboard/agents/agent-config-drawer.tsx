"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { IconX } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Agent } from "./agent-catalog";

const TIER_LABEL = { opus: "Opus", sonnet: "Sonnet" } as const;
const TIER_CLASS = {
  opus: "bg-accent-primary/10 text-accent-primary border-accent-primary/25",
  sonnet: "bg-white/5 text-content-secondary border-white/10",
} as const;

export interface AgentConfigDrawerProps {
  agent: Agent | null;
  findingCount: number;
  onClose: () => void;
}

/**
 * Right-side slide-in drawer with the agent's real details (role, model
 * tier, what it inspects, recent finding count) plus configuration controls.
 * The controls are locally interactive but deliberately NOT persisted yet —
 * the Save button stays disabled and the note below says so. No fake saves.
 */
export function AgentConfigDrawer({ agent, findingCount, onClose }: AgentConfigDrawerProps) {
  useEffect(() => {
    if (!agent) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [agent, onClose]);

  return (
    <AnimatePresence>
      {agent && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden
          />
          {/* Keyed by agent id so the local (unsaved) controls reset cleanly
              when a different agent is opened. */}
          <DrawerPanel key={agent.id} agent={agent} findingCount={findingCount} onClose={onClose} />
        </>
      )}
    </AnimatePresence>
  );
}

function DrawerPanel({
  agent,
  findingCount,
  onClose,
}: {
  agent: Agent;
  findingCount: number;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(true);
  const [severity, setSeverity] = useState("warning");
  const [guidance, setGuidance] = useState("");

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const Icon = agent.icon;

  return (
    <motion.aside
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${agent.label} agent details and settings`}
      tabIndex={-1}
      className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col gap-6 overflow-y-auto border-l border-border-default bg-surface-0/95 p-6 backdrop-blur-xl focus:outline-none"
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", stiffness: 320, damping: 34 }}
    >
      {/* Identity */}
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-accent-primary/15 bg-accent-primary/10 text-accent-primary">
          <Icon size={22} stroke={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-content-primary">{agent.label}</h3>
          <p className="text-xs text-content-muted">Specialist review agent</p>
        </div>
        <Badge className={TIER_CLASS[agent.tier]}>{TIER_LABEL[agent.tier]}</Badge>
        <Button variant="icon" size="icon" onClick={onClose} aria-label="Close agent settings">
          <IconX size={18} stroke={1.75} />
        </Button>
      </div>

      {/* What it does */}
      <section className="space-y-3">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-content-muted">
          What it does
        </h4>
        <p className="text-sm leading-relaxed text-content-secondary">{agent.longDescription}</p>
        <ul className="space-y-1.5">
          {agent.inspects.map((item) => (
            <li key={item} className="flex items-center gap-2 text-xs text-content-muted">
              <span className="h-1 w-1 shrink-0 rounded-full bg-accent-primary/70" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      </section>

      {/* Recent activity — real counts only */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-content-muted">
          Recent activity
        </h4>
        {findingCount > 0 ? (
          <p className="text-sm text-content-secondary">
            <span className="font-mono font-semibold tabular-nums text-content-primary">
              {findingCount}
            </span>{" "}
            verified finding{findingCount === 1 ? "" : "s"} posted to your pull requests.
          </p>
        ) : (
          <p className="text-sm text-content-muted">No recent findings from this agent.</p>
        )}
      </section>

      {/* Configuration — interactive, honestly unsaved */}
      <section className="space-y-4 border-t border-border-subtle pt-5">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-content-muted">
          Configuration
        </h4>

        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-content-primary">Enabled</p>
            <p className="text-xs text-content-muted">Run this agent on every pull request.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={`${enabled ? "Disable" : "Enable"} the ${agent.label} agent`}
            onClick={() => setEnabled((v) => !v)}
            className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
              enabled
                ? "border-accent-primary/40 bg-accent-primary/60"
                : "border-border-strong bg-white/5"
            }`}
          >
            <span
              className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-[left] ${
                enabled ? "left-[calc(100%-1.25rem)]" : "left-0.5"
              }`}
              aria-hidden
            />
          </button>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor={`severity-${agent.id}`}
            className="text-sm font-medium text-content-primary"
          >
            Severity threshold
          </label>
          <p className="text-xs text-content-muted">
            Only post findings at or above this severity.
          </p>
          <select
            id={`severity-${agent.id}`}
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
            className="h-9 w-full rounded-lg border border-border-default bg-surface-2 px-3 text-sm text-content-primary focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
          >
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="error">Error</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor={`guidance-${agent.id}`}
            className="text-sm font-medium text-content-primary"
          >
            Custom guidance
          </label>
          <textarea
            id={`guidance-${agent.id}`}
            value={guidance}
            onChange={(event) => setGuidance(event.target.value)}
            rows={3}
            placeholder={`e.g. "Pay extra attention to our payments module."`}
            className="w-full resize-none rounded-lg border border-border-default bg-surface-2 px-3 py-2 text-sm text-content-primary placeholder:text-content-muted/60 focus:outline-none focus:ring-2 focus:ring-accent-primary/50"
          />
        </div>

        <div className="space-y-2 pt-1">
          <Button disabled className="w-full">
            Save changes
          </Button>
          <p className="text-xs text-content-muted">
            Agent settings aren&apos;t saved yet — per-repository configuration is coming soon.
          </p>
        </div>
      </section>
    </motion.aside>
  );
}
