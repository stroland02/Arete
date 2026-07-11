-- AlterTable
ALTER TABLE "TelemetryConnection" ADD COLUMN     "authMethod" TEXT NOT NULL DEFAULT 'api_key';
