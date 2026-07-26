-- ErrorGroup: human triage state for a runtime error group. The error EVENTS
-- stay in ClickHouse (superlog.otel_traces exception spans + superlog.otel_logs,
-- 30-day TTL); this table only records what a person decided, keyed by the
-- deterministic fingerprint. Absence of a row means "open".

-- CreateTable
CREATE TABLE "ErrorGroup" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "incidentId" TEXT,
    "attachedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "silencedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErrorGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErrorGroup_installationId_status_idx" ON "ErrorGroup"("installationId", "status");

-- CreateIndex
CREATE INDEX "ErrorGroup_incidentId_idx" ON "ErrorGroup"("incidentId");

-- CreateIndex
CREATE UNIQUE INDEX "ErrorGroup_installationId_fingerprint_key" ON "ErrorGroup"("installationId", "fingerprint");

-- AddForeignKey
ALTER TABLE "ErrorGroup" ADD CONSTRAINT "ErrorGroup_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorGroup" ADD CONSTRAINT "ErrorGroup_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE SET NULL ON UPDATE CASCADE;
