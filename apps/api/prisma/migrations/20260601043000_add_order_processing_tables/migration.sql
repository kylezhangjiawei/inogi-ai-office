-- Production tables for the order-processing and inventory module.
CREATE TABLE "OrderProcessingOrder" (
  "id" TEXT NOT NULL,
  "customer" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "shipDate" TIMESTAMP(3) NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'upload',
  "generated" BOOLEAN NOT NULL DEFAULT false,
  "invoiceExported" BOOLEAN NOT NULL DEFAULT false,
  "originalFileName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderProcessingOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderProcessingOrderProduct" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "spec" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "orderQty" INTEGER NOT NULL,
  "stockQty" INTEGER NOT NULL,
  "orderPrice" DECIMAL(12,2) NOT NULL,
  "sysPrice" DECIMAL(12,2) NOT NULL,
  "subtotal" DECIMAL(14,2) NOT NULL,
  "status" TEXT NOT NULL,
  "remark" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderProcessingOrderProduct_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderProcessingInvoice" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "invoiceNo" TEXT NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "generatedAt" TIMESTAMP(3),
  "exportedAt" TIMESTAMP(3),
  "templateId" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderProcessingInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderProcessingInventoryItem" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "spec" TEXT NOT NULL,
  "stock" INTEGER NOT NULL,
  "safe" INTEGER NOT NULL,
  "inboundPending" INTEGER NOT NULL DEFAULT 0,
  "outboundPending" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderProcessingInventoryItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderProcessingStockMovement" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "itemName" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "qty" INTEGER NOT NULL,
  "operator" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "relatedOrderId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderProcessingStockMovement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderProcessingInvoiceTemplate" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "accentColor" TEXT,
  "config" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderProcessingInvoiceTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrderProcessingSetting" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderProcessingSetting_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "OrderProcessingOrderProduct_orderId_sku_key" ON "OrderProcessingOrderProduct"("orderId", "sku");
CREATE UNIQUE INDEX "OrderProcessingInvoice_orderId_key" ON "OrderProcessingInvoice"("orderId");
CREATE UNIQUE INDEX "OrderProcessingInvoice_invoiceNo_key" ON "OrderProcessingInvoice"("invoiceNo");

CREATE INDEX "OrderProcessingOrder_source_createdAt_idx" ON "OrderProcessingOrder"("source", "createdAt");
CREATE INDEX "OrderProcessingOrder_status_createdAt_idx" ON "OrderProcessingOrder"("status", "createdAt");
CREATE INDEX "OrderProcessingOrder_shipDate_idx" ON "OrderProcessingOrder"("shipDate");
CREATE INDEX "OrderProcessingOrderProduct_sku_idx" ON "OrderProcessingOrderProduct"("sku");
CREATE INDEX "OrderProcessingOrderProduct_status_idx" ON "OrderProcessingOrderProduct"("status");
CREATE INDEX "OrderProcessingInvoice_generatedAt_idx" ON "OrderProcessingInvoice"("generatedAt");
CREATE INDEX "OrderProcessingInvoice_exportedAt_idx" ON "OrderProcessingInvoice"("exportedAt");
CREATE INDEX "OrderProcessingInventoryItem_sortOrder_idx" ON "OrderProcessingInventoryItem"("sortOrder");
CREATE INDEX "OrderProcessingInventoryItem_category_idx" ON "OrderProcessingInventoryItem"("category");
CREATE INDEX "OrderProcessingInventoryItem_status_idx" ON "OrderProcessingInventoryItem"("status");
CREATE INDEX "OrderProcessingStockMovement_itemId_createdAt_idx" ON "OrderProcessingStockMovement"("itemId", "createdAt");
CREATE INDEX "OrderProcessingStockMovement_type_createdAt_idx" ON "OrderProcessingStockMovement"("type", "createdAt");
CREATE INDEX "OrderProcessingStockMovement_relatedOrderId_idx" ON "OrderProcessingStockMovement"("relatedOrderId");
CREATE INDEX "OrderProcessingInvoiceTemplate_source_createdAt_idx" ON "OrderProcessingInvoiceTemplate"("source", "createdAt");

ALTER TABLE "OrderProcessingOrderProduct"
  ADD CONSTRAINT "OrderProcessingOrderProduct_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "OrderProcessingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderProcessingInvoice"
  ADD CONSTRAINT "OrderProcessingInvoice_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "OrderProcessingOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrderProcessingStockMovement"
  ADD CONSTRAINT "OrderProcessingStockMovement_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "OrderProcessingInventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
