CREATE TABLE "ImagePromptChatSession" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL DEFAULT '新提示词对话',
  "sourcePrompt" TEXT NOT NULL DEFAULT '',
  "currentPrompt" TEXT NOT NULL DEFAULT '',
  "model" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ImagePromptChatSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ImagePromptChatMessage" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "optimizedPrompt" TEXT NOT NULL DEFAULT '',
  "model" TEXT,
  "requestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ImagePromptChatMessage_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ImagePromptChatSession"
  ADD CONSTRAINT "ImagePromptChatSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ImagePromptChatMessage"
  ADD CONSTRAINT "ImagePromptChatMessage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ImagePromptChatMessage"
  ADD CONSTRAINT "ImagePromptChatMessage_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "ImagePromptChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "ImagePromptChatSession_userId_updatedAt_idx"
  ON "ImagePromptChatSession"("userId", "updatedAt");

CREATE INDEX "ImagePromptChatMessage_userId_sessionId_createdAt_idx"
  ON "ImagePromptChatMessage"("userId", "sessionId", "createdAt");
