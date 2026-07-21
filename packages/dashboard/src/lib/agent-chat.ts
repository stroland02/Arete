import type { Agent } from "@/components/dashboard/agents/agent-catalog";
import type { LlmBlock } from "@/lib/model-connections-api";
import { internalAuthHeaders } from "@/lib/internal-auth";

// Mirrors packages/webhook/src/config.ts's PYTHON_SERVICE_URL default. The
// dashboard reaches the same FastAPI agents service the webhook does. Server
// -only — this module is imported only by the route handler, never a client.
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? "http://127.0.0.1:8000";
const CHAT_TIMEOUT_MS = 120_000;

/**
 * Proxies one message to the Python `/chat` endpoint (the same ChatAgent the
 * webhook uses for PR-comment replies). The agent's persona lives in Python — we
 * only map our dashboard-conversation fields onto ChatAgent's existing context
 * shape. Returns a discriminated result: `{ reply }` on success, or
 * `{ error }` when the provider failed with a classified, user-actionable reason
 * (out of credits, bad key, …) — that message is surfaced, never swallowed.
 * Throws only on a genuine transport failure (network/timeout/non-OK), which the
 * caller maps to an honest 503.
 */
export type AgentChatResult =
  | { reply: string }
  | { error: { kind: string; message: string } };

export async function sendAgentChat({
  agent,
  message,
  llm,
}: {
  agent: Agent;
  message: string;
  /** The tenant's connected model. When present, /chat replies on THIS model
   *  (mirrors /review's BYO block); omitted → the service default. */
  llm?: LlmBlock | null;
}): Promise<AgentChatResult> {
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
      ...(llm ? { llm } : {}),
    };
    const res = await fetch(`${PYTHON_SERVICE_URL}/chat`, {
      method: "POST",
      // The agents service's POST surface is behind the shared internal bearer
      // with a fail-closed 503 (arete_agents/internal_auth.py, review finding
      // B4) — the same posture the webhook's own /internal/* already has, and
      // the same token this module's sibling already sends the other way.
      headers: { "Content-Type": "application/json", ...internalAuthHeaders() },
      body: JSON.stringify(context),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`agent chat upstream failed (status ${res.status})`);
    }
    const data = await res.json();
    // A classified provider error (ChatAgent returns { reply: null, error }).
    if (data && data.error && typeof data.error.message === "string") {
      return { error: { kind: String(data.error.kind ?? "unknown"), message: data.error.message } };
    }
    if (data && typeof data.reply === "string") return { reply: data.reply };
    return { reply: "" };
  } finally {
    clearTimeout(timer);
  }
}
