-- 留痕关键字搜索用的 trigram 扩展。索引本体在紧随其后的几条迁移里单独建：
-- CREATE INDEX CONCURRENTLY 不能跑在事务里，而 Prisma 会把多语句迁移包进事务，
-- 因此每条 CONCURRENTLY 必须独占一个迁移文件。
CREATE EXTENSION IF NOT EXISTS pg_trgm;
