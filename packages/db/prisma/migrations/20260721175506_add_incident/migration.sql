-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "alertName" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'firing',
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "workItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Incident_installationId_status_idx" ON "Incident"("installationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_installationId_fingerprint_key" ON "Incident"("installationId", "fingerprint");

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
