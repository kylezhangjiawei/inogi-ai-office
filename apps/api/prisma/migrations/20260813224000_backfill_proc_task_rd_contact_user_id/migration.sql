-- 对姓名能唯一命中的存量任务回填账号。存在同名时宁可保持为空，运行时仍走安全的唯一姓名兜底，
-- 不能猜测账号导致消息错投。独立增量迁移，避免修改已经在部分环境执行过的建列迁移。
WITH matched_contacts AS (
  SELECT task.id AS "taskId", MIN(account.id) AS "userId"
  FROM "ProcTask" task
  JOIN "User" account ON LOWER(TRIM(account.name)) = LOWER(TRIM(task."rdContact"))
  WHERE task."rdContact" IS NOT NULL
    AND TRIM(task."rdContact") <> ''
    AND account.status = 'ACTIVE'
  GROUP BY task.id
  HAVING COUNT(*) = 1
)
UPDATE "ProcTask" task
SET "rdContactUserId" = matched_contacts."userId"
FROM matched_contacts
WHERE task.id = matched_contacts."taskId"
  AND task."rdContactUserId" IS NULL;
