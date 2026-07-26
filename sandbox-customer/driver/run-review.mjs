// Sandbox Customer E2E driver (TEST DATA tooling).
//
// Feeds sandbox-customer/driver/pr-context.json through the REAL Areté agents
// review pipeline (POST /review) and prints the verified findings. It degrades
// honestly: if the agents server is unreachable or ANTHROPIC_API_KEY is unset,
// it prints the payload and the exact command to run, then exits non-zero — it
// never fabricates a review result.
//
// Usage:  node sandbox-customer/driver/run-review.mjs
// Env:    AGENTS_URL (default http://localhost:8000), ANTHROPIC_API_KEY (server-side)

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENTS_URL = process.env.AGENTS_URL ?? "http://localhost:8000";
const REVIEW_ENDPOINT = `${AGENTS_URL}/review`;

async function main() {
  const payload = JSON.parse(await readFile(join(HERE, "pr-context.json"), "utf8"));
  delete payload._comment;

  console.log(`[driver] Sandbox review: ${payload.repo} PR #${payload.pr_number}`);
  console.log(`[driver] Target: POST ${REVIEW_ENDPOINT}`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn(
      "[driver] WARNING: ANTHROPIC_API_KEY is not set in this shell. The agents " +
        "server needs it to run a real LLM review; if the server was started " +
        "without it, the review will fail server-side.",
    );
  }

  let res;
  try {
    res = await fetch(REVIEW_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    fail(
      `Could not reach the agents server at ${AGENTS_URL}.`,
      `Start it first, e.g.:  cd packages/agents && ANTHROPIC_API_KEY=... uv run uvicorn arete_agents.server:app --port 8000`,
      payload,
      err,
    );
    return;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    fail(`Agents server returned ${res.status}.`, text, payload);
    return;
  }

  const result = await res.json();
  console.log("[driver] Review complete. Verified result:");
  console.log(JSON.stringify(result, null, 2));
}

function fail(reason, hint, payload, err) {
  console.error(`\n[driver] NOT RUN — ${reason}`);
  if (err) console.error(`[driver] ${err.message ?? err}`);
  if (hint) console.error(`[driver] ${hint}`);
  console.error("[driver] Payload that would have been sent:\n");
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
}

main();
