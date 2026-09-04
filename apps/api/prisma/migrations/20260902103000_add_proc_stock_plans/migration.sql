-- CreateTable
CREATE TABLE "ProcStockPlan" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "materialId" TEXT,
    "materialName" TEXT NOT NULL,
    "spec" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "targetQty" DECIMAL(14,3) NOT NULL,
    "targetDate" TIMESTAMP(3),
    "note" TEXT,
    "createdBy" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcStockPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcStockPlanBatch" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL,
    "purchaseQty" DECIMAL(14,3) NOT NULL,
    "purchaseOrderNo" TEXT,
    "orderDate" TIMESTAMP(3),
    "expectedArrivalDate" TIMESTAMP(3),
    "note" TEXT,
    "createdBy" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcStockPlanBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProcStockPlan_code_key" ON "ProcStockPlan"("code");

-- CreateIndex
CREATE INDEX "ProcStockPlan_materialId_idx" ON "ProcStockPlan"("materialId");

-- CreateIndex
CREATE INDEX "ProcStockPlan_updatedAt_idx" ON "ProcStockPlan"("updatedAt");

-- CreateIndex
CREATE INDEX "ProcStockPlanBatch_planId_createdAt_idx" ON "ProcStockPlanBatch"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "ProcStockPlanBatch_supplierId_idx" ON "ProcStockPlanBatch"("supplierId");

-- AddForeignKey
ALTER TABLE "ProcStockPlan" ADD CONSTRAINT "ProcStockPlan_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "ProcMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcStockPlanBatch" ADD CONSTRAINT "ProcStockPlanBatch_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ProcStockPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcStockPlanBatch" ADD CONSTRAINT "ProcStockPlanBatch_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "ProcSupplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
