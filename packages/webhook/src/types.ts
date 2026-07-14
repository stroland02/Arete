// Mirrors the Python Pydantic models in packages/agents/src/arete_agents/models/

export interface FileChange {
  path: string
  patch: string
  additions: number
  deletions: number
  language: string
  // Optional change kind (used by the GitLab fetcher); absent in GitHub payloads
  status?: 'added' | 'removed' | 'renamed' | 'modified'
}

export interface TelemetrySnapshot {
  provider: string
  source_ref: string
  summary_text: string
  metrics: Record<string, number>
  links: string[]
  fetched_at: string
}

export interface TelemetryConnectorConfig {
  provider: 'github_actions' | 'posthog' | 'sentry' | 'vercel' | 'stripe'
  service?: string
  project?: string
  /** Sentry: organization slug. Vercel: team ID (optional, personal accounts omit it). */
  org?: string
}

export interface PRContext {
  repo: string
  pr_number: number
  title: string
  description: string
  files: FileChange[]
  customRules?: string[]
  ciLogs?: string
  telemetry?: TelemetrySnapshot[]
  telemetryConnectors?: TelemetryConnectorConfig[]
  repoConventions?: string
  cloneUrl?: string
  installationToken?: string
  installationId?: number
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
  analysis_status?: 'complete' | 'failed'
  actions?: AgentAction[]
}

export type AgentAction = 
  | { type: 'save_memory', kind: string, title: string, body: string }
  | { type: 'ask_human', question: string }
