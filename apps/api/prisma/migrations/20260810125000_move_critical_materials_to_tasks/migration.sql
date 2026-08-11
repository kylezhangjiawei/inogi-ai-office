CREATE TABLE "ProcTaskCriticalMaterial" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "leadTimeDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcTaskCriticalMaterial_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProcTaskCriticalMaterial_taskId_materialId_key"
ON "ProcTaskCriticalMaterial"("taskId", "materialId");

CREATE INDEX "ProcTaskCriticalMaterial_taskId_sortOrder_idx"
ON "ProcTaskCriticalMaterial"("taskId", "sortOrder");

CREATE INDEX "ProcTaskCriticalMaterial_materialId_idx"
ON "ProcTaskCriticalMaterial"("materialId");

ALTER TABLE "ProcTaskCriticalMaterial"
ADD CONSTRAINT "ProcTaskCriticalMaterial_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "ProcTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProcTaskCriticalMaterial"
ADD CONSTRAINT "ProcTaskCriticalMaterial_materialId_fkey"
FOREIGN KEY ("materialId") REFERENCES "ProcMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Core/critical material selection is stored in ProcTaskCriticalMaterial and RuntimeState.
