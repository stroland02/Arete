// Persistence for the agent config drawer's controls (PM-2, agent-config-persistence).
//
// The three controls — enabled, severity threshold, custom guidance — were
// local React state marked "deliberately NOT persisted", so each one reset when
// the panel closed. A parameter control that cannot outlive its panel is
// decoration; the drawer was honest about that and kept Save disabled.
//
// Tenant scope comes entirely from the session via requireScope(), never from a
// client-supplied id — same rule as agent-chat-history.ts. Tenancy is a security
// boundary, so a config read that could not be scoped returns defaults rather
// than another installation's settings.
//
// Reads and writes fail DIFFERENTLY, on purpose:
//   - a read failure falls back to defaults, which is exactly how every agent
//     behaved before this table existed, so the page still renders;
//   - a write failure THROWS. A save that reports success without saving is the
//     fake save this drawer refused to ship in the first place, and swallowing
//     it here would reintroduce it one layer down.

import { db } from '@/lib/db';
import { requireScope } from '@/lib/model-connections-api';

export const SEVERITY_THRESHOLDS = ['info', 'warning', 'error'] as const;
export type SeverityThreshold = (typeof SEVERITY_THRESHOLDS)[number];

export interface AgentConfig {
  enabled: boolean;
  severityThreshold: SeverityThreshold;
  guidance: string;
}

/**
 * What an agent runs on when nothing has been saved for it.
 *
 * These match the drawer's previous local initial state exactly, so an
 * installation that never opens the drawer behaves identically to before the
 * table existed. Absence of a row is a real state, not a missing one.
 */
export const DEFAULT_AGENT_CONFIG: AgentConfig = {
  enabled: true,
  severityThreshold: 'warning',
  guidance: '',
};

export class AgentConfigSaveError extends Error {}

function isSeverity(value: unknown): value is SeverityThreshold {
  return typeof value === 'string' && (SEVERITY_THRESHOLDS as readonly string[]).includes(value);
}

/**
 * Coerce an untrusted payload into a config, or explain why it cannot be.
 *
 * Returns an error rather than silently repairing: a save that quietly stored
 * something other than what was sent would leave the UI showing one value and
 * the database holding another, which is the drift this whole record exists to
 * prevent.
 */
export function parseAgentConfig(input: unknown): { config: AgentConfig } | { error: string } {
  if (typeof input !== 'object' || input === null) {
    return { error: 'Body must be a JSON object.' };
  }
  const body = input as Record<string, unknown>;

  if (typeof body.enabled !== 'boolean') {
    return { error: 'enabled must be true or false.' };
  }
  if (!isSeverity(body.severityThreshold)) {
    return { error: `severityThreshold must be one of: ${SEVERITY_THRESHOLDS.join(', ')}.` };
  }
  if (typeof body.guidance !== 'string') {
    return { error: 'guidance must be a string.' };
  }
  // Bounded so one installation cannot store an unbounded blob that later gets
  // pasted into every prompt for that agent.
  if (body.guidance.length > 2000) {
    return { error: 'guidance must be 2000 characters or fewer.' };
  }

  return {
    config: {
      enabled: body.enabled,
      severityThreshold: body.severityThreshold,
      guidance: body.guidance.trim(),
    },
  };
}

/**
 * The saved config for one agent, or the defaults when nothing is saved.
 *
 * Never throws: an unreadable config renders the drawer on defaults rather than
 * failing the page. That is the same behaviour as before this table existed, so
 * a database problem degrades to the old experience instead of a blank panel.
 */
export async function getAgentConfig(agentId: string): Promise<AgentConfig> {
  try {
    const scope = await requireScope();
    if (!scope || scope.installationIds.length === 0) return DEFAULT_AGENT_CONFIG;

    const row = await db.agentConfig.findFirst({
      where: { installationId: { in: scope.installationIds }, agentId },
      select: { enabled: true, severityThreshold: true, guidance: true },
    });
    if (!row) return DEFAULT_AGENT_CONFIG;

    return {
      enabled: row.enabled,
      // A value written before a future threshold was renamed must not crash
      // the panel; fall back rather than trust the column blindly.
      severityThreshold: isSeverity(row.severityThreshold)
        ? row.severityThreshold
        : DEFAULT_AGENT_CONFIG.severityThreshold,
      guidance: row.guidance,
    };
  } catch (err) {
    console.error('[agent-config] failed to load config, using defaults:', err);
    return DEFAULT_AGENT_CONFIG;
  }
}

/**
 * Save one agent's config for the session's installation.
 *
 * Throws `AgentConfigSaveError` when there is no installation to scope to, and
 * lets a database error propagate. Both are cases where the caller must tell
 * the user it did not save — reporting success here is the exact dishonesty the
 * disabled Save button was avoiding.
 */
export async function saveAgentConfig(agentId: string, config: AgentConfig): Promise<AgentConfig> {
  const scope = await requireScope();
  const installationId = scope?.installationIds[0];
  if (!installationId) {
    throw new AgentConfigSaveError(
      'No connected installation to save this against. Connect a repository first.',
    );
  }

  // Upsert on the unique (installationId, agentId): a save is an edit of the
  // one row for that agent, so repeated saves can never leave two rows
  // disagreeing about the same agent.
  await db.agentConfig.upsert({
    where: { installationId_agentId: { installationId, agentId } },
    create: { installationId, agentId, ...config },
    update: { ...config },
  });

  return config;
}
