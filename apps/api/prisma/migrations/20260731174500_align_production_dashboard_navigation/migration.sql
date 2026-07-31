-- 将生产驾驶舱并入系统现有的“质量与生产”分组。
-- 单独保留纠正迁移，即使上一版迁移已在某个环境执行，也能安全收敛到正确目录。
UPDATE "PermissionCatalogItem"
SET "label" = '生产驾驶舱',
    "description" = '生产部门全局进度、人员负载热力图、批量重分配（高级权限）',
    "groupLabel" = '页面访问 · 质量与生产',
    "routePath" = '/production-dashboard',
    "navHidden" = false,
    "sortOrder" = 590,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'page:rd-director-dashboard';
