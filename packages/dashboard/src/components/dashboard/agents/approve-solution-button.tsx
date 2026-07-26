"use client";

import { useState } from "react";
import { IconAlertTriangle, IconCheck, IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";

/**
 * The human control for the FIRST gate: approve the composed solution
 * (ready → solution_approved). Wave-2 ③.
 *
 * It only TRIGGERS the gate — the authority is the server. It POSTs to
 * /api/containers/[id]/approve and reflects the outcome; it never decides
 * readiness itself, so a not-yet-ready container comes back 409 and the control
 * says so rather than pretending to approve. It does NOT post a pull request —
 * that is the second gate, on Services.
 */
type ButtonState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "approved" }
  | { kind: "not-ready" }
  | { kind: "error"; message: string };

export function ApproveSolutionButton({
  containerId,
  onApproved,
}: {
  containerId: string;
  onApproved?: () => void;
}) {
  const [state, setState] = useState<ButtonState>({ kind: "idle" });

  async function approve() {
    setState({ kind: "pending" });
    try {
      const res = await fetch(`/api/containers/${encodeURIComponent(containerId)}/approve`, {
        method: "POST",
      });
      if (res.status === 200) {
        setState({ kind: "approved" });
        onApproved?.();
        return;
      }
      if (res.status === 409) {
        setState({ kind: "not-ready" });
        return;
      }
      setState({ kind: "error", message: `Approval failed (${res.status})` });
    } catch {
      setState({ kind: "error", message: "Network error — try again" });
    }
  }

  if (state.kind === "approved") {
    return (
      <Button size="sm" disabled className="h-8 w-full rounded-lg text-[12px]">
        <IconCheck size={13} stroke={2} aria-hidden />
        Solution approved
      </Button>
    );
  }

  return (
    <div className="space-y-1.5">
      <Button
        size="sm"
        onClick={approve}
        disabled={state.kind === "pending"}
        className="h-8 w-full rounded-lg text-[12px]"
      >
        {state.kind === "pending" ? (
          <IconLoader2 size={13} className="motion-safe:animate-spin" aria-hidden />
        ) : (
          <IconCheck size={13} stroke={2} aria-hidden />
        )}
        {state.kind === "pending" ? "Approving…" : "Approve solution"}
      </Button>
      {state.kind === "not-ready" && (
        <p className="text-[10px] leading-4 text-accent-warning">
          Not ready yet — the review is still composing. The server holds this gate until the fix is ready.
        </p>
      )}
      {state.kind === "error" && (
        <p className="flex items-center gap-1 text-[10px] leading-4 text-accent-danger">
          <IconAlertTriangle size={11} aria-hidden />
          {state.message}
        </p>
      )}
    </div>
  );
}
