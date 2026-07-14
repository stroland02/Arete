import Link from "next/link";
import { KumaLogo } from "@/components/ui/kuma-logo";

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-border-subtle bg-surface-0/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="group flex items-center gap-2">
          <span className="flex items-center justify-center text-accent-primary drop-shadow-[0_0_8px_rgba(0,212,255,0.4)]">
            <KumaLogo size={28} />
          </span>
          <span className="font-serif text-xl font-semibold tracking-tight text-content-primary">
            Kuma
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
          <a href="https://discord.gg/HyYVmVc6d" target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-content-primary">
            Community
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
