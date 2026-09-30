BEGIN;

-- 保留全部报价与历史；同一物料/供应商档案存在重复时交由业务核对。
LOCK TABLE "ProcSupplierQuote" IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "ProcSupplierQuote"
    WHERE "supplierId" IS NOT NULL
    GROUP BY "materialId", "supplierId" HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION '同一物料和供应商档案存在重复现行报价，请核对后重试；迁移未删除任何报价';
  END IF;
END $$;

CREATE UNIQUE INDEX "ProcSupplierQuote_materialId_supplierId_key"
  ON "ProcSupplierQuote"("materialId", "supplierId");
CREATE INDEX "ProcSupplierQuote_materialId_supplierName_idx"
  ON "ProcSupplierQuote"("materialId", "supplierName");
DROP INDEX "ProcSupplierQuote_materialId_supplierName_key";

COMMIT;
