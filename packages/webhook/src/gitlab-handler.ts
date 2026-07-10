import { Request, Response } from 'express';
import { fetchGitLabMRContext } from './gitlab-fetcher.js';
import { postGitLabReview, DiffRefs } from './gitlab-comment-poster.js';
import { runReviewPipeline } from './review-bridge.js';
import { PrismaClient } from './generated/prisma/client.js';

const prisma = new PrismaClient()

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

  // Persist to Prisma. GitLab entities are namespaced with a "gitlab-" id
  // prefix so they never collide with GitHub installation/repository ids.
  const fullName: string = body.project?.path_with_namespace || `project-${projectId}`
  const owner = fullName.split('/')[0]
  const name = fullName.split('/').pop() ?? fullName
  const installationId = `gitlab-inst-${projectId}`
  const repositoryId = `gitlab-repo-${projectId}`

  await prisma.$transaction([
    prisma.installation.upsert({
      where: { id: installationId },
      create: {
        id: installationId,
        githubInstallationId: projectId,
        owner,
      },
      update: { owner },
    }),
    prisma.repository.upsert({
      where: { id: repositoryId },
      create: {
        id: repositoryId,
        githubRepoId: projectId,
        name,
        fullName,
        installationId,
      },
      update: { name, fullName },
    }),
    prisma.review.create({
      data: {
        prNumber: mrIid,
        repositoryId,
        riskLevel: result.risk_level,
        overallSummary: result.overall_summary,
        comments: {
          createMany: {
            data: result.file_reviews.flatMap((fr) =>
              fr.comments.map((c) => ({
                path: fr.path,
                line: c.line,
                body: c.body,
                severity: c.severity,
                category: c.category,
              }))
            ),
          },
        },
      },
    }),
  ])

  console.log(
    `[gitlab-handler] Posted review for ${fullName}!${mrIid} — risk: ${result.risk_level}, comments: ${result.total_comments}`
  )
}

export async function handleGitLabWebhook(req: Request, res: Response): Promise<void> {
  const token = req.headers['x-gitlab-token'];

  if (process.env.GITLAB_WEBHOOK_SECRET && token !== process.env.GITLAB_WEBHOOK_SECRET) {
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
