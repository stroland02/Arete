import type { AccountState } from "@/lib/account-state";

/**
 * The overview onboarding/next-action state, derived SOLELY from the
 * Account-State Contract resolver (getAccountState) — never from ad-hoc
 * hasAccess/hasReviews checks.
 * See docs/superpowers/specs/2026-07-17-account-state-contract.md.
 *
 * The setup narrative is four steps: connect an AI model → connect your
 * codebase → build, deploy & verify → extend Kuma (MCP + services). Every
 * `done` flag maps to a real DB fact. Capabilities that are designed but not
 * yet shipped (the coding-agent setup prompt, MCP Kuma) appear as
 * `coming_soon` sub-steps: guidance, never a checkmark.
 */

export type StepStatus = "done" | "todo" | "coming_soon";

export interface SetupSubStep {
  id: string;
  label: string;
  /** One-line explanation shown under the label. */
  detail?: string;
  /** `coming_soon` renders a pill + guided text — NEVER a checkbox. */
  status: StepStatus;
  href?: string;
}

export interface SetupStep {
  id: "connect-model" | "connect-codebase" | "verify" | "extend";
  label: string;
  detail: string;
  /** A real, account-state-backed fact — never fabricated. */
  done: boolean;
  cta?: { label: string; href: string };
  subSteps?: SetupSubStep[];
}

export interface OverviewSetup {
  /** Always the four narrative steps, in order. */
  steps: SetupStep[];
  /** Done count among the four top-level steps. */
  doneCount: number;
  /** Steps 1–3 done. Step 4 (extend) is optional and never gates completion. */
  setupComplete: boolean;
  /** First not-done step of 1–3, else step 4 when it still has work, else undefined. */
  nextStep: SetupStep | undefined;
}

export function deriveOverviewSetup(
  state: Pick<
    AccountState,
    "repoConnected" | "modelConnected" | "hasReviews" | "scanCompleted" | "telemetryConnected"
  >,
): OverviewSetup {
  const steps: SetupStep[] = [
    {
      id: "connect-model",
      label: "Connect an AI model",
      detail:
        "Kuma can't think without a model. Bring your own key — Anthropic, OpenAI, Gemini, OpenRouter — or run free on local Ollama.",
      done: state.modelConnected,
      cta: { label: "Connect an AI model", href: "/connections/ai-models" },
    },
    {
      id: "connect-codebase",
      label: "Connect your codebase",
      detail: "Give Kuma the code it will reason about.",
      done: state.repoConnected,
      cta: { label: "Connect a repository", href: "/connections" },
      subSteps: [
        {
          id: "github-app",
          label: "Install the Kuma GitHub App",
          detail: "Kuma indexes the repo into its code map the moment it connects.",
          status: state.repoConnected ? "done" : "todo",
          href: "/connections",
        },
        {
          id: "workspace-setup",
          label: "Run the Kuma setup prompt in your coding agent",
          detail:
            "Installs Kuma skills, wires OpenTelemetry, and embeds the code graph in your project.",
          status: "todo",
          href: "/connections/workspace-setup",
        },
      ],
    },
    {
      id: "verify",
      label: "Build, deploy & verify",
      detail:
        "Kuma's first repo scan lands findings in your inbox; opening a pull request gets your first verified review.",
      // Either real signal proves the repo+model pair works end to end.
      done: state.hasReviews || state.scanCompleted,
    },
    {
      id: "extend",
      label: "Extend Kuma",
      detail: "Optional — give reviews production context and bring Kuma into your agent.",
      done: state.telemetryConnected,
      cta: { label: "Connect your services", href: "/connections" },
      subSteps: [
        {
          id: "mcp-kuma",
          label: "Connect MCP Kuma to your agent",
          detail: "Pull Kuma's review judgment straight into your coding agent.",
          status: "todo",
          href: "/connections/mcp-kuma",
        },
        {
          id: "connect-services",
          label: "Connect your git account and services",
          detail: "GitHub Actions, PostHog, Vercel, Stripe — production signals for reviews.",
          status: state.telemetryConnected ? "done" : "todo",
          href: "/connections",
        },
      ],
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const core = steps.slice(0, 3);
  const setupComplete = core.every((s) => s.done);
  const nextStep = core.find((s) => !s.done) ?? (steps[3].done ? undefined : steps[3]);
  return { steps, doneCount, setupComplete, nextStep };
}
