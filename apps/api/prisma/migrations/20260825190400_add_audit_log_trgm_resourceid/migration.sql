-- 关键字搜索的 trigram 索引：任务号等业务编码。
-- 与 20260825190100 同批，CONCURRENTLY 不能与其它语句同事务，故一条一个文件。
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AuditLog_resourceId_gin_trgm_idx" ON "AuditLog" USING gin ("resourceId" gin_trgm_ops);
