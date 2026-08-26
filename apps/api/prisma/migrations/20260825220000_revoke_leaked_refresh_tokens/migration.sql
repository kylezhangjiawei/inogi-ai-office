-- 作废全部刷新令牌：它们曾以明文存在留痕表里，必须视为已泄露。
--
-- 背景（见 20260825210000）：AuditInterceptor 把请求体整体写进 AuditLog.meta 且未脱敏，
-- /auth/refresh 的请求体里就是刷新令牌本体，477 条记录长期明文留存。
-- 上一条迁移已把留痕里的值抹掉，但**令牌本身仍然有效** —— 凡是接触过这张表、
-- 只读副本或任何一份历史备份的人，手上都可能有一份可用的凭据。
--
-- 刷新令牌是 bearer 凭据：拿到即可换取访问令牌，且不需要口令。因此仅仅抹掉留痕不够，
-- 令牌必须一并作废。
--
-- 影响：所有人需要重新登录一次。
-- - 访问令牌 TTL 15 分钟，作废后最多 15 分钟内陆续掉线；
-- - 前端 authSession 在刷新失败时会 clearAuthSession() 跳登录页，不会卡死；
-- - 迁移只跑一次，不会反复踢人。
--
-- ⚠️ 本迁移覆盖不到历史数据库备份：那些备份里的留痕仍是明文令牌。
--    但令牌在此作废后，那些副本已不再能用于换取访问令牌。

DELETE FROM "RefreshToken";

DO $$
DECLARE remaining bigint;
BEGIN
  SELECT count(*) INTO remaining FROM "RefreshToken";
  IF remaining > 0 THEN
    RAISE EXCEPTION '仍有 % 条刷新令牌未作废', remaining;
  END IF;
  RAISE NOTICE '[凭据轮换] 刷新令牌已全部作废，用户需重新登录一次';
END $$;
