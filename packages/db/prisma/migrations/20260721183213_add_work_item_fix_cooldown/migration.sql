-- AlterTable
ALTER TABLE "WorkItem" ADD COLUMN     "fixFailureAt" TIMESTAMP(3),
ADD COLUMN     "fixFailureCount" INTEGER NOT NULL DEFAULT 0;
