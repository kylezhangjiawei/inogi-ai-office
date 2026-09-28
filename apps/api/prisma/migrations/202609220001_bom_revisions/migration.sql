-- Additive only: no historical binding, publication or stock changes.
ALTER TABLE "ProcBomNode" ADD COLUMN "productRootId" TEXT;
ALTER TABLE "ProcBomNode" ADD CONSTRAINT "ProcBomNode_productRootId_fkey" FOREIGN KEY ("productRootId") REFERENCES "ProcTaskTreeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "ProcBomRevision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "deviceId" TEXT NOT NULL,
  "productRootId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "publishedById" TEXT NOT NULL,
  "publishedByName" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reason" TEXT NOT NULL,
  "retiredAt" TIMESTAMP(3),
  "retiredById" TEXT,
  "retiredByName" TEXT,
  "retiredReason" TEXT,
  CONSTRAINT "ProcBomRevision_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "ProcBomNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProcBomRevision_productRootId_fkey" FOREIGN KEY ("productRootId") REFERENCES "ProcTaskTreeNode"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProcBomRevision_deviceId_version_key" ON "ProcBomRevision"("deviceId", "version");
CREATE UNIQUE INDEX "ProcBomRevision_requestId_key" ON "ProcBomRevision"("requestId");
CREATE INDEX "ProcBomRevision_productRootId_idx" ON "ProcBomRevision"("productRootId");
ALTER TABLE "ProcStockPlan" ADD COLUMN "bomRevisionId" TEXT, ADD COLUMN "bomBasis" JSONB;
ALTER TABLE "ProcStockPlan" ADD CONSTRAINT "ProcStockPlan_bomRevisionId_fkey" FOREIGN KEY ("bomRevisionId") REFERENCES "ProcBomRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
