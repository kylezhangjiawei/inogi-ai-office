ALTER TABLE "GeneratedImage"
  ADD COLUMN "parentImageId" TEXT,
  ADD COLUMN "rootImageId" TEXT,
  ADD COLUMN "editInstruction" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "editDepth" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cumulativeEstimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE "GeneratedImage"
SET "cumulativeEstimatedCostUsd" = "estimatedCostUsd"
WHERE "cumulativeEstimatedCostUsd" = 0 AND "estimatedCostUsd" > 0;

CREATE TABLE "ImageEditMessage" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "rootImageId" TEXT NOT NULL,
  "sourceImageId" TEXT,
  "resultImageId" TEXT,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "model" TEXT,
  "requestId" TEXT,
  "inputTokens" INTEGER NOT NULL DEFAULT 0,
  "inputTextTokens" INTEGER NOT NULL DEFAULT 0,
  "inputImageTokens" INTEGER NOT NULL DEFAULT 0,
  "outputTokens" INTEGER NOT NULL DEFAULT 0,
  "totalTokens" INTEGER NOT NULL DEFAULT 0,
  "estimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "cumulativeEstimatedCostUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "meta" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ImageEditMessage_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ImageEditMessage"
  ADD CONSTRAINT "ImageEditMessage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "GeneratedImage_userId_rootImageId_createdAt_idx"
  ON "GeneratedImage"("userId", "rootImageId", "createdAt");

CREATE INDEX "GeneratedImage_parentImageId_idx"
  ON "GeneratedImage"("parentImageId");

CREATE INDEX "ImageEditMessage_userId_rootImageId_createdAt_idx"
  ON "ImageEditMessage"("userId", "rootImageId", "createdAt");

CREATE INDEX "ImageEditMessage_sourceImageId_idx"
  ON "ImageEditMessage"("sourceImageId");

CREATE INDEX "ImageEditMessage_resultImageId_idx"
  ON "ImageEditMessage"("resultImageId");
