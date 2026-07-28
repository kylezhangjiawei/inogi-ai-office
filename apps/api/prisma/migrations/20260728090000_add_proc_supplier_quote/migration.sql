-- CreateTable
CREATE TABLE "ProcSupplierQuote" (
    "id" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT NOT NULL,
    "supplierModel" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "taxIncluded" BOOLEAN NOT NULL DEFAULT true,
    "leadTimeDays" INTEGER NOT NULL DEFAULT 0,
    "tiers" JSONB NOT NULL DEFAULT '[]',
    "quoteDate" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcSupplierQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcSupplierQuote_supplierId_idx" ON "ProcSupplierQuote"("supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcSupplierQuote_materialId_supplierName_key" ON "ProcSupplierQuote"("materialId", "supplierName");

-- AddForeignKey
ALTER TABLE "ProcSupplierQuote" ADD CONSTRAINT "ProcSupplierQuote_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "ProcMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcSupplierQuote" ADD CONSTRAINT "ProcSupplierQuote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "ProcSupplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
