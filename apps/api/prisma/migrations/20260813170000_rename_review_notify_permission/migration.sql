-- 把 rd-review:notify 改名为 rd-task:review-notify。
--
-- 原因是界面归类，不是逻辑问题：角色管理页把操作码挂到哪个页面下，靠的是
-- 「命名空间 token ∩ 页面码 token」算分（RoleManagement.actionPageScore，≥180 分才归到页面）。
--   rd-task:edit          → 命名空间 rd-task   → 与 page:rd-task-management 全匹配（200）→ 挂在「研发任务驾驶舱」下
--   rd-review:notify      → 命名空间 rd-review → 只匹配上 rd（100）→ 掉进「模块公共功能权限」
-- 管理员在「研发任务驾驶舱」里找不到这个勾选项，等于配不了。改名后与同组操作码一致。
--
-- 上一条迁移（20260813150000）已授予旧码，不能回头改它（校验和已记录），故用改名补齐。
-- 全新库按顺序执行两条迁移，终态与存量库一致。

-- 角色权限数组里的旧码换成新码；jsonb_agg(DISTINCT ...) 顺带去重，
-- 避免个别角色同时存有新旧两个码时改出重复项。
UPDATE "Role"
SET permissions = (
      SELECT jsonb_agg(DISTINCT swapped.code)
      FROM jsonb_array_elements_text("Role".permissions) AS original(code),
           LATERAL (
             SELECT CASE WHEN original.code = 'rd-review:notify'
                         THEN 'rd-task:review-notify'
                         ELSE original.code END AS code
           ) AS swapped
    )
WHERE permissions @> '["rd-review:notify"]'::jsonb;

-- 目录里的旧条目删掉，否则角色管理页会同时列出新旧两个「接收审核通知」勾选项。
-- 新条目由服务启动时的 ensureDefaults 自动补种，无需在此插入。
DELETE FROM "PermissionCatalogItem" WHERE code = 'rd-review:notify';

DO $$
DECLARE stale bigint; renamed bigint;
BEGIN
  SELECT count(*) INTO stale   FROM "Role" WHERE permissions @> '["rd-review:notify"]'::jsonb;
  SELECT count(*) INTO renamed FROM "Role" WHERE permissions @> '["rd-task:review-notify"]'::jsonb;
  IF stale > 0 THEN
    RAISE EXCEPTION '仍有 % 个角色残留旧码 rd-review:notify', stale;
  END IF;
  RAISE NOTICE '[rd-task:review-notify] 改名完成，持有该码的角色数：%', renamed;
END $$;
