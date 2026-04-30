import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Response } from 'express';

import { PrismaService } from '../../prisma/prisma.service';
import { SecureConfigService } from '../security/secure-config.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';

const SYSTEM_PROMPT =
  '你是 MateChat，INOGI 智能办公助手。帮助用户处理文档整理、邮件起草、项目跟踪、业务分析等办公事务。' +
  '使用简洁专业的中文回答，除非用户要求使用其他语言。回答尽量结构清晰，重点突出。';

const RAG_PROMPT_PREFIX =
  '以下是从系统数据库中检索到的相关信息，请优先基于这些信息回答，信息不足时再结合通用知识：\n\n';

const CONV_SELECT = {
  id: true,
  title: true,
  summary: true,
  pinned: true,
  updatedAt: true,
  _count: { select: { messages: true } },
} as const;

@Injectable()
export class ChatService {
  private readonly openaiApiKey: string | null;
  private readonly openaiBaseUrl: string | null;
  private readonly qwenApiKey: string | null;
  private readonly qwenBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly secureConfigService: SecureConfigService,
  ) {
    this.openaiApiKey = this.config.get<string>('OPENAI_API_KEY') ?? null;
    this.openaiBaseUrl =
      this.config.get<string>('OPENAI_BASE_URL')?.trim().replace(/\/$/, '') ?? null;
    this.qwenApiKey =
      this.config.get<string>('DASHSCOPE_API_KEY') ??
      this.config.get<string>('QWEN_API_KEY') ??
      null;
    this.qwenBaseUrl =
      this.config.get<string>('DASHSCOPE_BASE_URL')?.trim().replace(/\/$/, '') ??
      'https://dashscope.aliyuncs.com/compatible-mode/v1';
  }

  // ── Conversations ────────────────────────────────────────────────────────────

  listConversations(userId: string) {
    return this.prisma.chatConversation.findMany({
      where: { userId },
      orderBy: [{ pinned: 'desc' }, { updatedAt: 'desc' }],
      select: CONV_SELECT,
    });
  }

  async createConversation(userId: string, dto: CreateConversationDto) {
    return this.prisma.chatConversation.create({
      data: { userId, title: dto.title?.trim() || '新对话', summary: '' },
      select: CONV_SELECT,
    });
  }

  async updateConversation(id: string, userId: string, dto: UpdateConversationDto) {
    await this.assertOwner(id, userId);
    return this.prisma.chatConversation.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() || '新对话' } : {}),
        ...(dto.pinned !== undefined ? { pinned: dto.pinned } : {}),
      },
      select: CONV_SELECT,
    });
  }

  async deleteConversation(id: string, userId: string) {
    await this.assertOwner(id, userId);
    await this.prisma.chatConversation.delete({ where: { id } });
    return { ok: true };
  }

  // ── Messages ─────────────────────────────────────────────────────────────────

  async getMessages(conversationId: string, userId: string) {
    await this.assertOwner(conversationId, userId);
    return this.prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, model: true, reaction: true, createdAt: true },
    });
  }

  async updateReaction(messageId: string, userId: string, reaction: string | null) {
    const msg = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { conversation: { select: { userId: true } } },
    });
    if (!msg) throw new NotFoundException('消息不存在');
    if (msg.conversation.userId !== userId) throw new ForbiddenException();
    return this.prisma.chatMessage.update({
      where: { id: messageId },
      data: { reaction },
      select: { id: true, reaction: true },
    });
  }

  async deleteMessage(messageId: string, userId: string) {
    const msg = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { conversation: { select: { userId: true } } },
    });
    if (!msg) throw new NotFoundException('消息不存在');
    if (msg.conversation.userId !== userId) throw new ForbiddenException();
    await this.prisma.chatMessage.delete({ where: { id: messageId } });
    return { ok: true };
  }

  // ── Models ───────────────────────────────────────────────────────────────────

  async listModels() {
    const configuredModels = await this.prisma.integrationConfig.findMany({
      where: { kind: 'openai', isActive: true },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
    });

    return configuredModels
      .map((config) => {
        const metadata = this.parseAiModelMetadata(config.metadata);
        const hasApiKey = Boolean(this.decryptSecret(config.encryptedSecret));
        return {
          id: config.id,
          label: config.name,
          provider: config.provider ?? 'openai',
          model: config.model ?? '',
          isDefault: metadata.is_default_enabled,
          ready: hasApiKey,
        };
      })
      .filter((item) => item.model && item.ready)
      .sort((left, right) => Number(right.isDefault) - Number(left.isDefault));
  }

  // ── Streaming ────────────────────────────────────────────────────────────────

  async streamMessage(
    conversationId: string,
    dto: SendMessageDto,
    userId: string,
    res: Response,
  ) {
    const conv = await this.prisma.chatConversation.findUnique({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: 'asc' }, take: 40 } },
    });
    if (!conv) throw new NotFoundException('会话不存在');
    if (conv.userId !== userId) throw new ForbiddenException();

    // Save user message
    const userMsg = await this.prisma.chatMessage.create({
      data: { conversationId, role: 'user', content: dto.content },
    });

    // Auto-set title from first user message
    const isFirstUserMsg = !conv.messages.some((m) => m.role === 'user');
    if (isFirstUserMsg) {
      await this.prisma.chatConversation.update({
        where: { id: conversationId },
        data: { title: dto.content.slice(0, 30) || '新对话', summary: dto.content.slice(0, 60) },
      });
    }

    // SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const send = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    send({ type: 'userMessage', messageId: userMsg.id });

    const selectedConfig = await this.resolveModelConfig(dto.model);
    if (!selectedConfig) {
      send({ type: 'error', message: '未配置可用 AI 模型，请先在 AI 模型管理中新增并启用模型' });
      res.end();
      return;
    }

    const model = selectedConfig.model;
    const isQwen = /qwen|tongyi|dashscope|dashscope|阿里|通义/i.test(
      `${selectedConfig.provider} ${model}`,
    );
    const apiKey =
      selectedConfig.apiKey ||
      (isQwen ? (this.qwenApiKey ?? this.openaiApiKey) : this.openaiApiKey);

    if (!apiKey) {
      send({ type: 'error', message: 'AI 模型未配置 API Key，请先在 AI 模型管理中配置并启用模型' });
      res.end();
      return;
    }

    const baseURL =
      selectedConfig.baseUrl || (isQwen ? this.qwenBaseUrl : (this.openaiBaseUrl ?? undefined));
    const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });

    const history = conv.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // ── RAG：先搜本地数据库，命中则作为上下文 ─────────────────────────────
    const dbContext = await this.searchDatabase(dto.content);
    const systemContent = dbContext
      ? `${SYSTEM_PROMPT}\n\n${RAG_PROMPT_PREFIX}${dbContext}`
      : SYSTEM_PROMPT;

    send({ type: 'context', fromDb: Boolean(dbContext) });

    let fullContent = '';
    try {
      const stream = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemContent },
          ...history,
          { role: 'user', content: dto.content },
        ],
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        if (delta) {
          fullContent += delta;
          send({ type: 'delta', delta });
        }
      }

      const assistantMsg = await this.prisma.chatMessage.create({
        data: { conversationId, role: 'assistant', content: fullContent, model },
      });

      await this.prisma.chatConversation.update({
        where: { id: conversationId },
        data: {
          summary: fullContent.slice(0, 60),
          updatedAt: new Date(),
          ...(isFirstUserMsg ? {} : {}),
        },
      });

      send({ type: 'done', messageId: assistantMsg.id, title: isFirstUserMsg ? dto.content.slice(0, 30) : undefined });
    } catch (err) {
      send({ type: 'error', message: err instanceof Error ? err.message : 'AI 调用失败' });
    } finally {
      res.end();
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private async assertOwner(conversationId: string, userId: string) {
    const conv = await this.prisma.chatConversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });
    if (!conv) throw new NotFoundException('会话不存在');
    if (conv.userId !== userId) throw new ForbiddenException();
  }

  private async resolveModelConfig(modelId?: string) {
    const trimmedModelId = modelId?.trim();
    const where = { kind: 'openai', isActive: true };

    const config = trimmedModelId
      ? await this.prisma.integrationConfig.findFirst({
          where: {
            ...where,
            OR: [{ id: trimmedModelId }, { model: trimmedModelId }],
          },
          orderBy: { updatedAt: 'desc' },
        })
      : await this.resolveDefaultModelConfig();

    if (!config) {
      return null;
    }

    const metadata = this.parseAiModelMetadata(config.metadata);
    return {
      id: config.id,
      provider: config.provider ?? 'openai',
      model: config.model ?? '',
      baseUrl: metadata.base_url || undefined,
      apiKey: this.decryptSecret(config.encryptedSecret),
    };
  }

  private async resolveDefaultModelConfig() {
    const configs = await this.prisma.integrationConfig.findMany({
      where: { kind: 'openai', isActive: true },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
    });

    return (
      configs.find((config) => this.parseAiModelMetadata(config.metadata).is_default_enabled) ??
      configs[0] ??
      null
    );
  }

  private parseAiModelMetadata(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { base_url: '', is_default_enabled: false };
    }

    const parsed = value as Record<string, unknown>;
    return {
      base_url: typeof parsed.base_url === 'string' ? parsed.base_url.trim() : '',
      is_default_enabled:
        typeof parsed.is_default_enabled === 'boolean' ? parsed.is_default_enabled : false,
    };
  }

  private decryptSecret(value: string) {
    try {
      return this.secureConfigService.decryptFromStorage(value);
    } catch {
      return '';
    }
  }

  // ── RAG：从系统数据库检索相关信息 ─────────────────────────────────────────

  private async searchDatabase(query: string): Promise<string> {
    // 提取长度≥2的有效关键词，最多取前6个
    const keywords = [...new Set(
      query
        .split(/[\s,，。、？！,.?!\r\n]+/)
        .map((k) => k.trim())
        .filter((k) => k.length >= 2),
    )].slice(0, 6);

    if (keywords.length === 0) return '';

    const orCondition = <T extends Record<string, unknown>>(fields: (keyof T)[]) =>
      keywords.flatMap((k) =>
        fields.map((f) => ({ [f]: { contains: k, mode: 'insensitive' as const } })),
      );

    const sections: string[] = [];

    // 1. 候选人
    try {
      const candidates = await this.prisma.candidate.findMany({
        where: { OR: orCondition(['name', 'recentTitle', 'recentCompany', 'targetJob']) },
        select: {
          name: true,
          recentTitle: true,
          recentCompany: true,
          targetJob: true,
          yearsExperience: true,
          education: true,
          city: true,
          status: true,
        },
        take: 6,
      });
      if (candidates.length > 0) {
        sections.push('【候选人信息】');
        candidates.forEach((c) => {
          sections.push(
            `- ${c.name}｜${c.recentTitle}@${c.recentCompany}｜${c.yearsExperience}年经验` +
            `｜学历：${c.education}｜城市：${c.city}｜状态：${c.status}｜目标岗位：${c.targetJob}`,
          );
        });
      }
    } catch { /* ignore */ }

    // 2. 招聘岗位（JobRule）
    try {
      const jobs = await this.prisma.jobRule.findMany({
        where: {
          enabled: true,
          OR: orCondition(['name', 'jdText']),
        },
        select: { name: true, jdText: true },
        take: 3,
      });
      if (jobs.length > 0) {
        sections.push('【招聘岗位信息】');
        jobs.forEach((j) => {
          sections.push(`- 岗位：${j.name}\n  描述：${j.jdText.slice(0, 300)}`);
        });
      }
    } catch { /* ignore */ }

    // 3. 字典数据（部门、分类等）
    try {
      const dictItems = await this.prisma.systemSetting.findMany({
        where: {
          category: 'dictionary_item',
          OR: keywords.map((k) => ({ key: { contains: k, mode: 'insensitive' as const } })),
        },
        select: { key: true, value: true },
        take: 10,
      });
      if (dictItems.length > 0) {
        sections.push('【字典数据】');
        dictItems.forEach((item) => {
          const val = typeof item.value === 'object' ? JSON.stringify(item.value) : String(item.value);
          sections.push(`- ${item.key}：${val.slice(0, 120)}`);
        });
      }
    } catch { /* ignore */ }

    // 4. 用户/部门基本信息
    try {
      const users = await this.prisma.user.findMany({
        where: {
          OR: orCondition(['name', 'department']),
          status: 'ACTIVE',
        },
        select: { name: true, department: true, role: { select: { name: true } } },
        take: 6,
      });
      if (users.length > 0) {
        sections.push('【用户信息】');
        users.forEach((u) => {
          sections.push(`- ${u.name}｜部门：${u.department ?? '未分配'}｜角色：${u.role?.name ?? '无'}`);
        });
      }
    } catch { /* ignore */ }

    return sections.join('\n');
  }
}
