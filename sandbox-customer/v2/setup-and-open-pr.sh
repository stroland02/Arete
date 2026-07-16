#!/usr/bin/env bash
# Sandbox Customer v2 — push Beancount baseline + open the defective-feature PR.
#
# TEST DATA tooling. Run this YOURSELF from the repo root — it uses your git +
# gh credentials to push to a real GitHub repo and open a PR. It is intentionally
# NOT run by the agent (which has no GitHub auth and must not fabricate a push).
#
#   REPO=areteservices02-create/test01 bash sandbox-customer/v2/setup-and-open-pr.sh
#
# What it does:
#   1. clones the target repo into a temp dir
#   2. commits a CLEAN Beancount baseline to `main` and pushes
#   3. creates `feat/expense-search`, commits the DEFECTIVE feature, pushes
#   4. opens the PR (gh) and prints its URL — this fires the webhook review
set -euo pipefail

REPO="${REPO:-areteservices02-create/test01}"
BASE="${BASE_BRANCH:-main}"
FEATURE="${FEATURE_BRANCH:-feat/expense-search}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../app" && pwd)"
BASELINE_SERVER="$SCRIPT_DIR/baseline-server.ts"

# The files the PR ADDS/CHANGES — the diff that carries the catalogued defects.
FEATURE_FILES=("api/expenses.ts" "api/reports.ts" "api/__tests__/reports.test.ts")

echo "==> Preflight"
command -v gh >/dev/null || { echo "gh CLI not found — install it and 'gh auth login'"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Not authenticated — run 'gh auth login'"; exit 1; }
[ -d "$APP_DIR" ] || { echo "Sample app not found at $APP_DIR"; exit 1; }
[ -f "$BASELINE_SERVER" ] || { echo "Baseline server not found at $BASELINE_SERVER"; exit 1; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
echo "==> Cloning https://github.com/$REPO into $WORK/repo"
git clone "https://github.com/$REPO.git" "$WORK/repo"
cd "$WORK/repo"
git checkout -B "$BASE"

echo "==> Assembling clean baseline (feature files excluded, health-only server)"
cp -r "$APP_DIR/." ./
for f in "${FEATURE_FILES[@]}"; do rm -f "./$f"; done
cp "$BASELINE_SERVER" "api/server.ts"
git add -A
git commit -m "chore: scaffold Beancount baseline (no feature yet)"
echo "==> Pushing baseline to $BASE"
git push -u origin "$BASE"

echo "==> Creating feature branch $FEATURE with the defective feature"
git checkout -b "$FEATURE"
for f in "${FEATURE_FILES[@]}"; do
  mkdir -p "$(dirname "./$f")"
  cp "$APP_DIR/$f" "./$f"
done
cp "$APP_DIR/api/server.ts" "api/server.ts"  # feature server wires the new handlers
git add -A
git commit -m "feat: add expense search, paginated listing, and category report"
echo "==> Pushing $FEATURE"
git push -u origin "$FEATURE"

echo "==> Opening PR"
PR_URL="$(gh pr create \
  --repo "$REPO" \
  --base "$BASE" \
  --head "$FEATURE" \
  --title "Add expense search + paginated listing and a category report" \
  --body "Adds GET /expenses (paginated), GET /expenses/search, and GET /reports/summary for the new dashboard. First pass — feedback welcome.")"

echo ""
echo "PR opened: $PR_URL"
echo "This should fire pull_request.opened -> smee -> :3001/webhook -> review-pr queue."
echo "Watch the webhook worker logs and the PR for Areté's review comments + check run."
