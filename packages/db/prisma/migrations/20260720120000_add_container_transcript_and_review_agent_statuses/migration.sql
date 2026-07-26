-- Healing-loop v1 + tiered-comms status board (additive, nullable).
-- IF NOT EXISTS: the dev DB may already carry `transcript` from an earlier
-- parallel session; keep this migration idempotent so deploy is safe.
ALTER TABLE "IssueContainer" ADD COLUMN IF NOT EXISTS "transcript" JSONB;
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "agentStatuses" JSONB;
