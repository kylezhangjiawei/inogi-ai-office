-- CreateTable
CREATE TABLE "ProcPurchaseOrderMirror" (
    "id" TEXT NOT NULL,
    "tpOrderNo" TEXT NOT NULL,
    "tpOrderId" TEXT,
    "tpLineNo" TEXT NOT NULL DEFAULT '',
    "supplierName" TEXT NOT NULL DEFAULT '',
    "inventoryCode" TEXT NOT NULL DEFAULT '',
    "inventoryName" TEXT NOT NULL DEFAULT '',
    "spec" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "orderedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "receivedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(12,4),
    "orderDate" TIMESTAMP(3),
    "etaDate" TIMESTAMP(3),
    "approvalStatus" TEXT,
    "status" TEXT,
    "materialId" TEXT,
    "matchTaskId" TEXT,
    "matchStatus" TEXT NOT NULL DEFAULT 'unmatched',
    "matchConfidence" DECIMAL(4,3),
    "matchReason" TEXT,
    "syncedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcPurchaseOrderMirror_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcPurchaseOrderMirror_matchStatus_idx" ON "ProcPurchaseOrderMirror"("matchStatus");

-- CreateIndex
CREATE INDEX "ProcPurchaseOrderMirror_materialId_idx" ON "ProcPurchaseOrderMirror"("materialId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcPurchaseOrderMirror_tpOrderNo_tpLineNo_key" ON "ProcPurchaseOrderMirror"("tpOrderNo", "tpLineNo");
