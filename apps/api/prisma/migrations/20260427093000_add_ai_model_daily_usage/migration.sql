CREATE TABLE "AiModelDailyUsage" (
    "id" TEXT NOT NULL,
    "integrationConfigId" TEXT NOT NULL,
    "usageDate" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "tokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModelDailyUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiModelDailyUsage_integrationConfigId_usageDate_key" ON "AiModelDailyUsage"("integrationConfigId", "usageDate");
CREATE INDEX "AiModelDailyUsage_usageDate_idx" ON "AiModelDailyUsage"("usageDate");

ALTER TABLE "AiModelDailyUsage" ADD CONSTRAINT "AiModelDailyUsage_integrationConfigId_fkey" FOREIGN KEY ("integrationConfigId") REFERENCES "IntegrationConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
