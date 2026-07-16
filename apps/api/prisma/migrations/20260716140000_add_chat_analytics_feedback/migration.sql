-- MateChat usage analytics and structured answer feedback.

CREATE TABLE "ChatFeedback" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "reaction" TEXT NOT NULL,
  "reasons" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "comment" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'open',
  "resolutionNote" TEXT NOT NULL DEFAULT '',
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChatFeedback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatUsageEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "conversationId" TEXT,
  "messageId" TEXT,
  "model" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChatFeedback_messageId_key" ON "ChatFeedback"("messageId");
CREATE INDEX "ChatFeedback_reaction_createdAt_idx" ON "ChatFeedback"("reaction", "createdAt");
CREATE INDEX "ChatFeedback_status_createdAt_idx" ON "ChatFeedback"("status", "createdAt");
CREATE INDEX "ChatUsageEvent_createdAt_idx" ON "ChatUsageEvent"("createdAt");
CREATE INDEX "ChatUsageEvent_eventType_createdAt_idx" ON "ChatUsageEvent"("eventType", "createdAt");
CREATE INDEX "ChatUsageEvent_userId_createdAt_idx" ON "ChatUsageEvent"("userId", "createdAt");

ALTER TABLE "ChatFeedback"
  ADD CONSTRAINT "ChatFeedback_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ChatUsageEvent"
  ADD CONSTRAINT "ChatUsageEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve feedback already collected by the legacy reaction column.
INSERT INTO "ChatFeedback" (
  "id", "messageId", "reaction", "reasons", "comment", "status", "resolutionNote", "resolvedAt", "createdAt", "updatedAt"
)
SELECT
  'legacy-' || m."id", m."id", m."reaction", ARRAY[]::TEXT[], '',
  CASE WHEN m."reaction" = 'dislike' THEN 'open' ELSE 'resolved' END,
  '', CASE WHEN m."reaction" = 'like' THEN m."createdAt" ELSE NULL END,
  m."createdAt", m."createdAt"
FROM "ChatMessage" m
WHERE m."reaction" IN ('like', 'dislike');
