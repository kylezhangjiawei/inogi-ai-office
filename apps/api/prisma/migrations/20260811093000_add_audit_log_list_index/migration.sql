CREATE INDEX CONCURRENTLY "AuditLog_resource_createdAt_id_idx"
ON "AuditLog"("resource", "createdAt", "id");
