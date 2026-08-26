-- 抹掉存量留痕里的明文凭据。
--
-- AuditInterceptor 一直把请求体整体写进 AuditLog.meta 且没有脱敏，实测本地库 auth 模块
-- 481 条记录里，477 条 refresh 存了明文 refreshToken、7 条 login 存了 encryptedPassword、
-- 1 条存了 appSecret。刷新令牌是 bearer 凭据，拿到即可换访问令牌 —— 落在留痕表里
-- 等于多了一份可离线利用的副本（备份、只读库、任意一处注入都能取到）。
--
-- 代码侧已在同批修复（拦截器落库前脱敏）；这条迁移处理已经写进去的存量。
-- 做「原地抹值」而不是删行：审计记录本身要留着，只是不该留凭据。
--
-- ⚠️ 这些令牌应视为已泄露。是否连带清空 RefreshToken 表强制全员重新登录，
--    是业务决定，本迁移不做 —— 那会把所有在线用户踢下线。
--
-- 匹配规则与 audit.interceptor.ts 的 SENSITIVE_EXACT_KEYS / SENSITIVE_KEY_PARTS 一致：
-- token 类只认确切键名，否则会误伤 AI 用量里的 totalTokens / inputTokens 这类**计数**字段
-- （实测存量里有 55 条），把正常审计数据抹掉。

CREATE OR REPLACE FUNCTION pg_temp.redact_audit_meta(input jsonb, depth int DEFAULT 0)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN depth >= 6 OR input IS NULL THEN input
    WHEN jsonb_typeof(input) = 'object' THEN COALESCE((
      SELECT jsonb_object_agg(
        e.key,
        CASE
          WHEN lower(e.key) IN ('token','accesstoken','refreshtoken','idtoken','access_token',
                                'refresh_token','id_token','bearertoken','authorization',
                                'credential','credentials','cookie')
            OR lower(e.key) ~ '(password|passwd|secret|apikey|api_key|privatekey|private_key)'
          THEN '"[redacted]"'::jsonb
          ELSE pg_temp.redact_audit_meta(e.value, depth + 1)
        END
      )
      FROM jsonb_each(input) e
    ), '{}'::jsonb)
    WHEN jsonb_typeof(input) = 'array' THEN COALESCE((
      SELECT jsonb_agg(pg_temp.redact_audit_meta(v, depth + 1)) FROM jsonb_array_elements(input) v
    ), '[]'::jsonb)
    ELSE input
  END
$$;

UPDATE "AuditLog"
SET meta = pg_temp.redact_audit_meta(meta)
WHERE jsonb_typeof(meta) IN ('object', 'array')
  AND meta::text ~* '"[^"]*(password|passwd|secret|apikey|api_key|privatekey|private_key|token|authorization|credential|cookie)[^"]*"\s*:';

DO $$
DECLARE leaked bigint;
BEGIN
  -- 只统计真正的凭据键，token 计数字段不算
  SELECT count(*) INTO leaked FROM "AuditLog" a, jsonb_each(a.meta) e
  WHERE jsonb_typeof(a.meta) = 'object'
    AND e.value <> '"[redacted]"'::jsonb
    AND (lower(e.key) IN ('token','accesstoken','refreshtoken','idtoken','access_token',
                          'refresh_token','id_token','bearertoken','authorization',
                          'credential','credentials','cookie')
         OR lower(e.key) ~ '(password|passwd|secret|apikey|api_key|privatekey|private_key)');
  IF leaked > 0 THEN
    RAISE EXCEPTION '仍有 % 条留痕的顶层字段存着未脱敏的凭据', leaked;
  END IF;
  RAISE NOTICE '[留痕脱敏] 存量凭据已抹除';
END $$;
