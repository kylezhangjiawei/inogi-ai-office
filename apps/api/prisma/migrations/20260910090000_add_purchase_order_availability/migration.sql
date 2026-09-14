-- Local human confirmation only. ERP order and inventory columns are unchanged.
CREATE TABLE "ProcPurchaseOrderAvailability" (
    "id" TEXT NOT NULL,
    "mirrorId" TEXT NOT NULL,
    "availableDate" DATE,
    "note" TEXT NOT NULL DEFAULT '',
    "confirmedById" TEXT NOT NULL,
    "confirmedByName" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "sourceFingerprint" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProcPurchaseOrderAvailability_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProcPurchaseOrderAvailability_version_check" CHECK ("version" > 0)
);
CREATE UNIQUE INDEX "ProcPurchaseOrderAvailability_mirrorId_key" ON "ProcPurchaseOrderAvailability"("mirrorId");
ALTER TABLE "ProcPurchaseOrderAvailability"
  ADD CONSTRAINT "ProcPurchaseOrderAvailability_mirrorId_fkey"
  FOREIGN KEY ("mirrorId") REFERENCES "ProcPurchaseOrderMirror"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
