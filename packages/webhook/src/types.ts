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
  projectMemories?: string[]
  cloneUrl?: string
  installationToken?: string
  installationId?: number
  /// The tenant's resolved Bring-Your-Own model connection for this review
  /// (see resolve-model-connection.ts). apiKey is decrypted; null for keyless
  /// (Ollama companion) connections. Attached at the /review choke point.
  modelConnection?: {
    provider: string
    model: string
    apiKey: string | null
    baseUrl: string | null
  }
}

export interface ReviewComment {
  path: string
  line: number
  body: string
  severity: 'info' | 'warning' | 'error'
  category: string
  // Noise Classification (SP6). Snake_case: the Python agents service emits
  // these field names unchanged over the wire, exactly like risk_level/
  // overall_summary/pr_context elsewhere on ReviewResult -- NOT translated
  // to camelCase here. persistence.ts's persistReview is the one place that
  // translates to the Prisma schema's camelCase columns.
  noise_state?: 'OPEN' | 'SILENCED' | 'UNDER_OBSERVATION' | 'ESCALATED'
  escalate_on?: string | null
  threshold?: number | null
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
  // Deterministic risk-tiered gate from the agents service (SP4). Optional
  // for backward-compat with older agent responses / non-review paths that
  // don't set it — reviewConclusion() falls back to risk_level when absent.
  verdict?: 'pass' | 'comment' | 'review-required' | 'blocked'
  verdict_reason?: string
  actions?: AgentAction[]
}

export type AgentAction = 
  | { type: 'save_memory', kind: string, title: string, body: string }
  | { type: 'ask_human', question: string }
