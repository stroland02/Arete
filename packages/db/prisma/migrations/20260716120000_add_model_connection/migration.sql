-- CreateTable
CREATE TABLE "ModelConnection" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "apiKeyEncrypted" TEXT,
    "model" TEXT NOT NULL,
    "baseUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ModelConnection_installationId_provider_key" ON "ModelConnection"("installationId", "provider");

-- AddForeignKey
ALTER TABLE "ModelConnection" ADD CONSTRAINT "ModelConnection_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
