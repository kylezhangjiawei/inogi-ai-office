-- 同一份资料在任一时刻只能存在一个正在比对或等待复核的任务。
-- 应用层会通过行锁给出友好的 409，此索引作为最终一致性防线。
-- 若旧数据已经存在重复活动任务，保留最新一条并将其余任务标记为失败，
-- 避免唯一索引上线时直接阻断部署。
WITH "rankedActiveComparisons" AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "documentId"
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS "rowNumber"
  FROM "ExternalDocumentComparison"
  WHERE "status" IN ('comparing', 'review')
)
UPDATE "ExternalDocumentComparison" AS "comparison"
SET
  "status" = 'failed',
  "errorMessage" = '并发活动任务已由数据库迁移关闭，请重新上传该候选版本',
  "completedAt" = COALESCE("comparison"."completedAt", CURRENT_TIMESTAMP)
FROM "rankedActiveComparisons" AS "ranked"
WHERE "comparison"."id" = "ranked"."id"
  AND "ranked"."rowNumber" > 1;

UPDATE "ExternalDocumentVersion" AS "version"
SET "status" = 'failed'
FROM "ExternalDocumentComparison" AS "comparison"
WHERE "version"."id" = "comparison"."candidateVersionId"
  AND "version"."status" = 'pending'
  AND "comparison"."errorMessage" = '并发活动任务已由数据库迁移关闭，请重新上传该候选版本';

CREATE UNIQUE INDEX "ExternalDocumentComparison_one_active_per_document"
ON "ExternalDocumentComparison" ("documentId")
WHERE "status" IN ('comparing', 'review');

-- 明确记录摘要/分类究竟由模型生成还是由确定性规则降级生成，
-- 避免仅凭 aiModel 误判为 AI 调用成功。
ALTER TABLE "ExternalDocumentComparison"
ADD COLUMN "aiGenerationMode" TEXT,
ADD COLUMN "aiWarning" TEXT;

UPDATE "ExternalDocumentComparison"
SET
  "aiGenerationMode" = CASE
    WHEN COALESCE("aiProvider", '') = ''
      OR COALESCE("aiProvider", '') LIKE '%fallback%'
      OR COALESCE("aiProvider", '') LIKE '%local-diff%'
      THEN 'fallback'
    ELSE 'ai'
  END,
  "aiWarning" = CASE
    WHEN COALESCE("aiProvider", '') = ''
      THEN '历史任务缺少可验证的 AI 生成来源'
    WHEN COALESCE("aiProvider", '') LIKE '%fallback%' OR COALESCE("aiProvider", '') LIKE '%local-diff%'
      THEN '历史任务使用了确定性规则降级结果'
    ELSE NULL
  END
WHERE "aiGenerationMode" IS NULL;
