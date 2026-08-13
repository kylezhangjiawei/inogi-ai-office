-- 站内消息从 SystemSetting['rd.messages'] 的单个 JSON 数组迁到独立表。
-- 建表 DDL 由 `prisma migrate diff --from-empty --to-schema-datamodel` 生成，未手改。
-- 回填在同一迁移内完成：存量消息的 id 已被前端持有（标已读按 id 提交），必须原样保留。
-- 原 SystemSetting 行不删除，作为回退保险；确认无误后可另行清理。

-- CreateTable
CREATE TABLE "RdMessage" (
    "id" TEXT NOT NULL,
    "senderId" TEXT,
    "senderName" TEXT NOT NULL DEFAULT '系统',
    "senderRole" TEXT,
    "recipientId" TEXT,
    "recipientPersonId" TEXT,
    "recipientName" TEXT,
    "recipientNameKey" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "meta" JSONB,
    "type" TEXT,
    "taskId" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RdMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RdMessage_recipientId_handled_createdAt_idx" ON "RdMessage"("recipientId", "handled", "createdAt");

-- CreateIndex
CREATE INDEX "RdMessage_recipientPersonId_idx" ON "RdMessage"("recipientPersonId");

-- CreateIndex
CREATE INDEX "RdMessage_recipientNameKey_idx" ON "RdMessage"("recipientNameKey");

-- CreateIndex
CREATE INDEX "RdMessage_type_taskId_handled_idx" ON "RdMessage"("type", "taskId", "handled");

-- CreateIndex
CREATE INDEX "RdMessage_senderId_idx" ON "RdMessage"("senderId");

-- CreateIndex
CREATE INDEX "RdMessage_createdAt_idx" ON "RdMessage"("createdAt");

-- ── 存量回填 ──────────────────────────────────────────────────────────────

-- body 里混着纯文本和 JSON 两种历史数据，直接 ::jsonb 会让整条迁移炸掉。
-- 这个包装只在解析失败时返回 NULL；迁移末尾即删除，不留残留对象。
CREATE OR REPLACE FUNCTION pg_rd_msg_try_jsonb(t text) RETURNS jsonb AS $$
BEGIN
  RETURN t::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- recipientName 归一化，必须与服务层 personNameLookupKey 逐步对应：
--   ① 去掉「（…）」「(…)」括号后缀  ② 转小写  ③ 去掉所有空白
CREATE OR REPLACE FUNCTION pg_rd_msg_name_key(t text) RETURNS text AS $$
  SELECT NULLIF(
    regexp_replace(
      lower(regexp_replace(btrim(t), '[（(][^）)]*[）)]', '', 'g')),
      '\s', '', 'g'
    ),
    ''
  );
$$ LANGUAGE sql IMMUTABLE;

INSERT INTO "RdMessage" (
    "id", "senderId", "senderName", "senderRole",
    "recipientId", "recipientPersonId", "recipientName", "recipientNameKey",
    "subject", "body", "meta", "type", "taskId",
    "read", "handled", "createdAt"
)
SELECT DISTINCT ON (src.m ->> 'id')
    src.m ->> 'id',
    NULLIF(btrim(COALESCE(src.m ->> 'sender_id', '')), ''),
    COALESCE(NULLIF(btrim(COALESCE(src.m ->> 'sender_name', '')), ''), '系统'),
    NULLIF(btrim(COALESCE(src.m ->> 'sender_role', '')), ''),
    NULLIF(btrim(COALESCE(src.m ->> 'recipient_id', '')), ''),
    NULLIF(btrim(COALESCE(src.m ->> 'recipient_person_id', '')), ''),
    NULLIF(btrim(COALESCE(src.m ->> 'recipient_name', '')), ''),
    pg_rd_msg_name_key(src.m ->> 'recipient_name'),
    NULLIF(btrim(COALESCE(src.m ->> 'subject', '')), ''),
    COALESCE(src.m ->> 'body', ''),
    CASE WHEN jsonb_typeof(src.m -> 'meta') = 'object' THEN src.m -> 'meta' END,
    -- 只对看起来像 JSON 的 body 走解析，纯文本消息直接留空，省掉逐行子事务
    CASE WHEN left(btrim(COALESCE(src.m ->> 'body', '')), 1) = '{'
         THEN pg_rd_msg_try_jsonb(src.m ->> 'body') ->> 'type' END,
    CASE WHEN left(btrim(COALESCE(src.m ->> 'body', '')), 1) = '{'
         THEN pg_rd_msg_try_jsonb(src.m ->> 'body') ->> 'task_id' END,
    COALESCE((src.m ->> 'read')::boolean, false),
    COALESCE((src.m ->> 'handled')::boolean, false),
    -- ⚠️ createdAt 是 TIMESTAMP(3)（无时区），Prisma 按 UTC 存取。
    -- 少了 AT TIME ZONE 'UTC'，ISO 串会按服务器会话时区落成本地时间，
    -- 全部历史消息的时间整体偏移一个时区（东八区实测差 8 小时）。
    COALESCE(
      (src.m ->> 'created_at')::timestamptz AT TIME ZONE 'UTC',
      now() AT TIME ZONE 'UTC'
    )
FROM (
    SELECT elem.m, elem.ord
    FROM "SystemSetting" s
    CROSS JOIN LATERAL jsonb_array_elements(s."value") WITH ORDINALITY AS elem(m, ord)
    WHERE s."key" = 'rd.messages'
      AND jsonb_typeof(s."value") = 'array'
) AS src
WHERE jsonb_typeof(src.m) = 'object'
  AND NULLIF(btrim(COALESCE(src.m ->> 'id', '')), '') IS NOT NULL
  -- 收件人三标识全空的脏数据投递不到任何人，不迁
  AND COALESCE(
        NULLIF(btrim(COALESCE(src.m ->> 'recipient_id', '')), ''),
        NULLIF(btrim(COALESCE(src.m ->> 'recipient_person_id', '')), ''),
        NULLIF(btrim(COALESCE(src.m ->> 'recipient_name', '')), '')
      ) IS NOT NULL
-- 数组里若有重复 id，保留靠前的那条（数组按时间倒序，靠前 = 较新）
ORDER BY src.m ->> 'id', src.ord;

-- 回填自检：本次迁移刚建的表，行数必须等于「可投递且有 id 的去重元素数」。
-- 对不上说明有消息在类型转换/冲突处理中被悄悄吞掉——宁可整条迁移回滚，
-- 也不能留下一份缺了通知、事后无从察觉的半截数据。
DO $$
DECLARE
  expected bigint;
  actual   bigint;
BEGIN
  SELECT count(DISTINCT elem.m ->> 'id') INTO expected
  FROM "SystemSetting" s
  CROSS JOIN LATERAL jsonb_array_elements(s."value") AS elem(m)
  WHERE s."key" = 'rd.messages'
    AND jsonb_typeof(s."value") = 'array'
    AND jsonb_typeof(elem.m) = 'object'
    AND NULLIF(btrim(COALESCE(elem.m ->> 'id', '')), '') IS NOT NULL
    AND COALESCE(
          NULLIF(btrim(COALESCE(elem.m ->> 'recipient_id', '')), ''),
          NULLIF(btrim(COALESCE(elem.m ->> 'recipient_person_id', '')), ''),
          NULLIF(btrim(COALESCE(elem.m ->> 'recipient_name', '')), '')
        ) IS NOT NULL;

  SELECT count(*) INTO actual FROM "RdMessage";

  IF actual <> COALESCE(expected, 0) THEN
    RAISE EXCEPTION 'RdMessage 回填行数不符：预期 % 行，实际 % 行', COALESCE(expected, 0), actual;
  END IF;

  RAISE NOTICE '[RdMessage] 存量回填完成：% 行', actual;
END $$;

DROP FUNCTION pg_rd_msg_name_key(text);
DROP FUNCTION pg_rd_msg_try_jsonb(text);
