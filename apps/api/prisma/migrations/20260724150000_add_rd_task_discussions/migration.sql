-- CreateTable
CREATE TABLE "RdTaskDiscussionThread" (
    "id" TEXT NOT NULL,
    "workspace" TEXT NOT NULL DEFAULT 'rd',
    "taskId" TEXT NOT NULL,
    "anchorType" TEXT NOT NULL DEFAULT 'task',
    "anchorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RdTaskDiscussionThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RdTaskDiscussionMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "authorRole" TEXT,
    "body" TEXT NOT NULL,
    "attachments" JSONB NOT NULL DEFAULT '[]',
    "mentions" JSONB NOT NULL DEFAULT '[]',
    "replyToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),

    CONSTRAINT "RdTaskDiscussionMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RdTaskDiscussionRead" (
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RdTaskDiscussionRead_pkey" PRIMARY KEY ("threadId","userId")
);

-- CreateIndex
CREATE INDEX "RdTaskDiscussionThread_workspace_taskId_updatedAt_idx" ON "RdTaskDiscussionThread"("workspace", "taskId", "updatedAt");

-- CreateIndex
CREATE INDEX "RdTaskDiscussionThread_workspace_taskId_anchorType_anchorId_idx" ON "RdTaskDiscussionThread"("workspace", "taskId", "anchorType", "anchorId");

-- CreateIndex
CREATE INDEX "RdTaskDiscussionMessage_threadId_createdAt_idx" ON "RdTaskDiscussionMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "RdTaskDiscussionMessage_replyToId_idx" ON "RdTaskDiscussionMessage"("replyToId");

-- CreateIndex
CREATE INDEX "RdTaskDiscussionRead_userId_lastReadAt_idx" ON "RdTaskDiscussionRead"("userId", "lastReadAt");

-- AddForeignKey
ALTER TABLE "RdTaskDiscussionMessage" ADD CONSTRAINT "RdTaskDiscussionMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "RdTaskDiscussionThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RdTaskDiscussionMessage" ADD CONSTRAINT "RdTaskDiscussionMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "RdTaskDiscussionMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RdTaskDiscussionRead" ADD CONSTRAINT "RdTaskDiscussionRead_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "RdTaskDiscussionThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;
