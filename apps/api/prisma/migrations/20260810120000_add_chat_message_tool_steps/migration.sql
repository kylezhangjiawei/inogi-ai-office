-- AlterTable: assistant 消息的 ReAct 工具调用步骤。此前只走 SSE 推送、存在前端内存里，
-- 刷新后步骤条丢失，且「分享给同事」的越权确认因读不到步骤而被跳过。
-- 存量消息为 NULL，前端按空数组处理，不影响历史回放。
ALTER TABLE "ChatMessage" ADD COLUMN     "toolSteps" JSONB;
