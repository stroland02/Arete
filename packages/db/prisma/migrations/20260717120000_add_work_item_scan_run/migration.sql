-- CreateTable
CREATE TABLE "WorkItem" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "dimension" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'open',
    "fingerprint" TEXT NOT NULL,
    "containerId" TEXT,
    "scanRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanRun" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ScanRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkItem_installationId_fingerprint_key" ON "WorkItem"("installationId", "fingerprint");

-- CreateIndex
CREATE INDEX "WorkItem_installationId_state_idx" ON "WorkItem"("installationId", "state");

-- CreateIndex
CREATE INDEX "ScanRun_installationId_startedAt_idx" ON "ScanRun"("installationId", "startedAt");
