// Fix-drive cooldown (Phase 2 Task 6).
//
// The hole this closes: the only re-entry guard before this was
// `WorkItem.state !== 'open'` -> 409 (work-items/[id]/fix/route.ts), which
// holds only while a run is active. The moment driveFix's fail() path
// (fix/trigger.ts) returns a WorkItem to `open`, an immediate re-trigger was
// allowed — a failing fix could retry in a tight loop, each attempt costing a
// full repo checkout + LLM call.
//
// Derive-vs-column (task brief: "derive the failure count from existing state
// if possible; add a column only if you can show it cannot be derived"):
// consecutive failure count CANNOT be derived from what already exists. Each
// "Fix it" click (dashboard work-items/[id]/fix route) creates a BRAND NEW
// IssueContainer; IssueContainer carries no back-reference to the WorkItem
// that spawned it (no workItemId column — contrast with Incident.workItemId,
// which IS a deliberate denormalized field for exactly this "no Prisma
// relation" reason, per Task 2/4's own schema comments). Once a retry
// overwrites WorkItem.containerId, the PRIOR (possibly fix_failed) container
// becomes unreachable from the WorkItem side — there is no query against the
// current schema that reconstructs "how many times in a row has this item
// failed." So WorkItem.fixFailureCount was added (packages/db/prisma/schema.prisma,
// migration 20260721183213_add_work_item_fix_cooldown).
//
// WorkItem.fixFailureAt was ALSO added rather than reusing WorkItem.updatedAt
// for "when did this last fail": updatedAt is bumped by unrelated writes while
// the item is still `open` — scan/trigger.ts and review-sync.ts both refresh
// an open WorkItem's title/detail/confidence/scanRunId on every re-scan pass
// that still matches its fingerprint. Reading the cooldown clock off
// updatedAt would let a routine re-scan silently reset it.
import { logger } from '../logger.js'

const log = logger.child({ component: 'fix-cooldown' })

export const FIX_COOLDOWN_BASE_SECONDS = 5 * 60 // 5 minutes
export const FIX_COOLDOWN_MAX_SECONDS = 60 * 60 // 1 hour

export interface FixCooldownResult {
  allowed: boolean
  retryAfterSeconds?: number
}

/**
 * Pure: exponential backoff from FIX_COOLDOWN_BASE_SECONDS, doubling per
 * consecutive failure, capped at FIX_COOLDOWN_MAX_SECONDS. No I/O.
 *
 * `failureCount` <= 0 or a missing `lastFailureAt` is treated as "allowed" —
 * a stale/missing timestamp alongside a nonzero count is a data
 * inconsistency we fail OPEN on (never lock a work item out forever because
 * of a read that didn't carry the expected shape).
 */
export function computeFixCooldown(
  failureCount: number,
  lastFailureAt: Date | null,
  now: Date = new Date(),
): FixCooldownResult {
  if (failureCount <= 0 || !lastFailureAt) return { allowed: true }

  const windowSeconds = Math.min(
    FIX_COOLDOWN_BASE_SECONDS * 2 ** (failureCount - 1),
    FIX_COOLDOWN_MAX_SECONDS,
  )
  const elapsedSeconds = (now.getTime() - lastFailureAt.getTime()) / 1000
  if (elapsedSeconds >= windowSeconds) return { allowed: true }

  return { allowed: false, retryAfterSeconds: Math.ceil(windowSeconds - elapsedSeconds) }
}

export interface CooldownDeps {
  prisma: {
    workItem: {
      findUnique(args: unknown): Promise<{ fixFailureCount: number; fixFailureAt: Date | null } | null>
    }
  }
}

/**
 * Reads the WorkItem's own failure bookkeeping and applies computeFixCooldown.
 * A work item that no longer exists is "allowed" — there is nothing to guard,
 * and the caller's own not-found handling takes over from here.
 */
export async function checkFixCooldown(workItemId: string, deps: CooldownDeps): Promise<FixCooldownResult> {
  const item = await deps.prisma.workItem.findUnique({
    where: { id: workItemId },
    select: { fixFailureCount: true, fixFailureAt: true },
  })
  if (!item) return { allowed: true }

  const result = computeFixCooldown(item.fixFailureCount, item.fixFailureAt)
  if (!result.allowed) {
    log.info({ workItemId, retryAfterSeconds: result.retryAfterSeconds }, 'fix cooldown active — retrigger refused')
  }
  return result
}

/** Real deps: lazy @arete/db import, matching trigger.ts's defaultFixTriggerDeps
 *  pattern (route/consumer registration stays DB-import-free until called). */
export function defaultCooldownDeps(): CooldownDeps {
  return {
    prisma: {
      workItem: {
        findUnique: async (args: unknown) => {
          const { prisma } = await import('../db.js')
          return prisma.workItem.findUnique(args as any) as any
        },
      },
    },
  }
}
