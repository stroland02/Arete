import Link from "next/link";
import {
  IconArrowRight,
  IconBriefcase,
  IconCheck,
  IconGauge,
  IconGitPullRequest,
  IconPlugConnected,
  IconRocket,
  IconShieldCheck,
  IconSparkles,
  IconTestPipe,
} from "@tabler/icons-react";
import { Card } from "@/components/ui/card";

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Connect your repo",
    description:
      "Install the Areté GitHub App on your account or org. Every new pull request is reviewed automatically — no setup per-repo.",
  },
  {
    step: "02",
    title: "Six agents analyze your diff",
    description:
      "Security, Performance, Quality, Test Coverage, Deployment Safety, and Business Logic review in parallel. Business Logic is the only one that reads your connected production telemetry.",
  },
  {
    step: "03",
    title: "A Synthesizer verifies everything",
    description:
      "Every finding is merged, checked against the real diff, and dropped if it can't be verified — then posted straight to your PR. You review and merge on your own terms.",
  },
];

// Mirrors the real agent set in packages/agents/src/arete_agents/agents/*.py
// (agent_name values) — same 6 agents shown in the authenticated dashboard's
// AgentOrchestrationGraph and the hero graph, not a marketing-only invented
// list. Colors match the hero graph's per-agent hues.
const AGENTS = [
  { label: "Security", description: "Scans for vulnerabilities and OWASP-class issues.", icon: IconShieldCheck, color: "#fb7185" },
  { label: "Performance", description: "Flags algorithmic and resource-usage regressions.", icon: IconGauge, color: "#22d3ee" },
  { label: "Quality", description: "Reviews style, readability, and maintainability.", icon: IconSparkles, color: "#c084fc" },
  { label: "Test Coverage", description: "Checks whether behavior changes are actually tested.", icon: IconTestPipe, color: "#34d399" },
  { label: "Deployment Safety", description: "Looks for migration, rollout, and config risks.", icon: IconRocket, color: "#f59e0b" },
  { label: "Business Logic", description: "Checks your diff against connected production signals.", icon: IconBriefcase, color: "#818cf8" },
];

const CONNECTORS = [
  { name: "GitHub Actions", color: "#f1f5f9" },
  { name: "Sentry", color: "#c084fc" },
  { name: "Vercel", color: "#f1f5f9" },
  { name: "Stripe", color: "#818cf8" },
  { name: "PostHog", color: "#f59e0b" },
];

// Pricing mirrors docs/proposal/TYME-platform-proposal.md §9 "Code Review
// Service (Launch Product)" table exactly — prices/units and the feature copy
// below (split verbatim from the proposal's descriptions) — no invented numbers.
const PRICING_TIERS = [
  {
    name: "Starter",
    price: "$29",
    unit: "/dev/month",
    tagline: "For small teams getting started.",
    features: ["Up to 10 developers", "All 6 review agents", "PR summary + inline comments"],
    featured: false,
  },
  {
    name: "Pro",
    price: "$49",
    unit: "/dev/month",
    tagline: "For teams that ship to production.",
    features: ["Unlimited developers", "Production monitoring context", "Conversational interface"],
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    unit: "",
    tagline: "For organizations with compliance needs.",
    features: ["Self-hosted option", "SSO + audit logs", "SLA + dedicated support"],
    featured: false,
  },
];

function SectionHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle: string }) {
  return (
    <div className="mb-14 text-center">
      <span className="text-xs font-semibold uppercase tracking-[0.2em] text-accent-primary">{eyebrow}</span>
      <h2 className="mt-3 text-3xl font-bold tracking-tight text-content-primary">{title}</h2>
      <p className="mt-3 text-content-muted">{subtitle}</p>
    </div>
  );
}

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-6xl px-6 py-24">
      <SectionHeading
        eyebrow="How it works"
        title="From pull request to verified review"
        subtitle="Three steps, then it runs on every PR — automatically."
      />

      <div className="relative mb-20 grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* connecting line behind the step badges (desktop) */}
        <div className="absolute inset-x-[16%] top-11 hidden h-px bg-gradient-to-r from-transparent via-white/10 to-transparent md:block" />
        {HOW_IT_WORKS.map((item) => (
          <div key={item.step} className="relative flex flex-col items-start">
            <span className="mb-5 flex h-10 w-10 items-center justify-center rounded-full border border-accent-primary/30 bg-surface-0 font-mono text-sm font-semibold text-accent-primary shadow-[0_0_0_4px_rgba(2,6,23,1)]">
              {item.step}
            </span>
            <h3 className="mb-2 text-lg font-semibold text-content-primary">{item.title}</h3>
            <p className="text-sm leading-relaxed text-content-muted">{item.description}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 text-center">
        <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-content-muted">The six specialists</h3>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AGENTS.map((agent) => {
          const Icon = agent.icon;
          return (
            <div
              key={agent.label}
              className="group flex items-start gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:border-white/15 hover:bg-white/[0.04]"
            >
              <div
                className="shrink-0 rounded-lg border p-2"
                style={{ color: agent.color, borderColor: `${agent.color}33`, backgroundColor: `${agent.color}14` }}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div>
                <p className="text-sm font-medium text-content-primary">{agent.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-content-muted">{agent.description}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function ConnectorStrip() {
  return (
    <section id="connectors" className="border-y border-white/[0.06] bg-white/[0.01]">
      <div className="mx-auto max-w-6xl px-6 py-16 text-center">
        <div className="mb-7 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-content-muted">
          <IconPlugConnected className="h-4 w-4" />
          Connects to what you already run
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {CONNECTORS.map((c) => (
            <span
              key={c.name}
              className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.02] px-4 py-2 text-sm text-content-secondary transition-colors hover:border-white/20"
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color, boxShadow: `0 0 8px ${c.color}66` }} />
              {c.name}
            </span>
          ))}
        </div>
        <p className="mx-auto mt-7 max-w-md text-sm leading-relaxed text-content-muted">
          The Business Logic agent reads your connected telemetry to catch production-shaped bugs
          before they ship.
        </p>
      </div>
    </section>
  );
}

export function PricingSection() {
  return (
    <section id="pricing" className="mx-auto max-w-6xl px-6 py-24">
      <SectionHeading
        eyebrow="Pricing"
        title="Simple, per-developer pricing"
        subtitle="First 50 PRs free. No credit card required."
      />

      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-3">
        {PRICING_TIERS.map((tier) => (
          <Card
            key={tier.name}
            elevated={tier.featured}
            className={`relative flex flex-col ${tier.featured ? "md:-mt-3 md:pb-8" : ""}`}
          >
            {tier.featured && (
              <span className="absolute -top-3 left-6 inline-flex items-center rounded-full bg-accent-primary px-3 py-1 text-[11px] font-semibold text-white shadow-[0_6px_14px_-6px_rgba(129,140,248,0.6)]">
                Most popular
              </span>
            )}
            <h3 className="text-lg font-semibold text-content-primary">{tier.name}</h3>
            <p className="mt-1 text-sm text-content-muted">{tier.tagline}</p>
            <div className="mt-4 mb-5 flex items-baseline gap-1">
              <span className="text-4xl font-bold tracking-tight text-content-primary">{tier.price}</span>
              <span className="text-sm text-content-muted">{tier.unit}</span>
            </div>
            <ul className="mb-6 flex flex-1 flex-col gap-2.5">
              {tier.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-content-secondary">
                  <IconCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent-success" />
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/login"
              className={
                tier.featured
                  ? "inline-flex h-10 items-center justify-center rounded-full bg-accent-primary px-4 text-sm font-medium text-white shadow-[0_1px_0_0_rgba(255,255,255,0.15)_inset,0_6px_14px_-6px_rgba(129,140,248,0.55)] transition-[filter] hover:brightness-110 active:brightness-95"
                  : "inline-flex h-10 items-center justify-center rounded-full border border-white/15 px-4 text-sm font-medium text-content-secondary transition-colors hover:border-white/30 hover:bg-white/5"
              }
            >
              {tier.name === "Enterprise" ? "Contact sales" : "Get started"}
            </Link>
          </Card>
        ))}
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-6 pb-24">
      <Card elevated className="relative flex flex-col items-center gap-6 overflow-hidden py-16 text-center">
        <div className="absolute left-1/2 top-0 -z-10 h-64 w-64 -translate-x-1/2 rounded-full bg-accent-primary/15 blur-[100px]" />
        <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-accent-primary/30 bg-accent-primary/10 text-accent-primary">
          <IconGitPullRequest className="h-6 w-6" />
        </span>
        <h2 className="max-w-lg text-2xl font-bold tracking-tight text-content-primary sm:text-3xl">
          Verified code review, posted straight to your next PR.
        </h2>
        <Link
          href="/login"
          className="group inline-flex h-11 items-center justify-center gap-2 rounded-full bg-accent-primary px-6 text-sm font-medium text-white shadow-[0_1px_0_0_rgba(255,255,255,0.15)_inset,0_10px_24px_-8px_rgba(129,140,248,0.6)] transition-[filter,transform] hover:brightness-110 active:brightness-95"
        >
          Get started free
          <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
        </Link>
        <p className="text-xs text-content-muted">First 50 PRs free · no credit card required</p>
      </Card>
    </section>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 sm:flex-row">
        <span className="bg-gradient-to-r from-indigo-300 via-cyan-300 to-teal-200 bg-clip-text text-sm font-semibold text-transparent">
          Areté AI
        </span>
        <nav className="flex items-center gap-6 text-xs text-content-muted">
          <a href="#how-it-works" className="transition-colors hover:text-content-primary">How it works</a>
          <a href="#pricing" className="transition-colors hover:text-content-primary">Pricing</a>
          <Link href="/login" className="transition-colors hover:text-content-primary">Sign in</Link>
        </nav>
        <p className="text-xs text-content-muted">© 2026 Areté AI. All rights reserved.</p>
      </div>
    </footer>
  );
}
