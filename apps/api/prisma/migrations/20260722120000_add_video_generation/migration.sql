-- CreateTable
CREATE TABLE "VideoGeneration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "mode" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt" TEXT NOT NULL DEFAULT '',
    "sourceImageRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sourceImageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "resolution" TEXT NOT NULL DEFAULT '720P',
    "ratio" TEXT NOT NULL DEFAULT '',
    "duration" INTEGER NOT NULL DEFAULT 5,
    "watermark" BOOLEAN NOT NULL DEFAULT true,
    "seed" INTEGER,
    "upstreamTaskId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "videoObjectKey" TEXT NOT NULL DEFAULT '',
    "upstreamVideoUrl" TEXT NOT NULL DEFAULT '',
    "billedSeconds" INTEGER NOT NULL DEFAULT 0,
    "costYuan" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VideoGeneration_userId_createdAt_idx" ON "VideoGeneration"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "VideoGeneration_upstreamTaskId_idx" ON "VideoGeneration"("upstreamTaskId");

-- CreateIndex
CREATE INDEX "VideoGeneration_status_idx" ON "VideoGeneration"("status");

-- AddForeignKey
ALTER TABLE "VideoGeneration" ADD CONSTRAINT "VideoGeneration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
