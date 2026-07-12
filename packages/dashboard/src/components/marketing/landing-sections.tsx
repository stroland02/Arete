import Link from "next/link";
import {
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
// AgentOrchestrationGraph, not a marketing-only invented list.
const AGENTS = [
  { label: "Security", description: "Scans for vulnerabilities and OWASP-class issues.", icon: IconShieldCheck },
  { label: "Performance", description: "Flags algorithmic and resource-usage regressions.", icon: IconGauge },
  { label: "Quality", description: "Reviews style, readability, and maintainability.", icon: IconSparkles },
  { label: "Test Coverage", description: "Checks whether behavior changes are actually tested.", icon: IconTestPipe },
  { label: "Deployment Safety", description: "Looks for migration, rollout, and config risks.", icon: IconRocket },
  {
    label: "Business Logic",
    description: "Checks your diff against connected production signals.",
    icon: IconBriefcase,
  },
];

const CONNECTORS = ["GitHub Actions", "Sentry", "Vercel", "Stripe", "PostHog"];

// Pricing mirrors docs/proposal/TYME-platform-proposal.md §9 "Code Review
// Service (Launch Product)" table exactly — no invented numbers.
const PRICING_TIERS = [
  {
    name: "Starter",
    price: "$29",
    unit: "/dev/month",
    description: "Up to 10 devs, all 6 review agents, PR summary + inline comments.",
    featured: false,
  },
  {
    name: "Pro",
    price: "$49",
    unit: "/dev/month",
    description: "Unlimited devs, production monitoring context, conversational interface.",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    unit: "",
    description: "Self-hosted option, SSO, audit logs, SLA, dedicated support.",
    featured: false,
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-6xl px-6 py-20">
      <div className="text-center mb-14">
        <h2 className="text-3xl font-bold text-content-primary">How it works</h2>
        <p className="text-content-muted mt-3">From pull request to verified review, automatically.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
        {HOW_IT_WORKS.map((item) => (
          <Card key={item.step}>
            <span className="text-xs font-mono text-accent-primary">{item.step}</span>
            <h3 className="text-lg font-semibold text-content-primary mt-2 mb-2">{item.title}</h3>
            <p className="text-sm text-content-muted">{item.description}</p>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {AGENTS.map((agent) => {
          const Icon = agent.icon;
          return (
            <div
              key={agent.label}
              className="flex items-start gap-3 p-4 rounded-xl border border-border-subtle bg-white/[0.02]"
            >
              <div className="p-2 rounded-lg bg-accent-primary/10 border border-accent-primary/20 shrink-0">
                <Icon className="w-4 h-4 text-accent-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-content-primary">{agent.label}</p>
                <p className="text-xs text-content-muted mt-0.5">{agent.description}</p>
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
    <section className="border-y border-border-subtle bg-white/[0.01]">
      <div className="mx-auto max-w-6xl px-6 py-12 text-center">
        <div className="inline-flex items-center gap-2 text-xs font-medium text-content-muted mb-6">
          <IconPlugConnected className="w-4 h-4" />
          CONNECTS TO WHAT YOU ALREADY RUN
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {CONNECTORS.map((name) => (
            <span
              key={name}
              className="px-4 py-2 rounded-full text-sm text-content-secondary border border-border-default bg-white/[0.02]"
            >
              {name}
            </span>
          ))}
        </div>
        <p className="text-xs text-content-muted mt-6 max-w-md mx-auto">
          The Business Logic agent reads your connected telemetry to catch production-shaped bugs
          before they ship.
        </p>
      </div>
    </section>
  );
}

export function PricingSection() {
  return (
    <section id="pricing" className="mx-auto max-w-6xl px-6 py-20">
      <div className="text-center mb-14">
        <h2 className="text-3xl font-bold text-content-primary">Pricing</h2>
        <p className="text-content-muted mt-3">First 50 PRs free. No credit card required.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {PRICING_TIERS.map((tier) => (
          <Card key={tier.name} elevated={tier.featured} className="flex flex-col">
            <h3 className="text-lg font-semibold text-content-primary">{tier.name}</h3>
            <div className="mt-3 mb-4">
              <span className="text-3xl font-bold text-content-primary">{tier.price}</span>
              <span className="text-sm text-content-muted">{tier.unit}</span>
            </div>
            <p className="text-sm text-content-muted flex-1">{tier.description}</p>
            <Link
              href="/login"
              className={
                tier.featured
                  ? "mt-6 inline-flex items-center justify-center h-9 px-4 rounded-full text-sm font-medium text-white bg-accent-primary hover:brightness-110 active:brightness-95 shadow-[0_1px_0_0_rgba(255,255,255,0.15)_inset,0_6px_14px_-6px_rgba(129,140,248,0.55)] transition-[filter]"
                  : "mt-6 inline-flex items-center justify-center h-9 px-4 rounded-full text-sm font-medium text-content-secondary border border-white/15 hover:bg-white/5 transition-colors"
              }
            >
              Get started
            </Link>
          </Card>
        ))}
      </div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-6 pb-20">
      <Card elevated className="text-center py-16 flex flex-col items-center gap-6">
        <IconGitPullRequest className="w-8 h-8 text-accent-primary" />
        <h2 className="text-2xl sm:text-3xl font-bold text-content-primary max-w-lg">
          Verified code review, posted straight to your next PR.
        </h2>
        <Link
          href="/login"
          className="inline-flex items-center justify-center gap-2 h-10 px-6 rounded-full text-sm font-medium text-white bg-accent-primary hover:brightness-110 active:brightness-95 shadow-[0_1px_0_0_rgba(255,255,255,0.15)_inset,0_8px_20px_-6px_rgba(129,140,248,0.5)] transition-[filter]"
        >
          <IconCheck className="w-4 h-4" />
          Get started
        </Link>
      </Card>
    </section>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-border-subtle">
      <div className="mx-auto max-w-6xl px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
        <span className="text-sm font-semibold bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-cyan-400 to-teal-300">
          Areté AI
        </span>
        <p className="text-xs text-content-muted">© 2026 Areté AI. All rights reserved.</p>
      </div>
    </footer>
  );
}
