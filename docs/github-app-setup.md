# GitHub App Setup Guide

This guide walks through registering the Kuma GitHub App for a new environment.

> ## ⚠️ The #1 gotcha: the Webhook URL must point at the **webhook server**, not the dashboard
>
> The GitHub App's **Webhook URL** must be the **webhook service** endpoint — `http://<public-host>/webhook` (the webhook server listens on **port 3000** and mounts the receiver at `/webhook`; see `packages/webhook/src/server.ts` + `index.ts`).
>
> It is **NOT** the Next.js **dashboard** (which runs on port **3002** and has no webhook receiver). If the Webhook URL points at the dashboard, GitHub's events (`installation`, `pull_request`, …) all 404 and are **silently dropped** — no `Installation` row is created, no reviews run, and the dashboard stays empty even though the app looks "installed."
>
> ### To actually run a review locally you need ALL of:
> 1. **Postgres** (`DATABASE_URL`) and **Redis** (`REDIS_URL`, for the BullMQ review queue).
> 2. **The webhook server:** `cd packages/webhook && pnpm dev` (needs `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `DATABASE_URL`, `REDIS_URL`).
> 3. **The Python agents service** (the review brain): needs a **valid `ANTHROPIC_API_KEY`** — the review pipeline calls it; without it, jobs enqueue but never produce findings.
> 4. **A tunnel** so GitHub can reach your local webhook server — see step 5 (ngrok or smee: `npx smee-client --url https://smee.io/<channel> --target http://localhost:3000/webhook`), and set the tunnel URL as the App's Webhook URL.
>
> **On-connect backfill:** once the webhook reaches the server, installing the app now enqueues a review for every **existing open PR** on the repo (not just future PRs) — so the dashboard backfills from real history. See `packages/webhook/src/backfill.ts`.

## 1. Register the App

1. Go to **github.com/settings/apps/new**
2. Fill in:
   - **App name:** `Areté Code Review` (or `Areté Code Review (dev)` for dev)
   - **Homepage URL:** your repo URL
   - **Webhook URL:** `https://YOUR_PUBLIC_HOST/webhook`
   - **Webhook secret:** generate with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
3. **Permissions:**
   - Pull requests: Read & write
   - Contents: Read
4. **Subscribe to events:** Pull request
5. Click **Create GitHub App** → note the **App ID**

## 2. Generate Private Key

App settings page → **Private keys** → **Generate a private key**. A `.pem` downloads.

Convert for `.env` (newlines become `\n` literals):

```bash
node -e "const k=require('fs').readFileSync('key.pem','utf8'); console.log(k.replace(/\n/g,'\\n'))"
```

## 3. Configure `.env`

```
GITHUB_APP_ID=<number from app settings>
GITHUB_PRIVATE_KEY=<output from step above, including BEGIN/END lines>
GITHUB_WEBHOOK_SECRET=<secret you generated>
PORT=3000
LLM_PROVIDER=gemini
GEMINI_API_KEY=<your Google AI Studio key>
```

## 4. Install the App

App settings page → **Install App** → select the repository.

## 5. Expose Your Local Port

**GitHub Codespaces:** Forward port 3000 in the Ports tab. Copy the public URL and set `<url>/webhook` as the Webhook URL in app settings.

**Local machine:**

```bash
npx ngrok http 3000
```

Copy the `https://….ngrok.io` URL and set `https://….ngrok.io/webhook` as the Webhook URL.

## 6. Test End to End

1. Start the server: `cd packages/webhook && pnpm dev`
2. Open a PR on the installed repository
3. Watch for `[handler] Reviewing …` and `[handler] Posted review` in the terminal
4. Check the PR on GitHub — Areté should have posted a review comment
