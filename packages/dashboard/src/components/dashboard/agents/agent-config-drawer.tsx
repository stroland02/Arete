"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { IconCpu, IconX } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { ReadinessBadge } from "@/components/ui/readiness-badge";
import type { Agent } from "./agent-catalog";
import type { ActiveModelConnection } from "@/lib/model-connections-map";

export interface AgentConfigDrawerProps {
  agent: Agent | null;
  findingCount: number;
  /** The connected model this agent runs on (dynamic; replaces the old hardcoded
      Claude model list — providers are now user-selectable under AI Models). */
  activeModel?: ActiveModelConnection | null;
  onClose: () => void;
}

/**
 * Right-side slide-in drawer with the agent's real details (role, model, what
 * it inspects, recent finding count) plus configuration controls. The controls
 * persist per installation through `/api/agents/[id]/config` (AgentConfig).
 *
 * Still no fake saves: the panel renders the config the server returns rather
 * than what it sent, and every failed save says so and changes nothing. The
 * model pick remains read-only — it is chosen once under AI Models and applies
 * to every agent, so a per-agent control there would be the fake this drawer
 * has always refused.
 */
export function AgentConfigDrawer({ agent, findingCount, activeModel = null, onClose }: AgentConfigDrawerProps) {
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
            className="fixed inset-0 z-40 bg-content-primary/40 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden
          />
          {/* Keyed by agent id so the local (unsaved) controls reset cleanly
              when a different agent is opened. */}
          <DrawerPanel key={agent.id} agent={agent} findingCount={findingCount} activeModel={activeModel} onClose={onClose} />
        </>
      )}
    </AnimatePresence>
  );
}

function DrawerPanel({
  agent,
  findingCount,
  activeModel,
  onClose,
}: {
  agent: Agent;
  findingCount: number;
  activeModel: ActiveModelConnection | null;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(true);
  const [severity, setSeverity] = useState("warning");
  const [guidance, setGuidance] = useState("");
  // "loading" until the saved config arrives, so the controls never briefly
  // show defaults that are not what is stored — a flash of the wrong value is
  // indistinguishable from a setting that did not save.
  const [status, setStatus] = useState<"loading" | "ready" | "saving">("loading");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/agents/${agent.id}/config`);
        if (!res.ok) throw new Error(String(res.status));
        const { config } = await res.json();
        if (cancelled) return;
        setEnabled(config.enabled);
        setSeverity(config.severityThreshold);
        setGuidance(config.guidance);
      } catch {
        // Leave the defaults in place. They are what the agent actually runs on
        // when nothing is saved, so this is accurate rather than a fallback.
      } finally {
        if (!cancelled) setStatus("ready");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agent.id]);

  async function save() {
    setStatus("saving");
    setSaveError(null);
    try {
      const res = await fetch(`/api/agents/${agent.id}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, severityThreshold: severity, guidance }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveError(data.error ?? `Could not save (${res.status}). Nothing was changed.`);
        return;
      }
      // Render what came back, not what was sent: if the server stored anything
      // different, the panel must show the stored value.
      setEnabled(data.config.enabled);
      setSeverity(data.config.severityThreshold);
      setGuidance(data.config.guidance);
      setSavedAt(new Date().toLocaleTimeString());
    } catch {
      setSaveError("Could not reach the server. Nothing was changed.");
    } finally {
      setStatus("ready");
    }
  }

  const Icon = agent.icon;

  return (
    <motion.aside
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${agent.label} agent details and settings`}
      tabIndex={-1}
      className="fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col gap-6 overflow-y-auto border-l border-border-default bg-surface-1 p-6 shadow-[0_0_60px_-15px_rgba(26,27,24,0.35)] focus:outline-none"
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
          <p className="truncate text-xs text-content-muted">
            Specialist review agent{activeModel ? ` · ${activeModel.model}` : ""}
          </p>
        </div>
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

      {/* Configuration — persisted per installation via /api/agents/[id]/config */}
      <section className="space-y-4 border-t border-border-subtle pt-5">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-content-muted">
            Configuration
          </h4>
          {/* The badge said "Not saved yet" and was accurate until these
              controls were backed by AgentConfig. It reflects the model pick
              only now, which genuinely is still read-only. */}
          <ReadinessBadge level="partial" label="Model is read-only" />
        </div>

        {/* Model — the connected model this agent runs on. Read-only and dynamic:
            the provider/model is chosen once under AI Models, and every agent
            runs on it. Per-agent overrides are the "coming soon" below. */}
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-content-primary">Model</p>
          <p className="text-xs text-content-muted">The connected model this agent runs on.</p>
          {activeModel ? (
            <Link
              href="/connections/ai-models"
              title={`Running on ${activeModel.provider} · ${activeModel.model}`}
              className="inline-flex items-center gap-2 rounded-full border border-border-default bg-surface-2 py-1.5 pl-2.5 pr-3 text-sm font-medium text-content-primary transition-colors hover:border-border-strong"
            >
              <IconCpu size={15} stroke={1.75} className="shrink-0 text-accent-primary" aria-hidden />
              <span className="max-w-[16rem] truncate font-mono text-[13px]">{activeModel.model}</span>
              <span className="text-xs font-normal text-content-muted">· {activeModel.provider}</span>
            </Link>
          ) : (
            <Link
              href="/connections/ai-models"
              className="inline-flex items-center gap-2 rounded-full border border-dashed border-border-default bg-surface-2 py-1.5 pl-2.5 pr-3 text-sm font-medium text-content-muted transition-colors hover:border-border-strong"
            >
              <IconCpu size={15} stroke={1.75} className="shrink-0" aria-hidden />
              Connect a model
            </Link>
          )}
        </div>

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
                : "border-border-strong bg-content-primary/5"
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
          <Button
            onClick={save}
            disabled={status !== "ready"}
            className="w-full"
          >
            {status === "saving" ? "Saving…" : "Save changes"}
          </Button>
          {saveError ? (
            <p className="text-xs text-accent-danger">{saveError}</p>
          ) : savedAt ? (
            <p className="text-xs text-content-muted">Saved at {savedAt}.</p>
          ) : (
            <p className="text-xs text-content-muted">
              Saved per installation and applied to this agent&apos;s next run.
            </p>
          )}
        </div>
      </section>
    </motion.aside>
  );
}
