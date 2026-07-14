/**
 * Static catalog of the telemetry connectors the review pipeline supports
 * (packages/webhook/src/telemetry/*, see docs/superpowers/specs/2026-07-10-telemetry-connectors-design.md).
 * This is intentionally NOT read from a database — "connected" is always
 * false here even though TelemetryConnection now exists, because this
 * catalog only describes what's connectABLE, not a given user's actual
 * connections; getConnectedTelemetryProviders (queries.ts) is the real
 * per-installation source of truth. Every description and requirement
 * below is drawn from the real implementation, not invented.
 */

export type ConnectorAuthKind = "existing-token" | "api-key" | "oauth";

export interface ConnectorDef {
  id: string;
  name: string;
  category: string;
  tagline: string;
  authKind: ConnectorAuthKind;
  authSummary: string;
  trustNote: string;
  requirement?: string;
  status: "available" | "planned";
  connected: false;
}

export const CONNECTORS: ConnectorDef[] = [
  {
    id: "github-actions",
    name: "GitHub Actions",
    category: "CI health",
    tagline: "How healthy has this repo's CI been recently — failure rate over the last 30 days.",
    authKind: "existing-token",
    authSummary: "Uses the GitHub App installation you already granted Kuma. No new credential to store.",
    trustNote: "No new token is created or stored — Kuma reuses the same installation-scoped access it already has for reviewing this repo.",
    status: "available",
    connected: false,
  },
  {
    id: "posthog",
    name: "PostHog",
    category: "Product usage",
    tagline: "Correlate a PR's feature area with real product engagement and conversion trends.",
    authKind: "oauth",
    authSummary: "OAuth connection — click to sign in with PostHog, same as GitHub sign-in.",
    trustNote: "Kuma only requests read-only analytics access. Revoke access anytime from your PostHog account settings.",
    status: "available",
    connected: false,
  },
  {
    id: "sentry",
    name: "Sentry",
    category: "Errors",
    tagline: "Surface recent error spikes and incident history for the code a PR touches.",
    authKind: "oauth",
    authSummary: "OAuth connection — gated behind Sentry's own integration review process.",
    trustNote: "Sentry's own MCP server typically requires a paid-tier org to return meaningful data.",
    requirement: "Not yet available — Sentry requires publishing an approved integration before this can launch.",
    status: "planned",
    connected: false,
  },
  {
    id: "vercel",
    name: "Vercel",
    category: "Deploys",
    tagline: "Understand deploy health and recent rollback history for the affected project.",
    authKind: "oauth",
    authSummary: "OAuth connection — click to sign in with Vercel, same as GitHub sign-in.",
    trustNote: "Vercel does not offer Drains (the streaming telemetry API) on the Hobby plan.",
    requirement: "Requires a Vercel Pro or Enterprise team.",
    status: "available",
    connected: false,
  },
  {
    id: "stripe",
    name: "Stripe",
    category: "Revenue",
    tagline: "Connect code changes in billing-critical paths to real revenue and subscription impact.",
    authKind: "api-key",
    authSummary: "A restricted, read-only API key — Stripe Connect (OAuth) isn't the right tool for reading your own account's data.",
    trustNote: "Create a Restricted key in Stripe with read-only access to Charges. Kuma encrypts it at rest and never requests write access.",
    status: "available",
    connected: false,
  },
];

export function getConnector(id: string): ConnectorDef | undefined {
  return CONNECTORS.find((c) => c.id === id);
}
