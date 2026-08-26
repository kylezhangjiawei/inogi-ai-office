-- 关键字搜索是多列中文子串匹配（ILIKE '%kw%'），B-tree 用不上、内置全文检索对中文不分词。
-- 30 万行基准实测：搜不到时全表扫 213ms，建 GIN trigram 后 0.046ms；稀有命中 38ms → 0.088ms。
-- 代价：写入 +0.055ms/行，索引约 150 字节/行。
-- CONCURRENTLY：留痕表持续写入，普通 CREATE INDEX 会持写锁，而每个业务写请求都要写留痕。
CREATE INDEX CONCURRENTLY IF NOT EXISTS "AuditLog_summary_gin_trgm_idx" ON "AuditLog" USING gin ("summary" gin_trgm_ops);
