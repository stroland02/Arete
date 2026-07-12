import Link from "next/link";

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-border-subtle bg-surface-0/70 backdrop-blur-md">
      <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
        <Link
          href="/"
          className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-cyan-400 to-teal-300 tracking-tight"
        >
          Areté AI
        </Link>

        <nav className="hidden md:flex items-center gap-8 text-sm text-content-muted">
          <a href="#how-it-works" className="hover:text-content-primary transition-colors">
            How it works
          </a>
          <a href="#pricing" className="hover:text-content-primary transition-colors">
            Pricing
          </a>
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm font-medium text-content-muted hover:text-content-primary transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center h-8 px-4 rounded-full text-[13px] font-medium text-white bg-accent-primary hover:brightness-110 active:brightness-95 shadow-[0_1px_0_0_rgba(255,255,255,0.15)_inset,0_6px_14px_-6px_rgba(129,140,248,0.55)] transition-[filter]"
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
