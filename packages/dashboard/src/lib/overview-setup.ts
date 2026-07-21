import type { AccountState } from "@/lib/account-state";

/**
 * The overview onboarding/next-action state, derived SOLELY from the
 * Account-State Contract resolver (getAccountState) — never from ad-hoc
 * hasAccess/hasReviews checks. This is the overview surface's adoption of the
 * three-state rule: "Connect a repository" is done once a repo is connected,
 * and the setup is complete once reviews actually exist.
 * See docs/superpowers/specs/2026-07-17-account-state-contract.md.
 */

export interface SetupStep {
  label: string;
  done: boolean;
}

export interface OverviewSetup {
  steps: SetupStep[];
  doneCount: number;
  /** True once reviews exist (stage === "active"). Drives the card's evolution. */
  setupComplete: boolean;
  /** The first not-yet-done step, or undefined when setup is complete. */
  nextStep: SetupStep | undefined;
}

export function deriveOverviewSetup(
  state: Pick<AccountState, "repoConnected" | "modelConnected" | "hasReviews">,
): OverviewSetup {
  const steps: SetupStep[] = [
    { label: "Create your Kuma account", done: true },
    { label: "Connect a repository", done: state.repoConnected },
    // Kuma can't review without a model — a real, account-state-backed step
    // (modelConnected), never a fabricated checkmark. Claude Code recommended.
    { label: "Connect an AI model", done: state.modelConnected },
    { label: "Open a pull request", done: state.hasReviews },
    { label: "Get your first verified review", done: state.hasReviews },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  return {
    steps,
    doneCount,
    setupComplete: state.hasReviews,
    nextStep: steps.find((s) => !s.done),
  };
}
