-- CreateTable
CREATE TABLE "TelemetrySnapshotRecord" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "summaryText" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "links" JSONB NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelemetrySnapshotRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelemetrySnapshotRecord_installationId_provider_sourceRef_key" ON "TelemetrySnapshotRecord"("installationId", "provider", "sourceRef");

-- AddForeignKey
ALTER TABLE "TelemetrySnapshotRecord" ADD CONSTRAINT "TelemetrySnapshotRecord_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
