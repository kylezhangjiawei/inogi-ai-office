CREATE TABLE IF NOT EXISTS "OrderProcessingInvoiceProfile" (
  "id" TEXT NOT NULL,
  "companyName" TEXT NOT NULL,
  "taxNo" TEXT NOT NULL DEFAULT '',
  "address" TEXT NOT NULL DEFAULT '',
  "phone" TEXT NOT NULL DEFAULT '',
  "email" TEXT NOT NULL DEFAULT '',
  "bankName" TEXT NOT NULL DEFAULT '',
  "bankAccount" TEXT NOT NULL DEFAULT '',
  "swiftCode" TEXT NOT NULL DEFAULT '',
  "bankAddress" TEXT NOT NULL DEFAULT '',
  "contactName" TEXT NOT NULL DEFAULT '',
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OrderProcessingInvoiceProfile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OrderProcessingInvoiceProfile_isDefault_createdAt_idx"
  ON "OrderProcessingInvoiceProfile"("isDefault", "createdAt");

CREATE INDEX IF NOT EXISTS "OrderProcessingInvoiceProfile_companyName_idx"
  ON "OrderProcessingInvoiceProfile"("companyName");
