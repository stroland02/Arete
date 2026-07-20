-- Healing loop v1 (spec 2026-07-19 §4, §7): the real fix drive's transcript,
-- and the honest failure reason on the work item. Both nullable — additive.
ALTER TABLE "IssueContainer" ADD COLUMN "transcript" JSONB;
ALTER TABLE "WorkItem" ADD COLUMN "fixError" TEXT;
