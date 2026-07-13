"use client";

import { useState } from "react";
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/**
 * "Copy agent prompt" — hands the review's verified findings to a coding agent
 * (Phase B, Review detail). The prompt string is assembled server-side from
 * real findings and passed in; this button only copies it and shows a
 * transient confirmation, so no review data is re-derived on the client.
 */
export function CopyAgentPrompt({ prompt, className }: { prompt: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (insecure context / denied) — leave the label as-is.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-live="polite"
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-default bg-surface-1 px-3 py-1.5 text-xs font-medium text-content-secondary transition-colors hover:border-border-strong hover:bg-content-primary/5",
        className,
      )}
    >
      {copied ? (
        <IconCheck size={14} stroke={2} className="text-accent-success" aria-hidden />
      ) : (
        <IconCopy size={14} stroke={1.75} aria-hidden />
      )}
      {copied ? "Copied" : "Copy agent prompt"}
    </button>
  );
}
