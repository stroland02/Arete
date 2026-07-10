import { Request, Response } from 'express';
import { PRContext } from './types.js';
import { runReviewPipeline } from './review-bridge.js';

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
      const prContext: PRContext = {
        repo: body.project?.path_with_namespace || 'unknown/repo',
        pr_number: body.object_attributes?.iid || 0,
        title: body.object_attributes?.title || '',
        description: body.object_attributes?.description || '',
        files: [] // Mock files array, full GitLab diff fetch not implemented yet
      };

      console.log(`[gitlab-handler] Handling merge request event for ${prContext.repo}#${prContext.pr_number}`);
      
      // Call pipeline but don't await so we can return 200 immediately
      runReviewPipeline(prContext)
        .then(result => {
          console.log(`[gitlab-handler] Pipeline completed for PR #${prContext.pr_number}`);
        })
        .catch(err => {
          console.error(`[gitlab-handler] Pipeline error for PR #${prContext.pr_number}`, err);
        });
    }
  }

  res.status(200).send('OK');
}
