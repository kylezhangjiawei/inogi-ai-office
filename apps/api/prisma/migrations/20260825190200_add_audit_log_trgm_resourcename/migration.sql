-- 关键字搜索的 trigram 索引：任务标题/立项名等资源名称。
-- 与 20260825190100 同批，CONCURRENTLY 不能与其它语句同事务，故一条一个文件。
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AuditLog_resourceName_gin_trgm_idx" ON "AuditLog" USING gin ("resourceName" gin_trgm_ops);
