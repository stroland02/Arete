import Link from "next/link";
import { IconLock, IconArrowRight } from "@tabler/icons-react";

export type ConnectKind = "repository" | "service";

const COPY: Record<ConnectKind, { message: string; cta: string }> = {
  repository: {
    message: "Connect a repository to see this",
    cta: "Connect a repository",
  },
  service: {
    message: "Connect a service to see this",
    cta: "Connect a service",
  },
};

/**
 * Honest placeholder shown inside a widget frame when the tenant has nothing
 * connected yet. It conveys what the dashboard WILL show without ever
 * fabricating data — the frame/layout is real, and the data area says how to
 * light it up (repository for review-driven widgets, service for telemetry).
 *
 * `compact` (for small metric tiles) drops the CTA link so the tile stays tidy;
 * the larger widgets carry the actionable "Connect …" link.
 */
export function ConnectPrompt({ kind, compact }: { kind: ConnectKind; compact?: boolean }) {
  const copy = COPY[kind];
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 text-center ${compact ? "py-4" : "py-8"}`}
    >
      <div className="rounded-xl border border-border-default bg-content-primary/5 p-2 text-content-muted">
        <IconLock className="h-4 w-4" />
      </div>
      <p className="text-xs text-content-muted">{copy.message}</p>
      {!compact && (
        <Link
          href="/connections"
          className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-accent-primary hover:underline"
        >
          {copy.cta} <IconArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </div>
  );
}
