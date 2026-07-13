"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
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
  IconBrandGithub,
  IconBrandVercel,
  IconBrandStripe,
  IconBrandAws,
  IconBrandDocker,
  IconBrandSlack,
  IconBrandNotion,
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
// list. Colors match the hero graph's per-agent hues (chosen to read on the
// light Marble & Ink ground).
const AGENTS = [
  { label: "Security", description: "Scans for vulnerabilities and OWASP-class issues.", icon: IconShieldCheck, color: "#c2410c" },
  { label: "Performance", description: "Flags algorithmic and resource-usage regressions.", icon: IconGauge, color: "#0e7490" },
  { label: "Quality", description: "Reviews style, readability, and maintainability.", icon: IconSparkles, color: "#7c3aed" },
  { label: "Test Coverage", description: "Checks whether behavior changes are actually tested.", icon: IconTestPipe, color: "#047857" },
  { label: "Deployment Safety", description: "Looks for migration, rollout, and config risks.", icon: IconRocket, color: "#b45309" },
  { label: "Business Logic", description: "Checks your diff against connected production signals.", icon: IconBriefcase, color: "#2f55d4" },
];

// Authentic connector brands rendered as clean, blended SVG logos
const CONNECTORS = [
  { name: "GitHub", icon: IconBrandGithub },
  { name: "Vercel", icon: IconBrandVercel },
  { name: "Stripe", icon: IconBrandStripe },
  { name: "Docker", icon: IconBrandDocker },
  { name: "AWS", icon: IconBrandAws },
  { name: "Slack", icon: IconBrandSlack },
  { name: "Notion", icon: IconBrandNotion },
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
      <h2 className="mt-3 font-serif text-3xl font-semibold tracking-tight text-content-primary">{title}</h2>
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
        <div className="absolute inset-x-[16%] top-11 hidden h-px bg-gradient-to-r from-transparent via-border-default to-transparent md:block" />
        {HOW_IT_WORKS.map((item) => (
          <div key={item.step} className="relative flex flex-col items-start">
            <span className="mb-5 flex h-10 w-10 items-center justify-center rounded-full border border-accent-primary/30 bg-surface-0 font-mono text-sm font-semibold text-accent-primary ring-4 ring-surface-0">
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
              className="group flex items-start gap-3 rounded-xl border border-border-subtle bg-surface-1 p-4 transition-colors hover:border-border-default hover:bg-surface-2"
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
  const marqueeItems = [...CONNECTORS, ...CONNECTORS, ...CONNECTORS, ...CONNECTORS];

  return (
    <section id="connectors" className="border-y border-border-subtle bg-surface-1 overflow-hidden">
      <div className="mx-auto max-w-6xl py-16 text-center">
        <div className="mb-7 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-content-muted">
          <IconPlugConnected className="h-4 w-4" />
          Connects to what you already run
        </div>
        
        {/* Infinite Marquee Container */}
        <div className="relative flex w-full overflow-hidden whitespace-nowrap">
          {/* Fading Edges */}
          <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 md:w-32 bg-gradient-to-r from-surface-1 to-transparent"></div>
          <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 md:w-32 bg-gradient-to-l from-surface-1 to-transparent"></div>
          
          <motion.div
            className="flex w-max items-center gap-16 px-8"
            animate={{ x: ["0%", "-25%"] }}
            transition={{ repeat: Infinity, ease: "linear", duration: 25 }}
          >
            {marqueeItems.map((c, idx) => {
              const Icon = c.icon;
              return (
                <div
                  key={`${c.name}-${idx}`}
                  className="flex flex-shrink-0 items-center gap-3 text-content-muted opacity-60 transition-all hover:scale-105 hover:opacity-100 hover:text-content-primary"
                  title={c.name}
                >
                  <Icon size={36} stroke={1.5} />
                  <span className="text-xl font-semibold tracking-tight">{c.name}</span>
                </div>
              );
            })}
          </motion.div>
        </div>

        <p className="mx-auto mt-10 max-w-md px-6 text-sm leading-relaxed text-content-muted">
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
              <span className="absolute -top-3 left-6 inline-flex items-center rounded-full bg-accent-primary px-3 py-1 text-[11px] font-semibold text-white shadow-sm">
                Most popular
              </span>
            )}
            <h3 className="text-lg font-semibold text-content-primary">{tier.name}</h3>
            <p className="mt-1 text-sm text-content-muted">{tier.tagline}</p>
            <div className="mt-4 mb-5 flex items-baseline gap-1">
              <span className="font-serif text-4xl font-semibold tracking-tight text-content-primary">{tier.price}</span>
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
                  ? "inline-flex h-10 items-center justify-center rounded-full bg-accent-primary px-4 text-sm font-medium text-white shadow-sm transition-colors hover:bg-accent-primary/90"
                  : "inline-flex h-10 items-center justify-center rounded-full border border-border-default px-4 text-sm font-medium text-content-secondary transition-colors hover:border-border-strong hover:bg-content-primary/5"
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
      <Card elevated className="relative flex flex-col items-center gap-6 overflow-hidden py-20 text-center">
        <Image
          src="/kanagawa-bg-v3.jpg"
          alt="Kanagawa Background"
          fill
          className="absolute inset-0 z-0 object-cover opacity-90 transition-transform duration-1000 hover:scale-105"
        />
        <div className="absolute inset-0 z-0 bg-black/40" />

        <span className="relative z-10 flex h-14 w-14 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white backdrop-blur-md shadow-lg">
          <IconGitPullRequest className="h-7 w-7" />
        </span>
        <h2 className="relative z-10 max-w-lg font-serif text-3xl font-semibold tracking-tight text-white drop-shadow-md sm:text-4xl">
          Verified code review, posted straight to your next PR.
        </h2>
        <Link
          href="/login"
          className="relative z-10 group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-white px-8 text-sm font-semibold text-black shadow-xl transition-all hover:scale-105 hover:bg-gray-100"
        >
          Get started free
          <IconArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
        </Link>
        <p className="relative z-10 text-sm font-medium text-white/80 drop-shadow-sm">First 50 PRs free · no credit card required</p>
      </Card>
    </section>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-border-subtle">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-10 sm:flex-row">
        <span className="font-serif text-sm font-semibold text-content-primary">
          Aret<span className="text-accent-secondary">é</span> AI
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
