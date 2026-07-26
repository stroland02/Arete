-- CreateTable
CREATE TABLE "AgentChatTurn" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "containerId" TEXT,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentChatTurn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentChatTurn_installationId_agentId_containerId_createdAt_idx" ON "AgentChatTurn"("installationId", "agentId", "containerId", "createdAt");
