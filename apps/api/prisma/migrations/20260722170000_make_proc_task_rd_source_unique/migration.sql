-- A research task maps to at most one procurement task. PostgreSQL unique
-- indexes allow multiple NULL values, so procurement-created tasks are
-- unaffected while repeated/concurrent R&D transfers become idempotent.
DROP INDEX IF EXISTS "ProcTask_rdTaskId_idx";
CREATE UNIQUE INDEX "ProcTask_rdTaskId_key" ON "ProcTask"("rdTaskId");
