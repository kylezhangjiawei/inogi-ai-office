-- 站内消息增加「来源」与「分类」两个维度。
--   source   哪个业务模块发的（研发/协同/生产/采购/视频/绩效/助手）
--   category 给用户看的那层分类（待办/结果/提及/通知），由 type 派生
-- 默认值让存量行先落到安全值上，紧接着的回填再按 type 修正。

ALTER TABLE "RdMessage" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'rd';
ALTER TABLE "RdMessage" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'notice';

-- CreateIndex
CREATE INDEX "RdMessage_recipientId_category_createdAt_idx" ON "RdMessage"("recipientId", "category", "createdAt");

-- ── 存量回填 ──────────────────────────────────────────────────────────────
-- 表化那一步已经把结构化 body 的 type 落了列，这里直接按 type 派生分类。
-- ⚠️ 映射必须与服务层 messageCategoryOf 保持一致，两处改一处就会出现
--    「历史消息归在待办、同类新消息归在通知」的分裂。
UPDATE "RdMessage" SET "category" =
  CASE "type"
    WHEN 'review_request'       THEN 'todo'
    WHEN 'perf_self_assessment' THEN 'todo'
    WHEN 'review_result'        THEN 'result'
    WHEN 'discussion_mention'   THEN 'mention'
    ELSE 'notice'
  END;

-- 来源：表化之前所有消息都由研发服务写入（采购/视频/助手也是调它的 createMessage），
-- 存量行区分不出真实来源，只能按 type 认出绩效这一类，其余保守归到研发。
UPDATE "RdMessage" SET "source" = 'performance' WHERE "type" = 'perf_self_assessment';

DO $$
DECLARE total bigint; uncategorized bigint;
BEGIN
  SELECT count(*) INTO total FROM "RdMessage";
  SELECT count(*) INTO uncategorized FROM "RdMessage"
   WHERE "category" NOT IN ('todo','result','mention','notice');
  IF uncategorized > 0 THEN
    RAISE EXCEPTION '有 % 行分类取值非法', uncategorized;
  END IF;
  RAISE NOTICE '[RdMessage] 来源/分类回填完成，共 % 行', total;
END $$;
