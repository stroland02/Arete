import Link from "next/link";
import { DashboardPreview } from "@/components/marketing/dashboard-preview";

export function LandingHero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />
      <div className="absolute bottom-0 right-0 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl -z-10 pointer-events-none" />

      <div className="mx-auto max-w-6xl px-6 pt-20 pb-16">
        {/* Hero copy — full width, centered, above the preview (Tsenta/Orca pattern) */}
        <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 text-center">
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight text-content-primary">
            Code review that{" "}
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-cyan-400 to-teal-300">
              checks its own work
            </span>
            .
          </h1>
          <p className="text-lg text-content-muted max-w-2xl">
            Six specialist agents review every pull request in parallel. A Synthesizer verifies
            each finding against your actual diff and drops anything it can&apos;t prove — so
            what lands in your PR is signal, not noise.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/login"
              className="inline-flex items-center justify-center h-11 px-7 rounded-full text-sm font-medium text-white bg-accent-primary hover:brightness-110 active:brightness-95 shadow-[0_1px_0_0_rgba(255,255,255,0.15)_inset,0_8px_20px_-6px_rgba(129,140,248,0.5)] transition-[filter]"
            >
              Get started
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center h-11 px-7 rounded-full text-sm font-medium text-content-secondary border border-white/15 bg-white/[0.03] backdrop-blur-md hover:border-white/30 hover:bg-white/[0.06] transition-colors"
            >
              See how it works
            </a>
          </div>
          <p className="text-xs text-content-muted">
            First 50 PRs free. No credit card required.
          </p>
        </div>

        {/* Full-width product preview card below the copy */}
        <div className="mt-16 flex flex-col gap-2">
          <DashboardPreview />
          <p className="text-center text-xs text-content-muted/70">
            Illustrative preview — not live account data.
          </p>
        </div>
      </div>
    </section>
  );
}
