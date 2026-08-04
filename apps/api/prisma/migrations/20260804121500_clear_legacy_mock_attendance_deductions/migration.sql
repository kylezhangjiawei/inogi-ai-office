-- 演示数据也曾按旧规则把迟到/早退分钟复制为倒挂扣时。
-- Mock 不是人工审核数据，可直接清零，避免本地演示继续展示已废弃口径。
UPDATE "EmployeeAttendance"
SET "deductionMinutes" = 0,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "source" = 'mock'
  AND "deductionMinutes" <> 0;
