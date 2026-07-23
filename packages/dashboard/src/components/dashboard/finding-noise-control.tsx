"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconAlertTriangle, IconBell, IconBellOff, IconLoader2 } from "@tabler/icons-react";

/**
 * The human end of the noise loop — Stage 1.4.
 *
 * The escalation machine has always been able to observe a finding, count its
 * recurrences and escalate it; nothing could ever tell it "this one is noise".
 * This control is that sentence. It POSTs to /api/findings/[id]/noise and lets
 * the server decide — it never assumes the write succeeded.
 *
 * It offers exactly two transitions, because those are the only two the route
 * accepts: silence (→ SILENCED) and restore (→ OPEN). `UNDER_OBSERVATION` and
 * `ESCALATED` are shown as read-only status, never as buttons — a human
 * asserting "under observation" would be claiming a recurrence count the
 * machine never measured.
 *
 * On success it calls `router.refresh()` rather than reloading the page: the
 * server component re-renders with the new state (so the row dims and the
 * agent prompt drops the finding) without losing scroll position — the same
 * pattern `ai-models-section.tsx` and `glassbox-dock.tsx` already use.
 */

type ControlState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "error"; message: string };

/** Read-only labels for the states only the machine can assign. */
const MACHINE_LABELS: Record<string, string> = {
  UNDER_OBSERVATION: "Watching for recurrence",
  ESCALATED: "Escalated — recurred past its threshold",
};

export function FindingNoiseControl({
  findingId,
  noiseState,
}: {
  findingId: string;
  noiseState: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<ControlState>({ kind: "idle" });

  const silenced = noiseState === "SILENCED";
  const next = silenced ? "OPEN" : "SILENCED";

  async function setNoiseState() {
    setState({ kind: "pending" });
    try {
      const res = await fetch(`/api/findings/${encodeURIComponent(findingId)}/noise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: next }),
      });
      if (res.status === 200) {
        // The label flips only because the SERVER re-rendered with the stored
        // state — this component never flips it optimistically, so what you
        // read is always what is saved.
        router.refresh();
        setState({ kind: "idle" });
        return;
      }
      if (res.status === 404) {
        setState({
          kind: "error",
          message: "This finding is no longer available on your account.",
        });
        return;
      }
      setState({ kind: "error", message: `Could not save (${res.status})` });
    } catch {
      setState({ kind: "error", message: "Network error — nothing was saved." });
    }
  }

  const machineLabel = MACHINE_LABELS[noiseState];

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {machineLabel && (
          <span
            className="text-[10px] text-content-muted"
            title="Set by the escalation machine, not by hand"
          >
            {machineLabel}
          </span>
        )}
        <button
          type="button"
          onClick={setNoiseState}
          disabled={state.kind === "pending"}
          aria-label={silenced ? "Restore this finding" : "Silence this finding as noise"}
          className="inline-flex items-center gap-1 rounded-full border border-border-subtle px-2 py-0.5 text-[10px] font-medium text-content-muted transition-colors hover:border-border-strong hover:text-content-secondary disabled:opacity-60"
        >
          {state.kind === "pending" ? (
            <IconLoader2 size={11} className="motion-safe:animate-spin" aria-hidden />
          ) : silenced ? (
            <IconBell size={11} stroke={1.75} aria-hidden />
          ) : (
            <IconBellOff size={11} stroke={1.75} aria-hidden />
          )}
          {state.kind === "pending" ? "Saving…" : silenced ? "Restore" : "Silence"}
        </button>
      </div>
      {state.kind === "error" && (
        <p className="flex items-center gap-1 text-[10px] leading-4 text-accent-danger">
          <IconAlertTriangle size={11} aria-hidden />
          {state.message}
        </p>
      )}
    </div>
  );
}
