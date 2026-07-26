"use client";

import { useState } from "react";
import { IconAlertTriangle, IconExternalLink, IconGitPullRequest, IconLoader2 } from "@tabler/icons-react";

/**
 * The human control for the SECOND gate: send the approved solution as a real
 * pull request. Wave-2 Part B.
 *
 * It only TRIGGERS the send — the server is the authority and the webhook opens
 * the PR. It POSTs to /api/containers/[id]/send and reflects the REAL outcome
 * 1:1, never a fabricated success: a not-yet-approved container comes back 409
 * and the control says "approve first" rather than pretending to post; an
 * un-configured environment says so plainly. Idempotent — a re-send of an
 * already-open PR shows the same PR, not a second.
 */
type SendState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "opened"; url: string | null; already: boolean }
  | { kind: "not-approved" }
  | { kind: "message"; tone: "warn" | "error"; text: string };

interface SendResponse {
  outcome?: { status?: string; url?: string; prNumber?: number; reason?: string };
  error?: string;
}

export function SendPrButton({ containerId }: { containerId: string }) {
  const [state, setState] = useState<SendState>({ kind: "idle" });

  async function send() {
    setState({ kind: "pending" });
    try {
      const res = await fetch(`/api/containers/${encodeURIComponent(containerId)}/send`, { method: "POST" });
      let body: SendResponse = {};
      try {
        body = (await res.json()) as SendResponse;
      } catch {
        /* non-JSON body — fall through to status-based messaging */
      }

      const status = body.outcome?.status;
      if (res.status === 200 && (status === "opened" || status === "already_open")) {
        setState({ kind: "opened", url: body.outcome?.url ?? null, already: status === "already_open" });
        return;
      }
      if (res.status === 409) {
        setState({ kind: "not-approved" });
        return;
      }
      if (res.status === 503) {
        setState({ kind: "message", tone: "warn", text: "Sending isn't enabled in this environment yet." });
        return;
      }
      if (res.status === 404) {
        setState({ kind: "message", tone: "error", text: "This container no longer exists." });
        return;
      }
      if (res.status === 400) {
        setState({ kind: "message", tone: "error", text: "The send request was rejected as invalid." });
        return;
      }
      // 502 failed, or any other status — the host/upstream refused to open the PR.
      setState({
        kind: "message",
        tone: "error",
        text: body.outcome?.reason ?? `Couldn't open the pull request (${res.status}).`,
      });
    } catch {
      setState({ kind: "message", tone: "error", text: "Network error — try again." });
    }
  }

  if (state.kind === "opened") {
    return (
      <div className="space-y-1.5">
        <div className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-accent-success/30 bg-accent-success/10 px-3 py-1.5 text-[12px] font-semibold text-accent-success">
          <IconGitPullRequest size={14} stroke={2} aria-hidden />
          {state.already ? "Pull request already open" : "Pull request opened"}
        </div>
        {state.url && (
          <a
            href={state.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-1 text-[10.5px] text-accent-primary hover:underline"
          >
            View it on GitHub <IconExternalLink size={11} aria-hidden />
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={send}
        disabled={state.kind === "pending"}
        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent-primary px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition-colors hover:bg-accent-primary/90 disabled:opacity-60"
      >
        {state.kind === "pending" ? (
          <IconLoader2 size={14} className="motion-safe:animate-spin" aria-hidden />
        ) : (
          <IconGitPullRequest size={14} stroke={2} aria-hidden />
        )}
        {state.kind === "pending" ? "Opening pull request…" : "Post pull request"}
      </button>
      {state.kind === "not-approved" && (
        <p className="text-[10px] leading-4 text-accent-warning">
          Approve the solution first — the server holds this gate until it&apos;s approved.
        </p>
      )}
      {state.kind === "message" && (
        <p
          className={`flex items-center gap-1 text-[10px] leading-4 ${
            state.tone === "error" ? "text-accent-danger" : "text-accent-warning"
          }`}
        >
          <IconAlertTriangle size={11} aria-hidden />
          {state.text}
        </p>
      )}
    </div>
  );
}
