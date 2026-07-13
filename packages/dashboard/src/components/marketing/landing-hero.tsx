import Link from "next/link";
import { IconArrowRight, IconBrandGithub, IconBrandGitlab, IconSparkles } from "@tabler/icons-react";
import { HeroAgentGraph } from "@/components/marketing/hero-agent-graph";

export function LandingHero() {
  return (
    <section className="relative overflow-hidden">
      {/* faint top hairline */}
      <div className="absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-border-default to-transparent" />

      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 pt-20 pb-20 lg:grid-cols-12 lg:gap-10">
        <div className="flex flex-col gap-6 lg:col-span-5">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-border-default bg-surface-1 px-3 py-1 text-xs font-medium text-content-secondary">
            <IconSparkles className="h-3.5 w-3.5 text-accent-primary" />
            Verified AI code review
          </span>

          <h1 className="font-serif text-4xl font-semibold leading-[1.06] tracking-tight text-content-primary sm:text-5xl">
            Code review that{" "}
            <span className="italic text-accent-primary">checks its own work</span>.
          </h1>

          <p className="max-w-xl text-lg leading-relaxed text-content-muted">
            Six specialist agents review every pull request in parallel. A Synthesizer verifies
            each finding against your actual diff and drops anything it can&apos;t prove — so what
            lands in your PR is signal, not noise.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/login"
              className="group inline-flex h-11 items-center justify-center gap-2 rounded-full bg-accent-primary px-6 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent-primary/90"
            >
              Get started free
              <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex h-11 items-center justify-center rounded-full border border-border-default bg-surface-1 px-6 text-sm font-medium text-content-secondary transition-colors hover:border-border-strong hover:bg-surface-2"
            >
              See how it works
            </a>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-xs text-content-muted">
            <span>First 50 PRs free · no credit card</span>
            <span className="hidden h-3 w-px bg-border-default sm:inline-block" />
            <span className="inline-flex items-center gap-1.5">
              <IconBrandGithub className="h-4 w-4" /> GitHub
              <IconBrandGitlab className="ml-2 h-4 w-4" /> GitLab
            </span>
          </div>
        </div>

        {/* Hero product demo slot.
            This column is the integration point for the real interactive
            Overview demo being built in parallel (packages/dashboard/src/app/
            (dashboard)/overview/*). Until that lands, it renders the
            self-contained illustrative HeroAgentGraph — clearly labelled
            below so it can never read as live account data. When the real
            Overview embed is ready, swap <HeroAgentGraph/> for it here; the
            surrounding hero layout does not change. */}
        <div className="flex flex-col gap-2 lg:col-span-7">
          <HeroAgentGraph />
          <p className="text-center text-xs text-content-muted/70">
            Illustrative example — not live account data.
          </p>
        </div>
      </div>
    </section>
  );
}
