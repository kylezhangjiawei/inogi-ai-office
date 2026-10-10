-- 自助建立备货任务单；不授予 ERP 订单写入或采购审批权限。
UPDATE "Role"
SET permissions = permissions || '["proc-task:create"]'::jsonb
WHERE name IN ('采购人员', '采购管理员')
  AND jsonb_typeof(permissions) = 'array'
  AND NOT permissions @> '["proc-task:create"]'::jsonb;
