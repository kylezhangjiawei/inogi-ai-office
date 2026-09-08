-- Persist user-confirmed reference checklists; taskId references the existing RD JSON task store.
CREATE TABLE "ChatDeliveryCheck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "workspace" TEXT NOT NULL DEFAULT 'rd',
    "taskTitle" TEXT NOT NULL,
    "checklist" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ChatDeliveryCheck_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatDeliveryCheck_userId_conversationId_updatedAt_idx" ON "ChatDeliveryCheck"("userId", "conversationId", "updatedAt");
CREATE INDEX "ChatDeliveryCheck_userId_taskId_idx" ON "ChatDeliveryCheck"("userId", "taskId");
ALTER TABLE "ChatDeliveryCheck" ADD CONSTRAINT "ChatDeliveryCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatDeliveryCheck" ADD CONSTRAINT "ChatDeliveryCheck_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
