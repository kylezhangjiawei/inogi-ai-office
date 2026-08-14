-- 研发任务的转采购入口由 proc-task:transfer 单独守卫。
-- 新装环境由默认角色配置获得；存量角色需在升级时补齐，否则界面入口和接口都会被权限拦截。
UPDATE "Role"
SET permissions = permissions || '["proc-task:transfer"]'::jsonb
WHERE name IN ('研发人员', '研发管理员')
  AND NOT permissions @> '["proc-task:transfer"]'::jsonb;
