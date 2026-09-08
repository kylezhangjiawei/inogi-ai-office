CREATE TABLE "ChatFileSelection" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "conversationId" TEXT NOT NULL,
  "filter" JSONB NOT NULL, "files" JSONB NOT NULL, "warnings" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "ChatFileSelection_userId_conversationId_createdAt_idx" ON "ChatFileSelection"("userId", "conversationId", "createdAt");
CREATE INDEX "ChatFileSelection_expiresAt_idx" ON "ChatFileSelection"("expiresAt");
CREATE TABLE "ChatArchiveJob" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "conversationId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL, "filename" TEXT NOT NULL, "grouping" TEXT NOT NULL DEFAULT 'source',
  "files" JSONB NOT NULL, "warnings" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'queued',
  "total" INTEGER NOT NULL, "processed" INTEGER NOT NULL DEFAULT 0, "succeeded" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0, "bytes" BIGINT NOT NULL DEFAULT 0, "report" JSONB, "objectKey" TEXT, "outputKeys" JSONB NOT NULL DEFAULT '[]',
  "error" TEXT, "attempts" INTEGER NOT NULL DEFAULT 0, "claimToken" TEXT, "leaseUntil" TIMESTAMP(3),
  "cancelRequested" BOOLEAN NOT NULL DEFAULT false, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "ChatArchiveJob_requestKey_key" ON "ChatArchiveJob"("requestKey");
CREATE INDEX "ChatArchiveJob_status_leaseUntil_createdAt_idx" ON "ChatArchiveJob"("status", "leaseUntil", "createdAt");
CREATE INDEX "ChatArchiveJob_userId_conversationId_createdAt_idx" ON "ChatArchiveJob"("userId", "conversationId", "createdAt");
CREATE INDEX "ChatArchiveJob_expiresAt_idx" ON "ChatArchiveJob"("expiresAt");
