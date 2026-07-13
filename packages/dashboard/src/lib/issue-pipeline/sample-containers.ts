/**
 * Sample IssueContainer fixtures — the "sample producer" data source.
 * See docs/superpowers/specs/2026-07-13-synthesizer-component-and-critic.md §4, §5.2.
 *
 * These conform to the canonical IssueContainer type (types.ts). They feed the
 * in-memory ContainerStore so the real SSE path + real component can run before
 * the live Critic / connectors exist. The UI labels anything from here with a
 * "Sample" chip — it is never presented as a real review.
 */

import type { IssueContainer, SynthStep } from "./types";

/** Tenant the sample containers live under (no real GitHub installs yet — auth.ts). */
export const SAMPLE_INSTALLATION_ID = "sample-installation";

const T0 = "2026-07-13T14:00:00Z";

/** A fully-scripted transcript for the animated (working) sample — streamed live. */
const WORKING_TRANSCRIPT: SynthStep[] = [
  { kind: "dispatch", text: "6 specialists dispatched in parallel", detail: "security · performance · quality · tests · deploys · business logic", at: T0 },
  { kind: "report", agentId: "security", text: "Security reported 2 candidates", at: T0 },
  { kind: "report", agentId: "business_logic", text: "Business Logic reported 1 candidate", at: T0 },
  { kind: "verify", findingId: "f-sec-1", agentId: "security", text: "Verifying Security · src/billing/webhooks/handlers.ts:42", at: T0 },
  { kind: "keep", findingId: "f-sec-1", agentId: "security", text: "Kept — evidence in the diff", detail: "src/billing/webhooks/handlers.ts:42", at: T0 },
  { kind: "verify", findingId: "f-sec-2", agentId: "security", text: "Verifying Security · src/billing/webhooks/handlers.ts:88", at: T0 },
  { kind: "drop", findingId: "f-sec-2", agentId: "security", text: "Dropped — unproven", detail: "no evidence in the diff at src/billing/webhooks/handlers.ts:88", at: T0 },
  { kind: "verify", findingId: "f-biz-1", agentId: "business_logic", text: "Verifying Business Logic · src/billing/webhooks/handlers.ts:51", at: T0 },
  { kind: "keep", findingId: "f-biz-1", agentId: "business_logic", text: "Kept — wants a human look", detail: "signature check present but Critic confidence is 0.55", at: T0, needsAttention: true },
  { kind: "compose", text: "Composing review — 2 comments", at: T0 },
  { kind: "posted", text: "Review composed — ready for your approval", at: T0 },
];

const WORKING: IssueContainer = {
  id: "sample-working",
  installationId: SAMPLE_INSTALLATION_ID,
  serviceId: "payments-api",
  fingerprint: "payments-api::typeerror::charge()",
  source: "Sentry",
  severity: "critical",
  state: "verifying",
  firstSeen: T0,
  lastSeen: T0,
  occurrences: 3,
  evidence: [
    { key: "error", value: "TypeError: cannot read 'amount' of undefined" },
    { key: "top frame", value: "src/billing/webhooks/handlers.ts:42" },
  ],
  findings: [
    { id: "f-sec-1", agentId: "security", category: "security", file: "src/billing/webhooks/handlers.ts", line: 42, rationale: "Webhook body parsed before signature verification.", diff: [], verdict: "kept" },
    { id: "f-sec-2", agentId: "security", category: "security", file: "src/billing/webhooks/handlers.ts", line: 88, rationale: "Possible log of raw payload.", diff: [], verdict: "dropped", droppedReason: "no evidence in the diff at src/billing/webhooks/handlers.ts:88" },
    { id: "f-biz-1", agentId: "business_logic", category: "business_logic", file: "src/billing/webhooks/handlers.ts", line: 51, rationale: "invoice.paid handled without idempotency key.", diff: [], verdict: "kept", confidence: 0.55 },
  ],
  transcript: WORKING_TRANSCRIPT,
  pr: {
    number: null,
    base: "main",
    branch: "arete/fix-sample-working",
    title: "Areté review — 2 verified findings",
    body: "Areté verified 2 finding(s) against this diff.",
    comments: [
      { findingId: "f-sec-1", file: "src/billing/webhooks/handlers.ts", line: 42, body: "**security**: Webhook body parsed before signature verification." },
      { findingId: "f-biz-1", file: "src/billing/webhooks/handlers.ts", line: 51, body: "**business_logic**: invoice.paid handled without idempotency key." },
    ],
    state: "ready",
    hostUrl: null,
  },
  gates: { solutionApprovedAt: null, solutionApprovedBy: null, postedAt: null, postedBy: null },
  createdAt: T0,
  updatedAt: T0,
};

const DONE: IssueContainer = {
  id: "sample-done",
  installationId: SAMPLE_INSTALLATION_ID,
  serviceId: "checkout-web",
  fingerprint: "checkout-web::referenceerror::render()",
  source: "Areté",
  severity: "high",
  state: "posted",
  firstSeen: T0,
  lastSeen: T0,
  occurrences: 1,
  evidence: [{ key: "review", value: "PR #128 — 1 verified finding" }],
  findings: [
    { id: "f-q-1", agentId: "quality", category: "quality", file: "src/checkout/cart.tsx", line: 17, rationale: "Unhandled null before render.", diff: [], verdict: "kept" },
  ],
  transcript: [
    { kind: "dispatch", text: "6 specialists dispatched in parallel", at: T0 },
    { kind: "report", agentId: "quality", text: "Quality reported 1 candidate", at: T0 },
    { kind: "verify", findingId: "f-q-1", agentId: "quality", text: "Verifying Quality · src/checkout/cart.tsx:17", at: T0 },
    { kind: "keep", findingId: "f-q-1", agentId: "quality", text: "Kept — evidence in the diff", detail: "src/checkout/cart.tsx:17", at: T0 },
    { kind: "compose", text: "Composing review — 1 comment", at: T0 },
    { kind: "posted", text: "Pull request opened — PR #128", at: T0 },
  ],
  pr: {
    number: 128,
    base: "main",
    branch: "arete/fix-sample-done",
    title: "Areté review — 1 verified finding",
    body: "Areté verified 1 finding against this diff.",
    comments: [{ findingId: "f-q-1", file: "src/checkout/cart.tsx", line: 17, body: "**quality**: Unhandled null before render." }],
    state: "posted",
    hostUrl: "https://github.com/acme/checkout-web/pull/128",
  },
  gates: { solutionApprovedAt: T0, solutionApprovedBy: "you", postedAt: T0, postedBy: "you" },
  createdAt: T0,
  updatedAt: T0,
};

export const SAMPLE_CONTAINERS: IssueContainer[] = [WORKING, DONE];

/** Stable ids for the sample containers, so UI can reference them without literals. */
export const SAMPLE_WORKING_ID = WORKING.id;
export const SAMPLE_DONE_ID = DONE.id;

/** True for any container id served by the sample producer — drives the "Sample" chip. */
export function isSampleContainerId(id: string): boolean {
  return SAMPLE_CONTAINERS.some((c) => c.id === id);
}
