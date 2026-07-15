import { prisma } from './db.js'
import { enqueueApprovalExecution } from './queue.js'

// Executes a human-approved infrastructure command request.
//
// An ApprovalPrompt is created when a review agent calls the
// `request_infrastructure_approval` tool (packages/agents/.../tools/actions.py):
// the agent pauses and a PENDING row is written with the exact command + reason.
// The dashboard shows it to a human, who clicks "Approve"; that click hits
// POST /api/approvals/:id/execute, which is what this module backs.
//
// Applying the command / resuming the paused agent run is real follow-on work
// (potentially slow, must survive a crash), so — exactly like a PR review — it
// is NOT run inline in the request handler. This function durably transitions
// the approval to EXECUTED and hands the actual command off to the
// `approval-exec` BullMQ queue. The transition + enqueue are the real effect;
// there is deliberately no fake "ran the command, here's stdout" response.

export type ExecuteApprovalResult =
  | { outcome: 'not_found' }
  | { outcome: 'rejected'; status: string }
  | { outcome: 'already_executed'; approvalId: string; executedAt: Date }
  | { outcome: 'executed'; approvalId: string; executedAt: Date }

/**
 * Look up the approval by id, durably mark it executed, and enqueue the
 * follow-on execution job.
 *
 * - `not_found`: no ApprovalPrompt with this id.
 * - `rejected`: the approval was REJECTED — a rejected command must never run.
 * - `already_executed`: idempotent replay (double-click / webhook retry). The
 *   command is NOT enqueued a second time; the original executedAt is returned.
 * - `executed`: first successful execution — row transitioned to EXECUTED with
 *   an executedAt timestamp AND the command enqueued onto `approval-exec`.
 *
 * Idempotency is enforced with a conditional update (executedAt still null) so
 * two concurrent clicks can never both enqueue the same command.
 */
export async function executeApproval(id: string): Promise<ExecuteApprovalResult> {
  const approval = await prisma.approvalPrompt.findUnique({ where: { id } })
  if (!approval) return { outcome: 'not_found' }

  if (approval.status === 'REJECTED') {
    return { outcome: 'rejected', status: approval.status }
  }

  // Already actioned: return the recorded timestamp without re-enqueuing.
  if (approval.executedAt) {
    return { outcome: 'already_executed', approvalId: approval.id, executedAt: approval.executedAt }
  }

  // Conditional transition: only flips the row if it is still un-executed.
  // updateMany (not update) so a lost race returns count 0 instead of throwing,
  // letting the loser fall through to the idempotent path.
  const executedAt = new Date()
  const claim = await prisma.approvalPrompt.updateMany({
    where: { id, executedAt: null },
    data: { status: 'EXECUTED', executedAt },
  })

  if (claim.count === 0) {
    // A concurrent request won the race and already executed it. Re-read the
    // authoritative timestamp so the response is honest.
    const current = await prisma.approvalPrompt.findUnique({ where: { id } })
    return {
      outcome: 'already_executed',
      approvalId: id,
      executedAt: current?.executedAt ?? executedAt,
    }
  }

  await enqueueApprovalExecution({
    approvalId: approval.id,
    reviewId: approval.reviewId,
    command: approval.command,
  })

  return { outcome: 'executed', approvalId: approval.id, executedAt }
}
