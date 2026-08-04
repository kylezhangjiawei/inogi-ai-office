ALTER TABLE "ProcTaskTreeNode"
ADD COLUMN "productId" TEXT NOT NULL DEFAULT 'prod-portable-o2';

ALTER TABLE "ProcTask"
ADD COLUMN "productId" TEXT NOT NULL DEFAULT 'prod-portable-o2';

CREATE INDEX "ProcTaskTreeNode_productId_parentId_sortOrder_idx"
ON "ProcTaskTreeNode"("productId", "parentId", "sortOrder");

CREATE INDEX "ProcTask_productId_status_idx"
ON "ProcTask"("productId", "status");
