-- Additive only: nullable JSONB column for per-specialist agent statuses
-- (ReviewResult.agent_statuses). Existing rows stay NULL — "field absent",
-- distinct from [] ("no agent ran"). Safe under `prisma migrate deploy`.
ALTER TABLE "Review" ADD COLUMN "agentStatuses" JSONB;
