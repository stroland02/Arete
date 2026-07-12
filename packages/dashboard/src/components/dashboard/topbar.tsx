"use client";

import { usePathname } from "next/navigation";
import { IconSearch, IconBell } from "@tabler/icons-react";

const BREADCRUMB_LABELS: Record<string, string> = {
  "/": "Overview",
  "/connections": "Connections",
  "/reviews": "Review",
  "/history": "Review History",
  "/settings": "Settings",
};

function breadcrumbFor(pathname: string): string {
  if (BREADCRUMB_LABELS[pathname]) return BREADCRUMB_LABELS[pathname];
  // Dynamic sub-routes (e.g. /connections/vercel) fall back to their parent's label.
  const parent = "/" + pathname.split("/")[1];
  return BREADCRUMB_LABELS[parent] ?? "Overview";
}

export function Topbar() {
  const pathname = usePathname();

  return (
    <header className="flex items-center justify-between px-8 pt-6 pb-2">
      <div className="flex items-center gap-3">
        <nav className="flex items-center gap-1.5 text-sm text-content-muted">
          <span className="text-content-secondary font-medium">Dashboard</span>
          <span>/</span>
          <span className="text-content-primary font-medium">{breadcrumbFor(pathname)}</span>
        </nav>
        {/* No "system live" pill here: the Topbar has no real signal to back
            such a claim, and the agent-orchestration graph already shows an
            honest live/idle state derived from real data. A hardcoded pulsing
            "live" badge would be fabricated status. */}
      </div>

      <div className="flex items-center gap-3">
        <button
          disabled
          title="Command palette coming soon"
          className="flex items-center gap-2 px-3 h-9 rounded-xl border border-border-default bg-content-primary/5 text-sm text-content-muted opacity-60 cursor-not-allowed"
        >
          <IconSearch className="w-4 h-4" />
          Search
          <kbd className="ml-2 px-1.5 py-0.5 rounded border border-border-subtle text-[10px] font-mono text-content-muted">
            ⌘K
          </kbd>
        </button>
        <button
          disabled
          title="Notifications coming soon"
          aria-label="Notifications (coming soon)"
          className="h-9 w-9 flex items-center justify-center rounded-xl border border-border-default bg-content-primary/5 text-content-muted opacity-60 cursor-not-allowed"
        >
          <IconBell className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
