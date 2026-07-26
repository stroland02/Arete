-- Creates the ApprovalPrompt and AgentMemory tables. These models exist in
-- schema.prisma and are referenced by a later migration
-- (20260714130000_add_approval_prompt_executed_at ALTERs ApprovalPrompt), but no
-- migration ever CREATEd them — the gap was masked by `prisma db push` in dev.
-- This migration fills it, ordered BEFORE the ALTER so a fresh `migrate deploy`
-- applies cleanly. ApprovalPrompt is created WITHOUT `executedAt`; the later
-- ALTER adds that column.

-- CreateTable
CREATE TABLE "ApprovalPrompt" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApprovalPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMemory" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentMemory_repositoryId_status_idx" ON "AgentMemory"("repositoryId", "status");

-- AddForeignKey
ALTER TABLE "ApprovalPrompt" ADD CONSTRAINT "ApprovalPrompt_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
