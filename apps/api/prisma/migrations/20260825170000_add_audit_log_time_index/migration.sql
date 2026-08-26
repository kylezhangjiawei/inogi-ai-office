-- 留痕页默认视图（不选模块）按时间倒序翻页，但既有复合索引的首列分别是
-- resource / module / userId，都用不上，查询退化成全表排序。补一条纯时间序索引。
CREATE INDEX "AuditLog_createdAt_id_idx" ON "AuditLog"("createdAt", "id");
