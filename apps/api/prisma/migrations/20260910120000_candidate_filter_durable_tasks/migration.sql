CREATE TABLE "CandidateFilterTask" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "activeUserId" TEXT,
  "fingerprint" VARCHAR(64) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "phase" VARCHAR(20) NOT NULL DEFAULT 'queued',
  "payloadJson" JSONB NOT NULL,
  "snapshotJson" JSONB,
  "analysisJson" JSONB,
  "totalCount" INTEGER NOT NULL DEFAULT 0,
  "processedCount" INTEGER NOT NULL DEFAULT 0,
  "resultJson" JSONB,
  "error" TEXT,
  "claimToken" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "CandidateFilterTask_activeUserId_key" ON "CandidateFilterTask"("activeUserId");
CREATE INDEX "CandidateFilterTask_status_leaseUntil_createdAt_idx" ON "CandidateFilterTask"("status", "leaseUntil", "createdAt");
CREATE INDEX "CandidateFilterTask_userId_createdAt_idx" ON "CandidateFilterTask"("userId", "createdAt");

CREATE TABLE "CandidateFilterTaskBatch" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "taskId" TEXT NOT NULL,
  "batchIndex" INTEGER NOT NULL,
  "candidateCount" INTEGER NOT NULL,
  "completionJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CandidateFilterTaskBatch_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "CandidateFilterTask"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CandidateFilterTaskBatch_taskId_batchIndex_key" ON "CandidateFilterTaskBatch"("taskId", "batchIndex");
