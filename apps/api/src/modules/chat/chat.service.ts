import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { Response } from 'express';

import { PrismaService } from '../../prisma/prisma.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';

const SYSTEM_PROMPT =
  '你是 MateChat，INOGI 智能办公助手。帮助用户处理文档整理、邮件起草、项目跟踪、业务分析等办公事务。' +
  '使用简洁专业的中文回答，除非用户要求使用其他语言。回答尽量结构清晰，重点突出。';

const DEFAULT_MODEL = 'gpt-4.1-mini';

const OPENAI_MODELS = [
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', provider: 'openai' },
  { id: 'gpt-4.1', label: 'GPT-4.1', provider: 'openai' },
  { id: 'gpt-4o', label: 'GPT-4o', provider: 'openai' },
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', provider: 'openai' },
];

const QWEN_MODELS = [
  { id: 'qwen-turbo', label: 'Qwen Turbo', provider: 'qwen' },
  { id: 'qwen-plus', label: 'Qwen Plus', provider: 'qwen' },
  { id: 'qwen-max', label: 'Qwen Max', provider: 'qwen' },
];

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

  listModels() {
    return [
      ...(this.openaiApiKey ? OPENAI_MODELS : []),
      ...(this.qwenApiKey ? QWEN_MODELS : []),
    ];
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

    const model = dto.model?.trim() || DEFAULT_MODEL;
    const isQwen = /qwen|tongyi|dashscope/i.test(model);
    const apiKey = isQwen ? (this.qwenApiKey ?? this.openaiApiKey) : this.openaiApiKey;

    if (!apiKey) {
      send({ type: 'error', message: 'AI 服务未配置，请联系管理员配置 API Key' });
      res.end();
      return;
    }

    const baseURL = isQwen ? this.qwenBaseUrl : (this.openaiBaseUrl ?? undefined);
    const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });

    const history = conv.messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    let fullContent = '';
    try {
      const stream = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
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
}
