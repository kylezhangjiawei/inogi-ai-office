-- 研发转采购前置审核必须与普通研发编辑、采购确认权限解耦。
-- 存量“研发管理员”角色自动补齐；超级管理员的 * 无需重复写入。
UPDATE "Role"
SET permissions = permissions || '["rd-procurement:review"]'::jsonb
WHERE name = '研发管理员'
  AND NOT permissions @> '["rd-procurement:review"]'::jsonb;

INSERT INTO "PermissionCatalogItem" (
  id, code, label, description, "groupLabel", type, "routePath", enabled, "sortOrder", "createdAt", "updatedAt"
)
VALUES (
  'builtin-rd-procurement-review',
  'rd-procurement:review',
  '研发转采购审核',
  '研发管理员审核研发任务的转采购申请；通过后才流转并分配给采购人员',
  '操作权限 · 采购管理',
  'action',
  '',
  true,
  1615,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT (code) DO NOTHING;
