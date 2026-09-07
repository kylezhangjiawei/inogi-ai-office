-- AlterTable
ALTER TABLE "ProcTask" ADD COLUMN     "stockPlanId" TEXT;

-- AlterTable
ALTER TABLE "ProcStockPlan" ADD COLUMN     "planType" TEXT NOT NULL DEFAULT 'material',
ADD COLUMN     "productId" TEXT,
ADD COLUMN     "productLine" TEXT,
ADD COLUMN     "productionTaskId" TEXT,
ADD COLUMN     "treeNodeId" TEXT;

-- AlterTable
ALTER TABLE "ProcStockPlanBatch" ADD COLUMN     "actualArrivalDate" TIMESTAMP(3),
ADD COLUMN     "purchaseOrderMirrorId" TEXT,
ADD COLUMN     "qualifiedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
ADD COLUMN     "receivedQty" DECIMAL(14,3) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ProcProductionReport" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "treeNodeId" TEXT NOT NULL,
    "stockPlanId" TEXT,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "shift" TEXT NOT NULL DEFAULT '',
    "lineName" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '套',
    "plannedQty" DECIMAL(14,3) NOT NULL,
    "actualQty" DECIMAL(14,3) NOT NULL,
    "goodQty" DECIMAL(14,3) NOT NULL,
    "workHours" DECIMAL(10,2) NOT NULL,
    "capacityQty" DECIMAL(14,3),
    "note" TEXT,
    "createdBy" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "updatedBy" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcProductionReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcQualityRecord" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "treeNodeId" TEXT NOT NULL,
    "stockPlanId" TEXT,
    "taskId" TEXT,
    "materialId" TEXT,
    "supplierId" TEXT,
    "productionReportId" TEXT,
    "source" TEXT NOT NULL,
    "batchNo" TEXT NOT NULL DEFAULT '',
    "inspectionDate" TIMESTAMP(3) NOT NULL,
    "unit" TEXT NOT NULL DEFAULT '套',
    "inspectedQty" DECIMAL(14,3) NOT NULL,
    "defectiveQty" DECIMAL(14,3) NOT NULL,
    "issue" TEXT NOT NULL,
    "disposition" TEXT NOT NULL DEFAULT 'pending',
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdByName" TEXT NOT NULL DEFAULT '',
    "updatedBy" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcQualityRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcProductionReport_productId_treeNodeId_reportDate_idx" ON "ProcProductionReport"("productId", "treeNodeId", "reportDate");

-- CreateIndex
CREATE INDEX "ProcProductionReport_stockPlanId_reportDate_idx" ON "ProcProductionReport"("stockPlanId", "reportDate");

-- CreateIndex
CREATE INDEX "ProcQualityRecord_productId_treeNodeId_inspectionDate_idx" ON "ProcQualityRecord"("productId", "treeNodeId", "inspectionDate");

-- CreateIndex
CREATE INDEX "ProcQualityRecord_stockPlanId_inspectionDate_idx" ON "ProcQualityRecord"("stockPlanId", "inspectionDate");

-- CreateIndex
CREATE INDEX "ProcQualityRecord_productionReportId_idx" ON "ProcQualityRecord"("productionReportId");

-- CreateIndex
CREATE INDEX "ProcQualityRecord_source_status_idx" ON "ProcQualityRecord"("source", "status");

-- CreateIndex
CREATE INDEX "ProcQualityRecord_taskId_idx" ON "ProcQualityRecord"("taskId");

-- CreateIndex
CREATE INDEX "ProcTask_stockPlanId_idx" ON "ProcTask"("stockPlanId");

-- CreateIndex
CREATE INDEX "ProcStockPlan_productId_treeNodeId_idx" ON "ProcStockPlan"("productId", "treeNodeId");

-- CreateIndex
CREATE INDEX "ProcStockPlan_planType_targetDate_idx" ON "ProcStockPlan"("planType", "targetDate");

-- CreateIndex
CREATE UNIQUE INDEX "ProcStockPlanBatch_purchaseOrderMirrorId_key" ON "ProcStockPlanBatch"("purchaseOrderMirrorId");

-- AddForeignKey
ALTER TABLE "ProcTask" ADD CONSTRAINT "ProcTask_stockPlanId_fkey" FOREIGN KEY ("stockPlanId") REFERENCES "ProcStockPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcStockPlan" ADD CONSTRAINT "ProcStockPlan_treeNodeId_fkey" FOREIGN KEY ("treeNodeId") REFERENCES "ProcTaskTreeNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcStockPlanBatch" ADD CONSTRAINT "ProcStockPlanBatch_purchaseOrderMirrorId_fkey" FOREIGN KEY ("purchaseOrderMirrorId") REFERENCES "ProcPurchaseOrderMirror"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcProductionReport" ADD CONSTRAINT "ProcProductionReport_treeNodeId_fkey" FOREIGN KEY ("treeNodeId") REFERENCES "ProcTaskTreeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcProductionReport" ADD CONSTRAINT "ProcProductionReport_stockPlanId_fkey" FOREIGN KEY ("stockPlanId") REFERENCES "ProcStockPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcQualityRecord" ADD CONSTRAINT "ProcQualityRecord_treeNodeId_fkey" FOREIGN KEY ("treeNodeId") REFERENCES "ProcTaskTreeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcQualityRecord" ADD CONSTRAINT "ProcQualityRecord_stockPlanId_fkey" FOREIGN KEY ("stockPlanId") REFERENCES "ProcStockPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcQualityRecord" ADD CONSTRAINT "ProcQualityRecord_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProcTask"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcQualityRecord" ADD CONSTRAINT "ProcQualityRecord_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "ProcMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcQualityRecord" ADD CONSTRAINT "ProcQualityRecord_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "ProcSupplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcQualityRecord" ADD CONSTRAINT "ProcQualityRecord_productionReportId_fkey" FOREIGN KEY ("productionReportId") REFERENCES "ProcProductionReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
