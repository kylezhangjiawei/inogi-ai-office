-- 只迁移仍使用内置旧名称的目录项，保留管理员已经自定义过的标签。
UPDATE "PermissionCatalogItem"
SET
  label = CASE code
    WHEN 'page:proc-cockpit' THEN '供应链任务驾驶舱'
    WHEN 'page:proc-my-workspace' THEN '供应链个人工作台'
    WHEN 'page:proc-materials' THEN '供应链物料库'
    ELSE label
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE (code = 'page:proc-cockpit' AND label = '采购任务驾驶舱')
   OR (code = 'page:proc-my-workspace' AND label = '采购个人工作台')
   OR (code = 'page:proc-materials' AND label = '采购物料库');

UPDATE "PermissionCatalogItem"
SET
  "groupLabel" = CASE "groupLabel"
    WHEN '页面访问 · 采购管理' THEN '页面访问 · 供应链管理'
    WHEN '操作权限 · 采购管理' THEN '操作权限 · 供应链管理'
    ELSE "groupLabel"
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "groupLabel" IN ('页面访问 · 采购管理', '操作权限 · 采购管理');
