-- 任务级报价汇总：最终总价 = 报价小计 - 折扣金额
ALTER TABLE "ProcTask"
ADD COLUMN "quotationSubtotal" DECIMAL(20,4),
ADD COLUMN "quotationDiscount" DECIMAL(20,4),
ADD COLUMN "quotationTotal" DECIMAL(20,4),
ADD COLUMN "quotationCurrency" TEXT;

-- 已确认报价逐条保存实际采购数量和行金额
ALTER TABLE "ProcQuotation"
ADD COLUMN "quantity" DECIMAL(14,3),
ADD COLUMN "lineTotal" DECIMAL(20,4);
