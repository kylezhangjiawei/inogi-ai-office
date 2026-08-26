-- 移除 rd-audit:clear（清空操作留痕）。
--
-- 留痕能被一键清空，审计就失去意义：清空动作本身也不会有人来查。
-- 端点与页面入口已随留痕合并一并删除，这里把权限码从角色和目录里摘干净，
-- 否则角色管理页会一直挂着一个勾了也没用的选项。
--
-- 保留期改由 AuditRetentionCron 按 AUDIT_LOG_RETENTION_DAYS 定时清理超期记录，
-- 不再提供「立即清空全部」这种操作。

UPDATE "Role"
SET permissions = (
      SELECT COALESCE(jsonb_agg(code), '[]'::jsonb)
      FROM jsonb_array_elements_text("Role".permissions) AS t(code)
      WHERE code <> 'rd-audit:clear'
    )
WHERE permissions @> '["rd-audit:clear"]'::jsonb;

DELETE FROM "PermissionCatalogItem" WHERE code = 'rd-audit:clear';

DO $$
DECLARE stale bigint;
BEGIN
  SELECT count(*) INTO stale FROM "Role" WHERE permissions @> '["rd-audit:clear"]'::jsonb;
  IF stale > 0 THEN
    RAISE EXCEPTION '仍有 % 个角色残留 rd-audit:clear', stale;
  END IF;
  RAISE NOTICE '[rd-audit:clear] 已从角色与权限目录中移除';
END $$;
