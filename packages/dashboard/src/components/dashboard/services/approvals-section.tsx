"use client";

import { useState } from "react";
import { IconAlertTriangle, IconLoader2, IconLock } from "@tabler/icons-react";
import type { PendingApprovalView } from "@/lib/approvals";

/**
 * The rail's approval queue: infrastructure commands a paused agent is waiting
 * on a human to authorize.
 *
 * This renders nothing at all when there are none. An empty "Approvals" header
 * would imply a queue exists to watch; the honest signal for "nothing is
 * blocked" is the absence of the section, and the triage bar already carries
 * the count.
 *
 * The COMMAND IS SHOWN VERBATIM in monospace, never summarised or truncated
 * away. A human authorizing a command has to be able to read the command; a
 * paraphrase would mean approving something other than what runs.
 *
 * Both controls reflect the server's real answer. A rejected command can never
 * be approved afterwards (409), an already-actioned one cannot be rejected
 * (409), and an unconfigured environment says so (503) rather than appearing
 * to succeed.
 */
export function ApprovalsSection({ approvals }: { approvals: PendingApprovalView[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  // Locally decided ids drop out of the list immediately so the queue reflects
  // the decision without a full-page reload losing the rail's position.
  const [decided, setDecided] = useState<Set<string>>(new Set());

  const pending = approvals.filter((a) => !decided.has(a.id));
  if (pending.length === 0) return null;

  async function act(id: string, action: "approve" | "reject") {
    setBusy(id);
    setMessages((m) => ({ ...m, [id]: "" }));
    try {
      const res = await fetch(`/api/approvals/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
      });
      if (res.ok) {
        setDecided((d) => new Set(d).add(id));
        return;
      }
      const text =
        res.status === 503
          ? "Approvals aren't wired up in this environment yet."
          : res.status === 409
            ? "This approval was already decided — reload to see its current state."
            : res.status === 404
              ? "This approval no longer exists."
              : `Couldn't ${action} it (${res.status}).`;
      setMessages((m) => ({ ...m, [id]: text }));
    } catch {
      setMessages((m) => ({ ...m, [id]: "Network error — try again." }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border-t border-border-subtle">
      <div className="flex items-center gap-1.5 px-3 pb-1.5 pt-3">
        <IconLock size={12} stroke={2} className="text-accent-warning" aria-hidden />
        <h3 className="text-xs font-semibold uppercase tracking-wider text-content-secondary">
          Awaiting your approval
        </h3>
        <span className="font-mono text-[10px] tabular-nums text-content-muted">{pending.length}</span>
      </div>
      <p className="px-3 pb-2 text-[10.5px] leading-4 text-content-muted">
        An agent has paused and will not continue until you decide.
      </p>
      <ul className="space-y-1.5 px-3 pb-3">
        {pending.map((a) => (
          <li
            key={a.id}
            className="space-y-1.5 rounded-lg border border-accent-warning/30 bg-accent-warning/5 p-2.5"
          >
            <p className="text-[11.5px] leading-4 text-content-secondary">{a.reason}</p>
            <pre className="overflow-x-auto rounded border border-border-default bg-surface-2 px-2 py-1.5 font-mono text-[10.5px] leading-relaxed text-content-primary">
              {a.command}
            </pre>
            <p className="font-mono text-[10px] text-content-muted">
              {a.repositoryFullName} · PR #{a.prNumber}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => act(a.id, "approve")}
                disabled={busy !== null}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy === a.id ? (
                  <IconLoader2 size={12} className="motion-safe:animate-spin" aria-hidden />
                ) : null}
                Approve
              </button>
              <button
                type="button"
                onClick={() => act(a.id, "reject")}
                disabled={busy !== null}
                className="inline-flex items-center justify-center rounded-lg border border-border-default bg-surface-2 px-3 py-1.5 text-[11px] font-semibold text-content-secondary transition-colors hover:bg-content-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Reject
              </button>
            </div>
            {messages[a.id] ? (
              <p className="flex items-start gap-1 text-[10px] leading-4 text-accent-danger">
                <IconAlertTriangle size={11} className="mt-px shrink-0" aria-hidden />
                {messages[a.id]}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
