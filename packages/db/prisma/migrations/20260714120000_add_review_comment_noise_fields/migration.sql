-- Adds the noise-classification columns to ReviewComment. These fields were
-- present in schema.prisma with no corresponding migration, so any query that
-- reads full ReviewComment rows failed at runtime against databases created
-- before them (e.g. "column ReviewComment.noiseState does not exist").
--
-- All three columns are additive and safe on existing data: noiseState is NOT
-- NULL with a default, and escalateOn/threshold are nullable.

-- AlterTable
ALTER TABLE "ReviewComment" ADD COLUMN     "noiseState" TEXT NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "escalateOn" TEXT,
ADD COLUMN     "threshold" INTEGER;
