// Persistence for the /api/agents/[id]/chat composer (Wave-3 Agents).
//
// A thread is scoped to (installation, agentId, containerId): containerId ties
// a thread to the specific IssueContainer/problem it was opened for — opening a
// different work item starts a fresh thread for the same agent — and null is
// the "general" thread for an agent when no specific work item is in focus.
// Tenant scope is derived entirely from the session (requireScope), never a
// client-supplied id. Both operations are best-effort: history-load and
// turn-save failures are swallowed (logged, not thrown) so persistence never
// blocks or breaks the live chat itself.

import { db } from '@/lib/db';
import { requireScope } from '@/lib/model-connections-api';

export interface StoredChatTurn {
  role: 'user' | 'agent';
  text: string;
}

/** List a thread's turns, oldest first. Never throws — an unreadable history
 *  renders as an empty thread rather than blocking the chat UI. */
export async function listChatTurns(agentId: string, containerId: string | null): Promise<StoredChatTurn[]> {
  try {
    const scope = await requireScope();
    if (!scope || scope.installationIds.length === 0) return [];
    const rows = await db.agentChatTurn.findMany({
      where: { installationId: { in: scope.installationIds }, agentId, containerId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, text: true },
    });
    return rows.map((r) => ({ role: r.role === 'user' ? ('user' as const) : ('agent' as const), text: r.text }));
  } catch (err) {
    console.error('[agent-chat-history] failed to load thread:', err);
    return [];
  }
}

/** Append one turn to a thread. Best-effort: a save failure is logged and
 *  swallowed, never surfaced to the chat request — the reply the user sees is
 *  never blocked on persistence succeeding. No-ops when there's no installation
 *  to scope the turn to (e.g. no repository connected yet). */
export async function appendChatTurn(agentId: string, containerId: string | null, turn: StoredChatTurn): Promise<void> {
  try {
    const scope = await requireScope();
    const target = scope?.installationIds[0];
    if (!target) return;
    await db.agentChatTurn.create({
      data: { installationId: target, agentId, containerId, role: turn.role, text: turn.text },
    });
  } catch (err) {
    console.error('[agent-chat-history] failed to save turn:', err);
  }
}
