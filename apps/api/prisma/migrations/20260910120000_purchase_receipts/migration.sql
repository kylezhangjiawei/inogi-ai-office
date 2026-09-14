-- Local receipt and inspection evidence only. ERP orders, task quantities, and stock stay unchanged.
CREATE TABLE "ProcPurchaseReceipt" (
  "id" TEXT NOT NULL,
  "lineId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "deliveryNo" TEXT NOT NULL,
  "receivedDate" DATE NOT NULL,
  "receivedQty" DECIMAL(14,3) NOT NULL,
  "note" TEXT NOT NULL DEFAULT '',
  "sourceOrderId" TEXT NOT NULL,
  "sourceOrderNo" TEXT NOT NULL,
  "sourceLineNo" TEXT NOT NULL,
  "sourceInventoryCode" TEXT NOT NULL,
  "sourceInventoryName" TEXT NOT NULL,
  "sourceSpec" TEXT NOT NULL,
  "sourceUnit" TEXT NOT NULL,
  "sourceSupplierName" TEXT NOT NULL,
  "sourceOrderedQty" DECIMAL(14,3) NOT NULL,
  "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT NOT NULL,
  "createdByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcPurchaseReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProcPurchaseReceipt_quantity_check" CHECK ("receivedQty" > 0),
  CONSTRAINT "ProcPurchaseReceipt_version_check" CHECK ("version" >= 0),
  CONSTRAINT "ProcPurchaseReceipt_delivery_check" CHECK (length(trim("deliveryNo")) > 0)
);
CREATE UNIQUE INDEX "ProcPurchaseReceipt_requestId_key" ON "ProcPurchaseReceipt"("requestId");
CREATE UNIQUE INDEX "ProcPurchaseReceipt_lineId_deliveryNo_key" ON "ProcPurchaseReceipt"("lineId", "deliveryNo");
CREATE INDEX "ProcPurchaseReceipt_lineId_receivedDate_createdAt_idx" ON "ProcPurchaseReceipt"("lineId", "receivedDate", "createdAt");
ALTER TABLE "ProcPurchaseReceipt" ADD CONSTRAINT "ProcPurchaseReceipt_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ProcPurchaseOrderMirror"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ProcPurchaseReceiptInspection" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "inspectionDate" DATE NOT NULL,
  "qualifiedQty" DECIMAL(14,3) NOT NULL,
  "defectiveQty" DECIMAL(14,3) NOT NULL,
  "pendingJudgmentQty" DECIMAL(14,3) NOT NULL,
  "basis" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdByName" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcPurchaseReceiptInspection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProcPurchaseReceiptInspection_version_check" CHECK ("version" > 0),
  CONSTRAINT "ProcPurchaseReceiptInspection_quantity_check" CHECK ("qualifiedQty" >= 0 AND "defectiveQty" >= 0 AND "pendingJudgmentQty" >= 0),
  CONSTRAINT "ProcPurchaseReceiptInspection_evidence_check" CHECK (length(trim("basis")) > 0 AND length(trim("note")) > 0)
);
CREATE UNIQUE INDEX "ProcPurchaseReceiptInspection_requestId_key" ON "ProcPurchaseReceiptInspection"("requestId");
CREATE UNIQUE INDEX "ProcPurchaseReceiptInspection_receiptId_version_key" ON "ProcPurchaseReceiptInspection"("receiptId", "version");
ALTER TABLE "ProcPurchaseReceiptInspection" ADD CONSTRAINT "ProcPurchaseReceiptInspection_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "ProcPurchaseReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
