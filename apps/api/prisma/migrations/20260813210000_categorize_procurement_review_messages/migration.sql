-- 转采购审核结果属于「结果」类消息。
-- 服务层会为新消息直接写 result；这里兜住滚动发布期间可能先写入的 notice 行。
UPDATE "RdMessage"
SET "category" = 'result'
WHERE "type" = 'procurement_review_result'
  AND "category" <> 'result';
