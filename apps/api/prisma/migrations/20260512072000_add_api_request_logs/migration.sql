CREATE TABLE "ApiRequestLog" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "userId" TEXT,
  "method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "durationMs" INTEGER NOT NULL,
  "ip" TEXT,
  "userAgent" TEXT,
  "errorName" TEXT,
  "errorMessage" TEXT,
  "errorStack" TEXT,
  "requestMeta" JSONB NOT NULL DEFAULT '{}',
  "responseMeta" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ApiRequestLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiRequestLog_requestId_key" ON "ApiRequestLog"("requestId");
CREATE INDEX "ApiRequestLog_createdAt_idx" ON "ApiRequestLog"("createdAt");
CREATE INDEX "ApiRequestLog_statusCode_createdAt_idx" ON "ApiRequestLog"("statusCode", "createdAt");
CREATE INDEX "ApiRequestLog_path_createdAt_idx" ON "ApiRequestLog"("path", "createdAt");
CREATE INDEX "ApiRequestLog_userId_createdAt_idx" ON "ApiRequestLog"("userId", "createdAt");
