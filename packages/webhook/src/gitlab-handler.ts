import { Request, Response } from 'express';
import { fetchGitLabMRContext } from './gitlab-fetcher.js';
import { postGitLabReview, DiffRefs } from './gitlab-comment-poster.js';
import { runReviewPipeline } from './review-bridge.js';
import { persistReview } from './persistence.js';

async function processMergeRequest(body: any): Promise<void> {
  const projectId: number = body.project?.id
  const mrIid: number = body.object_attributes?.iid

  if (!projectId || !mrIid) {
    console.warn('[gitlab-handler] Missing project id or MR iid in payload — skipping')
    return
  }

  const diffRefs: DiffRefs = {
    baseSha: body.object_attributes?.diff_refs?.base_sha ?? '',
    startSha: body.object_attributes?.diff_refs?.start_sha ?? '',
    headSha: body.object_attributes?.last_commit?.id
      ?? body.object_attributes?.diff_refs?.head_sha
      ?? '',
  }

  const prContext = await fetchGitLabMRContext(projectId, mrIid, body)
  const result = await runReviewPipeline(prContext)
  await postGitLabReview(projectId, mrIid, result, diffRefs)

  // Persist to Prisma. Rows are scoped by provider="gitlab" + externalId, so
  // a GitLab project id can never collide with a GitHub installation id.
  // The review has already been posted above — persistence failures must
  // never fail the review itself.
  const fullName: string = body.project?.path_with_namespace || `project-${projectId}`
  const owner = fullName.split('/')[0]
  const name = fullName.split('/').pop() ?? fullName

  try {
    await persistReview({
      provider: 'gitlab',
      installationExternalId: projectId,
      repositoryExternalId: projectId,
      owner,
      name,
      fullName,
      prNumber: mrIid,
      headSha: diffRefs.headSha,
      result,
    })
  } catch (err) {
    console.error('[gitlab-handler] Failed to persist review (review was still posted):', err)
  }

  console.log(
    `[gitlab-handler] Posted review for ${fullName}!${mrIid} — risk: ${result.risk_level}, comments: ${result.total_comments}`
  )
}

export async function handleGitLabWebhook(req: Request, res: Response): Promise<void> {
  const token = req.headers['x-gitlab-token'];
  const secret = process.env.GITLAB_WEBHOOK_SECRET;

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

      // Fire-and-forget so the webhook returns 200 immediately
      processMergeRequest(body).catch((err) => {
        console.error(`[gitlab-handler] Pipeline error for MR !${mrIid}`, err);
      });
    }
  }

  res.status(200).send('OK');
}
