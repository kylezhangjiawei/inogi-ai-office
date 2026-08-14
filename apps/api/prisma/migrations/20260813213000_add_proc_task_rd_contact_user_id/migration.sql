-- 研发对接人必须按稳定账号标识投递审核消息，姓名字段仅保留作展示和存量兼容。
ALTER TABLE "ProcTask" ADD COLUMN "rdContactUserId" TEXT;

CREATE INDEX "ProcTask_rdContactUserId_idx" ON "ProcTask"("rdContactUserId");
