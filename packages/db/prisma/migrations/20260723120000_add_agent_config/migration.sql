-- AgentConfig: per-installation settings for one specialist review agent —
-- enabled, severity threshold, and custom guidance. These were local React
-- state in the config drawer, explicitly "deliberately NOT persisted", so every
-- control reset when the panel closed.
--
-- Purely additive: one CREATE TABLE, nothing altered and nothing dropped. Every
-- worktree shares one Postgres, so this had to be safe for checkouts that have
-- not pulled it — they simply never reference the table.
--
-- Absence of a row is meaningful and is not an error: an agent with no row runs
-- on the defaults below, which is exactly the behaviour before this migration.
-- That is why there is no backfill.

-- CreateTable
CREATE TABLE "AgentConfig" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "severityThreshold" TEXT NOT NULL DEFAULT 'warning',
    "guidance" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentConfig_installationId_idx" ON "AgentConfig"("installationId");

-- CreateIndex
-- One row per (installation, agent). This is what makes a save an upsert and
-- makes it impossible for two rows to disagree about the same agent.
CREATE UNIQUE INDEX "AgentConfig_installationId_agentId_key" ON "AgentConfig"("installationId", "agentId");
