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
