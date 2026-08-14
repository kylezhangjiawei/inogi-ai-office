-- 新采购任务分配属于采购负责人待办，历史滚动发布期间产生的行统一归到 todo。
UPDATE "RdMessage"
SET "category" = 'todo'
WHERE "type" = 'procurement_assignment'
  AND "category" <> 'todo';
