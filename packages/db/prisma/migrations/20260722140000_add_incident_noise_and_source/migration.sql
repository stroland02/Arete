-- Adds human-triage + provenance columns to Incident:
--  * noisedAt: set when a user triages the incident as noise (non-actionable).
--    Nullable; orthogonal to status, so the Alertmanager receiver never touches
--    it and a re-fire cannot undo the classification.
--  * source: how the incident was opened — "alert" (the Alertmanager receiver)
--    or "manual" (a New investigation opened by hand). NOT NULL with a default
--    so existing receiver-created rows and every future receiver write are
--    unaffected.
-- Both columns are additive and safe on existing data.

-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "noisedAt" TIMESTAMP(3),
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'alert';
