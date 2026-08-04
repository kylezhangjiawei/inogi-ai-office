-- 企微日报只有迟到/早退异常，没有「公司安排少做、后续补回」这一业务事实。
-- 旧逻辑曾把迟到+早退分钟自动复制到倒挂扣时，导致同一段异常时间重复进入倒挂欠账。
-- 企微导入记录从未支持人工填写倒挂扣时，因此可安全清零；手工记录保持不变。
UPDATE "EmployeeAttendance"
SET "deductionMinutes" = 0,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "source" = 'wecom_import'
  AND "deductionMinutes" <> 0;
