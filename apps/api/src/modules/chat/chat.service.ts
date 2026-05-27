import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
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
          usage_kind: metadata.usage_kind,
          isDefault: metadata.is_default_enabled,
          ready: hasApiKey,
        };
      })
      .filter((item) => item.model && item.ready && !this.isImageOnlyModel(item.model, item.usage_kind))
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
      return { base_url: '', is_default_enabled: false, usage_kind: 'auto' };
    }

    const parsed = value as Record<string, unknown>;
    return {
      base_url: typeof parsed.base_url === 'string' ? parsed.base_url.trim() : '',
      is_default_enabled:
        typeof parsed.is_default_enabled === 'boolean' ? parsed.is_default_enabled : false,
      usage_kind: typeof parsed.usage_kind === 'string' ? parsed.usage_kind : 'auto',
    };
  }

  /** 图片生成模型不支持对话，需要过滤掉 */
  private isImageOnlyModel(model: string, usageKind: string): boolean {
    if (usageKind === 'image') return true;
    if (usageKind !== 'auto') return false;
    const n = model.toLowerCase();
    return n.includes('gpt-image') || n.includes('image-to-image') || n === 'dall-e-2' || n.startsWith('dall-e-');
  }

  private decryptSecret(value: string) {
    try {
      return this.secureConfigService.decryptFromStorage(value);
    } catch {
      return '';
    }
  }

  // ── RAG：从系统所有业务表检索相关信息 ──────────────────────────────────────

  private async searchDatabase(query: string): Promise<string> {
    const ilike = (s: string) => ({ contains: s, mode: 'insensitive' as const });

    // 提取长度≥2的有效关键词（最多6个），同时保留原始问题用于意图判断
    const keywords = [...new Set(
      query.split(/[\s,，。、？！,.?!\r\n]+/).map((k) => k.trim()).filter((k) => k.length >= 2),
    )].slice(0, 6);

    if (keywords.length === 0) return '';

    // 判断问题是否与某个业务域相关（宽松匹配，只要命中一个关键词就搜）
    const hits = (words: string[]) => keywords.some((k) => words.some((w) => k.includes(w) || w.includes(k)));

    const sections: string[] = [];
    const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase());
    const textMatches = (value: unknown) => {
      const text = String(value ?? '').toLowerCase();
      return normalizedKeywords.some((keyword) => text.includes(keyword));
    };

    // ── 1. 部门（Department 表，权威来源）────────────────────────────────────
    try {
      const deptKeywords = ['部门', '组织', '架构', '科室', '团队', '分公司', '子公司', 'department'];
      const isGeneral = hits(deptKeywords);

      // 按名称/编码/负责人匹配，或用户问的是泛义"部门"时列出全部
      const depts = await this.prisma.department.findMany({
        where: isGeneral
          ? { enabled: true }
          : {
              enabled: true,
              OR: keywords.flatMap((k) => [
                { name: ilike(k) }, { code: ilike(k) }, { manager: ilike(k) }, { category: ilike(k) },
              ]),
            },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        take: 50,
      });
      if (depts.length > 0) {
        sections.push(`【部门列表】共 ${depts.length} 个`);
        depts.forEach((d) => {
          sections.push(
            `- ${d.name}（编码：${d.code}，类别：${d.category}，负责人：${d.manager || '未设置'}）`,
          );
        });
      }
    } catch { /* ignore */ }

    // ── 2. 用户 / 员工 ────────────────────────────────────────────────────────
    try {
      const userKeywords = ['用户', '员工', '人员', '成员', '账号', '账户', 'user', '姓名'];
      const isGeneral = hits(userKeywords);

      const users = await this.prisma.user.findMany({
        where: {
          status: 'ACTIVE',
          ...(isGeneral ? {} : {
            OR: keywords.flatMap((k) => [
              { name: ilike(k) }, { department: ilike(k) }, { email: ilike(k) },
            ]),
          }),
        },
        select: { name: true, department: true, email: true, role: { select: { name: true } } },
        orderBy: { name: 'asc' },
        take: 20,
      });
      if (users.length > 0) {
        sections.push(`【用户信息】共 ${users.length} 名活跃用户`);
        users.forEach((u) => {
          sections.push(`- ${u.name}｜部门：${u.department ?? '未分配'}｜角色：${u.role?.name ?? '无'}｜邮箱：${u.email}`);
        });
      }
    } catch { /* ignore */ }

    // ── 3. 角色与权限 ─────────────────────────────────────────────────────────
    try {
      const roleKeywords = ['角色', '权限', '管理员', 'role', '职责'];
      if (hits(roleKeywords) || keywords.some((k) => ['角色', '权限', 'role'].includes(k))) {
        const roles = await this.prisma.role.findMany({
          select: { name: true, description: true },
          orderBy: { name: 'asc' },
        });
        if (roles.length > 0) {
          sections.push(`【系统角色】共 ${roles.length} 个`);
          roles.forEach((r) => {
            sections.push(`- ${r.name}${r.description ? `：${r.description}` : ''}`);
          });
        }
      }
    } catch { /* ignore */ }

    // ── 4. 招聘岗位（JobRule）────────────────────────────────────────────────
    try {
      const jobKeywords = ['岗位', '招聘', 'JD', '职位', '职务', '招人', 'job'];
      const isGeneral = hits(jobKeywords);

      const jobs = await this.prisma.jobRule.findMany({
        where: isGeneral
          ? { enabled: true }
          : { enabled: true, OR: keywords.flatMap((k) => [{ name: ilike(k) }, { jdText: ilike(k) }]) },
        select: { name: true, jdText: true },
        take: 5,
      });
      if (jobs.length > 0) {
        sections.push(`【招聘岗位】共 ${jobs.length} 个`);
        jobs.forEach((j) => {
          sections.push(`- ${j.name}\n  要求摘要：${j.jdText.slice(0, 200)}`);
        });
      }
    } catch { /* ignore */ }

    // ── 5. 候选人 ─────────────────────────────────────────────────────────────
    try {
      const candidateKeywords = ['候选人', '简历', '应聘', '投递', '求职', 'candidate'];
      const isGeneral = hits(candidateKeywords);

      const candidates = await this.prisma.candidate.findMany({
        where: isGeneral
          ? {}
          : {
              OR: keywords.flatMap((k) => [
                { name: ilike(k) }, { recentTitle: ilike(k) },
                { recentCompany: ilike(k) }, { targetJob: ilike(k) }, { city: ilike(k) },
              ]),
            },
        select: {
          name: true, recentTitle: true, recentCompany: true,
          yearsExperience: true, education: true, city: true, status: true, targetJob: true,
        },
        take: 8,
      });
      if (candidates.length > 0) {
        sections.push(`【候选人信息】共 ${candidates.length} 条匹配`);
        candidates.forEach((c) => {
          sections.push(
            `- ${c.name}｜${c.recentTitle}@${c.recentCompany}｜${c.yearsExperience}年经验` +
            `｜学历：${c.education}｜城市：${c.city}｜状态：${c.status}｜目标：${c.targetJob}`,
          );
        });
      }
    } catch { /* ignore */ }

    // ── 6. AI 模型集成配置 ────────────────────────────────────────────────────
    try {
      const modelKeywords = ['模型', 'AI', '千问', 'GPT', 'openai', '通义', '集成', '配置'];
      if (hits(modelKeywords)) {
        const configs = await this.prisma.integrationConfig.findMany({
          where: { kind: 'openai', isActive: true },
          select: { name: true, provider: true, model: true },
          orderBy: { name: 'asc' },
        });
        if (configs.length > 0) {
          sections.push(`【已配置 AI 模型】共 ${configs.length} 个`);
          configs.forEach((c) => {
            sections.push(`- ${c.name}（${c.provider ?? ''}，模型：${c.model ?? ''}）`);
          });
        }
      }
    } catch { /* ignore */ }

    // ── 7. 字典数据 ───────────────────────────────────────────────────────────
    // value JSON 结构：类型 = {label, key, kind, ...}，条目 = {type_id, label, code, ...}
    try {
      const allTypes = await this.prisma.systemSetting.findMany({
        where: { category: 'dictionary_type' },
        select: { id: true, value: true },
      });

      const matchedTypes = allTypes.filter((t) => {
        const v = t.value as Record<string, unknown>;
        const label = typeof v.label === 'string' ? v.label : '';
        const key = typeof v.key === 'string' ? v.key : '';
        return keywords.some(
          (k) => label.toLowerCase().includes(k.toLowerCase()) || key.toLowerCase().includes(k.toLowerCase()),
        );
      });

      for (const type of matchedTypes) {
        const typeLabel = ((type.value as Record<string, unknown>).label as string) ?? type.id;
        const itemRows = await this.prisma.$queryRaw<Array<{ value: string }>>(
          Prisma.sql`
            SELECT value::text AS value FROM "SystemSetting"
            WHERE category = 'dictionary_item'
            AND value::jsonb->>'type_id' = ${type.id}
            ORDER BY key LIMIT 100
          `,
        );
        const labels = itemRows
          .map((r) => { try { return ((JSON.parse(r.value) as Record<string, unknown>).label as string) ?? ''; } catch { return ''; } })
          .filter(Boolean);
        if (labels.length > 0) {
          sections.push(`【字典·${typeLabel}】共 ${labels.length} 条：${labels.join('、')}`);
        }
      }
    } catch { /* ignore */ }

    // ── 8. 研发任务 / 研发人员 / 知识库（SystemSetting JSON 数据）──────────────
    try {
      const rdKeywords = ['研发', '任务', '项目', '进度', '负责人', '知识库', '里程碑', 'rd'];
      const isGeneral = hits(rdKeywords);
      if (isGeneral) {
        const stores = await this.prisma.systemSetting.findMany({
          where: { key: { in: ['rd.taskCategories', 'rd.people', 'rd.knowledgeEntries'] } },
          select: { key: true, value: true },
        });
        const byKey = new Map(stores.map((row) => [row.key, row.value as unknown]));
        const asRecord = (value: unknown): Record<string, unknown> =>
          value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
        const asArray = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
        const clean = (value: unknown) => String(value ?? '').trim();

        const taskRows: Array<{
          title: string;
          owner: string;
          status: string;
          progress: string;
          due: string;
          path: string;
        }> = [];
        const collectTasks = (tasks: unknown[], path: string) => {
          for (const rawTask of tasks) {
            const task = asRecord(rawTask);
            const title = clean(task.title);
            const taskPath = clean(task.category_path) || path;
            const searchable = [title, clean(task.task_id), clean(task.primary_owner), taskPath, clean(task.status)].join(' ');
            if (title && (textMatches(searchable) || taskRows.length < 12)) {
              taskRows.push({
                title,
                owner: clean(task.primary_owner ?? task.owner) || '待指派',
                status: clean(task.status) || '未知',
                progress: Number.isFinite(Number(task.progress)) ? `${Math.round(Number(task.progress))}%` : '未设置',
                due: clean(task.due_date) || '未设置',
                path: taskPath || '未分类',
              });
            }
            collectTasks(asArray(task.subtasks), taskPath);
          }
        };

        for (const rawCategory of asArray(byKey.get('rd.taskCategories'))) {
          const category = asRecord(rawCategory);
          const categoryLabel = clean(category.label);
          for (const rawChild of asArray(category.children)) {
            const child = asRecord(rawChild);
            collectTasks(asArray(child.tasks), [categoryLabel, clean(child.label)].filter(Boolean).join(' / '));
          }
        }
        const matchedTasks = taskRows
          .filter((task) => isGeneral || textMatches(`${task.title} ${task.owner} ${task.status} ${task.path}`))
          .slice(0, 12);
        if (matchedTasks.length > 0) {
          sections.push(`【研发任务】${matchedTasks.length} 条相关任务`);
          matchedTasks.forEach((task) => {
            sections.push(`- ${task.title}｜负责人：${task.owner}｜状态：${task.status}｜进度：${task.progress}｜截止：${task.due}｜路径：${task.path}`);
          });
        }

        const people = asArray(byKey.get('rd.people'))
          .map((item) => asRecord(item))
          .filter((person) => {
            const searchable = [person.name, person.position, person.department, person.status].map(clean).join(' ');
            return isGeneral || textMatches(searchable);
          })
          .slice(0, 12);
        if (people.length > 0) {
          sections.push(`【研发人员】${people.length} 名相关成员`);
          people.forEach((person) => {
            sections.push(
              `- ${clean(person.name)}｜岗位：${clean(person.position) || '未设置'}｜部门：${clean(person.department) || '未设置'}｜任务数：${clean(person.task_count) || '0'}/${clean(person.max_tasks) || '未设置'}`,
            );
          });
        }

        const kbEntries = asArray(byKey.get('rd.knowledgeEntries'))
          .map((item) => asRecord(item))
          .filter((entry) => {
            const searchable = [
              entry.title,
              entry.name,
              entry.filename,
              entry.summary,
              entry.description,
              entry.content,
              Array.isArray(entry.tags) ? entry.tags.join(' ') : '',
            ].map(clean).join(' ');
            return textMatches(searchable);
          })
          .slice(0, 8);
        if (kbEntries.length > 0) {
          sections.push(`【研发知识库】${kbEntries.length} 条相关资料`);
          kbEntries.forEach((entry) => {
            const title = clean(entry.title ?? entry.name ?? entry.filename) || '未命名资料';
            const excerpt = clean(entry.summary ?? entry.description ?? entry.content).slice(0, 160);
            sections.push(`- ${title}${excerpt ? `：${excerpt}` : ''}`);
          });
        }
      }
    } catch { /* ignore */ }

    return sections.join('\n');
  }
}
