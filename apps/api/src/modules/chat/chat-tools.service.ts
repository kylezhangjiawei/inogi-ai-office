import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import OpenAI from 'openai';

import { PrismaService } from '../../prisma/prisma.service';
import { ImageGenerationService } from '../image-generation/image-generation.service';
import { RagService, type RagUserContext } from '../rag/rag.service';
import { isWorkspaceAllowed } from '../research-development/rd-workspace.context';
import { ResearchDevelopmentService } from '../research-development/research-development.service';
import { ChatFileExportService } from './chat-file-export.service';
import type { StoredChatAttachment } from './chat-attachment.service';

/** 前端确认卡数据：写操作先生成待确认动作，用户点确认后才执行 */
export type PendingActionCard = {
  id: string;
  tool: string;
  label: string;
  summary: string;
  fields: Array<{ label: string; value: string }>;
  expiresAt: string;
};

/** 工具执行结果：content 回给模型作为观察值，summary 用于前端步骤条与审计 */
export type ChatToolResult = {
  ok: boolean;
  /** 一句话结果（如「命中 12 条任务」/「查询超时」），展示给用户 */
  summary: string;
  /** 完整结果文本，作为 tool 消息回给模型 */
  content: string;
  /** 写操作专用：生成的待确认动作卡（由 SSE 推给前端渲染确认按钮） */
  pendingAction?: PendingActionCard;
  /** 生图专用：已落库的图片附件（由 SSE 立即推给前端、并随 assistant 消息持久化） */
  attachment?: StoredChatAttachment;
};

type ToolSpec = {
  definition: OpenAI.Chat.Completions.ChatCompletionTool;
  /** 前端步骤条显示的动作名（如「查询研发任务」） */
  label: string;
  /** 该工具的执行超时（缺省 TOOL_TIMEOUT_MS；生图等长任务单独放宽） */
  timeoutMs?: number;
  execute: (
    args: Record<string, unknown>,
    user: RagUserContext,
    conversationId: string,
  ) => Promise<ChatToolResult>;
};

/** 单个工具执行超时：超时结果回给模型而不是挂死整条 SSE */
const TOOL_TIMEOUT_MS = 10_000;
/** 生图工具超时：上游图像生成 + OSS 落库通常 20s~2min，给足预算 */
const IMAGE_TOOL_TIMEOUT_MS = 5 * 60 * 1000;

/** generate / editImage 返回值里本工具关心的字段 */
type GeneratedImagePayload = {
  id?: string;
  imageData?: string;
  imageUrl?: string | null;
  revisedPrompt?: string;
};

/** 跨库汇总后的任务行 */
type TaskRow = {
  taskId: string;
  title: string;
  owner: string;
  status: string;
  progress: string;
  progressNum: number | null;
  due: string;
  path: string;
  /** 来源库：主产品 / 产品·XX / 中美协同 */
  store: string;
  pendingReviewType: string;
};

/** 待确认动作 KV 存储键（沿用 chat.conv-memory 的免 migration 模式） */
const PENDING_ACTIONS_KEY = 'chat.pendingActions';
/** 待确认动作有效期：过期后确认按钮失效，须让模型重新发起 */
const PENDING_ACTION_TTL_MS = 30 * 60 * 1000;
/** KV 中最多保留的动作数（含已执行/已取消，超出淘汰最旧） */
const PENDING_ACTIONS_MAX = 200;

/** 与 POST /research-development/messages 端点一致的发消息权限 */
const SEND_MESSAGE_PERMISSIONS = [
  'page:rd-director-dashboard',
  'rd-people:manage',
  'rd-task:reassign',
  'rd-task:edit',
  'page:rd-my-workspace',
  'page:us-collab-workspace',
];

/** 与 RD 控制器 RD_TASK_MANAGER_PERMISSIONS 一致：任一命中即可为任意任务记进展 */
const RD_TASK_MANAGER_PERMISSIONS = [
  'rd-task:edit',
  'rd-task:create',
  'rd-task:reassign',
  'rd-project:direct',
  'rd-project:review-l1',
  'rd-project:review-l2',
  'rd-people:manage',
];

/** 与 POST /research-development/task-progress-notes 端点一致的留痕权限 */
const PROGRESS_NOTE_PERMISSIONS = [
  'page:rd-my-workspace',
  'page:us-collab-workspace',
  ...RD_TASK_MANAGER_PERMISSIONS,
];

type PendingActionEntry = {
  id: string;
  userId: string;
  conversationId: string;
  /** 关联的 assistant 消息 id（回答落库后回填）；支撑刷新后确认卡按消息恢复 */
  messageId?: string;
  tool: 'create_task' | 'send_reminder' | 'update_task_progress' | 'approve_task_review';
  /** 已归一化的执行载荷（确认时直接投给对应服务） */
  payload: Record<string, unknown>;
  card: PendingActionCard;
  status: 'pending' | 'executed' | 'canceled';
  createdAt: string;
  expiresAt: string;
  resultMessage?: string;
};

/**
 * MateChat ReAct 只读工具集（第一期）：任务查询 / 知识库检索 / 人员查询。
 * 全部薄封装现有数据源，不引入任何写操作；每次执行写 audit_log 供运维台追溯。
 */
@Injectable()
export class ChatToolsService {
  private readonly logger = new Logger(ChatToolsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragService: RagService,
    private readonly rdService: ResearchDevelopmentService,
    private readonly imageGenerationService: ImageGenerationService,
    private readonly fileExportService: ChatFileExportService,
  ) {}

  private readonly tools: Record<string, ToolSpec> = {
    query_tasks: {
      label: '查询研发任务',
      definition: {
        type: 'function',
        function: {
          name: 'query_tasks',
          description:
            '按结构化条件精确查询公司研发任务清单（标题、负责人、状态、进度、截止日期）。当用户问题涉及任务数量、逾期情况、某人负责的任务等精确事实，且系统提供的检索数据不足以回答时调用。',
          parameters: {
            type: 'object',
            properties: {
              keyword: { type: 'string', description: '按任务标题/分类路径模糊过滤的关键词，可选' },
              owner: {
                type: 'string',
                description: '负责人姓名；查当前提问用户自己的任务时传 "me"，可选',
              },
              status: {
                type: 'string',
                enum: ['open', 'overdue', 'done', 'all'],
                description: 'open=未完成，overdue=已逾期（未完成且截止日期早于今天），done=已完成，all=全部。默认 open',
              },
            },
          },
        },
      },
      execute: (args, user) => this.queryTasks(args, user),
    },
    search_knowledge: {
      label: '检索公司知识库',
      definition: {
        type: 'function',
        function: {
          name: 'search_knowledge',
          description:
            '在公司知识库与内部文档中做语义检索。当用户追问的知识点在系统已提供的检索资料中没有覆盖时，用更精准的关键词再查一次。',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '检索词：独立、具体、包含关键实体' },
            },
            required: ['query'],
          },
        },
      },
      execute: (args, user) => this.searchKnowledge(args, user),
    },
    query_members: {
      label: '查询人员信息',
      definition: {
        type: 'function',
        function: {
          name: 'query_members',
          description:
            '查询研发人员名录（姓名、岗位、部门、在办任务数）。当用户问"谁负责 X""某某是什么岗位"且系统提供的数据不足时调用。',
          parameters: {
            type: 'object',
            properties: {
              keyword: { type: 'string', description: '按姓名/岗位/部门模糊过滤的关键词，可选' },
            },
          },
        },
      },
      execute: (args) => this.queryMembers(args),
    },
    create_task: {
      label: '发起立项（待确认）',
      definition: {
        type: 'function',
        function: {
          name: 'create_task',
          description:
            '为用户发起研发任务立项。调用后只会生成一张「待确认动作卡」，用户在界面点击确认后任务才会真正提交（并进入管理员审核流），你自己无法直接创建任务。当用户明确要求立项/建任务时使用；分类名不确定时可先用 query_tasks 了解现有分类路径。',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '任务标题，简洁明确' },
              category: {
                type: 'string',
                description: '任务所属分类名称（如「电源部分」或「电源部分/电池」，须是系统里已有的分类）',
              },
              description: { type: 'string', description: '任务描述/背景，可选' },
              owner: { type: 'string', description: '负责人姓名；默认当前提问用户，可选' },
              due_date: { type: 'string', description: '截止日期 YYYY-MM-DD，可选' },
              priority: { type: 'string', enum: ['high', 'medium', 'low'], description: '优先级，默认 medium' },
            },
            required: ['title', 'category'],
          },
        },
      },
      execute: (args, user, conversationId) => this.prepareCreateTask(args, user, conversationId),
    },
    send_reminder: {
      label: '发送催办通知（待确认）',
      definition: {
        type: 'function',
        function: {
          name: 'send_reminder',
          description:
            '给公司同事发送站内通知/催办消息（出现在对方的顶栏铃铛与工作台通知中心）。调用后只会生成「待确认动作卡」，用户确认后才真正发送。当用户要求催办、提醒、通知某人时使用；接收人须是 query_members 能查到的成员。',
          parameters: {
            type: 'object',
            properties: {
              recipient: { type: 'string', description: '接收人姓名' },
              subject: { type: 'string', description: '通知标题，可选' },
              content: { type: 'string', description: '通知正文（礼貌、说清事项与期望）' },
            },
            required: ['recipient', 'content'],
          },
        },
      },
      execute: (args, user, conversationId) => this.prepareSendReminder(args, user, conversationId),
    },
    update_task_progress: {
      label: '更新任务进展（待确认）',
      definition: {
        type: 'function',
        function: {
          name: 'update_task_progress',
          description:
            '为某个研发任务记录进展留痕，并可同时更新进度百分比。调用后只生成「待确认动作卡」，用户确认后才真正写入。当用户要求"把 XX 任务进度更到 N%""给 XX 任务记个进展"时使用；task_id 从 query_tasks 结果的 [RD-xxxx] 编号获得，不确定先查。',
          parameters: {
            type: 'object',
            properties: {
              task_id: { type: 'string', description: '任务编号（如 RD-2026-123456-ABC），来自 query_tasks 结果' },
              note: { type: 'string', description: '进展说明正文（做了什么、结果如何）' },
              progress: { type: 'number', description: '新的进度百分比 0-100，可选（不改进度就不传）' },
            },
            required: ['task_id', 'note'],
          },
        },
      },
      execute: (args, user, conversationId) => this.prepareUpdateTaskProgress(args, user, conversationId),
    },
    approve_task_review: {
      label: '任务审批（待确认）',
      definition: {
        type: 'function',
        function: {
          name: 'approve_task_review',
          description:
            '审批处于「待审核」状态的研发任务（立项/成果验收/截止日期变更/协作变更/放弃申请等，系统按任务的审核类型自动处理）。调用后只生成「待确认动作卡」，用户确认后才真正生效。仅审核人/管理员可用；task_id 从 query_tasks 结果获得（状态为 pending_review 的任务）。',
          parameters: {
            type: 'object',
            properties: {
              task_id: { type: 'string', description: '任务编号（须处于待审核状态）' },
              decision: { type: 'string', enum: ['approve', 'reject'], description: 'approve=通过，reject=驳回' },
              reason: { type: 'string', description: '驳回原因（decision=reject 时必填）' },
            },
            required: ['task_id', 'decision'],
          },
        },
      },
      execute: (args, user, conversationId) => this.prepareApproveTaskReview(args, user, conversationId),
    },
    get_dashboard_summary: {
      label: '汇总研发数据',
      definition: {
        type: 'function',
        function: {
          name: 'get_dashboard_summary',
          description:
            '汇总研发任务全景数据：总量、状态分布、逾期统计、待审核队列、按负责人分布、平均进度（覆盖主产品与全部产品库）。当用户要"周报/整体情况/汇总/统计/驾驶舱数据"时调用，比逐条查询高效。',
          parameters: { type: 'object', properties: {} },
        },
      },
      execute: (_args, user) => this.getDashboardSummary(user),
    },
    generate_image: {
      label: '生成图片',
      timeoutMs: IMAGE_TOOL_TIMEOUT_MS,
      definition: {
        type: 'function',
        function: {
          name: 'generate_image',
          description:
            '根据文字描述生成一张图片（配图、示意图、海报、插画等）。生成的图片会直接作为附件出现在你的回答下方，无需用户确认。当用户要求画图/生成图片/配图时使用；生成需要几十秒到一两分钟，调用一次即可，不要重复调用。',
          parameters: {
            type: 'object',
            properties: {
              prompt: {
                type: 'string',
                description: '图片描述：具体、包含主体/风格/构图/配色等要素（用户没说的可合理补全）',
              },
              size: {
                type: 'string',
                enum: ['1024x1024', '1792x1024', '1024x1792'],
                description: '图片尺寸：1024x1024 方图（默认）/ 1792x1024 横图 / 1024x1792 竖图（服务端会按模型自动换算）',
              },
            },
            required: ['prompt'],
          },
        },
      },
      execute: (args, user, conversationId) => this.generateImage(args, user, conversationId),
    },
    edit_image: {
      label: '修改图片',
      timeoutMs: IMAGE_TOOL_TIMEOUT_MS,
      definition: {
        type: 'function',
        function: {
          name: 'edit_image',
          description:
            '在已生成图片的基础上按要求修改（换风格/改元素/调构图等），修改结果同样直接作为图片附件展示，无需用户确认。image_id 来自 generate_image 或上一次 edit_image 的结果；用户说"把刚才那张图改成 XX"时使用。',
          parameters: {
            type: 'object',
            properties: {
              image_id: { type: 'string', description: '要修改的图片 id（来自之前生成/修改结果）' },
              instruction: { type: 'string', description: '修改要求，具体明确' },
            },
            required: ['image_id', 'instruction'],
          },
        },
      },
      execute: (args, user, conversationId) => this.editImage(args, user, conversationId),
    },
  };

  /** OpenAI tools 参数（第一期全员可用：三个工具均为只读，暴露面与既有聊天检索一致） */
  buildToolDefinitions(): OpenAI.Chat.Completions.ChatCompletionTool[] {
    return Object.values(this.tools).map((t) => t.definition);
  }

  toolLabel(name: string): string {
    return this.tools[name]?.label ?? name;
  }

  /** 执行工具（带超时 + 审计）。任何失败都以文本结果返回给模型，不抛异常。 */
  async execute(
    name: string,
    rawArgs: string,
    user: RagUserContext,
    conversationId: string,
  ): Promise<ChatToolResult> {
    const spec = this.tools[name];
    const startedAt = Date.now();
    let args: Record<string, unknown> = {};
    try {
      const parsed: unknown = rawArgs ? JSON.parse(rawArgs) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      // 参数坏 JSON：按空参执行，让模型基于结果自行纠偏
    }

    let result: ChatToolResult;
    if (!spec) {
      result = { ok: false, summary: '未知工具', content: `工具 ${name} 不存在，请改用已提供的工具。` };
    } else {
      const timeoutMs = spec.timeoutMs ?? TOOL_TIMEOUT_MS;
      try {
        result = await Promise.race([
          spec.execute(args, user, conversationId),
          new Promise<ChatToolResult>((resolve) =>
            setTimeout(
              () =>
                resolve({
                  ok: false,
                  summary: '执行超时',
                  content: `工具执行超时（${Math.round(timeoutMs / 1000)}s），请基于已有信息作答或如实告知用户。`,
                }),
              timeoutMs,
            ),
          ),
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`工具 ${name} 执行失败: ${message}`);
        result = { ok: false, summary: '查询失败', content: `工具执行失败：${message}。请基于已有信息作答或如实告知用户。` };
      }
    }

    // 审计（fire-and-forget）：运维台「服务与任务」链路可见每次工具调用
    void this.prisma.auditLog
      .create({
        data: {
          userId: user.userId,
          action: 'MATECHAT_TOOL_CALL',
          resource: 'chat_tool',
          resourceId: name,
          meta: {
            tool: name,
            args,
            ok: result.ok,
            summary: result.summary,
            durationMs: Date.now() - startedAt,
            conversationId,
          } as Prisma.InputJsonValue,
        },
      })
      .catch((error) =>
        this.logger.warn(`工具审计写入失败: ${error instanceof Error ? error.message : error}`),
      );

    return result;
  }

  // ── 工具实现 ─────────────────────────────────────────────────────────────────

  private async queryTasks(
    args: Record<string, unknown>,
    user: RagUserContext,
  ): Promise<ChatToolResult> {
    const keyword = String(args.keyword ?? '').trim().toLowerCase();
    const ownerArg = String(args.owner ?? '').trim();
    const status = ['open', 'overdue', 'done', 'all'].includes(String(args.status))
      ? String(args.status)
      : 'open';
    const owner = ownerArg === 'me' ? (user.name?.trim() ?? '') : ownerArg;
    const rows = await this.loadTaskRows(user);

    // 实际数据状态值为英文（in_progress/completed 等），中英文关键词都覆盖
    const isDone = (s: string) => /完成|已关闭|closed|done|complete/i.test(s);
    const todayKey = new Date().toISOString().slice(0, 10);
    let filtered = rows;
    if (owner) {
      filtered = filtered.filter((t) => t.owner.includes(owner) || owner.includes(t.owner));
    }
    if (keyword) {
      filtered = filtered.filter((t) => `${t.title} ${t.path}`.toLowerCase().includes(keyword));
    }
    if (status === 'open') filtered = filtered.filter((t) => !isDone(t.status));
    if (status === 'done') filtered = filtered.filter((t) => isDone(t.status));
    if (status === 'overdue') {
      filtered = filtered.filter((t) => !isDone(t.status) && t.due !== '' && t.due.slice(0, 10) < todayKey);
    }

    if (filtered.length === 0) {
      return { ok: true, summary: '未查到匹配任务', content: '没有查询到符合条件的任务。' };
    }
    const shown = filtered.slice(0, 30);
    const lines = shown.map(
      (t) =>
        `- [${t.taskId || '无编号'}] ${t.title}｜负责人：${t.owner}｜状态：${t.status}｜进度：${t.progress}｜截止：${t.due || '未设置'}｜路径：${t.path}${t.store === '主产品' ? '' : `｜库：${t.store}`}`,
    );
    const suffix = filtered.length > shown.length ? `\n（共 ${filtered.length} 条，仅列出前 ${shown.length} 条，可细化条件再查）` : '';
    return {
      ok: true,
      summary: `命中 ${filtered.length} 条任务`,
      content: `查询到 ${filtered.length} 条任务（条件：${status}${owner ? `，负责人含「${owner}」` : ''}${keyword ? `，关键词「${keyword}」` : ''}）：\n${lines.join('\n')}${suffix}`,
    };
  }

  private async searchKnowledge(
    args: Record<string, unknown>,
    user: RagUserContext,
  ): Promise<ChatToolResult> {
    const query = String(args.query ?? '').trim();
    if (!query) {
      return { ok: false, summary: '缺少检索词', content: '未提供检索词 query。' };
    }
    // RagService 内部已按用户权限/kbLevel 过滤，无越权风险
    const response = await this.ragService.search(query, user, { topK: 5 });
    if (response.results.length === 0) {
      return {
        ok: true,
        summary: '知识库未命中',
        content: `知识库中没有检索到与「${query}」相关的资料${response.filteredByPermission > 0 ? `（另有 ${response.filteredByPermission} 条因权限不足被过滤）` : ''}。`,
      };
    }
    const blocks = response.results.map((r, idx) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const title = typeof meta.title === 'string' && meta.title ? `《${meta.title}》` : `${r.sourceType}#${r.sourceId}`;
      return `[T${idx + 1}] ${title}\n${r.content.trim().slice(0, 800)}`;
    });
    return {
      ok: true,
      summary: `命中 ${response.results.length} 条资料`,
      content: `知识库检索结果（工具补查，引用时说明资料名称即可，不使用 [数字] 编号以免与首轮引用冲突）：\n\n${blocks.join('\n\n---\n\n')}`,
    };
  }

  private async queryMembers(args: Record<string, unknown>): Promise<ChatToolResult> {
    const keyword = String(args.keyword ?? '').trim().toLowerCase();
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'rd.people' },
      select: { value: true },
    });
    const clean = (v: unknown) => String(v ?? '').trim();
    const people = (Array.isArray(setting?.value) ? setting.value : [])
      .map((item) =>
        item && typeof item === 'object' && !Array.isArray(item) ? (item as Record<string, unknown>) : {},
      )
      .filter((p) => {
        if (!keyword) return true;
        return [p.name, p.position, p.department, p.status].map(clean).join(' ').toLowerCase().includes(keyword);
      })
      .slice(0, 20);
    if (people.length === 0) {
      return { ok: true, summary: '未查到人员', content: '没有查询到符合条件的人员。' };
    }
    const lines = people.map(
      (p) =>
        `- ${clean(p.name)}｜岗位：${clean(p.position) || '未设置'}｜部门：${clean(p.department) || '未设置'}｜任务数：${clean(p.task_count) || '0'}/${clean(p.max_tasks) || '未设置'}`,
    );
    return { ok: true, summary: `命中 ${people.length} 名人员`, content: `查询到 ${people.length} 名人员：\n${lines.join('\n')}` };
  }

  // ── 数据汇总（只读） ─────────────────────────────────────────────────────────

  private async getDashboardSummary(user: RagUserContext): Promise<ChatToolResult> {
    const rows = await this.loadTaskRows(user);
    if (rows.length === 0) {
      return { ok: true, summary: '暂无任务数据', content: '当前没有任何研发任务数据。' };
    }
    const isDone = (s: string) => /完成|已关闭|closed|done|complete/i.test(s);
    const todayKey = new Date().toISOString().slice(0, 10);
    const done = rows.filter((t) => isDone(t.status));
    const open = rows.filter((t) => !isDone(t.status));
    const overdue = open.filter((t) => t.due && t.due.slice(0, 10) < todayKey);
    const pendingReview = rows.filter((t) => t.status.includes('pending_review') || t.pendingReviewType);
    // 平均进度（仅未完成任务，反映在途工作量）
    const progressVals = open.map((t) => t.progressNum).filter((n): n is number => n !== null);
    const avgProgress = progressVals.length > 0 ? Math.round(progressVals.reduce((a, b) => a + b, 0) / progressVals.length) : 0;
    // 按负责人分布（未完成任务数 Top）
    const byOwner = new Map<string, { total: number; overdue: number }>();
    for (const t of open) {
      const cur = byOwner.get(t.owner) ?? { total: 0, overdue: 0 };
      cur.total += 1;
      if (t.due && t.due.slice(0, 10) < todayKey) cur.overdue += 1;
      byOwner.set(t.owner, cur);
    }
    const ownerLines = [...byOwner.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([name, s]) => `- ${name}：未完成 ${s.total} 条${s.overdue > 0 ? `（逾期 ${s.overdue}）` : ''}`);
    const reviewLines = pendingReview
      .slice(0, 15)
      .map((t) => `- [${t.taskId}] ${t.title}｜负责人：${t.owner}｜类型：${t.pendingReviewType || '待审核'}`);

    const content = [
      `研发任务总量 ${rows.length} 条：已完成 ${done.length}，未完成 ${open.length}（其中逾期 ${overdue.length}），待审核 ${pendingReview.length}。未完成任务平均进度 ${avgProgress}%。`,
      `\n【按负责人（未完成，Top10）】\n${ownerLines.join('\n')}`,
      pendingReview.length > 0 ? `\n【待审核队列】\n${reviewLines.join('\n')}${pendingReview.length > reviewLines.length ? `\n（另有 ${pendingReview.length - reviewLines.length} 条未列出）` : ''}` : '\n【待审核队列】无',
    ].join('\n');
    return {
      ok: true,
      summary: `汇总 ${rows.length} 条任务`,
      content: `以下是研发任务全景汇总数据，请据此为用户组织回答（可做成表格）：\n\n${content}`,
    };
  }

  // ── 任务审批（走确认卡） ─────────────────────────────────────────────────────

  private async prepareApproveTaskReview(
    args: Record<string, unknown>,
    user: RagUserContext,
    conversationId: string,
  ): Promise<ChatToolResult> {
    // 审批是管理员/审核人专属：与 updateTask 的 _review_action 越权守卫同口径
    if (!this.hasAnyPermission(user, RD_TASK_MANAGER_PERMISSIONS)) {
      return { ok: false, summary: '无审核权限', content: '当前用户没有任务审核权限（仅研发主管/审核人可审批），请如实告知用户。' };
    }
    const taskId = String(args.task_id ?? '').trim();
    const decision = String(args.decision) === 'reject' ? 'reject' : 'approve';
    const reason = String(args.reason ?? '').trim();
    if (!taskId) {
      return { ok: false, summary: '缺少任务编号', content: '审批需要 task_id 参数。' };
    }
    if (decision === 'reject' && !reason) {
      return { ok: false, summary: '缺少驳回原因', content: '驳回任务时必须提供 reason。' };
    }
    const task = await this.findTaskById(taskId);
    if (!task) {
      return { ok: false, summary: '任务不存在', content: `没有找到编号「${taskId}」的任务，请用 query_tasks 确认编号。` };
    }
    if (!task.status.includes('pending_review') && !task.pendingReviewType) {
      return {
        ok: false,
        summary: '任务非待审核',
        content: `任务「${task.title}」当前状态是「${task.status}」，不处于待审核状态，无法审批。`,
      };
    }
    const typeLabel =
      { proposal: '立项审核', result: '成果验收', due_date: '截止日期变更', collaboration: '协作变更', abandon: '放弃申请', merge: '合并申请' }[
        task.pendingReviewType
      ] ?? '待审核';
    const card = await this.savePendingAction(
      user,
      conversationId,
      'approve_task_review',
      { taskId, decision, reason, taskTitle: task.title },
      {
        label: decision === 'approve' ? '审批通过' : '驳回任务',
        summary: `${decision === 'approve' ? '通过' : '驳回'}「${task.title}」的${typeLabel}`,
        fields: [
          { label: '任务', value: `[${taskId}] ${task.title}` },
          { label: '审核类型', value: typeLabel },
          { label: '负责人', value: task.owner },
          { label: '决定', value: decision === 'approve' ? '✓ 通过' : '✕ 驳回' },
          ...(decision === 'reject' ? [{ label: '驳回原因', value: reason.slice(0, 200) }] : []),
        ],
      },
    );
    return {
      ok: true,
      summary: `已生成审批确认卡：${task.title}`,
      content: `已生成「${decision === 'approve' ? '审批通过' : '驳回任务'}」待确认动作（任务「${task.title}」的${typeLabel}）。尚未生效：需要用户点击「确认执行」后才会真正审批。请告知用户核对并确认，不要声称已审批。`,
      pendingAction: card,
    };
  }

  // ── 生图（对话内直接出图，无需确认） ─────────────────────────────────────────

  private async generateImage(
    args: Record<string, unknown>,
    user: RagUserContext,
    conversationId: string,
  ): Promise<ChatToolResult> {
    const prompt = String(args.prompt ?? '').trim();
    if (!prompt) return { ok: false, summary: '缺少图片描述', content: '生成图片需要 prompt 参数。' };
    const sizeInput = String(args.size ?? '');
    const size: '1024x1024' | '1792x1024' | '1024x1792' =
      sizeInput === '1792x1024' || sizeInput === '1024x1792' ? sizeInput : '1024x1024';

    // 渠道排序：image-2 系优先 → 管理台默认启用优先 → 最近更新优先；失败依次兜底（最多 4 个，
    // 不兼容渠道通常 <200ms 就 400，快速失败几乎无成本）
    const configs = await this.imageGenerationService.listActiveImageModelConfigs();
    const candidates: Array<{ id?: string; model: string }> = [...configs]
      .sort((a, b) => {
        const aImg2 = /image[-_]?2/i.test(a.model) ? 0 : 1;
        const bImg2 = /image[-_]?2/i.test(b.model) ? 0 : 1;
        if (aImg2 !== bImg2) return aImg2 - bImg2;
        return (a.isDefault ? 0 : 1) - (b.isDefault ? 0 : 1);
      })
      .slice(0, 4);
    if (candidates.length === 0) candidates.push({ model: 'gpt-image-2' });

    let lastError = '';
    for (const candidate of candidates) {
      try {
        const result = (await this.imageGenerationService.generate(user.userId, {
          prompt,
          size,
          quality: 'medium',
          model: candidate.model,
          ...(candidate.id ? { model_id: candidate.id } : {}),
        })) as GeneratedImagePayload;
        const attachment = await this.persistGeneratedImage(result, user.userId, conversationId);
        return {
          ok: true,
          summary: '图片已生成',
          content: `图片已生成，并已作为图片附件直接展示在你的回答下方（用户能看到图）。不要输出图片链接或 markdown 图片语法，只需一两句话说明画了什么。图片 id=${result.id ?? '未知'}（用户后续要求修改这张图时用 edit_image 传入该 id）。${result.revisedPrompt ? `实际使用的描述：${String(result.revisedPrompt).slice(0, 200)}` : ''}`,
          attachment,
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        this.logger.warn(`聊天生图失败（模型 ${candidate.model}）：${lastError}`);
      }
    }
    return {
      ok: false,
      summary: '图片生成失败',
      content: `图片生成失败：${lastError || '未知错误'}。请如实告知用户稍后重试，或建议前往图像工场页面生成。`,
    };
  }

  /** 修改已生成的图片（无需确认，来源图归属由 editImage 内部校验） */
  private async editImage(
    args: Record<string, unknown>,
    user: RagUserContext,
    conversationId: string,
  ): Promise<ChatToolResult> {
    const imageId = String(args.image_id ?? '').trim();
    const instruction = String(args.instruction ?? '').trim();
    if (!imageId || !instruction) {
      return { ok: false, summary: '缺少必填参数', content: '修改图片需要 image_id 与 instruction 两个参数。' };
    }
    // 图片编辑只有 gpt-image 系渠道支持：优先 image-2、默认启用；没有就走服务默认解析
    const configs = await this.imageGenerationService.listActiveImageModelConfigs();
    const editable = configs
      .filter((c) => /gpt-image/i.test(c.model))
      .sort((a, b) => {
        const aImg2 = /image[-_]?2/i.test(a.model) ? 0 : 1;
        const bImg2 = /image[-_]?2/i.test(b.model) ? 0 : 1;
        if (aImg2 !== bImg2) return aImg2 - bImg2;
        return (a.isDefault ? 0 : 1) - (b.isDefault ? 0 : 1);
      });
    const candidate = editable[0];
    try {
      const result = (await this.imageGenerationService.editImage(user.userId, imageId, {
        message: instruction,
        ...(candidate ? { model: candidate.model, model_id: candidate.id } : {}),
      })) as GeneratedImagePayload;
      const attachment = await this.persistGeneratedImage(result, user.userId, conversationId);
      return {
        ok: true,
        summary: '图片已修改',
        content: `图片已按要求修改，新图已作为附件展示在你的回答下方。新图片 id=${result.id ?? '未知'}（继续修改时用这个新 id）。不要输出图片链接或 markdown 图片语法。`,
        attachment,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`聊天图片修改失败（image=${imageId}）：${message}`);
      return {
        ok: false,
        summary: '图片修改失败',
        content: `图片修改失败：${message}。兜底方案：改用 generate_image，把原图的完整画面描述加上本次修改要求重新生成一张（效果等价）；若提示图片不存在，说明 image_id 有误或图片归属其他用户，如实告知用户。`,
      };
    }
  }

  /** 把生成/编辑结果落成聊天附件：base64 data URL 直接解码，仅有签名 URL（缓存命中）时下载 */
  private async persistGeneratedImage(
    result: GeneratedImagePayload,
    userId: string,
    conversationId: string,
  ): Promise<StoredChatAttachment> {
    let buffer: Buffer | null = null;
    let mime = 'image/png';
    const base64Match = /^data:(image\/[\w.+-]+);base64,(.+)$/s.exec(result.imageData ?? '');
    if (base64Match) {
      mime = base64Match[1];
      buffer = Buffer.from(base64Match[2], 'base64');
    } else if (result.imageUrl) {
      const res = await fetch(result.imageUrl);
      if (res.ok) {
        buffer = Buffer.from(await res.arrayBuffer());
        mime = res.headers.get('content-type')?.split(';')[0]?.trim() || 'image/png';
      }
    }
    if (!buffer || buffer.length === 0) throw new Error('生成结果为空');
    const ext = mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1] || 'png';
    return this.fileExportService.persist(
      userId,
      { buffer, filename: `AI配图-${Date.now()}.${ext}`, mime },
      conversationId,
    );
  }

  // ── 写操作（二期）：生成待确认动作，用户确认后才执行 ─────────────────────────

  private hasAnyPermission(user: RagUserContext, required: string[]): boolean {
    const perms = user.permissions ?? [];
    return perms.includes('*') || required.some((p) => perms.includes(p));
  }

  /** 立项（走审核流）：校验权限与分类后生成待确认动作 */
  private async prepareCreateTask(
    args: Record<string, unknown>,
    user: RagUserContext,
    conversationId: string,
  ): Promise<ChatToolResult> {
    // 与 POST /research-development/task-categories/tasks 端点权限一致
    if (!this.hasAnyPermission(user, ['rd-task:create'])) {
      return { ok: false, summary: '无立项权限', content: '当前用户没有立项权限（rd-task:create），无法发起立项，请如实告知用户。' };
    }
    const title = String(args.title ?? '').trim();
    const categoryInput = String(args.category ?? '').trim();
    if (!title || !categoryInput) {
      return { ok: false, summary: '缺少必填参数', content: '立项需要 title 与 category 两个参数。' };
    }
    const resolved = await this.resolveCategory(categoryInput);
    if (!resolved.ok) {
      return { ok: false, summary: '分类不存在', content: resolved.message };
    }
    const dueDate = String(args.due_date ?? '').trim();
    if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      return { ok: false, summary: '日期格式错误', content: 'due_date 须为 YYYY-MM-DD 格式。' };
    }
    const priority = ['high', 'medium', 'low'].includes(String(args.priority)) ? String(args.priority) : 'medium';
    const ownerInput = String(args.owner ?? '').trim();
    const ownerName = ownerInput || user.name?.trim() || '待指派';
    const isSelf = !ownerInput || ownerInput === user.name?.trim();
    const description = String(args.description ?? '').trim();

    const payload: Record<string, unknown> = {
      category_id: resolved.categoryId,
      ...(resolved.subProjectId ? { sub_project_id: resolved.subProjectId } : {}),
      title,
      primary_owner: ownerName,
      ...(isSelf ? { primary_owner_user_id: user.userId } : {}),
      // 统一走成员立项审核流：管理员审批通过后进入 in_progress，避免 AI 直建绕过审核
      status: 'pending_review',
      pending_review_type: 'proposal',
      progress: 0,
      final_priority: priority,
      ai_priority: priority,
      ...(dueDate ? { due_date: dueDate } : {}),
      ...(description ? { description } : {}),
    };
    const card = await this.savePendingAction(user, conversationId, 'create_task', payload, {
      label: '发起立项',
      summary: `立项「${title}」`,
      fields: [
        { label: '任务标题', value: title },
        { label: '分类', value: resolved.pathLabel },
        { label: '负责人', value: ownerName },
        { label: '优先级', value: priority === 'high' ? '高' : priority === 'low' ? '低' : '中' },
        ...(dueDate ? [{ label: '截止日期', value: dueDate }] : []),
        ...(description ? [{ label: '描述', value: description.slice(0, 120) }] : []),
        { label: '流程', value: '提交后进入管理员立项审核' },
      ],
    });
    return {
      ok: true,
      summary: `已生成立项确认卡：${title}`,
      content: `已生成「发起立项」待确认动作（标题「${title}」，分类「${resolved.pathLabel}」，负责人 ${ownerName}）。任务尚未创建：需要用户在界面上点击确认卡的「确认执行」后才会提交立项并进入管理员审核。请告知用户核对信息并确认，不要声称任务已创建。`,
      pendingAction: card,
    };
  }

  /** 站内催办通知：校验权限与接收人后生成待确认动作 */
  private async prepareSendReminder(
    args: Record<string, unknown>,
    user: RagUserContext,
    conversationId: string,
  ): Promise<ChatToolResult> {
    if (!this.hasAnyPermission(user, SEND_MESSAGE_PERMISSIONS)) {
      return { ok: false, summary: '无发送权限', content: '当前用户没有发送站内通知的权限，请如实告知用户。' };
    }
    const recipient = String(args.recipient ?? '').trim();
    const content = String(args.content ?? '').trim();
    if (!recipient || !content) {
      return { ok: false, summary: '缺少必填参数', content: '发送通知需要 recipient 与 content 两个参数。' };
    }
    if (recipient === user.name?.trim()) {
      return { ok: false, summary: '不能发给自己', content: '接收人是用户本人，无需发送站内通知，请直接答复用户。' };
    }
    // 接收人须能在人员名录里找到，否则消息会投递不到任何人
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'rd.people' },
      select: { value: true },
    });
    const people = (Array.isArray(setting?.value) ? setting.value : []).map((p) =>
      p && typeof p === 'object' && !Array.isArray(p) ? (p as Record<string, unknown>) : {},
    );
    const person = people.find((p) => String(p.name ?? '').trim() === recipient);
    if (!person) {
      const candidates = people
        .map((p) => String(p.name ?? '').trim())
        .filter((n) => n && (n.includes(recipient) || recipient.includes(n)))
        .slice(0, 5);
      return {
        ok: false,
        summary: '接收人不存在',
        content: `人员名录中没有「${recipient}」。${candidates.length > 0 ? `相近的人员：${candidates.join('、')}。请与用户确认后重试。` : '请用 query_members 查询确切姓名后重试。'}`,
      };
    }
    const subject = String(args.subject ?? '').trim();
    const payload: Record<string, unknown> = {
      recipient_name: recipient,
      ...(typeof person.user_id === 'string' && person.user_id ? { recipient_id: person.user_id } : {}),
      ...(typeof person.id === 'string' && person.id ? { recipient_person_id: person.id } : {}),
      subject: subject || '催办提醒',
      body: content,
    };
    const card = await this.savePendingAction(user, conversationId, 'send_reminder', payload, {
      label: '发送催办通知',
      summary: `通知 ${recipient}`,
      fields: [
        { label: '接收人', value: recipient },
        { label: '标题', value: subject || '催办提醒' },
        { label: '内容', value: content.slice(0, 200) },
      ],
    });
    return {
      ok: true,
      summary: `已生成通知确认卡：${recipient}`,
      content: `已生成「发送催办通知」待确认动作（接收人 ${recipient}）。通知尚未发送：需要用户在界面上点击「确认执行」后才会真正发出。请告知用户核对内容并确认，不要声称已发送。`,
      pendingAction: card,
    };
  }

  /** 任务进展留痕（走确认卡）：校验权限与任务存在后生成待确认动作 */
  private async prepareUpdateTaskProgress(
    args: Record<string, unknown>,
    user: RagUserContext,
    conversationId: string,
  ): Promise<ChatToolResult> {
    if (!this.hasAnyPermission(user, PROGRESS_NOTE_PERMISSIONS)) {
      return { ok: false, summary: '无留痕权限', content: '当前用户没有记录任务进展的权限，请如实告知用户。' };
    }
    const taskId = String(args.task_id ?? '').trim();
    const note = String(args.note ?? '').trim();
    if (!taskId || !note) {
      return { ok: false, summary: '缺少必填参数', content: '记录进展需要 task_id 与 note 两个参数。' };
    }
    let progress: number | undefined;
    if (args.progress !== undefined && args.progress !== null && args.progress !== '') {
      const parsed = Number(args.progress);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        return { ok: false, summary: '进度值无效', content: 'progress 须是 0-100 的数字。' };
      }
      progress = Math.round(parsed);
    }
    const task = await this.findTaskById(taskId);
    if (!task) {
      return {
        ok: false,
        summary: '任务不存在',
        content: `没有找到编号为「${taskId}」的任务。请先用 query_tasks 查询确认编号（结果里 [RD-xxxx] 即编号）。`,
      };
    }
    const card = await this.savePendingAction(
      user,
      conversationId,
      'update_task_progress',
      { taskId, text: note, ...(progress !== undefined ? { progress } : {}), taskTitle: task.title },
      {
        label: '更新任务进展',
        summary: `任务「${task.title}」记进展${progress !== undefined ? `，进度 → ${progress}%` : ''}`,
        fields: [
          { label: '任务', value: `[${taskId}] ${task.title}` },
          { label: '负责人', value: task.owner },
          ...(progress !== undefined
            ? [{ label: '进度', value: `${task.progress} → ${progress}%` }]
            : [{ label: '进度', value: `${task.progress}（不变）` }]),
          { label: '进展说明', value: note.slice(0, 200) },
        ],
      },
    );
    return {
      ok: true,
      summary: `已生成进展确认卡：${task.title}`,
      content: `已生成「更新任务进展」待确认动作（任务「${task.title}」${progress !== undefined ? `，进度将更新为 ${progress}%` : ''}）。尚未写入：需要用户点击「确认执行」后才会真正记录。请告知用户核对并确认，不要声称已更新。`,
      pendingAction: card,
    };
  }

  /**
   * 汇总任务行：主库 + 各产品库 +（当且仅当用户有协同池准入权限时）中美协同池。
   * 不传 user 时只汇总研发池（主库+产品库）——写操作用它定位任务，协同池任务不支持写。
   */
  private async loadTaskRows(user?: RagUserContext): Promise<TaskRow[]> {
    const includeUsCollab = user ? isWorkspaceAllowed('us-collab', user.permissions ?? []) : false;
    const keys = ['rd.taskCategories', 'rd.productTaskCategories', 'rd.products'];
    if (includeUsCollab) keys.push('rdws.us-collab.taskCategories');
    const settings = await this.prisma.systemSetting.findMany({
      where: { key: { in: keys } },
      select: { key: true, value: true },
    });
    const byKey = new Map(settings.map((s) => [s.key, s.value as unknown]));
    const asRecord = (v: unknown): Record<string, unknown> =>
      v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
    const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
    const clean = (v: unknown) => String(v ?? '').trim();

    const rows: TaskRow[] = [];
    const collect = (tasks: unknown[], path: string, store: string) => {
      for (const raw of tasks) {
        if (rows.length >= 800) return;
        const task = asRecord(raw);
        const title = clean(task.title);
        const taskPath = clean(task.category_path) || path;
        if (title) {
          const progressNum = Number.isFinite(Number(task.progress)) ? Math.round(Number(task.progress)) : null;
          rows.push({
            taskId: clean(task.task_id),
            title,
            owner: clean(task.primary_owner ?? task.owner) || '待指派',
            status: clean(task.status) || '未知',
            progress: progressNum !== null ? `${progressNum}%` : '未设置',
            progressNum,
            due: clean(task.due_date) || '',
            path: taskPath || '未分类',
            store,
            pendingReviewType: clean(task.pending_review_type),
          });
        }
        collect(asArray(task.subtasks), taskPath, store);
      }
    };
    const walkTree = (tree: unknown, store: string) => {
      for (const rawCategory of asArray(tree)) {
        const category = asRecord(rawCategory);
        for (const rawChild of asArray(category.children)) {
          const child = asRecord(rawChild);
          collect(asArray(child.tasks), [clean(category.label), clean(child.label)].filter(Boolean).join(' / '), store);
        }
      }
    };

    walkTree(byKey.get('rd.taskCategories'), '主产品');
    const products = asArray(byKey.get('rd.products')).map(asRecord);
    const productName = (id: string) => clean(products.find((p) => clean(p.id) === id)?.name) || id;
    const productStore = asRecord(byKey.get('rd.productTaskCategories'));
    for (const [pid, tree] of Object.entries(productStore)) {
      walkTree(tree, `产品·${productName(pid)}`);
    }
    if (includeUsCollab) walkTree(byKey.get('rdws.us-collab.taskCategories'), '中美协同');
    return rows;
  }

  /**
   * 生成个人化快捷问答建议：按当前账号的逾期任务 / 待审核队列 / 角色权限拼装，
   * 点击后能直接触发对应 ReAct 工具（查任务 / 汇总）。任何异常或数据不足都回退通用池，
   * 保证始终返回 4 条、新用户与空账号也不尴尬。
   */
  async buildQuickSuggestions(user: RagUserContext): Promise<string[]> {
    // 通用兜底池：安全、与研发/办公场景无关也能用（不含法务等专属项，除非有对应权限时另加）
    const fallback = [
      '帮我起草一封项目跟进邮件',
      '帮我写一份本周工作周报',
      '帮我梳理今天该优先处理的事',
      '帮我把一段内容总结成要点',
    ];
    const suggestions: string[] = [];
    try {
      const rows = await this.loadTaskRows(user);
      const isDone = (s: string) => /完成|已关闭|closed|done|complete/i.test(s);
      const todayKey = new Date().toISOString().slice(0, 10);
      const myName = user.name?.trim() ?? '';
      const mine = myName ? rows.filter((t) => t.owner.includes(myName) || myName.includes(t.owner)) : [];
      const myOpen = mine.filter((t) => !isDone(t.status));
      const myOverdue = myOpen.filter((t) => t.due && t.due.slice(0, 10) < todayKey);
      const canManage = this.hasAnyPermission(user, RD_TASK_MANAGER_PERMISSIONS);
      const pendingReview = rows.filter((t) => t.status.includes('pending_review') || t.pendingReviewType);

      if (myOverdue.length > 0) suggestions.push(`我有 ${myOverdue.length} 条逾期任务，帮我按优先级排一下`);
      if (canManage && pendingReview.length > 0) suggestions.push(`帮我看看 ${pendingReview.length} 条待审核的任务`);
      if (canManage) suggestions.push('帮我汇总本周研发整体情况');
      if (myOverdue.length === 0 && myOpen.length > 0) {
        suggestions.push(`我还有 ${myOpen.length} 个未完成任务，帮我梳理下今天该做什么`);
      }
      suggestions.push('帮我起草一封项目跟进邮件');
    } catch (error) {
      this.logger.warn(`快捷建议生成失败，回退通用池: ${error instanceof Error ? error.message : error}`);
    }
    // 去重后用兜底池补足到 4 条
    const seen = new Set<string>();
    const result: string[] = [];
    for (const s of [...suggestions, ...fallback]) {
      if (result.length >= 4) break;
      if (!seen.has(s)) {
        seen.add(s);
        result.push(s);
      }
    }
    return result;
  }

  /** 按任务编号查找任务（研发池：主库+产品库；协同池任务不支持写操作，有意不含） */
  private async findTaskById(taskId: string): Promise<TaskRow | null> {
    const rows = await this.loadTaskRows();
    return rows.find((t) => t.taskId === taskId) ?? null;
  }

  /** 按分类名解析 category_id / sub_project_id（支持「分类」或「分类/子项目」） */
  private async resolveCategory(
    input: string,
  ): Promise<
    | { ok: true; categoryId: string; subProjectId: string; pathLabel: string }
    | { ok: false; message: string }
  > {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'rd.taskCategories' },
      select: { value: true },
    });
    const categories = (Array.isArray(setting?.value) ? setting.value : []).map((c) =>
      c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {},
    );
    const clean = (v: unknown) => String(v ?? '').trim();
    const [catPart, subPart] = input.split('/').map((s) => s.trim());
    const category =
      categories.find((c) => clean(c.label) === catPart) ??
      categories.find((c) => clean(c.label).includes(catPart) || catPart.includes(clean(c.label)));
    if (!category) {
      const available = categories.map((c) => clean(c.label)).filter(Boolean).join('、');
      return { ok: false, message: `分类「${catPart}」不存在。现有分类：${available || '（无）'}。请与用户确认后重试。` };
    }
    const children = (Array.isArray(category.children) ? category.children : []).map((c) =>
      c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {},
    );
    let subProject = subPart
      ? children.find((c) => clean(c.label) === subPart) ??
        children.find((c) => clean(c.label).includes(subPart) || subPart.includes(clean(c.label)))
      : children[0];
    if (subPart && !subProject) {
      const availableSubs = children.map((c) => clean(c.label)).filter(Boolean).join('、');
      return {
        ok: false,
        message: `分类「${clean(category.label)}」下没有子项目「${subPart}」。现有子项目：${availableSubs || '（无）'}。`,
      };
    }
    if (!subProject) {
      return { ok: false, message: `分类「${clean(category.label)}」下没有任何子项目，无法立项。` };
    }
    return {
      ok: true,
      categoryId: clean(category.id),
      subProjectId: clean(subProject.id),
      pathLabel: [clean(category.label), clean(subProject.label)].filter(Boolean).join(' / '),
    };
  }

  // ── 待确认动作：KV 存储 + 确认/取消 ─────────────────────────────────────────

  private async readPendingActions(): Promise<Record<string, PendingActionEntry>> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: PENDING_ACTIONS_KEY },
      select: { value: true },
    });
    const value = setting?.value;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? ({ ...(value as Record<string, PendingActionEntry>) })
      : {};
  }

  private async writePendingActions(map: Record<string, PendingActionEntry>): Promise<void> {
    // 淘汰：已终结且超过 24h 的条目 + 超量最旧条目
    const entries = Object.values(map).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const kept = entries
      .filter((e) => e.status === 'pending' || new Date(e.createdAt).getTime() > cutoff)
      .slice(0, PENDING_ACTIONS_MAX);
    const next: Record<string, PendingActionEntry> = {};
    for (const e of kept) next[e.id] = e;
    await this.prisma.systemSetting.upsert({
      where: { key: PENDING_ACTIONS_KEY },
      create: { key: PENDING_ACTIONS_KEY, category: 'matechat', value: next as unknown as Prisma.InputJsonValue },
      update: { value: next as unknown as Prisma.InputJsonValue },
    });
  }

  private async savePendingAction(
    user: RagUserContext,
    conversationId: string,
    tool: PendingActionEntry['tool'],
    payload: Record<string, unknown>,
    cardBase: { label: string; summary: string; fields: Array<{ label: string; value: string }> },
  ): Promise<PendingActionCard> {
    const now = new Date();
    const id = `act-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
    const card: PendingActionCard = {
      id,
      tool,
      expiresAt: new Date(now.getTime() + PENDING_ACTION_TTL_MS).toISOString(),
      ...cardBase,
    };
    const map = await this.readPendingActions();
    map[id] = {
      id,
      userId: user.userId,
      conversationId,
      tool,
      payload,
      card,
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt: card.expiresAt,
    };
    await this.writePendingActions(map);
    return card;
  }

  /** 回答落库后，把本轮生成的待确认动作绑定到 assistant 消息（供刷新后按消息恢复卡片） */
  async bindActionsToMessage(actionIds: string[], messageId: string): Promise<void> {
    if (actionIds.length === 0) return;
    const map = await this.readPendingActions();
    let changed = false;
    for (const id of actionIds) {
      if (map[id]) {
        map[id].messageId = messageId;
        changed = true;
      }
    }
    if (changed) await this.writePendingActions(map);
  }

  /** 列出会话内仍待确认（pending 且未过期）的动作卡，带其所属消息 id，供前端刷新后恢复 */
  async listConversationPendingActions(
    conversationId: string,
    user: RagUserContext,
  ): Promise<Array<{ messageId: string | null; card: PendingActionCard }>> {
    const map = await this.readPendingActions();
    const nowMs = Date.now();
    return Object.values(map)
      .filter(
        (e) =>
          e.conversationId === conversationId &&
          e.userId === user.userId &&
          e.status === 'pending' &&
          new Date(e.expiresAt).getTime() > nowMs,
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((e) => ({ messageId: e.messageId ?? null, card: e.card }));
  }

  /** 用户点击「确认执行」：以用户本人身份执行动作（权限二次校验） */
  async confirmPendingAction(actionId: string, user: RagUserContext): Promise<{ ok: true; message: string }> {
    const map = await this.readPendingActions();
    const entry = map[actionId];
    if (!entry) throw new NotFoundException('该动作不存在或已过期清理');
    if (entry.userId !== user.userId) throw new ForbiddenException('只能确认自己发起的动作');
    if (entry.status !== 'pending') throw new BadRequestException(`该动作已${entry.status === 'executed' ? '执行' : '取消'}，不能重复操作`);
    if (new Date(entry.expiresAt).getTime() < Date.now()) {
      entry.status = 'canceled';
      entry.resultMessage = '已过期';
      await this.writePendingActions(map);
      throw new BadRequestException('该动作已过期（30 分钟有效），请在对话里重新发起');
    }

    let message: string;
    if (entry.tool === 'create_task') {
      if (!this.hasAnyPermission(user, ['rd-task:create'])) throw new ForbiddenException('没有立项权限');
      const task = (await this.rdService.createTask(entry.payload)) as Record<string, unknown>;
      message = `已提交立项「${String(entry.payload.title ?? '')}」（任务号 ${String(task.task_id ?? '未知')}），等待管理员审核。`;
    } else if (entry.tool === 'update_task_progress') {
      if (!this.hasAnyPermission(user, PROGRESS_NOTE_PERMISSIONS)) throw new ForbiddenException('没有记录任务进展的权限');
      const taskId = String(entry.payload.taskId ?? '');
      const progress = typeof entry.payload.progress === 'number' ? entry.payload.progress : undefined;
      const canEditAny = this.hasAnyPermission(user, RD_TASK_MANAGER_PERMISSIONS);
      // 归属校验交给服务层：管理员可写任意任务，普通成员仅限本人主责/协作的任务
      await this.rdService.createTaskProgressNote({
        taskId,
        text: String(entry.payload.text ?? ''),
        progress,
        actor: { id: user.userId, name: user.name ?? '未知用户', role: user.roleName ?? undefined },
        files: [],
        requesterUserId: user.userId,
        requesterName: user.name,
        canEditAny,
      });
      // 留痕只记录 progress 快照，不改任务本身——与工作台一致，进度变更需单独 updateTask
      if (progress !== undefined) {
        await this.rdService.updateTask(taskId, { progress }, {
          requesterUserId: user.userId,
          requesterName: user.name,
          canEditAny,
        });
      }
      message = `已为任务「${String(entry.payload.taskTitle ?? taskId)}」记录进展${progress !== undefined ? `，进度更新为 ${progress}%` : ''}。`;
    } else if (entry.tool === 'approve_task_review') {
      if (!this.hasAnyPermission(user, RD_TASK_MANAGER_PERMISSIONS)) throw new ForbiddenException('没有任务审核权限');
      const taskId = String(entry.payload.taskId ?? '');
      const decision = entry.payload.decision === 'reject' ? 'reject' : 'approve';
      // 复用工作台同款审批通道：updateTask 的 _review_action 会按任务的 pending_review_type 自动处理
      await this.rdService.updateTask(
        taskId,
        {
          _review_action: decision,
          _reviewer_name: user.name,
          ...(decision === 'reject' ? { _reject_reason: String(entry.payload.reason ?? '') } : {}),
        } as Record<string, unknown>,
        { requesterUserId: user.userId, requesterName: user.name, canEditAny: true },
      );
      message = `已${decision === 'approve' ? '审批通过' : '驳回'}任务「${String(entry.payload.taskTitle ?? taskId)}」。`;
    } else {
      if (!this.hasAnyPermission(user, SEND_MESSAGE_PERMISSIONS)) throw new ForbiddenException('没有发送站内通知的权限');
      await this.rdService.createMessage({
        sender: { id: user.userId, name: user.name ?? '未知用户', role: user.roleName ?? null },
        recipient_id: (entry.payload.recipient_id as string) ?? null,
        recipient_person_id: (entry.payload.recipient_person_id as string) ?? null,
        recipient_name: (entry.payload.recipient_name as string) ?? null,
        subject: (entry.payload.subject as string) ?? null,
        body: String(entry.payload.body ?? ''),
      });
      message = `已发送通知给 ${String(entry.payload.recipient_name ?? '')}。`;
    }

    entry.status = 'executed';
    entry.resultMessage = message;
    await this.writePendingActions(map);
    this.auditAction(user.userId, entry, 'confirmed', message);
    return { ok: true, message };
  }

  /** 用户点击「取消」 */
  async cancelPendingAction(actionId: string, user: RagUserContext): Promise<{ ok: true; message: string }> {
    const map = await this.readPendingActions();
    const entry = map[actionId];
    if (!entry) throw new NotFoundException('该动作不存在或已过期清理');
    if (entry.userId !== user.userId) throw new ForbiddenException('只能取消自己发起的动作');
    if (entry.status !== 'pending') throw new BadRequestException('该动作已处理，不能重复操作');
    entry.status = 'canceled';
    entry.resultMessage = '用户已取消';
    await this.writePendingActions(map);
    this.auditAction(user.userId, entry, 'canceled', '用户取消执行');
    return { ok: true, message: '已取消，未执行任何操作。' };
  }

  private auditAction(userId: string, entry: PendingActionEntry, stage: 'confirmed' | 'canceled', detail: string): void {
    void this.prisma.auditLog
      .create({
        data: {
          userId,
          action: 'MATECHAT_TOOL_CALL',
          resource: 'chat_pending_action',
          resourceId: entry.id,
          meta: {
            tool: entry.tool,
            stage,
            detail,
            conversationId: entry.conversationId,
          } as Prisma.InputJsonValue,
        },
      })
      .catch((error) =>
        this.logger.warn(`动作审计写入失败: ${error instanceof Error ? error.message : error}`),
      );
  }
}
