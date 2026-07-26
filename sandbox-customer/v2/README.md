# Sandbox Customer v2 — real GitHub webhook → review → PR E2E

v2 drives the **real** pipeline against a real GitHub repo with the Areté App
installed. Unlike v1 (local seed + local driver), this fires the actual webhook.

## Target (human prerequisites — DONE)

- Repo: **`areteservices02-create/test01`**
- KumaServices GitHub App installed on it ✓
- Webhook → smee (`https://smee.io/20rIIVo5FrSD9dz8`) → local `:3001/webhook` wired + verified ✓

## The E2E story

`main` gets a **clean** Beancount baseline (no feature yet). Then a PR on branch
`feat/expense-search` **adds the defective feature** — expense search + paginated
listing + a category report — which is where the four catalogued defects live
(SQL injection, pagination off-by-one, flaky test, O(n²) rollup; see
`../README.md`). The webhook fires on `pull_request.opened`, so the review runs on
that diff and posts findings back to the PR.

## What must be running locally for the review to actually complete

The webhook returns 200 fast and hands off to a queue; the review runs in the
worker. So, in addition to smee forwarding, you need up:

1. **Webhook server** on `:3001` (receives the smee-forwarded delivery).
2. **Webhook worker** (`packages/webhook` worker process) — runs the pipeline.
3. **Redis** — BullMQ backing store for the `review-pr` queue.
4. **Agents server** (`/review`) with **`ANTHROPIC_API_KEY`** set — the actual LLM review.
5. The **Installation row** for this repo must exist in the DB and be billing-allowed
   (`subscriptionStatus` trialing/active, free tier not exhausted). It is created by
   the App-installation `installation` webhook; if `/overview` shows the repo, this is fine.

If any of 1–4 is down, GitHub still shows the PR but no review posts — check the
worker logs. Nothing here fabricates a review.

## Run it (needs YOUR GitHub auth)

The push and PR-open use your `git` + `gh` credentials, so **you** run this — I
cannot and do not push on your behalf:

```bash
# from the repo root, with `gh auth status` green:
REPO=areteservices02-create/test01 bash sandbox-customer/v2/setup-and-open-pr.sh
```

The script (see `setup-and-open-pr.sh`):
1. clones the target repo into a temp dir,
2. commits the clean baseline to `main` and pushes,
3. creates `feat/expense-search`, commits the defective feature, pushes,
4. opens the PR with `gh pr create` and prints its URL.

## Observe

- **smee / `:3001` logs:** a `pull_request.opened` delivery arrives.
- **worker logs:** `Enqueued review-pr job … #<n>` then the pipeline running.
- **The PR on GitHub:** Areté's review comments appear, and an "Areté AI Code
  Review" check run. If a fix is proposed, a follow-up PR appears.

## Re-triggering

Reviews are idempotent per head SHA. To re-run, push a new commit to
`feat/expense-search` (a `synchronize` event) or open a fresh PR — re-opening the
same SHA is intentionally skipped.

## Assumptions / honesty

- Assumes the target repo is empty or README-only; the script adds a baseline
  commit onto `main` (it does not rewrite history).
- The defect catalogue and telemetry story match v1 so findings are consistent
  across the local and real paths.
