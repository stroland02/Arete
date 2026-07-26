"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { IconSettings, IconSend, IconArrowRight, IconCpu } from "@tabler/icons-react";
import type { Agent } from "./agent-catalog";
import type { AgentActivityFinding } from "@/lib/queries";
import type { ActiveModelConnection } from "@/lib/model-connections-map";
import { cn } from "@/lib/utils";

const SEV_PILL: Record<string, string> = {
  error: "text-accent-danger border-accent-danger/30 bg-accent-danger/10",
  warning: "text-accent-warning border-accent-warning/30 bg-accent-warning/10",
  info: "text-accent-info border-accent-info/30 bg-accent-info/10",
};

interface ChatTurn {
  role: "user" | "agent";
  text: string;
}

export interface AgentConversationProps {
  agent: Agent;
  findings: AgentActivityFinding[];
  findingCount: number;
  hasReviews: boolean;
  /** Whether a repository is connected. */
  repoConnected?: boolean;
  /** Whether an AI model is connected — what the agent actually needs to run. */
  modelConnected?: boolean;
  /** The model this agent runs on. Replaces the old hardcoded Opus/Sonnet tier —
   *  every agent runs on the tenant's connected model today, so it's shown live. */
  activeModel?: ActiveModelConnection | null;
  /** The work item/problem this chat is scoped to (Services deep-link), or
   *  null for the agent's "general" thread. A different containerId is a
   *  different, fresh conversation — the parent remounts this component (key)
   *  when it changes, and history is (re)loaded for the new scope. */
  containerId?: string | null;
  onConfigure: (agentId: string) => void;
}

/**
 * Center pane of /agents: the selected specialist's own view. Shows its REAL
 * findings from recent reviews (path:line + severity + rationale) — the honest
 * "what it's doing in the background" — plus a live composer that talks to the
 * agent via /api/agents/[id]/chat. Nothing here is fabricated: when the agents
 * service is unreachable the composer surfaces a truthful notice instead of a
 * canned reply.
 */
export function AgentConversation({ agent, findings, findingCount, hasReviews, repoConnected = false, modelConnected = false, activeModel = null, containerId = null, onConfigure }: AgentConversationProps) {
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [sending, setSending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  // Keep the newest message in view: the scroll region should follow the
  // conversation to the bottom as turns are appended (and while a reply is
  // pending), so replies never get cut off below the fold.
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, sending]);

  // Load this thread's saved history on mount. The parent keys this component
  // by (agent, containerId), so a fresh mount always means a genuinely
  // different thread — one effect run per mount is correct, no deps needed.
  useEffect(() => {
    let cancelled = false;
    const qs = containerId ? `?containerId=${encodeURIComponent(containerId)}` : "";
    fetch(`/api/agents/${agent.id}/chat${qs}`)
      .then((r) => (r.ok ? r.json() : { turns: [] }))
      .then((d: { turns?: ChatTurn[] }) => {
        if (cancelled) return;
        if (Array.isArray(d.turns) && d.turns.length > 0) setTurns(d.turns);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const text = message.trim();
    if (!text || sending) return;
    setMessage("");
    setUnavailable(false);
    setTurns((t) => [...t, { role: "user", text }]);
    setSending(true);
    try {
      const res = await fetch(`/api/agents/${agent.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, containerId }),
      });
      if (!res.ok) {
        // A classified provider error (402) carries an actionable reason (out
        // of credits, bad key, …) — surface it as a notice instead of the
        // generic "service unavailable", so the user knows what to fix.
        if (res.status === 402) {
          const data = await res.json().catch(() => ({}));
          const msg = typeof data.error === "string" ? data.error : "The AI model call failed.";
          setTurns((t) => [...t, { role: "agent", text: msg }]);
          return;
        }
        setUnavailable(true);
        return;
      }
      const data = await res.json();
      const reply = typeof data.reply === "string" ? data.reply : "";
      setTurns((t) => [...t, { role: "agent", text: reply || "(no response)" }]);
    } catch {
      setUnavailable(true);
    } finally {
      setSending(false);
    }
  }

  const status = hasReviews
    ? `Analyzed · ${findingCount} finding${findingCount === 1 ? "" : "s"}`
    : "Idle";

  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label={`${agent.label} conversation`}>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <span
          className={cn("h-1.5 w-1.5 rounded-full", hasReviews ? "bg-accent-success" : "bg-content-muted/40")}
          aria-hidden
        />
        <h2 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">{agent.label}</h2>
        {activeModel && (
          <span
            title={`Running on ${activeModel.provider} · ${activeModel.model}`}
            className="inline-flex max-w-[12rem] items-center gap-1 rounded-full border border-accent-primary/25 bg-accent-primary/10 px-1.5 py-px text-[10px] font-medium text-accent-primary"
          >
            <IconCpu size={11} aria-hidden />
            <span className="truncate font-mono">{activeModel.model}</span>
          </span>
        )}
        <span className="ml-auto truncate font-mono text-[11px] text-content-muted">{status}</span>
        <button
          type="button"
          onClick={() => onConfigure(agent.id)}
          aria-label={`Configure the ${agent.label} agent`}
          className="ml-1 shrink-0 rounded-md p-1 text-content-muted transition-colors hover:bg-content-primary/[0.06] hover:text-content-secondary"
        >
          <IconSettings size={15} stroke={1.75} />
        </button>
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {findings.length > 0 ? (
          <ol className="space-y-2">
            <li className="pb-1 text-[10px] uppercase tracking-wider text-content-muted">
              {agent.label}&apos;s findings from your recent reviews
            </li>
            {findings.map((f) => (
              <li
                key={`${f.reviewId}:${f.path}:${f.line}`}
                className="rounded-lg border border-border-subtle bg-surface-2/40 px-3 py-2"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "rounded-full border px-1.5 py-px text-[9px] font-bold uppercase tracking-wide",
                      SEV_PILL[f.severity] ?? SEV_PILL.info,
                    )}
                  >
                    {f.severity}
                  </span>
                  <span className="font-mono text-[10.5px] text-content-muted">
                    {f.path}:{f.line}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-content-muted">PR #{f.prNumber}</span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-content-secondary">{f.body}</p>
              </li>
            ))}
          </ol>
        ) : turns.length > 0 ? (
          /* A conversation is already running: collapse the full profile/CTA
             block to one compact line right above the chat instead of the
             h-full filler below — that filler used to push every turn well
             below the fold with a dead gap in between. */
          <p className="border-b border-border-subtle px-1 pb-3 text-[12px] leading-relaxed text-content-muted">
            {agent.description}
          </p>
        ) : (
          /* No findings, no conversation yet: preview the agent from real
             catalog metadata (description + what it inspects) rather than a
             bare empty message, so each specialist reads as intentional and
             complete before any repo is connected. Nothing here is fabricated. */
          <div className="flex flex-col gap-4 px-1 py-1">
            {findingCount > 0 && (
              <p className="rounded-lg border border-border-subtle bg-surface-2/40 px-3 py-2 text-[11px] leading-4 text-content-muted">
                {agent.label} · {findingCount} finding{findingCount === 1 ? "" : "s"} on record — none in the most
                recent activity window. Open a recent review to see its latest findings.
              </p>
            )}

            <p className="text-[12.5px] leading-relaxed text-content-secondary">{agent.longDescription}</p>

            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-content-muted">
                What {agent.label} inspects
              </p>
              <ul className="space-y-1.5">
                {agent.inspects.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-[12px] leading-5 text-content-secondary">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent-primary/70" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {!repoConnected ? (
              <>
                <Link
                  href="/connections"
                  className="inline-flex items-center gap-2 self-start rounded-xl border border-accent-primary/30 bg-accent-primary/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-primary/30"
                >
                  Connect a repository
                  <IconArrowRight size={15} stroke={2} />
                </Link>
                <p className="text-[11px] leading-4 text-content-muted">
                  {agent.label} runs automatically on your pull requests — findings appear here once a connected repo has an open PR.
                </p>
              </>
            ) : !modelConnected ? (
              <>
                <Link
                  href="/connections/ai-models"
                  className="inline-flex items-center gap-2 self-start rounded-xl border border-accent-primary/30 bg-accent-primary/20 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-primary/30"
                >
                  Connect an AI model
                  <IconArrowRight size={15} stroke={2} />
                </Link>
                <p className="text-[11px] leading-4 text-content-muted">
                  Your repository is connected — {agent.label} just needs a model to run on. Connect one under
                  AI Models (Local · Ollama is free) and it will start reviewing your pull requests.
                </p>
              </>
            ) : (
              <p className="text-[11px] leading-4 text-content-muted">
                {agent.label} is ready and runs automatically on your pull requests — findings appear here once one
                of your connected repositories has an open PR.
              </p>
            )}
          </div>
        )}

        {turns.length > 0 && (
          <div className="mt-3 space-y-2">
            {turns.map((t, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-lg px-3 py-2 text-[12px] leading-relaxed",
                  t.role === "user" ? "bg-accent-primary/10 text-content-primary" : "bg-surface-2/60 text-content-secondary",
                )}
              >
                {t.text}
              </div>
            ))}
          </div>
        )}
        {/* Scroll anchor: the effect keeps this in view so new turns pin to the bottom. */}
        <div ref={bottomRef} aria-hidden />
      </div>

      <footer className="shrink-0 border-t border-border-subtle px-3 py-2.5">
        <form
          onSubmit={handleSend}
          className="flex items-center gap-2 rounded-lg border border-border-default bg-surface-2/60 px-3 py-2"
        >
          <input
            type="text"
            id="agent-chat-message"
            name="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            disabled={sending}
            placeholder={`Ask ${agent.label} about its findings…`}
            aria-label={`Message the ${agent.label} agent`}
            className="w-full bg-transparent font-mono text-xs text-content-primary placeholder:text-content-muted/70 focus:outline-none disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={sending || !message.trim()}
            aria-label="Send message"
            className="shrink-0 text-content-muted transition-colors hover:text-accent-primary disabled:opacity-40"
          >
            <IconSend size={15} stroke={1.75} />
          </button>
        </form>
        <p className="mt-1.5 px-1 font-mono text-[10px] text-content-muted/80">
          {unavailable
            ? "live chat activates when the agents service is running — nothing here is fabricated"
            : "talk to this agent about its findings, or ask it to adjust the code"}
        </p>
      </footer>
    </section>
  );
}
