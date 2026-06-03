-- Harden order-processing for production use:
-- - keep duplicate SKU lines in a single purchase order
-- - persist stock-in document context for audit
-- - use a DB-backed invoice counter instead of count-based numbering
-- - store parser/source metadata on uploaded orders

DROP INDEX IF EXISTS "OrderProcessingOrderProduct_orderId_sku_key";
CREATE INDEX IF NOT EXISTS "OrderProcessingOrderProduct_orderId_sku_idx" ON "OrderProcessingOrderProduct"("orderId", "sku");

ALTER TABLE "OrderProcessingOrder"
  ADD COLUMN IF NOT EXISTS "metadata" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "OrderProcessingStockMovement"
  ADD COLUMN IF NOT EXISTS "documentNo" TEXT,
  ADD COLUMN IF NOT EXISTS "warehouse" TEXT,
  ADD COLUMN IF NOT EXISTS "supplier" TEXT,
  ADD COLUMN IF NOT EXISTS "businessDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "metadata" JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS "OrderProcessingStockMovement_businessDate_idx" ON "OrderProcessingStockMovement"("businessDate");

CREATE TABLE IF NOT EXISTS "OrderProcessingInvoiceCounter" (
  "year" INTEGER NOT NULL,
  "nextValue" INTEGER NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OrderProcessingInvoiceCounter_pkey" PRIMARY KEY ("year")
);

INSERT INTO "OrderProcessingInvoiceCounter" ("year", "nextValue", "updatedAt")
SELECT parsed.year, COALESCE(MAX(parsed.seq), 0), CURRENT_TIMESTAMP
FROM (
  SELECT
    CAST(SUBSTRING("invoiceNo" FROM '^CI([0-9]{4})-') AS INTEGER) AS year,
    CAST(SUBSTRING("invoiceNo" FROM '-([0-9]+)$') AS INTEGER) AS seq
  FROM "OrderProcessingInvoice"
  WHERE "invoiceNo" ~ '^CI[0-9]{4}-[0-9]+$'
) parsed
WHERE parsed.year IS NOT NULL
GROUP BY parsed.year
ON CONFLICT ("year") DO UPDATE SET
  "nextValue" = GREATEST("OrderProcessingInvoiceCounter"."nextValue", EXCLUDED."nextValue"),
  "updatedAt" = CURRENT_TIMESTAMP;
