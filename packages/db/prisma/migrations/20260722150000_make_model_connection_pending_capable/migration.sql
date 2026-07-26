-- ModelConnection becomes pending-capable (model-before-repo onboarding):
-- a row may exist before any Installation, scoped by userId, and is adopted
-- (installationId set) by the first installation. Prisma-generated via
-- `migrate diff`; Incident changes excluded (covered by 20260722140000).

-- DropForeignKey
ALTER TABLE "ModelConnection" DROP CONSTRAINT "ModelConnection_installationId_fkey";

-- AlterTable
ALTER TABLE "ModelConnection" ADD COLUMN     "userId" TEXT,
ALTER COLUMN "installationId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "ModelConnection_userId_idx" ON "ModelConnection"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ModelConnection_userId_provider_key" ON "ModelConnection"("userId", "provider");

-- AddForeignKey
ALTER TABLE "ModelConnection" ADD CONSTRAINT "ModelConnection_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "Installation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
