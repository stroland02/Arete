import Link from "next/link";
import { IconTopologyStar3 } from "@tabler/icons-react";

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-border-subtle bg-surface-0/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="group flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-accent-primary/30 bg-accent-primary/10 text-accent-primary">
            <IconTopologyStar3 className="h-4 w-4" stroke={1.75} />
          </span>
          <span className="font-serif text-xl font-semibold tracking-tight text-content-primary">
            Aret<span className="text-accent-secondary">é</span> AI
          </span>
        </Link>

        <nav className="hidden items-center gap-8 text-sm text-content-muted md:flex">
          <a href="#how-it-works" className="transition-colors hover:text-content-primary">
            How it works
          </a>
          <a href="#connectors" className="transition-colors hover:text-content-primary">
            Connectors
          </a>
          <a href="#pricing" className="transition-colors hover:text-content-primary">
            Pricing
          </a>
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm font-medium text-content-muted transition-colors hover:text-content-primary"
          >
            Sign in
          </Link>
          <Link
            href="/login"
            className="inline-flex h-9 items-center justify-center rounded-full bg-accent-primary px-4 text-[13px] font-medium text-white shadow-sm transition-colors hover:bg-accent-primary/90"
          >
            Get started
          </Link>
        </div>
      </div>
    </header>
  );
}
