import { Module } from '@nestjs/common';

import { ChatModule } from '../chat/chat.module';
import { RagModule } from '../rag/rag.module';
import { IssueController } from './issue.controller';
import { IssueService } from './issue.service';

/**
 * 问题记录与 AI 定位（issue-ai）。
 * 复用 ChatModule 导出的 ChatService（模型列表 + complete 结构化分析）
 * 与 ChatAttachmentService（附件解析/图片多模态/文档抽取）；
 * RagModule 的 RagService 用于「查相似」向量检索与可复用问题索引。
 */
@Module({
  imports: [ChatModule, RagModule],
  controllers: [IssueController],
  providers: [IssueService],
})
export class IssueModule {}
