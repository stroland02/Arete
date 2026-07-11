import { Request, Response } from 'express';
import { reviewExists } from './persistence.js';
import { enqueueReviewJob } from './queue.js';
import { getGitLabConfig } from './config.js';

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
    console.warn('[gitlab-handler] Missing project id or MR iid in payload — skipping')
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
    console.log(
      `[gitlab-handler] Review already exists for project ${projectId} MR !${mrIid} @ ${headSha} — skipping duplicate delivery`
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

  console.log(`[gitlab-handler] Enqueued review-pr job for project ${projectId} MR !${mrIid}`)
}

export async function handleGitLabWebhook(req: Request, res: Response): Promise<void> {
  const token = req.headers['x-gitlab-token'];
  const secret = getGitLabConfig().webhookSecret;

  // Fail closed: without a configured secret we cannot verify the request
  // actually came from GitLab, so refuse to process it rather than trusting
  // an unauthenticated caller to trigger the (costly) review pipeline.
  if (!secret) {
    console.error('[gitlab-handler] GITLAB_WEBHOOK_SECRET is not configured — rejecting request')
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
      console.log(`[gitlab-handler] Handling merge request event for ${repo}!${mrIid}`);

      try {
        await enqueueMergeRequestJob(body)
      } catch (err) {
        console.error(`[gitlab-handler] Failed to enqueue review job for MR !${mrIid}`, err);
      }
    }
  }

  res.status(200).send('OK');
}
