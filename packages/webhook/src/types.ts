// Mirrors the Python Pydantic models in packages/agents/src/arete_agents/models/

export interface FileChange {
  path: string
  patch: string
  additions: number
  deletions: number
  language: string
}

export interface PRContext {
  repo: string
  pr_number: number
  title: string
  description: string
  files: FileChange[]
}

export interface ReviewComment {
  path: string
  line: number
  body: string
  severity: 'info' | 'warning' | 'error'
  category: string
}

export interface FileReview {
  path: string
  comments: ReviewComment[]
  summary: string
}

export interface ReviewResult {
  pr_context: PRContext
  file_reviews: FileReview[]
  overall_summary: string
  risk_level: 'low' | 'medium' | 'high' | 'critical'
  total_comments: number
}
