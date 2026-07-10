import type { Octokit } from '@octokit/core'
import type { FileChange, PRContext } from './types.js'

const EXTENSION_MAP: Record<string, string> = {
  '.py': 'python', '.ts': 'typescript', '.tsx': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.go': 'go',
  '.rs': 'rust', '.java': 'java', '.rb': 'ruby', '.php': 'php',
  '.cs': 'csharp', '.cpp': 'cpp', '.c': 'c', '.sql': 'sql', '.sh': 'shell',
}

function detectLanguage(filename: string): string {
  const ext = filename.includes('.') ? '.' + filename.split('.').pop()! : ''
  return EXTENSION_MAP[ext] ?? 'other'
}

export async function fetchPRContext(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<PRContext> {
  const [{ data: pr }, { data: files }] = await Promise.all([
    (octokit as any).rest.pulls.get({ owner, repo, pull_number: prNumber }),
    (octokit as any).rest.pulls.listFiles({ owner, repo, pull_number: prNumber, per_page: 100 }),
  ])

  const fileChanges: FileChange[] = files
    .filter((f: any) => typeof f.patch === 'string')
    .map((f: any): FileChange => ({
      path: f.filename,
      patch: f.patch as string,
      additions: f.additions,
      deletions: f.deletions,
      language: detectLanguage(f.filename),
    }))

  return {
    repo: `${owner}/${repo}`,
    pr_number: pr.number,
    title: pr.title,
    description: pr.body ?? '',
    files: fileChanges,
  }
}
