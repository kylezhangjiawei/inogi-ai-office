CREATE TABLE "OrderProcessingPurchaseOrder" (
    "id" TEXT NOT NULL,
    "poNo" TEXT NOT NULL,
    "supplier" TEXT NOT NULL,
    "supplierContact" TEXT,
    "supplierPhone" TEXT,
    "supplierEmail" TEXT,
    "buyer" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "orderDate" TIMESTAMP(3) NOT NULL,
    "etaDate" TIMESTAMP(3) NOT NULL,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "warehouse" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "paymentTerm" TEXT,
    "deliveryTerm" TEXT,
    "invoiceType" TEXT,
    "approvalStatus" TEXT,
    "remark" TEXT,
    "sourceFile" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderProcessingPurchaseOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderProcessingPurchaseOrderLine" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "spec" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderProcessingPurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderProcessingPurchaseOrder_poNo_key" ON "OrderProcessingPurchaseOrder"("poNo");
CREATE INDEX "OrderProcessingPurchaseOrder_status_etaDate_idx" ON "OrderProcessingPurchaseOrder"("status", "etaDate");
CREATE INDEX "OrderProcessingPurchaseOrder_supplier_idx" ON "OrderProcessingPurchaseOrder"("supplier");
CREATE INDEX "OrderProcessingPurchaseOrder_orderDate_idx" ON "OrderProcessingPurchaseOrder"("orderDate");
CREATE INDEX "OrderProcessingPurchaseOrder_etaDate_idx" ON "OrderProcessingPurchaseOrder"("etaDate");
CREATE INDEX "OrderProcessingPurchaseOrderLine_purchaseOrderId_sortOrder_idx" ON "OrderProcessingPurchaseOrderLine"("purchaseOrderId", "sortOrder");
CREATE INDEX "OrderProcessingPurchaseOrderLine_sku_idx" ON "OrderProcessingPurchaseOrderLine"("sku");

ALTER TABLE "OrderProcessingPurchaseOrderLine"
    ADD CONSTRAINT "OrderProcessingPurchaseOrderLine_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "OrderProcessingPurchaseOrder"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
