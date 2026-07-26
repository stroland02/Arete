import type { AccountState, AccountStage } from "@/lib/account-state";
import type { ActiveModelConnection } from "@/lib/model-connections-map";
import { getConnector } from "@/lib/connector-catalog";
import { getModelProvider } from "@/lib/model-catalog";

/**
 * The Settings → Connections summary: what this account actually has connected,
 * derived PURELY from already-fetched facts (no db, no I/O, no fetch) so it is
 * total and unit-testable.
 *
 * Settings SUMMARIZES and LINKS — `/connections` stays the management home
 * (the OAuth/connect flows only exist on its sub-routes, and ~20 call sites
 * deep-link there). This function produces the read-only view model; every
 * row carries the href that manages it.
 *
 * HONESTY (docs/superpowers/specs/2026-07-17-account-state-contract.md):
 *  - Connection facts come from `getAccountState` — the single source of truth
 *    — never from an ad-hoc local check.
 *  - Nothing is ever fabricated. A row that is not connected says exactly
 *    "Not connected" (NOT_CONNECTED below) and carries no items — never a
 *    plausible-looking placeholder, never a blank.
 *  - THE THREE-STATE RULE: "connected but idle" is a POPULATED state, not an
 *    empty one. A repo connected with no reviews yet reports connected=true,
 *    idle=true, and says so — and its CTA is "Manage", never "Connect a
 *    repository".
 *  - Only real names appear: actual repository full-names, the actual
 *    provider + model, the actual connected telemetry providers. Long lists are
 *    truncated honestly with a "+N more" marker; nothing is invented.
 */

/** The exact copy for a row with nothing connected. Never a blank, never a guess. */
export const NOT_CONNECTED = "Not connected";

/** How many real names a row lists before it truncates to "+N more". */
export const MAX_LISTED_ITEMS = 3;

export type ConnectionRowId = "repositories" | "ai-model" | "services";

export interface ConnectionRow {
  id: ConnectionRowId;
  label: string;
  /**
   * The real state, in one line. Always non-empty. Exactly `NOT_CONNECTED`
   * when nothing is connected.
   */
  status: string;
  /** A real connection exists. True for "connected but idle" too. */
  connected: boolean;
  /**
   * Connected, but nothing has run on it yet (three-state `connected_idle`).
   * Only the repositories row can be idle today — a repo with no reviews. It
   * is still a populated state; `connected` stays true.
   */
  idle: boolean;
  /**
   * Real names only — repo full-names, connected telemetry provider labels.
   * Truncated to `MAX_LISTED_ITEMS` plus a literal "+N more" entry. Empty
   * whenever the row is not connected.
   */
  items: string[];
  /** Where this is actually managed — `/connections` and its sub-routes. */
  href: string;
  /** "Manage …" once connected; only a disconnected row says "Connect …". */
  actionLabel: string;
}

export interface ConnectionsSummary {
  rows: ConnectionRow[];
  /** How many of the rows are genuinely connected. */
  connectedCount: number;
  /** Total rows — so the header can say "1 of 3 connected" truthfully. */
  totalCount: number;
  /** The canonical account lifecycle stage, passed through unchanged. */
  stage: AccountStage;
}

export interface ConnectionsSummaryInput {
  accountState: AccountState;
  /** Real repository full-names ("owner/repo") from getConnectedRepositories. */
  repositories: string[];
  /** Real connected provider ids from getConnectedTelemetryProviders. */
  telemetryProviders: string[];
  /** The active model from getActiveModelConnection, or null when none. */
  activeModel: ActiveModelConnection | null;
}

/** Truncate a list of real names honestly — never drop the count on the floor. */
function truncate(names: string[], max: number = MAX_LISTED_ITEMS): string[] {
  if (names.length <= max) return names;
  return [...names.slice(0, max), `+${names.length - max} more`];
}

/** Display label for a telemetry provider id; unknown ids show the raw id. */
function telemetryLabel(id: string): string {
  return getConnector(id)?.name ?? id;
}

/** Display label for a model provider id; unknown ids show the raw id. */
function modelProviderLabel(id: string): string {
  return getModelProvider(id)?.name ?? id;
}

function repositoriesRow(state: AccountState, repositories: string[]): ConnectionRow {
  const base = {
    id: "repositories" as const,
    label: "Repositories",
    href: "/connections",
  };
  if (!state.repoConnected) {
    return {
      ...base,
      status: NOT_CONNECTED,
      connected: false,
      idle: false,
      items: [],
      actionLabel: "Connect a repository",
    };
  }
  // Connected. Prefer the names we were handed; fall back to the resolver's
  // count so a row never understates what is really there.
  const count = repositories.length > 0 ? repositories.length : state.repoCount;
  if (count === 0) {
    // Installation authorized but nothing indexed yet — connected, not empty.
    return {
      ...base,
      status: "Connected — no repositories indexed yet",
      connected: true,
      idle: true,
      items: [],
      actionLabel: "Manage repositories",
    };
  }
  const noun = count === 1 ? "repository" : "repositories";
  return {
    ...base,
    // connected_idle is a populated state: say what is connected AND that
    // nothing has run yet. Never collapse it into "not connected".
    status: state.hasReviews
      ? `${count} ${noun} connected`
      : `${count} ${noun} connected — no reviews yet`,
    connected: true,
    idle: !state.hasReviews,
    items: truncate(repositories),
    actionLabel: "Manage repositories",
  };
}

function modelRow(state: AccountState, activeModel: ActiveModelConnection | null): ConnectionRow {
  const base = {
    id: "ai-model" as const,
    label: "AI model",
    href: "/connections/ai-models",
    idle: false,
    items: [] as string[],
  };
  if (activeModel) {
    return {
      ...base,
      status: `${modelProviderLabel(activeModel.provider)} · ${activeModel.model}`,
      connected: true,
      actionLabel: "Manage AI models",
    };
  }
  if (state.modelConnected) {
    // The resolver counted a connection but we have no row to name. Say that
    // plainly rather than inventing a provider or model.
    return {
      ...base,
      status: "Connected — model details unavailable",
      connected: true,
      actionLabel: "Manage AI models",
    };
  }
  return {
    ...base,
    status: NOT_CONNECTED,
    connected: false,
    actionLabel: "Connect an AI model",
  };
}

function servicesRow(state: AccountState, telemetryProviders: string[]): ConnectionRow {
  const base = {
    id: "services" as const,
    label: "Services",
    href: "/connections",
    idle: false,
  };
  if (telemetryProviders.length > 0) {
    const count = telemetryProviders.length;
    return {
      ...base,
      status: `${count} ${count === 1 ? "service" : "services"} connected`,
      connected: true,
      items: truncate(telemetryProviders.map(telemetryLabel)),
      actionLabel: "Manage services",
    };
  }
  if (state.telemetryConnected) {
    // Resolver says connected but no provider list was handed to us — report
    // the connection without naming a service we cannot see.
    return {
      ...base,
      status: "Connected — service details unavailable",
      connected: true,
      items: [],
      actionLabel: "Manage services",
    };
  }
  return {
    ...base,
    status: NOT_CONNECTED,
    connected: false,
    items: [],
    actionLabel: "Connect a service",
  };
}

export function deriveConnectionsSummary({
  accountState,
  repositories,
  telemetryProviders,
  activeModel,
}: ConnectionsSummaryInput): ConnectionsSummary {
  const rows: ConnectionRow[] = [
    repositoriesRow(accountState, repositories),
    modelRow(accountState, activeModel),
    servicesRow(accountState, telemetryProviders),
  ];
  return {
    rows,
    connectedCount: rows.filter((r) => r.connected).length,
    totalCount: rows.length,
    stage: accountState.stage,
  };
}
