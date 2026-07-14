import type { Agent } from "@/components/dashboard/agents/agent-catalog";

// Mirrors packages/webhook/src/config.ts's PYTHON_SERVICE_URL default. The
// dashboard reaches the same FastAPI agents service the webhook does. Server
// -only — this module is imported only by the route handler, never a client.
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "http://127.0.0.1:8000";
const CHAT_TIMEOUT_MS = 120_000;

/**
 * Proxies one message to the Python `/chat` endpoint (the same ChatAgent the
 * webhook uses for PR-comment replies) and returns its reply text. The agent's
 * persona lives in Python — we only map our dashboard-conversation fields onto
 * ChatAgent's existing context shape, so there is a single source of truth for
 * agent behavior. Throws on any non-OK response, network error, or timeout;
 * the caller maps that to an honest 503 (never a fabricated reply).
 */
export async function sendAgentChat({ agent, message }: { agent: Agent; message: string }): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
  try {
    const context = {
      pr_title: `Conversation with the ${agent.label} agent`,
      pr_description: agent.longDescription,
      file_path: "",
      diff_hunk: "",
      bot_comment: agent.description,
      user_reply: message,
    };
    const res = await fetch(`${PYTHON_SERVICE_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(context),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`agent chat upstream failed (status ${res.status})`);
    }
    const data = await res.json();
    if (typeof data === "string") return data;
    if (data && typeof data.reply === "string") return data.reply;
    return "";
  } finally {
    clearTimeout(timer);
  }
}
