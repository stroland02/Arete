-- CreateTable
CREATE TABLE "IssueContainer" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'open',
    "gates" JSONB NOT NULL,
    "target" JSONB NOT NULL,
    "pr" JSONB NOT NULL,
    "patch" JSONB NOT NULL,
    "findings" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueContainer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IssueContainer_installationId_idx" ON "IssueContainer"("installationId");

-- AddForeignKey
ALTER TABLE "IssueContainer" ADD CONSTRAINT "IssueContainer_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
