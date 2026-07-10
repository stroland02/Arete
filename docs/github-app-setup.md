# GitHub App Setup Guide

This guide walks through registering the Areté GitHub App for a new environment.

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
