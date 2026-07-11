import { IconSearch, IconBell } from "@tabler/icons-react";

export function Topbar() {
  return (
    <header className="flex items-center justify-between px-8 pt-6 pb-2">
      <div className="flex items-center gap-3">
        <nav className="flex items-center gap-1.5 text-sm text-content-muted">
          <span className="text-content-secondary font-medium">Dashboard</span>
          <span>/</span>
          <span className="text-content-primary font-medium">Overview</span>
        </nav>
        <span className="flex items-center gap-1.5 ml-2 px-2 py-0.5 rounded-full border border-border-subtle bg-white/5 text-xs text-content-muted">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping motion-reduce:animate-none absolute inline-flex h-full w-full rounded-full bg-accent-success opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-accent-success" />
          </span>
          Areté is live
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button
          disabled
          title="Command palette coming soon"
          className="flex items-center gap-2 px-3 h-9 rounded-xl border border-border-default bg-white/5 text-sm text-content-muted opacity-60 cursor-not-allowed"
        >
          <IconSearch className="w-4 h-4" />
          Search
          <kbd className="ml-2 px-1.5 py-0.5 rounded border border-border-subtle text-[10px] font-mono text-content-muted">
            ⌘K
          </kbd>
        </button>
        <button
          className="h-9 w-9 flex items-center justify-center rounded-xl border border-border-default bg-white/5 text-content-muted hover:text-white hover:bg-white/10 transition-colors"
          aria-label="Notifications"
        >
          <IconBell className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
