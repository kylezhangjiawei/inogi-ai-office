-- MateChat 幂等键：让同一逻辑发送的多次到达（网络/代理重放、误重发）只落一条用户消息。
-- 存量行 clientMessageId 为 NULL；Postgres 唯一索引对多行 NULL 宽容，故本迁移对存量数据零影响。

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN "clientMessageId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_conversationId_clientMessageId_key" ON "ChatMessage"("conversationId", "clientMessageId");
