-- 关键字搜索的 trigram 索引：操作人姓名快照（账号注销后仍要搜得到）。
-- 与 20260825190100 同批，CONCURRENTLY 不能与其它语句同事务，故一条一个文件。
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AuditLog_actorName_gin_trgm_idx" ON "AuditLog" USING gin ("actorName" gin_trgm_ops);
