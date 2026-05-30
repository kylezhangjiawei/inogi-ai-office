/*
  Warnings:

  - You are about to drop the `AiModelDailyUsage` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "AiModelDailyUsage" DROP CONSTRAINT "AiModelDailyUsage_integrationConfigId_fkey";

-- DropTable
DROP TABLE "AiModelDailyUsage";
