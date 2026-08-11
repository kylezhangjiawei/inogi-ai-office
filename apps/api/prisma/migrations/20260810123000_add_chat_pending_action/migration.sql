-- CreateTable: MateChat 待确认动作卡从 SystemSetting['chat.pendingActions'] 单键 JSON 搬到独立表。
-- 原实现读-改-写整份 JSON + 进程内 Map 锁，只在单实例下能防住重复执行；独立成表后
-- 确认改为 `WHERE status='pending'` 的条件更新原子抢占，可安全横向扩容。
CREATE TABLE "ChatPendingAction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT,
    "tool" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "card" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resultMessage" TEXT NOT NULL DEFAULT '',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatPendingAction_pkey" PRIMARY KEY ("id")
);

-- 列会话内未决卡（刷新恢复）走这条索引
CREATE INDEX "ChatPendingAction_conversationId_userId_status_idx" ON "ChatPendingAction"("conversationId", "userId", "status");

-- 过期清理走这条索引
CREATE INDEX "ChatPendingAction_status_expiresAt_idx" ON "ChatPendingAction"("status", "expiresAt");

-- 数据迁移：只搬仍然有效的卡（pending 且未过期，最多 200 条）。
-- 已执行/已取消/已过期的历史条目没有恢复价值，随旧 KV 一起丢弃。
INSERT INTO "ChatPendingAction" (
    "id", "userId", "conversationId", "messageId", "tool",
    "payload", "card", "status", "resultMessage", "expiresAt", "createdAt", "updatedAt"
)
SELECT
    e.value->>'id',
    e.value->>'userId',
    e.value->>'conversationId',
    e.value->>'messageId',
    e.value->>'tool',
    COALESCE(e.value->'payload', '{}'::jsonb),
    COALESCE(e.value->'card', '{}'::jsonb),
    'pending',
    '',
    (e.value->>'expiresAt')::timestamp,
    (e.value->>'createdAt')::timestamp,
    NOW()
FROM "SystemSetting" s, jsonb_each(s.value) AS e
WHERE s.key = 'chat.pendingActions'
  AND jsonb_typeof(s.value) = 'object'
  AND e.value->>'id' IS NOT NULL
  AND e.value->>'status' = 'pending'
  AND (e.value->>'expiresAt')::timestamp > (NOW() AT TIME ZONE 'UTC')
ON CONFLICT ("id") DO NOTHING;

-- 旧 KV 键退役：数据已搬走，留着只会让人误以为它还是数据源
DELETE FROM "SystemSetting" WHERE "key" = 'chat.pendingActions';
