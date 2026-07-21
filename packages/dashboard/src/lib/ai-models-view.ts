// Pure view helpers for the AI Models section — no React/fetch/db, so they are
// unit-testable in isolation. The component (ai-models-section.tsx) renders the
// values these return; keeping the decisions here makes the connect/disconnect
// wiring testable without a browser or a live API.

import type { ModelConnection } from "./model-connections-client";

/**
 * The persisted connection for a provider, if any. A pure lookup over the
 * `client.list()` result — the row carries the `id` that Disconnect deletes.
 */
export function findProviderConnection(
  rows: ModelConnection[],
  providerId: string,
): ModelConnection | null {
  return rows.find((r) => r.provider === providerId) ?? null;
}

export interface DisconnectControl {
  /** Only a persisted connection can be disconnected. */
  show: boolean;
  label: string;
  disabled: boolean;
}

/**
 * Disconnect-button state. It appears only once a connection is actually
 * persisted (a `connectionId` exists) — never for a mere Test result — and
 * disables itself while the delete is in flight.
 */
export function disconnectControl(
  connectionId: string | null,
  disconnecting: boolean,
): DisconnectControl {
  return {
    show: connectionId !== null,
    label: disconnecting ? "Disconnecting…" : "Disconnect",
    disabled: disconnecting,
  };
}

/**
 * The active connection's id — the NEWEST by `connectedAt`. Reviews (and the
 * sidebar chip and agent chat) run on the newest connection — "newest = active",
 * mirroring `getActiveModelConnection` — so among several connected providers
 * exactly one is live. Null when nothing is connected. ISO-8601 UTC timestamps
 * compare correctly as plain strings, so no Date parsing is needed.
 */
export function activeConnectionId(rows: ModelConnection[]): string | null {
  let best: ModelConnection | null = null;
  for (const r of rows) {
    if (!best || r.connectedAt > best.connectedAt) best = r;
  }
  return best?.id ?? null;
}

export type ConnectionBadge = "active" | "connected" | "free-default" | null;

/**
 * Which badge a provider row shows. A persisted connection reads "active" when
 * it is the live one (Kuma runs reviews on it) and "connected" (saved but idle)
 * otherwise; an unconnected provider shows "free-default" for the free default,
 * else nothing. `hasConnection` MUST come from the persisted list() — never from
 * an ephemeral Test outcome — so a bare Test never fabricates a saved state.
 */
export function connectionBadge(opts: {
  hasConnection: boolean;
  isActive: boolean;
  freeDefault: boolean;
}): ConnectionBadge {
  if (opts.hasConnection) return opts.isActive ? "active" : "connected";
  return opts.freeDefault ? "free-default" : null;
}

export interface SetActiveControl {
  /** Only a saved-but-idle connection can be switched to. */
  show: boolean;
  label: string;
  disabled: boolean;
}

/**
 * "Set active" button state. It appears only for a connection that is saved but
 * NOT the active one — the already-active row and unconnected providers have
 * nothing to switch to — and disables itself while the switch is in flight.
 */
export function setActiveControl(opts: {
  hasConnection: boolean;
  isActive: boolean;
  switching: boolean;
}): SetActiveControl {
  return {
    show: opts.hasConnection && !opts.isActive,
    label: opts.switching ? "Switching…" : "Set active",
    disabled: opts.switching,
  };
}
