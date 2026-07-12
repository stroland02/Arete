import Link from "next/link";
import { IconArrowRight, IconBrandGithub, IconBrandGitlab, IconSparkles } from "@tabler/icons-react";
import { HeroAgentGraph } from "@/components/marketing/hero-agent-graph";

export function LandingHero() {
  return (
    <section className="relative overflow-hidden">
      {/* ambient glows */}
      <div className="absolute -top-24 left-1/4 h-[28rem] w-[28rem] -z-10 rounded-full bg-indigo-500/[0.12] blur-[120px] pointer-events-none" />
      <div className="absolute top-40 right-0 h-96 w-96 -z-10 rounded-full bg-cyan-500/[0.08] blur-[120px] pointer-events-none" />
      {/* faint top hairline gradient */}
      <div className="absolute inset-x-0 top-0 -z-10 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-6 pt-20 pb-20 lg:grid-cols-12 lg:gap-10">
        <div className="flex flex-col gap-6 lg:col-span-5">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs font-medium text-content-secondary backdrop-blur-sm">
            <IconSparkles className="h-3.5 w-3.5 text-accent-primary" />
            Verified AI code review
          </span>

          <h1 className="text-4xl font-bold leading-[1.08] tracking-tight text-content-primary sm:text-5xl">
            Code review that{" "}
            <span className="bg-gradient-to-r from-indigo-400 via-cyan-400 to-teal-300 bg-clip-text text-transparent">
              checks its own work
            </span>
            .
          </h1>

          <p className="max-w-xl text-lg leading-relaxed text-content-muted">
            Six specialist agents review every pull request in parallel. A Synthesizer verifies
            each finding against your actual diff and drops anything it can&apos;t prove — so what
            lands in your PR is signal, not noise.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/login"
              className="group inline-flex h-11 items-center justify-center gap-2 rounded-full bg-accent-primary px-6 text-sm font-medium text-white shadow-[0_1px_0_0_rgba(255,255,255,0.15)_inset,0_10px_24px_-8px_rgba(129,140,248,0.6)] transition-[filter,transform] hover:brightness-110 active:brightness-95"
            >
              Get started free
              <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex h-11 items-center justify-center rounded-full border border-white/15 bg-white/[0.03] px-6 text-sm font-medium text-content-secondary backdrop-blur-md transition-colors hover:border-white/30 hover:bg-white/[0.06]"
            >
              See how it works
            </a>
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-xs text-content-muted">
            <span>First 50 PRs free · no credit card</span>
            <span className="hidden h-3 w-px bg-white/10 sm:inline-block" />
            <span className="inline-flex items-center gap-1.5">
              <IconBrandGithub className="h-4 w-4" /> GitHub
              <IconBrandGitlab className="ml-2 h-4 w-4" /> GitLab
            </span>
          </div>
        </div>

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
