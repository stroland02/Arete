# Areté — Phase 1.6: Dashboard Data Plumbing & GitLab Support

**Goal:** Complete the final two deliverables of Phase 1 to wrap up the core MVP. We need to replace the dashboard's placeholder data with real metrics from our Prisma database, and add GitLab webhook support to expand our total addressable market.

---

## Task 1: Dashboard Data Plumbing (Next.js)

**Files:**
- Create: `packages/dashboard/src/lib/db.ts` (Prisma client singleton)
- Modify: `packages/dashboard/src/app/page.tsx` (Dashboard Overview)

**Implementation:**
1. **DB Client:** Set up a Next.js-compatible Prisma singleton in `src/lib/db.ts` to prevent connection exhaustion in dev mode.
2. **Data Fetching:** In the Next.js App Router (`page.tsx` is a Server Component):
   - Query `prisma.review.count()` for Total PRs Reviewed.
   - Query `prisma.repository.count()` for Active Repositories.
   - Query the latest 5 `Review` records (with their `repository` relations) for a "Recent Activity" feed.
3. **UI Integration:** Replace the hardcoded placeholder metric cards with the dynamic data fetched from Prisma.

## Task 2: GitLab Webhook Support

**Files:**
- Modify: `packages/webhook/src/server.ts`
- Create: `packages/webhook/src/gitlab-handler.ts`

**Implementation:**
1. **Endpoint:** Add a `POST /gitlab-webhook` route to Express.
2. **Validation:** Verify the `X-Gitlab-Token` matches our configured secret.
3. **Handler Logic:**
   - Detect `Merge Request Hook` events (`object_kind === 'merge_request'`).
   - If `action` is `open` or `update`, extract the PR context (title, description, repository, source/target branches).
   - *Note:* Since GitLab's API structure is entirely different from GitHub, we will create an adapter that maps the GitLab Merge Request payload into our existing `PRContext` interface.
   - Call `runReviewPipeline(prContext)` just like we do for GitHub.
   - Post the results back using the GitLab REST API (requires a GitLab PAT).

---

Once these two tasks are complete, **Phase 1 (Code Review Service MVP)** is officially 100% finished.
