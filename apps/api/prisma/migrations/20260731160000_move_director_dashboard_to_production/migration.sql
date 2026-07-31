-- 将原研发主管驾驶舱迁移为生产部门下的生产驾驶舱。
-- 保留历史权限码；前端同时保留旧路由跳转，避免已有角色授权、接口鉴权和收藏链接失效。
UPDATE "PermissionCatalogItem"
SET "label" = '生产驾驶舱',
    "description" = '生产部门全局进度、人员负载热力图、批量重分配（高级权限）',
    "groupLabel" = '页面访问 · 生产部门',
    "routePath" = '/production-dashboard',
    "navHidden" = false,
    "sortOrder" = 40,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'page:rd-director-dashboard';

UPDATE "PermissionCatalogItem"
SET "description" = '清空研发任务分类、个人工作台和生产驾驶舱数据',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "code" = 'rd-data:clear';
