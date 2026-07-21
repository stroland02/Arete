import { Request, Response } from 'express';
import { reviewExists } from './persistence.js';
import { enqueueReviewJob } from './queue.js';
import { getGitLabConfig } from './config.js';
import { gitlabBaseUrl } from './gitlab-fetcher.js';
import { prisma } from './db.js';
import { evaluateBillingGate } from './billing.js';
import { logger } from './logger.js';

const log = logger.child({ component: 'gitlab-handler' });

/** Posts a plain top-level note on the MR (used for billing-gate messages). */
async function postMergeRequestNote(projectId: number, mrIid: number, body: string): Promise<void> {
  const url = `${gitlabBaseUrl()}/api/v4/projects/${projectId}/merge_requests/${mrIid}/notes`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Private-Token': getGitLabConfig().accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  })
  if (!res.ok) {
    log.error({ mrIid, status: res.status }, 'Failed to post note on MR')
  }
}

/**
 * Validates and enqueues a `review-pr` job for a GitLab merge request event.
 *
 * Mirrors handlePullRequestEvent()'s GitHub path: the actual pipeline
 * (fetch diff -> LLM review -> post discussions -> persist) never runs here —
 * it's handed off to the shared `review-pr` queue and picked up by worker.ts,
 * so both providers get the same concurrency control and backpressure.
 */
async function enqueueMergeRequestJob(body: any): Promise<void> {
  const projectId: number = body.project?.id
  const mrIid: number = body.object_attributes?.iid

  if (!projectId || !mrIid) {
    log.warn('Missing project id or MR iid in payload — skipping')
    return
  }

  // Billing gate — same rationale and rules as the GitHub handler's gate:
  // evaluated BEFORE enqueueing so a lapsed subscription or an exhausted
  // free tier (50 free reviews) never spends an LLM pipeline run. GitLab
  // installations are keyed by project id (see persistence.ts).
  const installation = await prisma.installation.findUnique({
    where: { provider_externalId: { provider: 'gitlab', externalId: projectId } },
  })
  const gate = evaluateBillingGate(installation)
  if (!gate.allowed) {
    log.info(
      {
        projectId,
        reason: gate.reason,
        subscriptionStatus: installation?.subscriptionStatus,
        usage: installation?.usageCount,
      },
      'Review blocked'
    )
    await postMergeRequestNote(projectId, mrIid, gate.message)
    return
  }

  const headSha: string = body.object_attributes?.last_commit?.id
    ?? body.object_attributes?.diff_refs?.head_sha
    ?? ''

  // Early idempotency: same rationale as the GitHub handler — a re-delivered
  // webhook for a head SHA that already has a completed review shouldn't pay
  // for a full LLM pipeline run before persistReview()'s DB-level check.
  const alreadyReviewed = await reviewExists({
    provider: 'gitlab',
    repositoryExternalId: projectId,
    prNumber: mrIid,
    headSha,
  })
  if (alreadyReviewed) {
    log.info(
      { projectId, mrIid, headSha },
      'Review already exists — skipping duplicate delivery'
    )
    return
  }

  await enqueueReviewJob({
    provider: 'gitlab',
    kind: 'merge_request',
    projectId,
    mrIid,
    payload: body,
  })

  log.info({ projectId, mrIid }, 'Enqueued review-pr job')
}

export async function handleGitLabWebhook(req: Request, res: Response): Promise<void> {
  const token = req.headers['x-gitlab-token'];
  const secret = getGitLabConfig().webhookSecret;

  // Fail closed: without a configured secret we cannot verify the request
  // actually came from GitLab, so refuse to process it rather than trusting
  // an unauthenticated caller to trigger the (costly) review pipeline.
  if (!secret) {
    log.error('GITLAB_WEBHOOK_SECRET is not configured — rejecting request')
    res.status(401).send('Unauthorized');
    return;
  }

  if (token !== secret) {
    res.status(401).send('Unauthorized');
    return;
  }

  const body = req.body;
  if (body?.object_kind === 'merge_request') {
    const state = body.object_attributes?.state;
    const action = body.object_attributes?.action;

    if (state === 'opened' || action === 'update') {
      const repo = body.project?.path_with_namespace || 'unknown/repo'
      const mrIid = body.object_attributes?.iid || 0
      log.info({ repo, mrIid }, 'Handling merge request event');

      try {
        await enqueueMergeRequestJob(body)
      } catch (err) {
        log.error({ err, mrIid }, 'Failed to enqueue review job');
      }
    }
  }

  res.status(200).send('OK');
}
