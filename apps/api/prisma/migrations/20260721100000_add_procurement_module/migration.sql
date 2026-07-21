-- CreateTable
CREATE TABLE "ProcBomNode" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "level" INTEGER NOT NULL DEFAULT 0,
    "productLine" TEXT NOT NULL DEFAULT '',
    "materialId" TEXT,
    "qtyPer" DECIMAL(14,4),
    "remark" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcBomNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcMaterial" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "productLine" TEXT NOT NULL DEFAULT '',
    "erpCode" TEXT NOT NULL DEFAULT '',
    "tpInventoryCode" TEXT,
    "isSpecial" BOOLEAN NOT NULL DEFAULT false,
    "isConsumable" BOOLEAN NOT NULL DEFAULT false,
    "safeStock" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reviewStatus" TEXT NOT NULL DEFAULT 'pending',
    "reviewSource" TEXT,
    "reviewNote" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "latestPrice" DECIMAL(12,4),
    "latestSupplier" TEXT,
    "latestQuoteDate" TIMESTAMP(3),
    "remark" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcTask" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "materialId" TEXT,
    "materialName" TEXT NOT NULL,
    "spec" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "method" TEXT NOT NULL DEFAULT 'inquiry',
    "purchaseLink" TEXT,
    "source" TEXT NOT NULL DEFAULT 'self',
    "businessLine" TEXT NOT NULL DEFAULT 'rd',
    "status" TEXT NOT NULL DEFAULT 'pending_inquiry',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "needSample" BOOLEAN NOT NULL DEFAULT false,
    "needDate" TIMESTAMP(3),
    "deadline" TIMESTAMP(3),
    "expectedArrivalDate" TIMESTAMP(3),
    "paymentDate" TIMESTAMP(3),
    "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
    "paymentNote" TEXT,
    "arrivedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "buyer" TEXT NOT NULL DEFAULT '',
    "buyerUserId" TEXT,
    "rdTaskId" TEXT,
    "rdTaskTitle" TEXT,
    "rdContact" TEXT,
    "requester" TEXT,
    "requesterUserId" TEXT,
    "requesterDept" TEXT,
    "consumableNote" TEXT,
    "selectedQuotationId" TEXT,
    "businessDone" BOOLEAN NOT NULL DEFAULT false,
    "cancelReason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcTaskAttachment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileKey" TEXT,
    "fileSize" INTEGER NOT NULL DEFAULT 0,
    "mimeType" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'drawing',
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcTaskAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcSupplier" (
    "id" TEXT NOT NULL,
    "tpCode" TEXT,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "contact" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'local',
    "syncedAt" TIMESTAMP(3),
    "remark" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcSupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcQuotation" (
    "id" TEXT NOT NULL,
    "taskId" TEXT,
    "materialId" TEXT,
    "materialName" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL,
    "unitPrice" DECIMAL(12,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
    "minOrderQty" DECIMAL(14,3),
    "quoteDate" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "channel" TEXT NOT NULL DEFAULT 'manual',
    "isSelected" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcQuotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcPurchaseOrderRef" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "tpOrderNo" TEXT NOT NULL,
    "tpOrderId" TEXT,
    "tpLineNo" TEXT,
    "supplierName" TEXT NOT NULL DEFAULT '',
    "orderedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "receivedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(12,4),
    "orderDate" TIMESTAMP(3),
    "etaDate" TIMESTAMP(3),
    "approvalStatus" TEXT,
    "status" TEXT,
    "linkedBy" TEXT,
    "syncedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcPurchaseOrderRef_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcInventoryBalance" (
    "id" TEXT NOT NULL,
    "tpInventoryCode" TEXT NOT NULL,
    "materialId" TEXT,
    "materialName" TEXT NOT NULL DEFAULT '',
    "spec" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "warehouse" TEXT NOT NULL DEFAULT '',
    "stockQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "availableQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "inTransitQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcInventoryBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcTaskLog" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'action',
    "text" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "actor" TEXT,
    "actorUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcTaskLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcBomNode_parentId_sortOrder_idx" ON "ProcBomNode"("parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "ProcBomNode_materialId_idx" ON "ProcBomNode"("materialId");

-- CreateIndex
CREATE INDEX "ProcBomNode_productLine_idx" ON "ProcBomNode"("productLine");

-- CreateIndex
CREATE UNIQUE INDEX "ProcMaterial_tpInventoryCode_key" ON "ProcMaterial"("tpInventoryCode");

-- CreateIndex
CREATE INDEX "ProcMaterial_name_idx" ON "ProcMaterial"("name");

-- CreateIndex
CREATE INDEX "ProcMaterial_category_idx" ON "ProcMaterial"("category");

-- CreateIndex
CREATE INDEX "ProcMaterial_productLine_idx" ON "ProcMaterial"("productLine");

-- CreateIndex
CREATE INDEX "ProcMaterial_reviewStatus_idx" ON "ProcMaterial"("reviewStatus");

-- CreateIndex
CREATE UNIQUE INDEX "ProcTask_code_key" ON "ProcTask"("code");

-- CreateIndex
CREATE INDEX "ProcTask_status_updatedAt_idx" ON "ProcTask"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "ProcTask_businessLine_status_idx" ON "ProcTask"("businessLine", "status");

-- CreateIndex
CREATE INDEX "ProcTask_materialId_idx" ON "ProcTask"("materialId");

-- CreateIndex
CREATE INDEX "ProcTask_rdTaskId_idx" ON "ProcTask"("rdTaskId");

-- CreateIndex
CREATE INDEX "ProcTask_buyerUserId_idx" ON "ProcTask"("buyerUserId");

-- CreateIndex
CREATE INDEX "ProcTask_needDate_idx" ON "ProcTask"("needDate");

-- CreateIndex
CREATE INDEX "ProcTaskAttachment_taskId_createdAt_idx" ON "ProcTaskAttachment"("taskId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProcSupplier_tpCode_key" ON "ProcSupplier"("tpCode");

-- CreateIndex
CREATE INDEX "ProcSupplier_name_idx" ON "ProcSupplier"("name");

-- CreateIndex
CREATE INDEX "ProcSupplier_source_idx" ON "ProcSupplier"("source");

-- CreateIndex
CREATE INDEX "ProcQuotation_materialId_quoteDate_idx" ON "ProcQuotation"("materialId", "quoteDate");

-- CreateIndex
CREATE INDEX "ProcQuotation_taskId_idx" ON "ProcQuotation"("taskId");

-- CreateIndex
CREATE INDEX "ProcQuotation_supplierId_idx" ON "ProcQuotation"("supplierId");

-- CreateIndex
CREATE INDEX "ProcPurchaseOrderRef_taskId_idx" ON "ProcPurchaseOrderRef"("taskId");

-- CreateIndex
CREATE INDEX "ProcPurchaseOrderRef_tpOrderNo_idx" ON "ProcPurchaseOrderRef"("tpOrderNo");

-- CreateIndex
CREATE INDEX "ProcInventoryBalance_materialId_idx" ON "ProcInventoryBalance"("materialId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcInventoryBalance_tpInventoryCode_warehouse_key" ON "ProcInventoryBalance"("tpInventoryCode", "warehouse");

-- CreateIndex
CREATE INDEX "ProcTaskLog_taskId_createdAt_idx" ON "ProcTaskLog"("taskId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProcBomNode" ADD CONSTRAINT "ProcBomNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProcBomNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcBomNode" ADD CONSTRAINT "ProcBomNode_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "ProcMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcTask" ADD CONSTRAINT "ProcTask_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "ProcMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcTaskAttachment" ADD CONSTRAINT "ProcTaskAttachment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProcTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcQuotation" ADD CONSTRAINT "ProcQuotation_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProcTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcQuotation" ADD CONSTRAINT "ProcQuotation_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "ProcMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcQuotation" ADD CONSTRAINT "ProcQuotation_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "ProcSupplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcPurchaseOrderRef" ADD CONSTRAINT "ProcPurchaseOrderRef_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProcTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcInventoryBalance" ADD CONSTRAINT "ProcInventoryBalance_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "ProcMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcTaskLog" ADD CONSTRAINT "ProcTaskLog_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProcTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

