-- CreateTable
CREATE TABLE "InstallationAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstallationAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstallationAccess_userId_idx" ON "InstallationAccess"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "InstallationAccess_userId_installationId_key" ON "InstallationAccess"("userId", "installationId");

-- AddForeignKey
ALTER TABLE "InstallationAccess" ADD CONSTRAINT "InstallationAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstallationAccess" ADD CONSTRAINT "InstallationAccess_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
