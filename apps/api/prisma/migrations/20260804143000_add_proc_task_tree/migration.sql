CREATE TABLE "ProcTaskTreeNode" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "spec" TEXT,
    "materialId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcTaskTreeNode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProcTaskTreeNode_parentId_sortOrder_idx" ON "ProcTaskTreeNode"("parentId", "sortOrder");
CREATE INDEX "ProcTaskTreeNode_materialId_idx" ON "ProcTaskTreeNode"("materialId");

ALTER TABLE "ProcTaskTreeNode"
ADD CONSTRAINT "ProcTaskTreeNode_parentId_fkey"
FOREIGN KEY ("parentId") REFERENCES "ProcTaskTreeNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProcTaskTreeNode"
ADD CONSTRAINT "ProcTaskTreeNode_materialId_fkey"
FOREIGN KEY ("materialId") REFERENCES "ProcMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;
