-- 操作留痕三合一：研发 / 中美协同 / 采购 各自的留痕页并成 /audit-log 一个页面。
--
-- 合并前有两套底座：
--   1) AuditLog 表 —— 全局 AuditInterceptor 无差别记录所有登录用户（含超级管理员）的写请求；
--   2) SystemSetting KV（rd.auditLogs / rdws.{workspace}.auditLogs）—— 业务语义留痕，
--      单键 JSON 数组、上限 1000 条滚动淘汰，且读-改-写整份数组天然有竞态。
-- 本迁移把 (2) 并入 (1)，此后语义留痕直接落表，KV 不再被写入。
--
-- KV 原数据保留不删：迁移后若发现字段映射有误，还能回到原始 JSON 重来。

-- ── 1. 统一字段 ──────────────────────────────────────────────────────────────
-- 全部带 IF NOT EXISTS：迁移失败后要能原地重跑，不该因为「列已存在」再炸一次。
ALTER TABLE "AuditLog"
  ADD COLUMN IF NOT EXISTS "module"       TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS "source"       TEXT NOT NULL DEFAULT 'api',
  ADD COLUMN IF NOT EXISTS "actorName"    TEXT,
  ADD COLUMN IF NOT EXISTS "resourceName" TEXT,
  ADD COLUMN IF NOT EXISTS "summary"      TEXT,
  ADD COLUMN IF NOT EXISTS "notes"        JSONB NOT NULL DEFAULT '[]';

-- ── 2. 存量 AuditLog 回填 ────────────────────────────────────────────────────
-- module 直接取 resource（拦截器写的就是 URL 首段），只把研发的段名归一到池名，
-- 与导入进来的语义留痕对齐，前端「模块」筛选才不会出现 rd 与 research-development 两项。
UPDATE "AuditLog"
SET "module" = CASE WHEN "resource" = 'research-development' THEN 'rd' ELSE "resource" END
WHERE "module" = 'other';

-- 姓名快照：user 关系在账号删除时被 SetNull，快照保证历史留痕仍追溯得到人
UPDATE "AuditLog" a
SET "actorName" = u."name"
FROM "User" u
WHERE a."userId" = u."id" AND a."actorName" IS NULL;

-- ── 3. 导入 KV 语义留痕 ──────────────────────────────────────────────────────
-- actor.id 有 100+ 条指向已删除账号，直接写进 userId 会撞 FK；
-- 这类记录 userId 置空、只留 actorName —— 留痕宁可少一个可点的人，也不能整条丢。
INSERT INTO "AuditLog" (
  "id", "userId", "action", "resource", "resourceId", "resourceName",
  "meta", "ip", "createdAt", "module", "source", "actorName", "summary", "notes"
)
-- DISTINCT ON：同一条留痕 id 可能在多个池的数组里各出现一次（历史上在池之间搬过数据）。
-- 原先只靠 ON CONFLICT DO NOTHING 兜着，留下的是哪一条取决于扫描顺序；这里显式去重，
-- 固定取 key 排序靠前的那份，结果可预期。
SELECT DISTINCT ON (e.log->>'id')
  e.log->>'id',
  u."id",
  COALESCE(NULLIF(e.log->>'action', ''), 'unknown'),
  COALESCE(NULLIF(e.log->'resource'->>'type', ''), 'system'),
  NULLIF(e.log->'resource'->>'id', ''),
  NULLIF(e.log->'resource'->>'name', ''),
  jsonb_strip_nulls(jsonb_build_object(
    'changes',  e.log->'changes',
    'metadata', e.log->'metadata',
    'actorRole', e.log->'actor'->>'role'
  )),
  NULL,
  COALESCE((e.log->>'timestamp')::timestamptz, now()),
  CASE s."key"
    WHEN 'rd.auditLogs' THEN 'rd'
    ELSE split_part(s."key", '.', 2)
  END,
  COALESCE(NULLIF(e.log->>'source', ''), 'web'),
  NULLIF(e.log->'actor'->>'name', ''),
  COALESCE(NULLIF(e.log->>'comment', ''), NULLIF(e.log->>'summary', '')),
  COALESCE(e.log->'notes', '[]'::jsonb)
FROM "SystemSetting" s
CROSS JOIN LATERAL jsonb_array_elements(s."value"::jsonb) AS e(log)
LEFT JOIN "User" u ON u."id" = e.log->'actor'->>'id'
WHERE s."key" IN ('rd.auditLogs', 'rdws.us-collab.auditLogs', 'rdws.production.auditLogs')
  AND jsonb_typeof(s."value"::jsonb) = 'array'
  AND COALESCE(NULLIF(e.log->>'id', ''), '') <> ''
ORDER BY e.log->>'id', s."key"
ON CONFLICT ("id") DO NOTHING;

-- ── 4. 索引 ─────────────────────────────────────────────────────────────────
-- 表量级在千行，普通 CREATE INDEX 的锁时间可忽略；不用 CONCURRENTLY 是为了
-- 让本迁移的 DDL + DML 能整体回滚，避免导入失败却留下半套索引。
CREATE INDEX IF NOT EXISTS "AuditLog_module_createdAt_id_idx" ON "AuditLog"("module", "createdAt", "id");
CREATE INDEX IF NOT EXISTS "AuditLog_userId_createdAt_idx"    ON "AuditLog"("userId", "createdAt");

-- ── 5. 权限三合一 ───────────────────────────────────────────────────────────
-- 三个页面码换成 page:audit-log。jsonb_agg(DISTINCT ...) 顺带去重，
-- 避免同时持有多个旧码的角色改出重复项。新目录条目由 ensureDefaults 启动时补种。
UPDATE "Role"
SET permissions = (
      SELECT jsonb_agg(DISTINCT swapped.code)
      FROM jsonb_array_elements_text("Role".permissions) AS original(code),
           LATERAL (
             SELECT CASE WHEN original.code IN ('page:rd-audit-log', 'page:us-collab-audit-log', 'page:proc-audit-log')
                         THEN 'page:audit-log'
                         ELSE original.code END AS code
           ) AS swapped
    )
WHERE permissions ?| array['page:rd-audit-log', 'page:us-collab-audit-log', 'page:proc-audit-log'];

DELETE FROM "PermissionCatalogItem"
WHERE code IN ('page:rd-audit-log', 'page:us-collab-audit-log', 'page:proc-audit-log');

-- ── 6. 断言 ─────────────────────────────────────────────────────────────────
DO $$
DECLARE stale bigint; migrated bigint; imported bigint; kv bigint;
BEGIN
  SELECT count(*) INTO stale FROM "Role"
    WHERE permissions ?| array['page:rd-audit-log', 'page:us-collab-audit-log', 'page:proc-audit-log'];
  IF stale > 0 THEN
    RAISE EXCEPTION '仍有 % 个角色残留旧留痕页面码', stale;
  END IF;

  -- 按**去重后**的 id 数比对：同一 id 在多个池里重复出现时只该导入一条，
  -- 那是正确行为不是数据丢失。此前按原始条数比，生产上 1117 条里有 2 个重复 id，
  -- 导入 1115 条即被判为失败，整条迁移回滚。
  SELECT count(DISTINCT e.log->>'id') INTO kv
    FROM "SystemSetting" s CROSS JOIN LATERAL jsonb_array_elements(s."value"::jsonb) AS e(log)
    WHERE s."key" IN ('rd.auditLogs', 'rdws.us-collab.auditLogs', 'rdws.production.auditLogs')
      AND jsonb_typeof(s."value"::jsonb) = 'array'
      AND COALESCE(NULLIF(e.log->>'id', ''), '') <> '';
  SELECT count(*) INTO imported FROM "AuditLog" WHERE "source" <> 'api';
  IF imported < kv THEN
    RAISE EXCEPTION 'KV 去重后 % 条语义留痕，实际导入 % 条，缺口 % 条', kv, imported, kv - imported;
  END IF;

  SELECT count(*) INTO migrated FROM "Role" WHERE permissions @> '["page:audit-log"]'::jsonb;
  RAISE NOTICE '[操作留痕合并] 导入语义留痕 % 条，持有 page:audit-log 的角色数：%', imported, migrated;
END $$;
