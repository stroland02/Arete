import type { Metadata } from "next";
import Link from "next/link";
import {
  IconShieldLock,
  IconEye,
  IconUsersGroup,
  IconCpu,
  IconGitPullRequest,
  IconBroadcast,
  IconPlugConnected,
  IconMap2,
  IconRocket,
  IconHeartHandshake,
} from "@tabler/icons-react";
import { MarketingNav } from "@/components/marketing/marketing-nav";
import { MarketingFooter } from "@/components/marketing/landing-sections";

export const metadata: Metadata = {
  title: "Docs — Kuma",
  description:
    "How Kuma reviews and heals your pull requests: the Glass Box, the multi-agent review, bring-your-own-model, the human-in-the-loop fix workflow, and the trust guarantees behind them.",
};

// Public, pre-login documentation. A single scrollable page with a sticky
// section rail (the SuperLog docs layout) — anchored sections, no client JS,
// so it renders and indexes as static content. Every claim below describes a
// capability that actually ships; anti-fabrication is the product's whole point,
// so the docs hold to the same bar.

type Section = {
  id: string;
  label: string;
  icon: typeof IconEye;
};

const SECTIONS: Section[] = [
  { id: "what-is-kuma", label: "What is Kuma", icon: IconHeartHandshake },
  { id: "quickstart", label: "Quickstart", icon: IconRocket },
  { id: "glass-box", label: "The Glass Box", icon: IconEye },
  { id: "multi-agent-review", label: "Multi-agent review", icon: IconUsersGroup },
  { id: "bring-your-own-model", label: "Bring your own model", icon: IconCpu },
  { id: "fix-workflow", label: "The fix workflow", icon: IconGitPullRequest },
  { id: "tiered-comms", label: "Tiered communications", icon: IconBroadcast },
  { id: "connectors", label: "Production context", icon: IconPlugConnected },
  { id: "code-map", label: "The code map", icon: IconMap2 },
  { id: "trust", label: "Trust & data integrity", icon: IconShieldLock },
];

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-surface-0">
      <MarketingNav />

      <div className="mx-auto flex max-w-6xl gap-10 px-6 py-12 lg:py-16">
        {/* Sticky section rail — the SuperLog left nav. */}
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-24">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
              Documentation
            </p>
            <nav className="flex flex-col gap-0.5">
              {SECTIONS.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-content-muted transition-colors hover:bg-content-primary/[0.04] hover:text-content-primary"
                >
                  <s.icon className="h-4 w-4 shrink-0" />
                  {s.label}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        {/* Content column. */}
        <main className="min-w-0 flex-1 space-y-16">
          <header className="space-y-3">
            <p className="text-sm font-medium text-accent-primary">Kuma documentation</p>
            <h1 className="text-3xl font-semibold tracking-tight text-content-primary sm:text-4xl">
              Your AI Software Healing Engineer
            </h1>
            <p className="max-w-2xl text-base leading-relaxed text-content-secondary">
              Kuma treats your codebase like a living organism: it watches every pull request,
              reviews it the way a senior team would — across six dimensions, with real production
              context — proposes a fix, and waits for a human to approve before anything ships.
              This guide walks through how it works and the strategies that make it trustworthy.
            </p>
          </header>

          <Doc
            section={SECTIONS[0]}
            lead="Kuma is a multi-agent code reviewer that closes the loop from problem to proposed fix — never touching your repository without a human hand on the gate."
          >
            <p>
              Most review tools judge a diff in isolation. Kuma judges it the way an experienced
              engineer would: with knowledge of what the code does, how it has failed before, and
              what your production telemetry is saying right now. A fleet of specialist agents each
              examine the change from a different angle, a synthesizer reconciles their findings,
              and the result is a single, honest verdict — plus, when there is a fix worth making, a
              proposed pull request that <strong>only you</strong> can send.
            </p>
            <p>
              The organizing idea is <em>self-healing software</em>: the same OODA loop a strong
              team runs — observe, orient, decide, act — automated up to the decision, and stopped
              there. Kuma does the tedious, thorough work; you keep the judgment.
            </p>
          </Doc>

          <Doc
            section={SECTIONS[1]}
            lead="Three steps to your first review — no configuration, no cloud keys required."
          >
            <Steps
              steps={[
                {
                  n: 1,
                  title: "Install the GitHub App",
                  body: "Connect Kuma to a repository from the Connections page. Kuma indexes the repo into a code map the moment it is installed — reviews start with context, not a cold read.",
                },
                {
                  n: 2,
                  title: "Choose a model (or use the free default)",
                  body: "Open AI Models and connect a provider. Local · Ollama runs on your own hardware at no cost and needs no key; or bring your own Anthropic, OpenAI, Gemini, or OpenRouter key to run on a hosted model.",
                },
                {
                  n: 3,
                  title: "Open a pull request",
                  body: "That's it. Kuma reviews the PR automatically and its findings appear live on your overview. Open the Services workspace to watch the review happen and, when there's a fix, to approve and send it.",
                },
              ]}
            />
          </Doc>

          <Doc
            section={SECTIONS[2]}
            lead="Every review happens in the open. You watch the agents think, in real time, instead of trusting a black box."
          >
            <p>
              The Glass Box is Kuma's core UX principle: a review is not a verdict handed down from
              nowhere. As the specialists dispatch, report, verify, and compose, each step streams
              to your screen live over the Synthesizer console. You see which agent is looking at
              what, what it found, how confident it is, and how the synthesizer weighs it.
            </p>
            <p>
              When a finding is low-confidence, Kuma raises a <strong>needs-a-human-look flag</strong>{" "}
              rather than quietly guessing. Transparency is not a dashboard afterthought here — it is
              how the system earns the right to propose changes to your code.
            </p>
          </Doc>

          <Doc
            section={SECTIONS[3]}
            lead="Six specialists, one synthesizer, one human gate — the shape of a real review team."
          >
            <p>Kuma reviews each change across six dimensions, each owned by a specialist agent:</p>
            <Dimensions
              items={[
                ["Security", "injection, auth, secret handling, unsafe surfaces"],
                ["Performance", "hot paths, N+1s, allocation and render cost"],
                ["Quality", "clarity, idiom, maintainability, dead paths"],
                ["Test coverage", "what the change leaves unverified"],
                ["Deployment safety", "migrations, rollout hazards, config drift"],
                ["Business logic", "does the change do what it should"],
              ]}
            />
            <p>
              The specialists report up to a synthesizer, which reconciles overlaps, drops noise, and
              composes the final review. Verification runs as a second pass — a critic stage — so a
              plausible-but-wrong finding is challenged before it reaches you. Nothing crosses from{" "}
              <em>ready</em> to <em>shipped</em> without your explicit approval.
            </p>
          </Doc>

          <Doc
            section={SECTIONS[4]}
            lead="Your model, your key, your data path. Kuma is not locked to one provider."
          >
            <p>
              Connect any of five providers and Kuma runs its reviews on the model you choose:
            </p>
            <Dimensions
              items={[
                ["Anthropic", "Claude — Kuma's native review and verification model"],
                ["OpenAI", "run reviews on GPT models with your own key"],
                ["Gemini", "Google's Gemini models"],
                ["OpenRouter", "one key, routed to many models"],
                ["Local · Ollama", "the free default — runs on your own hardware, no key"],
              ]}
            />
            <p>
              Keys are encrypted at rest and decrypted only in memory for the duration of a review —
              never logged, never returned by the API, never written to your repository. A key that
              fails its connection test is never saved. When you connect a non-native provider, Kuma
              tells you honestly that verification runs on your connected model rather than pretending
              a separate critic ran.
            </p>
          </Doc>

          <Doc
            section={SECTIONS[5]}
            lead="From a finding to a merged fix is a state machine — and the human owns the one gate that matters."
          >
            <p>A fix moves through explicit, visible states:</p>
            <p className="rounded-xl border border-border-subtle bg-surface-1 px-4 py-3 font-mono text-[13px] text-content-secondary">
              detecting → fanning&nbsp;out → verifying → composing → ready →{" "}
              <span className="text-accent-primary">approved</span> → posted
            </p>
            <p>
              Kuma drives the workflow all the way to <em>ready</em> on its own. The transition from{" "}
              <em>ready</em> to <em>approved</em> is the human-in-the-loop gate: only a person can set
              it, the approval endpoint rejects anything not actually ready, and the pull request is
              staged — never sent — until you press send. Kuma never auto-merges and never opens a PR
              behind your back. This is the moat: automation up to the decision, a human at the
              decision.
            </p>
          </Doc>

          <Doc
            section={SECTIONS[6]}
            lead="Agents talk like a well-run team: structured status, escalation before things get worse, one board everyone reads."
          >
            <p>
              Kuma's agents coordinate using a communication discipline borrowed from operational-
              excellence practice. Every specialist reports a structured status — its dimension, its
              state, a one-line summary, its real confidence, and anything blocking it — instead of
              noisy chatter. A deterministic escalation ladder decides what rolls up: a low-confidence
              or blocked finding escalates to the synthesizer; a synthesizer that cannot compose a
              confident answer escalates to you.
            </p>
            <p>
              All of it projects onto a single situational-awareness board over the live review
              stream, so the whole state of a review — who found what, what is stuck, what needs a
              human — is legible at a glance. Confidence numbers are always real, taken from the agent
              and its critic; an agent that did not run shows as absent, never as a fabricated
              &ldquo;on track.&rdquo;
            </p>
          </Doc>

          <Doc
            section={SECTIONS[7]}
            lead="Reviews cite what actually happened in production, not just what the diff looks like."
          >
            <p>
              Connect your telemetry and Kuma's reviews gain real-world grounding — the difference
              between &ldquo;this function looks risky&rdquo; and &ldquo;this endpoint failed six
              times this week.&rdquo; Available connectors include GitHub Actions (CI health),
              PostHog (product usage), Sentry (error and incident history), and Vercel (deploy health
              and rollbacks).
            </p>
            <p>
              Every connector is optional. Kuma reviews from the diff alone until you connect one, and
              says so plainly rather than implying context it does not have.
            </p>
          </Doc>

          <Doc
            section={SECTIONS[8]}
            lead="The agents navigate a real graph of your code, not a flat pile of files."
          >
            <p>
              When Kuma connects to a repository it builds a code map — a navigable graph of the
              project's structure that the review agents query to understand how a change ripples
              through the codebase. The map is built on connect and loads without any model key, so
              your overview shows a real picture of the repo from the first moment, not a placeholder.
            </p>
          </Doc>

          <Doc
            section={SECTIONS[9]}
            lead="The strategies that make Kuma safe to point at your codebase."
          >
            <p>These are guarantees, not aspirations — they are enforced in the system:</p>
            <ul className="space-y-2.5">
              <TrustItem title="Human-in-the-loop moat">
                Kuma never sends a pull request or merges anything on its own. The driver never
                crosses the approval gate; only a human sets it.
              </TrustItem>
              <TrustItem title="Anti-fabrication">
                Kuma never invents findings, diffs, or status. When it has nothing, it shows an honest
                empty state. Confidence and status always reflect a real run — never a display value.
              </TrustItem>
              <TrustItem title="Tenant isolation">
                Every query is scoped to your installation. One customer can never see another's
                repositories, connections, or reviews.
              </TrustItem>
              <TrustItem title="Secrets stay secret">
                API keys are encrypted at rest, decrypted only in memory, never logged, and never
                returned by the API. Keys never enter your git history.
              </TrustItem>
              <TrustItem title="Honest identity">
                Signing in shows you exactly which account and workspace you are in, so an empty
                workspace reads as empty — never as lost data.
              </TrustItem>
            </ul>
          </Doc>

          <div className="rounded-2xl border border-border-default bg-surface-1 p-8 text-center">
            <h2 className="text-xl font-semibold text-content-primary">Ready to try it?</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-content-muted">
              Install the GitHub App, connect the free local model, and open a pull request. Your
              first review runs in minutes.
            </p>
            <Link
              href="/login"
              className="mt-5 inline-flex items-center gap-2 rounded-xl bg-accent-primary px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Get started
            </Link>
          </div>
        </main>
      </div>

      <MarketingFooter />
    </div>
  );
}

function Doc({
  section,
  lead,
  children,
}: {
  section: Section;
  lead: string;
  children: React.ReactNode;
}) {
  return (
    <section id={section.id} className="scroll-mt-24">
      <div className="mb-4 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border-default bg-content-primary/5 text-accent-primary">
          <section.icon className="h-5 w-5" />
        </span>
        <h2 className="text-2xl font-semibold tracking-tight text-content-primary">
          {section.label}
        </h2>
      </div>
      <p className="mb-4 text-[15px] font-medium text-content-secondary">{lead}</p>
      <div className="space-y-4 text-[15px] leading-relaxed text-content-muted [&_strong]:font-semibold [&_strong]:text-content-secondary">
        {children}
      </div>
    </section>
  );
}

function Steps({ steps }: { steps: { n: number; title: string; body: string }[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((s) => (
        <li key={s.n} className="flex gap-4 rounded-xl border border-border-subtle bg-surface-1 p-4">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-primary/10 text-sm font-semibold text-accent-primary">
            {s.n}
          </span>
          <div>
            <p className="text-sm font-semibold text-content-primary">{s.title}</p>
            <p className="mt-1 text-sm text-content-muted">{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Dimensions({ items }: { items: [string, string][] }) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {items.map(([name, desc]) => (
        <div key={name} className="rounded-xl border border-border-subtle bg-surface-1 px-4 py-3">
          <p className="text-sm font-semibold text-content-primary">{name}</p>
          <p className="mt-0.5 text-[13px] text-content-muted">{desc}</p>
        </div>
      ))}
    </div>
  );
}

function TrustItem({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-xl border border-border-subtle bg-surface-1 px-4 py-3">
      <p className="text-sm font-semibold text-content-primary">{title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-content-muted">{children}</p>
    </li>
  );
}
