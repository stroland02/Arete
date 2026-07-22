// Deep-links from an error into the trace that produced it.
//
// The user's framing (verbatim): "Let's come up with a plan to address these
// issues and come up with a solution to implement ... make sure that we
// remaining good engine software engineering practices".
//
// WHY THIS MODULE EXISTS
// ----------------------
// Every error group already carries `sampleTraceId` (lib/errors.ts,
// `ErrorGroupView`) and every incident Signals row already carries `traceId`
// (lib/telemetry-queries.ts, `ErrorSpan` / `LogLine`), but until now neither
// linked anywhere — docs/status/2026-07-22-build-status-map.md §4 B2 names "no
// Jaeger deep-link" as a known gap. This is the ONE place that knows how to
// turn a trace id into a URL, so the Errors list and the incident detail page
// cannot drift apart on the rules below.
//
// CLIENT vs SERVER — the decision, and why
// ----------------------------------------
// The first consumer, components/dashboard/incidents/error-list.tsx, is a
// CLIENT component ("use client" — it renders the Silence/Resolve <form
// action>s). A plain `process.env.X` is NOT available in the browser: Next
// only inlines a variable into the client bundle when it is prefixed
// `NEXT_PUBLIC_` and referenced literally (node_modules/next/dist/docs/01-app/
// 02-guides/environment-variables.md, "Bundling Environment Variables for the
// Browser"; a `process.env[name]` lookup is explicitly NOT inlined).
//
// So the base URL is read from `NEXT_PUBLIC_JAEGER_UI_URL`, matching the
// established pattern in this app for exactly this situation —
// components/dashboard/glassbox/glassbox-dock.tsx reads
// `NEXT_PUBLIC_GLASSBOX_URL` for a dev-only sidecar that is likewise inert
// when unset. Threading the base down as a prop was the alternative; it was
// rejected because ErrorList reaches the page through IncidentsWorkspace,
// which is owned by another surface, and because the incident detail page
// (a Server Component) would then need a second, divergent path to the same
// value. One literal env read works identically during SSR and after
// hydration, so there is no hydration mismatch and no prop-drilling.
//
// Reading it INSIDE the function rather than into a module-level const is
// deliberate: the literal `process.env.NEXT_PUBLIC_JAEGER_UI_URL` is still
// inlined by Next either way, and tests can set/delete the variable per case
// (the lib/errors.test.ts convention for `ARETE_PLATFORM_INSTALLATION_ID`).
//
// HONESTY RULE
// ------------
// docs/handoff/2026-07-22-orchestration-briefs.md §0: "a control that cannot
// act must be `disabled`, never a live-looking button with no handler".
// A trace link that cannot open a trace is exactly that, so this returns
// `null` — not a placeholder URL, not `#`, not a base-less `/trace/` — and
// callers render NO anchor at all in that case. The trace id itself may still
// be shown as plain text; it is real. Nothing here ever invents an id.

/**
 * The configured Jaeger UI origin, normalized, or `null` when the feature is
 * simply not wired up in this environment.
 *
 * `null` for: unset, blank, unparseable, or a non-http(s) scheme. The scheme
 * check is defensive rather than a threat model — an operator-controlled env
 * is trusted — but a `javascript:` base would flow straight into an `href`
 * and become an XSS foot-gun, and that is too cheap to guard against not to.
 *
 * A trailing slash is stripped so `http://localhost:16686/` and
 * `http://localhost:16686` behave identically.
 */
function jaegerBaseUrl(): string | null {
  // Literal reference — required for Next's build-time inlining into the
  // client bundle. Do not refactor into a dynamic lookup.
  const raw = process.env.NEXT_PUBLIC_JAEGER_UI_URL;
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  // Strip any trailing slashes so the caller's `/trace/...` never doubles up.
  return trimmed.replace(/\/+$/, '');
}

/**
 * The Jaeger deep-link for a trace id, or `null` when no honest link exists.
 *
 * `null` when the Jaeger UI base URL is unconfigured (or unusable), and
 * `null` when the id is missing or blank. Callers MUST render no anchor for
 * `null` — never a dead or disabled-looking link.
 *
 * Shape: `<base>/trace/<traceId>` — Jaeger's own UI route.
 * e.g. traceUrl('4bf92f3577b34da6a3ce929d0e0e4736') with
 * NEXT_PUBLIC_JAEGER_UI_URL=http://localhost:16686 yields
 * `http://localhost:16686/trace/4bf92f3577b34da6a3ce929d0e0e4736`.
 */
export function traceUrl(traceId: string | null | undefined): string | null {
  const id = typeof traceId === 'string' ? traceId.trim() : '';
  if (id.length === 0) return null;

  const base = jaegerBaseUrl();
  if (base === null) return null;

  // Trace ids are hex in practice, so encoding is a no-op for real input —
  // it is here so a malformed id can never break out of the path segment.
  return `${base}/trace/${encodeURIComponent(id)}`;
}
