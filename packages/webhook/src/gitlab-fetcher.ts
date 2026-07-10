import type { FileChange, PRContext } from './types.js'

const EXTENSION_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.go': 'go',
}

interface GitLabChange {
  new_path: string
  old_path: string
  diff: string
  new_file: boolean
  deleted_file: boolean
  renamed_file: boolean
}

export function gitlabBaseUrl(): string {
  return process.env.GITLAB_URL || 'https://gitlab.com'
}

function detectLanguage(filename: string): string {
  const ext = filename.includes('.') ? '.' + filename.split('.').pop()! : ''
  return EXTENSION_MAP[ext] ?? 'other'
}

function changeStatus(change: GitLabChange): NonNullable<FileChange['status']> {
  if (change.new_file) return 'added'
  if (change.deleted_file) return 'removed'
  if (change.renamed_file) return 'renamed'
  return 'modified'
}

function countDiffLines(diff: string): { additions: number; deletions: number } {
  let additions = 0
  let deletions = 0
  for (const line of diff.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++
  }
  return { additions, deletions }
}

export async function fetchGitLabMRContext(
  projectId: number,
  mrIid: number,
  payload: any
): Promise<PRContext> {
  const url = `${gitlabBaseUrl()}/api/v4/projects/${projectId}/merge_requests/${mrIid}/changes`
  const res = await fetch(url, {
    headers: { 'Private-Token': process.env.GITLAB_ACCESS_TOKEN ?? '' },
  })

  if (!res.ok) {
    throw new Error(`[gitlab-fetcher] GitLab changes fetch failed with status ${res.status}`)
  }

  const data: any = await res.json()
  const changes: GitLabChange[] = data?.changes ?? []

  const files: FileChange[] = changes
    // Binary files come back with an empty diff — nothing reviewable
    .filter((c) => typeof c.diff === 'string' && c.diff.length > 0)
    .map((c): FileChange => {
      const path = c.new_path || c.old_path
      const { additions, deletions } = countDiffLines(c.diff)
      return {
        path,
        patch: c.diff,
        additions,
        deletions,
        language: detectLanguage(path),
        status: changeStatus(c),
      }
    })

  return {
    repo: payload?.project?.path_with_namespace || `project-${projectId}`,
    pr_number: mrIid,
    title: payload?.object_attributes?.title ?? data?.title ?? '',
    description: payload?.object_attributes?.description ?? data?.description ?? '',
    files,
  }
}
