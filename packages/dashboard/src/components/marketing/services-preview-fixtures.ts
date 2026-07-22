import type { Issue, Service } from "@/components/dashboard/services/services-workspace";

/**
 * ── Illustrative SAMPLE data — marketing preview ONLY, never the real page ──
 *
 * These services and incidents are INVENTED. They exist so a visitor to the
 * landing page can see what the /services triage workspace looks like once
 * tools are connected. The authenticated page
 * (packages/dashboard/src/app/(dashboard)/services/page.tsx) renders EMPTY by
 * default and never passes this data.
 *
 * They live HERE, in the marketing layer beside their single consumer
 * (`services-preview.tsx`), rather than inside the production
 * `services-workspace.tsx` component, so that fabricated telemetry is
 * structurally incapable of reaching a real account screen — one careless edit
 * inside the component file could otherwise wire it up. Importing this module
 * from anywhere under `app/(dashboard)/` is the bug.
 */
export const SAMPLE_SERVICES: Service[] = [
  { id: "payments-api", open: 3, worst: "critical" },
  { id: "auth-gateway", open: 2, worst: "high" },
  { id: "orders-service", open: 2, worst: "high" },
  { id: "notifications", open: 1, worst: "medium" },
  { id: "web-dashboard", open: 0, worst: "clear" },
];

export const SAMPLE_ISSUES: Issue[] = [
  {
    id: "p1", serviceId: "payments-api", source: "Sentry", severity: "critical",
    status: "Agent fixing", agent: "Business Logic",
    title: "TypeError: Cannot read 'balance' of null",
    occurrences: "1,204 events", lastSeen: "2m ago", where: "src/billing/charge.ts:23",
    summary: "Free-tier users have a null balance; the charge path assumes a number and throws before the request completes.",
    evidence: { file: "Sentry · TypeError · last 24h", rows: [["user.tier", "'free'"], ["balance", "None ← null"], ["at charge()", "src/billing/charge.ts:23"]] },
    fix: { file: "src/billing/charge.ts", rows: [
      { kind: "context", text: "function charge(order, user) {" },
      { kind: "remove", text: "  const amount = order.total * user.balance" },
      { kind: "add", text: "  const bal = user.balance ?? 0" },
      { kind: "add", text: "  const amount = order.total * bal" },
      { kind: "context", text: "  return stripe.charges.create({ amount })" },
      { kind: "context", text: "}" },
    ] },
    timeline: [
      { tone: "critical", text: "Error detected", when: "Sentry · 2m ago" },
      { tone: "accent", text: "Business Logic agent picked it up", when: "1m ago" },
      { tone: "accent", text: "Cross-checked with the diff & telemetry", when: "40s ago" },
      { tone: "good", text: "Fix proposed — awaiting your approval", when: "just now" },
    ],
  },
  {
    id: "p2", serviceId: "payments-api", source: "Stripe", severity: "high",
    status: "Fix proposed", agent: "Business Logic",
    title: "Charge retried without an idempotency key",
    occurrences: "47 events", lastSeen: "18m ago", where: "src/billing/charge.ts:31",
    summary: "This path already retries on timeout; without an idempotency key a retry can double-charge the customer.",
    evidence: { file: "Stripe · duplicate_charge · 7d", rows: [["event", "charge.retried"], ["idempotency_key", "null ← missing"], ["impact", "2 customers double-charged"]] },
    fix: { file: "src/billing/charge.ts", rows: [
      { kind: "context", text: "await stripe.charges.create(" },
      { kind: "context", text: "  { amount, currency: 'usd' }," },
      { kind: "remove", text: ")" },
      { kind: "add", text: "  { idempotencyKey: order.id }," },
      { kind: "add", text: ")" },
    ] },
    timeline: [
      { tone: "high", text: "Duplicate charges detected", when: "Stripe · 18m ago" },
      { tone: "accent", text: "Business Logic agent analyzing", when: "15m ago" },
      { tone: "good", text: "Fix proposed", when: "12m ago" },
    ],
  },
  {
    id: "p3", serviceId: "payments-api", source: "CI", severity: "medium",
    status: "Triaging", agent: "Test Coverage",
    title: "Flaky test: refund rounding",
    occurrences: "6 of 20 runs", lastSeen: "1h ago", where: "src/orders/refund.test.ts:15",
    summary: "The partial-refund test fails intermittently on rounding — the assertion compares floats directly.",
    evidence: { file: "GitHub Actions · test · 20 runs", rows: [["expected", "4.50"], ["received", "4.499999999"], ["flake_rate", "30%"]] },
    fix: { file: "src/orders/refund.test.ts", rows: [
      { kind: "remove", text: "expect(r.amount).toBe(4.5)" },
      { kind: "add", text: "expect(r.amount).toBeCloseTo(4.5, 2)" },
    ] },
    timeline: [
      { tone: "medium", text: "Flaky test flagged", when: "CI · 1h ago" },
      { tone: "accent", text: "Test Coverage agent triaging", when: "55m ago" },
    ],
  },
  {
    id: "a1", serviceId: "auth-gateway", source: "Kuma", severity: "high",
    status: "Fix proposed", agent: "Security",
    title: "Refresh token written to localStorage",
    occurrences: "312 events", lastSeen: "22m ago", where: "src/auth/session.ts:42",
    summary: "Tokens in localStorage are exposed to any script — an XSS bug would leak long-lived sessions.",
    evidence: { file: "Kuma review · Security · PR #418", rows: [["storage", "localStorage"], ["token_ttl", "30 days"], ["risk", "XSS → session theft"]] },
    fix: { file: "src/auth/session.ts", rows: [
      { kind: "remove", text: "localStorage.setItem('refresh', token)" },
      { kind: "add", text: "cookies().set('refresh', token, {" },
      { kind: "add", text: "  httpOnly: true, secure: true })" },
    ] },
    timeline: [
      { tone: "high", text: "Flagged on PR #418", when: "Kuma · 22m ago" },
      { tone: "accent", text: "Security agent analyzing", when: "20m ago" },
      { tone: "good", text: "Fix proposed", when: "16m ago" },
    ],
  },
  {
    id: "a2", serviceId: "auth-gateway", source: "Vercel", severity: "medium",
    status: "Triaging", agent: "Deployment Safety",
    title: "AUTH_SECRET missing in preview builds",
    occurrences: "preview builds", lastSeen: "40m ago", where: "vercel.json",
    summary: "Preview deployments boot without AUTH_SECRET, so login silently 500s on every PR preview.",
    evidence: { file: "Vercel · deploy · preview", rows: [["AUTH_SECRET", "undefined"], ["env", "preview"], ["result", "login 500"]] },
    fix: { file: "vercel.json", rows: [
      { kind: "context", text: '"env": {' },
      { kind: "add", text: '  "AUTH_SECRET": "@auth_secret"' },
      { kind: "context", text: "}" },
    ] },
    timeline: [
      { tone: "medium", text: "Preview boot failure", when: "Vercel · 40m ago" },
      { tone: "accent", text: "Deployment Safety triaging", when: "38m ago" },
    ],
  },
  {
    id: "o1", serviceId: "orders-service", source: "Sentry", severity: "high",
    status: "Agent fixing", agent: "Performance",
    title: "N+1 query on the orders list",
    occurrences: "8,900 events", lastSeen: "5m ago", where: "src/orders/list.ts:88",
    summary: "Each order row fires its own query; a 500-order page issues 500 round-trips and times out under load.",
    evidence: { file: "Sentry · slow_query · p95", rows: [["queries_per_req", "512"], ["p95_latency", "4.2s"], ["budget", "800ms"]] },
    fix: { file: "src/orders/list.ts", rows: [
      { kind: "remove", text: "for (const id of ids)" },
      { kind: "remove", text: "  orders.push(await find(id))" },
      { kind: "add", text: "const orders = await db.order.findMany({" },
      { kind: "add", text: "  where: { id: { in: ids } } })" },
    ] },
    timeline: [
      { tone: "high", text: "Latency regression", when: "Sentry · 5m ago" },
      { tone: "accent", text: "Performance agent picked it up", when: "4m ago" },
      { tone: "accent", text: "Building the fix", when: "1m ago" },
    ],
  },
  {
    id: "o2", serviceId: "orders-service", source: "CI", severity: "medium",
    status: "Triaging", agent: "Quality",
    title: "Dead code after checkout refactor",
    occurrences: "lint", lastSeen: "2h ago", where: "src/orders/legacy.ts",
    summary: "A whole module is unreferenced after the checkout refactor.",
    evidence: { file: "CI · knip", rows: [["unused_exports", "7"], ["file", "legacy.ts"]] },
    fix: { file: "src/orders/legacy.ts", rows: [{ kind: "remove", text: "// entire file unused — safe to delete" }] },
    timeline: [{ tone: "medium", text: "Dead code flagged", when: "CI · 2h ago" }],
  },
  {
    id: "n1", serviceId: "notifications", source: "PostHog", severity: "medium",
    status: "Triaging", agent: "Business Logic",
    title: "Signup → verify funnel dropped 18%",
    occurrences: "trend", lastSeen: "3h ago", where: "src/notify/email.ts",
    summary: "Verification emails started bouncing after the template change; PostHog shows the funnel drop.",
    evidence: { file: "PostHog · funnel · 24h", rows: [["step", "verify_email"], ["drop", "-18%"], ["suspect", "template v3"]] },
    fix: { file: "src/notify/email.ts", rows: [
      { kind: "remove", text: "from: 'no-reply@localhost'" },
      { kind: "add", text: "from: process.env.MAIL_FROM" },
    ] },
    timeline: [{ tone: "medium", text: "Funnel anomaly", when: "PostHog · 3h ago" }],
  },
];
