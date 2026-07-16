// The specialist disciplines the PM-distributor dispatches to. A discipline is a
// *worker* specialization (roles.ts is unchanged) — the review disciplines
// (security/reviewer) reuse today's agents; reproduction/root-cause/fix-author/
// test-author/qa are net-new (design §2.2).

export type Specialty =
  | "reproduction"
  | "root-cause"
  | "fix-author"
  | "test-author"
  | "security"
  | "reviewer"
  | "qa";

export const SPECIALTIES: readonly Specialty[] = [
  "reproduction",
  "root-cause",
  "fix-author",
  "test-author",
  "security",
  "reviewer",
  "qa",
];
