import type { Octokit } from '@octokit/core'
import type { FileChange, PRContext } from './types.js'
import yaml from 'yaml'

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

export async function fetchAreteYaml(octokit: Octokit, owner: string, repo: string, ref: string): Promise<string[]> {
  const tryFetch = async (path: string) => {
    try {
      const res = await (octokit as any).rest.repos.getContent({
        owner,
        repo,
        path,
        ref
      });
      if (res.data.type === 'file' && res.data.content) {
        const content = Buffer.from(res.data.content, res.data.encoding || 'base64').toString('utf8');
        const parsed = yaml.parse(content);
        return parsed?.custom_rules || [];
      }
    } catch (err: any) {
      if (err.status !== 404) {
        console.error(`Error fetching ${path}:`, err);
      }
    }
    return null;
  };

  const yamlResult = await tryFetch('.arete.yml');
  if (yamlResult !== null) return yamlResult;
  
  const yamlResult2 = await tryFetch('.arete.yaml');
  if (yamlResult2 !== null) return yamlResult2;

  return [];
}

// GitHub returns changed files in pages of up to 100. PRs touching more than
// 100 files (common with generated files, lockfiles, or large refactors)
// would otherwise be silently truncated to the first page.
async function listAllFiles(octokit: Octokit, owner: string, repo: string, prNumber: number): Promise<any[]> {
  const allFiles: any[] = []
  let page = 1
  while (true) {
    const { data } = await (octokit as any).rest.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
      page,
    })
    allFiles.push(...data)
    if (data.length < 100) break
    page += 1
  }
  return allFiles
}

export async function fetchPRContext(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<PRContext> {
  const [{ data: pr }, files] = await Promise.all([
    (octokit as any).rest.pulls.get({ owner, repo, pull_number: prNumber }),
    listAllFiles(octokit, owner, repo, prNumber),
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

  const customRules = await fetchAreteYaml(octokit, owner, repo, pr.head.sha);

  return {
    repo: `${owner}/${repo}`,
    pr_number: pr.number,
    title: pr.title,
    description: pr.body ?? '',
    files: fileChanges,
    customRules,
  }
}
