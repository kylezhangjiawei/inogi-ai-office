-- AlterTable: 采购任务显式归属的子系统节点。为空时回落到按 materialId / 物料名推导，
-- 存量任务不受影响；手工移动过归类的任务写死在此，不再随物料变化漂移。
ALTER TABLE "ProcTask" ADD COLUMN     "treeNodeId" TEXT;

-- AddForeignKey: 节点被删除时任务不删，只解除归属，退回推导逻辑
ALTER TABLE "ProcTask" ADD CONSTRAINT "ProcTask_treeNodeId_fkey" FOREIGN KEY ("treeNodeId") REFERENCES "ProcTaskTreeNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 查询任务树时按节点聚合，加索引避免全表扫描
CREATE INDEX "ProcTask_treeNodeId_idx" ON "ProcTask"("treeNodeId");
