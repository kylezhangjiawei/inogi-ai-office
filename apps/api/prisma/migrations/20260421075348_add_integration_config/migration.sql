-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED', 'DISABLED');

-- CreateEnum
CREATE TYPE "ScreeningDecision" AS ENUM ('RECOMMEND', 'HOLD', 'REJECT');

-- CreateEnum
CREATE TYPE "ScreeningStatus" AS ENUM ('COMPLETED', 'SKIPPED', 'FAILED', 'PENDING_CONFIG');

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "department" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "roleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuntimeState" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RuntimeState_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "JobRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jdText" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Candidate" (
    "id" TEXT NOT NULL,
    "uniqueKey" TEXT NOT NULL,
    "jobRuleId" TEXT,
    "name" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL DEFAULT '',
    "phone" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "education" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT '',
    "targetJob" TEXT NOT NULL DEFAULT '',
    "targetCity" TEXT NOT NULL DEFAULT '',
    "salaryExpectation" TEXT NOT NULL DEFAULT '',
    "recentCompany" TEXT NOT NULL DEFAULT '',
    "recentTitle" TEXT NOT NULL DEFAULT '',
    "yearsExperience" TEXT NOT NULL DEFAULT '',
    "rawEmailText" TEXT NOT NULL,
    "parsedCandidateProfile" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "sourceSubject" TEXT NOT NULL DEFAULT '',
    "sourceSenderName" TEXT NOT NULL DEFAULT '',
    "sourceSenderEmail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateScreening" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "jobRuleId" TEXT,
    "promptVersion" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "requestPayload" JSONB NOT NULL,
    "responsePayload" JSONB NOT NULL,
    "score" INTEGER,
    "decision" "ScreeningDecision",
    "matchedPoints" JSONB NOT NULL,
    "risks" JSONB NOT NULL,
    "summary" TEXT,
    "nextStep" BOOLEAN,
    "durationMs" INTEGER,
    "status" "ScreeningStatus" NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateScreening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConfig" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accountIdentifier" TEXT,
    "provider" TEXT,
    "model" TEXT,
    "encryptedSecret" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailIngestionLog" (
    "id" TEXT NOT NULL,
    "mailbox" TEXT NOT NULL,
    "imapUid" INTEGER,
    "messageId" TEXT,
    "uniqueKey" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "senderEmail" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "candidateId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailIngestionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "SystemSetting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Candidate_uniqueKey_key" ON "Candidate"("uniqueKey");

-- CreateIndex
CREATE UNIQUE INDEX "EmailIngestionLog_uniqueKey_key" ON "EmailIngestionLog"("uniqueKey");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Candidate" ADD CONSTRAINT "Candidate_jobRuleId_fkey" FOREIGN KEY ("jobRuleId") REFERENCES "JobRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateScreening" ADD CONSTRAINT "CandidateScreening_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateScreening" ADD CONSTRAINT "CandidateScreening_jobRuleId_fkey" FOREIGN KEY ("jobRuleId") REFERENCES "JobRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailIngestionLog" ADD CONSTRAINT "EmailIngestionLog_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "Candidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
