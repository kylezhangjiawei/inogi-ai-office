-- No historical quantity migration and no automatic material mapping.
ALTER TABLE "OrderProcessingOrderProduct" ADD COLUMN "materialId" TEXT,
  ADD COLUMN "mappingEvidence" JSONB;
CREATE INDEX "OrderProcessingOrderProduct_materialId_idx" ON "OrderProcessingOrderProduct"("materialId");
ALTER TABLE "OrderProcessingOrderProduct" ADD CONSTRAINT "OrderProcessingOrderProduct_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "ProcMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;
