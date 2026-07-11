-- CreateTable
CREATE TABLE "TelemetryConnection" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "credentials" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelemetryConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelemetryConnection_installationId_provider_key" ON "TelemetryConnection"("installationId", "provider");

-- AddForeignKey
ALTER TABLE "TelemetryConnection" ADD CONSTRAINT "TelemetryConnection_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
