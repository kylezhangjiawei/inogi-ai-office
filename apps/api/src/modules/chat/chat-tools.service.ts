import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type ChatPendingAction } from '@prisma/client';
import OpenAI from 'openai';

import { PrismaService } from '../../prisma/prisma.service';
import { ImageGenerationService } from '../image-generation/image-generation.service';
import { VideoGenerationService } from '../video-generation/video-generation.service';
import { computeReplenishRows } from '../procurement/replenish-core';
import { PROC_STATUS_LABELS, PROC_TERMINAL_STATUSES, type ProcStatus } from '../procurement/procurement.types';
import { UPLOADED_MEDIA_MARKER } from '../../common/media-upload.constants';
import { RagService, type RagUserContext } from '../rag/rag.service';
import { isWorkspaceAllowed } from '../research-development/rd-workspace.context';
import {
  RD_DEFAULT_SUBPROJECT_FLAG,
  RD_MAIN_PRODUCT_ID,
  ResearchDevelopmentService,
} from '../research-development/research-development.service';
import { ChatFileExportService } from './chat-file-export.service';
import { shanghaiDayStart } from './chat-streak.service';
import { THOUGHT_PARAM } from './react-loop';
import {
  AGENT_ACTIONS,
  AGENT_ACTION_PAYLOAD_KEY,
  AGENT_BATCH_MAX_TASKS,
  isFieldAction,
  type AgentActionDef,
  type AgentActionTool,
  type AgentCustomActionDef,
  type AgentCustomActionTool,
  type AgentFieldActionDef,
} from './agent-actions';
import { checkAgentPermission } from './agent-permission';
import { canManageTaskStructure } from '../research-development/research-development.controller';
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

/** 工具执行上下文：本轮消息级的附加信息（如用户上传的图片），供需要的工具按需取用 */
export type ChatToolContext = {
  /** 本轮用户上传的图片的外部可直连 URL（供 generate_video 作首帧/参考图） */
  uploadedImageUrls?: string[];
};

type ToolSpec = {
  definition: OpenAI.Chat.Completions.ChatCompletionTool;
  /** 前端步骤条显示的动作名（如「查询研发任务」） */
  label: string;
  /**
   * 挂载该工具所需的权限（任一命中即可）；缺省表示人人可用。
   * 只决定「要不要把工具定义发给模型」——execute 里各自的权限校验才是真正的闸门，两者不可互相替代。
   * 不挂无权限的工具，模型就不会拿它去试，省掉一整轮上游调用与一次注定失败的工具执行。
   */
  permissions?: string[];
  /** 该工具是否计入每日生图配额（生图/改图），超额后不再下发 */
  countsAgainstImageQuota?: boolean;
  /** 该工具是否计入每日生视频配额，超额后不再下发（视频更贵，闸门更严） */
  countsAgainstVideoQuota?: boolean;
  /** 该工具的执行超时（缺省 TOOL_TIMEOUT_MS；生图等长任务单独放宽） */
  timeoutMs?: number;
  execute: (
    args: Record<string, unknown>,
    user: RagUserContext,
    conversationId: string,
    ctx: ChatToolContext,
  ) => Promise<ChatToolResult>;
};

/** 单个工具执行超时：超时结果回给模型而不是挂死整条 SSE */
const TOOL_TIMEOUT_MS = 10_000;
/** 生图工具超时：上游图像生成 + OSS 落库通常 20s~2min，给足预算 */
const IMAGE_TOOL_TIMEOUT_MS = 5 * 60 * 1000;
/** 生视频工具超时：仅出确认卡或提交异步任务（不等生成），但自动提交路径含一次上游 POST（30s），留 45s */
const VIDEO_TOOL_TIMEOUT_MS = 45_000;
/**
 * 作品库检索超时：一次 embedding 上游调用（秒级）+ 命中图从 OSS 下载再落成聊天附件（秒级），
 * 默认 10s 不够用——实测会整轮超时，模型只好回退去生成新图，正好是这功能要治的病。
 */
const LIBRARY_TOOL_TIMEOUT_MS = 30_000;
/** 语义召回预算：超了就只用关键词召回，总比整轮超时强 */
const SEMANTIC_BUDGET_MS = 10_000;
/** 命中图落成聊天附件的预算：超了就只给文字清单 */
const ATTACHMENT_BUDGET_MS = 12_000;
/** 单步预算：某一路慢了就降级，别把整个工具拖到超时（超时=整轮白跑） */
function withBudget<T>(task: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([task, guard]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** 快捷建议兜底池的运营配置 KV 键（由「运营素材管理」页读写；本服务只读，缺省用内置默认） */
export const CONTENT_SLOT_QUICK_SUGGESTIONS_KEY = 'content_slot.matechat_quick_suggestions';
/** 快捷建议内置兜底池（与业务无关、安全通用） */
export const DEFAULT_QUICK_SUGGESTIONS = [
  '帮我起草一封项目跟进邮件',
  '帮我写一份本周工作周报',
  '帮我梳理今天该优先处理的事',
  '帮我把一段内容总结成要点',
];

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
  /**
   * 结构父任务；顶层任务为 null。
   * 任务树在这里被摊平成一维列表，不记下来的话 Agent 就看不出「这是子任务」——
   * 它会照常把子任务放进「移动归类」确认卡，而 moveTasks 只认顶层任务，
   * 用户点了执行才报错，且与 Agent 刚说过的「任务都存在」自相矛盾。
   */
  parentTaskId: string | null;
  parentTitle: string;
};

/** 待确认动作有效期：过期后确认按钮失效，须让模型重新发起 */
const PENDING_ACTION_TTL_MS = 30 * 60 * 1000;

/**
 * 每人每日生图次数上限（上海自然日）。
 * 生图是 ReAct 里唯一不经用户确认、又真花钱的动作（生视频有独立成本闸门），
 * 单请求的轮次上限拦不住「一天问一百次」，故加日闸门。超额后生图工具当天不再下发。
 */
const DAILY_IMAGE_TOOL_LIMIT = (() => {
  const raw = Number(process.env.MATECHAT_DAILY_IMAGE_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 20;
})();

/**
 * 每日生视频闸门。生视频比生图更贵，且确认卡只挡单次、拦不住「一天确认一百次」；
 * 故与生图同构加一道日上限。超额后当天不再下发 generate_video 工具。
 * env MATECHAT_DAILY_VIDEO_LIMIT 可调，默认 5（比生图更严）。
 */
const DAILY_VIDEO_TOOL_LIMIT = (() => {
  const raw = Number(process.env.MATECHAT_DAILY_VIDEO_LIMIT);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 5;
})();

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
  'rd-task:reassign',
  'rd-project:direct',
  'rd-project:review-l1',
  'rd-project:review-l2',
  'rd-people:manage',
];

/**
 * Agent 侧对「影响他人」的高风险写动作的额外收紧：反射到的控制器端点权限为了页面编辑而放宽
 * （含 page:rd-my-workspace，几乎全员持有），普通成员即便被挂上这些工具，在服务层也必被归属
 * 校验拒绝，只是白烧一轮。这里在反射门之外再 AND 一道管理权限——只收紧不放宽，不碰 HTTP
 * 端点（页面编辑不受影响），failure-closed 不变。key 是工具名，value 是「还必须命中其一」的权限。
 * 目前只收 reassign_task（改派他人负责人，普通成员在服务层必被拒）。
 */
const AGENT_ACTION_EXTRA_PERMISSIONS: Record<string, string[]> = {
  reassign_task: RD_TASK_MANAGER_PERMISSIONS,
};

const RD_TASK_CREATE_PERMISSIONS = ['rd-task:create', 'rd-project:propose', 'rd-project:direct'];
const RD_TASK_STRUCTURE_MANAGER_PERMISSIONS = [
  'rd-task:reassign',
  'rd-project:direct',
  'rd-project:review-l1',
  'rd-project:review-l2',
  'rd-people:manage',
];

/** 审批必须命中明确的管理/审核权限，不能复用普通任务编辑权限。 */
const RD_TASK_REVIEW_PERMISSIONS = [
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

/** 采购数据查询权限：能看采购页面或有采购操作码的人才可用（含单价等敏感信息） */
const PROC_QUERY_PERMISSIONS = [
  'page:proc-cockpit',
  'page:proc-materials',
  'proc-task:create',
  'proc:sync-erp',
];

/** 会生成待确认动作卡的写操作工具 */
type PendingActionTool =
  | 'create_task'
  | 'send_reminder'
  | 'update_task_progress'
  | 'approve_task_review'
  | 'generate_video'
  /** 注册表驱动的系统操作（确认级） */
  | AgentActionTool;

/** ChatPendingAction 行取出后定型的形态（payload/card 是 Json 列，读出来是 JsonValue） */
type PendingActionEntry = Omit<ChatPendingAction, 'payload' | 'card'> & {
  payload: Record<string, unknown>;
  card: PendingActionCard;
};

/** 可申请放弃的任务状态：与工作台「申请放弃」入口的判定一致（活跃任务才能放弃） */
const ABANDONABLE_TASK_STATUSES = ['in_progress', 'paused_leave', 'paused_blocked', 'on_hold'];

/**
 * loadTaskRows 一次最多收集的任务行数。
 *
 * 这是**防御性上限**（挡住任务树异常膨胀把内存吃光），不是展示条数限制——展示侧各自 slice
 * （query_tasks 只列 30 条），汇总侧要的是全量。原值 800 会让超出部分的任务对
 * findTaskById / locateTasks「不存在」，于是 Agent 写工具对真实存在的任务报「找不到」，
 * get_dashboard_summary 的统计也会偏小；而这两种错都不会报错，只会悄悄给出错误答案。
 * 行本身是十来个短字段的扁平对象，抬到这个量级的内存开销可以忽略。
 */
const MAX_TASK_ROWS = 20_000;

/**
 * custom 型操作校验通过后的执行计划。
 * payload 会原样落进确认卡，用户点确认时再交给 apply——所以它必须是可 JSON 序列化的纯数据。
 */
type CustomActionPlan = {
  payload: Record<string, unknown>;
  /** 确认卡摘要 */
  summary: string;
  /** 确认卡字段：用户就靠这些判断要不要点确认，影响面必须写进去 */
  fields: Array<{ label: string; value: string }>;
  /** 回给模型的观察值里描述这次动作的那句话 */
  detail: string;
};

/** custom 型操作的执行体：plan 只校验取值不写库，apply 才落写 */
type CustomActionRunner = {
  plan: (
    args: Record<string, unknown>,
    user: RagUserContext,
  ) => Promise<CustomActionPlan | { error: string }>;
  apply: (payload: Record<string, unknown>, user: RagUserContext) => Promise<string>;
};

/**
 * 给工具定义注入统一的 thought 参数（ReAct 的显式推理）。
 *
 * 在这里统一注入而不是逐个工具手写：12 个工具的 schema 各不相同，手写会漏、会写歪，
 * 且以后加工具还得记得补。返回副本，不改动注册表里的原定义。
 * 故意不放进 required——模型忘填时应该照常执行工具，而不是整轮调用失败。
 */
function withThoughtParam(
  definition: OpenAI.Chat.Completions.ChatCompletionTool,
): OpenAI.Chat.Completions.ChatCompletionTool {
  if (definition.type !== 'function') return definition;
  const params = (definition.function.parameters ?? {}) as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
  return {
    ...definition,
    function: {
      ...definition.function,
      parameters: {
        ...params,
        type: params.type ?? 'object',
        properties: {
          [THOUGHT_PARAM]: {
            type: 'string',
            description:
              '调用这个工具的理由，一句话（不超过 30 字），例如「先查逾期任务再按负责人归类」。会展示给用户，说明你为什么要这一步。',
          },
          ...(params.properties ?? {}),
        },
      },
    },
  };
}

/** 非 pending 状态下拒绝确认/取消时给用户的说法 */
function pendingActionBusyMessage(status: string): string {
  if (status === 'executed') return '该动作已执行，不能重复操作';
  if (status === 'executing') return '该动作正在执行中，请稍候';
  return '该动作已取消，不能重复操作';
}

/** Json 列取出时定型；payload/card 都是本服务自己写进去的，形状可信 */
function toPendingActionEntry(row: ChatPendingAction): PendingActionEntry {
  return {
    ...row,
    payload: (row.payload ?? {}) as Record<string, unknown>,
    card: row.card as unknown as PendingActionCard,
  };
}

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
    private readonly videoGenerationService: VideoGenerationService,
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
      permissions: RD_TASK_CREATE_PERMISSIONS,
      definition: {
        type: 'function',
        function: {
          name: 'create_task',
          description:
            '为用户发起研发任务立项。调用后只会生成一张「待确认动作卡」，用户在界面点击确认后才会创建进行中的任务，无需管理员审核。当用户明确要求立项/建任务时使用；分类名不确定时可先用 query_tasks 了解现有分类路径。',
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
      permissions: SEND_MESSAGE_PERMISSIONS,
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
      permissions: PROGRESS_NOTE_PERMISSIONS,
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
      permissions: RD_TASK_REVIEW_PERMISSIONS,
      definition: {
        type: 'function',
        function: {
          name: 'approve_task_review',
          description:
            '审批处于「待审核」状态的研发任务成果验收或放弃申请；历史遗留的其他待审变更可选择 approve 直接应用。调用后只生成「待确认动作卡」，用户确认后才真正生效。仅审核人/管理员可用；task_id 从 query_tasks 结果获得（状态为 pending_review 的任务）。',
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
    query_procurement: {
      label: '查询采购数据',
      permissions: PROC_QUERY_PERMISSIONS,
      definition: {
        type: 'function',
        function: {
          name: 'query_procurement',
          description:
            '查询采购与库存数据（只读）。视图选择：问"哪些物料缺料/该补什么货/库存不足"→view=shortage（缺料与补货建议，已扣除在途与进行中任务，含最近供应商/单价）；问"在途/已下单未到货/什么时候到"→view=transit（T+ 采购单未到齐明细行）；问"采购任务进展/采购员在跟什么"→view=tasks（进行中采购任务）。用户提到具体物料名/供应商/单号时务必把它作为 keyword 传入以精确过滤。',
          parameters: {
            type: 'object',
            properties: {
              view: {
                type: 'string',
                enum: ['shortage', 'transit', 'tasks'],
                description: 'shortage=缺料与补货建议 / transit=在途采购单 / tasks=进行中采购任务',
              },
              keyword: { type: 'string', description: '按物料名称/编码/单号模糊过滤，可选' },
            },
            required: ['view'],
          },
        },
      },
      execute: (args, user) => this.queryProcurement(args, user),
    },
    search_image_library: {
      label: '检索作品库',
      timeoutMs: LIBRARY_TOOL_TIMEOUT_MS,
      definition: {
        type: 'function',
        function: {
          name: 'search_image_library',
          description:
            '在用户自己的图片作品库里找现成的图（图像工场生成的 + 本地上传的）。**任何需要图片的场景都先调它**：用户问「库里有没有 XX 图」「有没有现成的 XX」「找一张 XX」，或者要配图/素材时，先搜库，命中就直接用现成的，确认没有合适的再 generate_image。query 写成空格分隔的关键词（「卡通 柯基 插画」），不要整句照抄用户的话。命中结果里最相关的一张会作为附件展示，其余以列表给出；库里的图可以直接把 id 传给 edit_image 修改。只能搜到当前用户自己的作品。',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description:
                  '检索词，**用空格分隔的关键词**而不是整句：如「卡通 柯基 插画」「蓝色 机箱 渲染」。关键词之间是「且」的关系，写得越长越难命中，2~4 个词最好',
              },
              category: { type: 'string', description: '限定作品库分类名（可选，如「产品渲染」）' },
              only_favorite: { type: 'boolean', description: '只找收藏的作品（可选）' },
              limit: { type: 'number', description: '返回条数，默认 6，最多 12' },
            },
            required: ['query'],
          },
        },
      },
      execute: (args, user, conversationId) => this.searchImageLibrary(args, user, conversationId),
    },
    generate_image: {
      label: '生成图片',
      countsAgainstImageQuota: true,
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
      countsAgainstImageQuota: true,
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
    generate_video: {
      label: '生成视频（待确认）',
      timeoutMs: VIDEO_TOOL_TIMEOUT_MS,
      countsAgainstVideoQuota: true,
      definition: {
        type: 'function',
        function: {
          name: 'generate_video',
          description:
            '根据文字或图片生成一段视频。三种模式：i2v 图生视频（需 1 张首帧图）、r2v 参考生视频（需 1~9 张参考图）、t2v 文生视频（仅需文字描述）。图片来源有两种：①用户本轮直接上传的图片——此时 image_ids 留空，系统会自动用用户上传的图；②之前 generate_image / edit_image 生成的图——把其 id 放进 image_ids。只要用户上传了图片并要求"根据图/用这张图生成视频"，就用 i2v 且 image_ids 留空。调用后不会直接生成：系统按成本闸门可能生成一张「待确认动作卡」显示预计花费，用户确认后才提交；视频生成需几分钟，完成后通过站内通知告知用户。当用户要求生成视频、把图做成视频、做个短片时使用；同一需求只调用一次。',
          parameters: {
            type: 'object',
            properties: {
              mode: {
                type: 'string',
                enum: ['i2v', 't2v', 'r2v'],
                description: 'i2v=图生视频(1张首帧) / t2v=文生视频(无需图) / r2v=参考生视频(1~9张参考图)',
              },
              prompt: {
                type: 'string',
                description: '视频内容描述：画面、动作、镜头、风格等（用户没说的可合理补全）；r2v 可用 [图1][图2] 指代参考图',
              },
              image_ids: {
                type: 'array',
                items: { type: 'string' },
                description: '来源图片 id 列表，仅当来源是 generate_image / edit_image 生成的图时才传其 id：i2v 传 1 个 / r2v 传 1~9 个。若来源是用户本轮上传的图片，则留空（系统自动用上传图）；t2v 不传',
              },
              resolution: {
                type: 'string',
                enum: ['720P', '1080P'],
                description: '分辨率，默认 720P（1080P 更清晰但更贵）',
              },
              duration: {
                type: 'number',
                description: '视频时长（秒），3~15，默认 5',
              },
            },
            required: ['mode', 'prompt'],
          },
        },
      },
      execute: (args, user, conversationId, ctx) => this.generateVideo(args, user, conversationId, ctx),
    },
  };

  /** OpenAI tools 参数（第一期全员可用：三个工具均为只读，暴露面与既有聊天检索一致） */
  /**
   * 按用户权限 + 当日配额裁剪后挂载给模型的工具定义。
   *
   * 没权限的工具不下发：否则模型会拿它去试（如无立项权限的人说「帮我立项」），
   * 白烧一轮上游调用 + 一次注定返回「无权限」的工具执行，用户还要多等一轮。
   *
   * 生图配额是成本闸门：ReAct 里生图不需要用户确认，一句「画张图」就能触发，
   * 单张几十秒到一两分钟且真花钱——单请求的轮次上限管不住「一天问一百次」。
   */
  async buildAgentTools(
    user: RagUserContext,
  ): Promise<{ definitions: OpenAI.Chat.Completions.ChatCompletionTool[]; imageQuotaExhausted: boolean }> {
    // 两个日配额并行统计，别为省事串成两次往返
    const [imageUsedToday, videoUsedToday] = await Promise.all([
      this.countTodayImageUsage(user.userId),
      this.countTodayVideoUsage(user.userId),
    ]);
    const imageQuotaExhausted = imageUsedToday >= DAILY_IMAGE_TOOL_LIMIT;
    const videoQuotaExhausted = videoUsedToday >= DAILY_VIDEO_TOOL_LIMIT;
    const definitions = Object.values(this.tools)
      .filter((t) => !t.permissions || this.hasAnyPermission(user, t.permissions))
      .filter((t) => !(imageQuotaExhausted && t.countsAgainstImageQuota))
      .filter((t) => !(videoQuotaExhausted && t.countsAgainstVideoQuota))
      .map((t) => withThoughtParam(t.definition));

    // 注册表驱动的系统操作：权限从控制器方法反射，注册表里没有可抄错的权限码。
    // 反射不到声明（undeclared）时这里同样不挂载——失败关闭，见 agent-permission。
    for (const action of AGENT_ACTIONS) {
      const verdict = checkAgentPermission(action.controller, action.handler, user.permissions ?? []);
      if (!verdict.allowed) {
        if (verdict.reason === 'undeclared') {
          // 这会让功能「静默消失」，必须留痕，否则以后排查会毫无线索
          this.logger.error(
            `Agent 操作 ${action.tool} 无法挂载：${action.handler} 未声明 @Permissions，已按失败关闭处理`,
          );
        }
        continue;
      }
      // 高风险写动作的额外收紧：反射门通过后，再要求命中其对应的管理权限（见常量说明）。
      if (!this.satisfiesAgentActionExtra(action.tool, user)) continue;
      definitions.push(withThoughtParam(this.agentActionDefinition(action)));
    }
    return { definitions, imageQuotaExhausted };
  }

  /**
   * 今日（上海自然日）该用户已产生的图片生成条数。
   * 从 AiUsageLog 统计而不是新建计数表：那张表本来就按 [userId, createdAt] 建了索引，
   * 且记的是真实产生的用量，重启、多实例都不会丢计数。
   */
  private async countTodayImageUsage(userId: string): Promise<number> {
    try {
      return await this.prisma.aiUsageLog.count({
        where: { userId, modality: 'image', createdAt: { gte: shanghaiDayStart(new Date()) } },
      });
    } catch (error) {
      // 统计失败不该让用户连话都说不了：放行，配额是成本护栏不是安全边界
      this.logger.warn(`生图配额统计失败，本轮放行: ${error instanceof Error ? error.message : error}`);
      return 0;
    }
  }

  /** 今日（上海自然日）该用户已生成的视频条数。与生图同口径，用于每日生视频闸门。 */
  private async countTodayVideoUsage(userId: string): Promise<number> {
    try {
      return await this.prisma.aiUsageLog.count({
        where: { userId, modality: 'video', createdAt: { gte: shanghaiDayStart(new Date()) } },
      });
    } catch (error) {
      // 与生图同理：统计失败放行，配额是成本护栏不是安全边界
      this.logger.warn(`生视频配额统计失败，本轮放行: ${error instanceof Error ? error.message : error}`);
      return 0;
    }
  }

  toolLabel(name: string): string {
    return this.tools[name]?.label ?? name;
  }

  /**
   * 高风险写动作的额外权限收紧：反射到的端点权限为页面编辑而放宽，这里在其之外再 AND 一道
   * 管理权限。三道闸门（挂载裁剪 / 执行前 / 确认时）共用它，口径一致，避免只在一处收紧。
   * 返回 true = 满足（或该动作本就无额外要求）。
   */
  private satisfiesAgentActionExtra(tool: string, user: RagUserContext): boolean {
    const extra = AGENT_ACTION_EXTRA_PERMISSIONS[tool];
    return !extra || this.hasAnyPermission(user, extra);
  }

  /** 由注册表条目生成模型可见的工具定义 */
  private agentActionDefinition(action: AgentActionDef): OpenAI.Chat.Completions.ChatCompletionTool {
    const { properties, required } = isFieldAction(action)
      ? {
          properties: {
            task_id: { type: 'string', description: '任务编号，如 RD-2026-190498-ZFB' },
            [action.field]: action.fieldSchema,
          },
          required: ['task_id', action.field],
        }
      : { properties: action.properties, required: action.required };
    return {
      type: 'function',
      function: {
        name: action.tool,
        description: action.description,
        parameters: { type: 'object', properties, required },
      },
    };
  }

  /**
   * 执行注册表操作。
   *
   * 权限在这里**二次校验**：挂载时裁剪只是省一轮空转，真闸门在执行前。
   * 目标任务经 findTaskById 定位，它只覆盖研发池，协同池任务在这一层就找不到。
   */
  private async executeAgentAction(
    action: AgentActionDef,
    args: Record<string, unknown>,
    user: RagUserContext,
    conversationId: string,
  ): Promise<ChatToolResult> {
    const verdict = checkAgentPermission(action.controller, action.handler, user.permissions ?? []);
    if (!verdict.allowed || !this.satisfiesAgentActionExtra(action.tool, user)) {
      return {
        ok: false,
        summary: '无操作权限',
        content: `当前用户没有执行「${action.label}」的权限，请如实告知用户，不要尝试其他方式绕过。`,
      };
    }
    return isFieldAction(action)
      ? this.executeFieldAction(action, args, user, conversationId)
      : this.executeCustomAction(action, args, user, conversationId);
  }

  /** field 型：单任务改单字段，出口固定 rdService.updateTask */
  private async executeFieldAction(
    action: AgentFieldActionDef,
    args: Record<string, unknown>,
    user: RagUserContext,
    conversationId: string,
  ): Promise<ChatToolResult> {
    const taskId = String(args.task_id ?? '').trim();
    if (!taskId) return { ok: false, summary: '缺少任务编号', content: '需要提供 task_id。' };
    const task = await this.findTaskById(taskId);
    if (!task) {
      return {
        ok: false,
        summary: '任务不存在',
        content: `找不到任务 ${taskId}（中美协同池的任务不支持修改）。请先用 query_tasks 确认任务编号。`,
      };
    }

    const normalized = action.normalize(args[action.field]);
    if (!normalized.ok) {
      return { ok: false, summary: '参数无效', content: normalized.message };
    }

    const payload = { [AGENT_ACTION_PAYLOAD_KEY[action.tool]]: normalized.value };
    const fields = [
      { label: '任务', value: `[${task.taskId}] ${task.title}` },
      { label: '当前负责人', value: task.owner },
      { label: action.fieldLabel, value: normalized.display },
    ];

    if (action.risk === 'confirm') {
      const card = await this.savePendingAction(user, conversationId, action.tool, { taskId, payload }, {
        label: action.label.replace('（待确认）', ''),
        summary: `${action.label.replace('（待确认）', '')}：${task.title}`,
        fields,
      });
      return {
        ok: true,
        summary: `已生成确认卡：${action.fieldLabel} → ${normalized.display}`,
        content: `已生成「${action.label}」待确认动作（任务 ${task.taskId}，${action.fieldLabel}改为 ${normalized.display}）。尚未生效：需要用户点击确认卡才会真正修改。请告知用户核对后确认，不要声称已经改好。`,
        pendingAction: card,
      };
    }

    try {
      await this.applyTaskUpdate(taskId, payload, user);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, summary: '修改失败', content: `修改失败：${message}。请如实告知用户。` };
    }
    return {
      ok: true,
      summary: `${action.fieldLabel} → ${normalized.display}`,
      content: `已将任务 ${task.taskId}「${task.title}」的${action.fieldLabel}改为 ${normalized.display}，修改已生效。`,
    };
  }

  /**
   * custom 型：参数校验与写出口都在各自的执行体里。
   *
   * plan 只做校验与取值，不写任何库——confirm 级操作从「模型调用」到「用户确认」之间可能
   * 隔几分钟，期间任务可能已被别人改动，所以真正的写在 apply 里做，且 apply 由确认流程调用。
   */
  private async executeCustomAction(
    action: AgentCustomActionDef,
    args: Record<string, unknown>,
    user: RagUserContext,
    conversationId: string,
  ): Promise<ChatToolResult> {
    const planned = await this.customActionRunners()[action.tool].plan(args, user);
    if ('error' in planned) {
      return { ok: false, summary: '参数无效', content: planned.error };
    }
    const bareLabel = action.label.replace('（待确认）', '');

    if (action.risk === 'confirm') {
      const card = await this.savePendingAction(user, conversationId, action.tool, planned.payload, {
        label: bareLabel,
        summary: planned.summary,
        fields: planned.fields,
      });
      return {
        ok: true,
        summary: `已生成确认卡：${planned.summary}`,
        content: `已生成「${bareLabel}」待确认动作（${planned.detail}）。尚未生效：需要用户点击确认卡才会执行。请告知用户核对后确认，不要声称已经做完。`,
        pendingAction: card,
      };
    }

    try {
      const message = await this.customActionRunners()[action.tool].apply(planned.payload, user);
      return { ok: true, summary: planned.summary, content: message };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, summary: '执行失败', content: `执行失败：${message}。请如实告知用户。` };
    }
  }

  /**
   * custom 型操作的执行体表。
   *
   * 键类型是 AgentCustomActionTool，注册表里加了工具却没在这里配执行体，编译期就报错——
   * 与 AGENT_ACTION_PAYLOAD_KEY 对 field 型的穷尽检查是同一个用意。
   */
  private customActionRunners(): Record<AgentCustomActionTool, CustomActionRunner> {
    const text = (v: unknown) => String(v ?? '').trim();

    return {
      request_task_merge: {
        plan: async (args) => {
          const sourceId = text(args.source_task_id);
          const targetId = text(args.target_task_id);
          const reason = text(args.reason);
          if (!sourceId || !targetId) return { error: '需要同时提供源任务编号（被并入方）与目标任务编号（保留方）。' };
          if (sourceId === targetId) return { error: '源任务与目标任务不能是同一个任务。' };
          if (!reason) return { error: '需要提供合并原因，用于记录本次变更。' };
          const source = await this.findTaskById(sourceId);
          if (!source) return { error: this.taskNotFoundHint(sourceId, '源任务') };
          const target = await this.findTaskById(targetId);
          if (!target) return { error: this.taskNotFoundHint(targetId, '目标任务') };
          // 在生成确认卡前挡住跨库合并，避免用户确认后才发现目标不受支持。
          if (source.store !== target.store) {
            return {
              error: `任务合并只能在同一个任务库内进行：${sourceId} 在「${source.store}」，${targetId} 在「${target.store}」。请改选同库的目标任务。`,
            };
          }
          if (source.status === 'pending_review') {
            return { error: `任务 ${sourceId} 正在审核中，需等当前审核结束后才能合并。` };
          }
          if (source.status === 'completed' || source.status === 'archived') {
            return { error: `任务 ${sourceId} 已是「${source.status}」状态，不再支持合并。` };
          }
          return {
            payload: { sourceId, targetId, reason },
            summary: `合并：${source.title} → ${target.title}`,
            fields: [
              { label: '被并入（将归档）', value: `[${source.taskId}] ${source.title}` },
              { label: '合并去向（保留）', value: `[${target.taskId}] ${target.title}` },
              { label: '合并原因', value: reason },
              { label: '影响', value: '源任务的子任务、进展留痕、附件、协作人并入目标任务；源任务归档' },
            ],
            detail: `源任务 ${source.taskId}「${source.title}」并入目标任务 ${target.taskId}「${target.title}」，确认后直接生效`,
          };
        },
        apply: async (payload, user) => {
          const sourceId = text(payload.sourceId);
          const targetId = text(payload.targetId);
          await this.applyTaskUpdate(
            sourceId,
            {
              status: 'pending_review',
              pending_review_type: 'merge',
              pending_merge_target: targetId,
              pending_merge_reason: text(payload.reason),
              pending_merge_requested_at: new Date().toISOString(),
              pending_merge_requested_by: user.name ?? '',
              pending_merge_requested_by_id: user.userId,
            },
            user,
          );
          return `已合并任务（${sourceId} → ${targetId}），源任务已归档。`;
        },
      },

      move_tasks_category: {
        plan: async (args) => {
          const ids = this.normalizeTaskIds(args.task_ids);
          if ('error' in ids) return ids;
          const targetCategory = text(args.target_category);
          if (!targetCategory) return { error: '需要提供目标分类，格式为「分类」或「分类/子项目」。' };
          const resolved = await this.resolveCategory(targetCategory);
          if (!resolved.ok) return { error: resolved.message };
          const located = await this.locateTasks(ids.value);
          if ('error' in located) return located;
          // moveTasks 只认顶层任务。子任务在这里就拦下，别等用户点了确认才失败——
          // 那时的报错还会和 query_tasks 刚给出的「任务都存在」自相矛盾。
          const nested = located.tasks.filter((task) => task.parentTaskId);
          if (nested.length > 0) {
            const detail = nested
              .map((task) => `${task.taskId}（已并入「${task.parentTitle || task.parentTaskId}」）`)
              .join('、');
            return {
              error:
                `以下任务已经是子任务，不能直接移动归类：${detail}。` +
                `请先把它们从父任务摘出（detach_parent），或改为移动其父任务。本次未做任何改动。`,
            };
          }
          return {
            payload: {
              taskIds: ids.value,
              categoryId: resolved.categoryId,
              subProjectId: resolved.subProjectId,
              pathLabel: resolved.pathLabel,
            },
            summary: `移动 ${located.tasks.length} 条任务到「${resolved.pathLabel}」`,
            fields: [
              { label: '目标分类', value: resolved.pathLabel },
              { label: `任务（${located.tasks.length} 条）`, value: this.describeTasks(located.tasks) },
            ],
            detail: `${located.tasks.length} 条任务移动到「${resolved.pathLabel}」`,
          };
        },
        apply: async (payload, user) => {
          const perms = user.permissions ?? [];
          // 与控制器 moveTasks 的判定逐字一致：管理员可移动任意任务，
          // 仅有工作台页面权限的普通成员只能移动自己负责的（由服务层兜底校验）。
          const canMoveAny =
            perms.includes('*') ||
            perms.includes('rd-task:move') ||
            perms.includes('rd-task:reassign') ||
            perms.includes('rd-task:edit');
          const result = await this.rdService.moveTasks(
            payload.taskIds,
            {
              productId: RD_MAIN_PRODUCT_ID,
              categoryId: text(payload.categoryId),
              subId: text(payload.subProjectId),
            },
            { requesterUserId: user.userId, requesterName: user.name, canMoveAny },
          );
          return `已把 ${result.movedCount} 条任务移动到「${text(payload.pathLabel)}」，修改已生效。`;
        },
      },

      attach_tasks_to_parent: {
        plan: async (args) => {
          const ids = this.normalizeTaskIds(args.task_ids);
          if ('error' in ids) return ids;
          const parentTaskId = text(args.parent_task_id);
          if (!parentTaskId) return { error: '需要提供目标父任务编号。' };
          if (ids.value.includes(parentTaskId)) {
            return { error: `父任务 ${parentTaskId} 不能同时出现在要并入的任务列表里。` };
          }
          const parent = await this.findTaskById(parentTaskId);
          if (!parent) return { error: this.taskNotFoundHint(parentTaskId, '父任务') };
          const located = await this.locateTasks(ids.value);
          if ('error' in located) return located;
          const foreign = located.tasks.filter((t) => t.store !== parent.store);
          if (foreign.length > 0) {
            return {
              error: `只能并入同一个任务库内的父任务：父任务在「${parent.store}」，而 ${foreign
                .map((t) => t.taskId)
                .join('、')} 在别的库。`,
            };
          }
          return {
            payload: { taskIds: ids.value, parentTaskId },
            summary: `${located.tasks.length} 条任务并入「${parent.title}」`,
            fields: [
              { label: '父任务', value: `[${parent.taskId}] ${parent.title}` },
              { label: `并入任务（${located.tasks.length} 条）`, value: this.describeTasks(located.tasks) },
              { label: '影响', value: '这些任务成为父任务的子任务，任务内容与负责人不变' },
            ],
            detail: `${located.tasks.length} 条任务并入父任务 ${parent.taskId}「${parent.title}」`,
          };
        },
        apply: async (payload, user) => {
          const taskIds = Array.isArray(payload.taskIds) ? payload.taskIds.map((id) => text(id)) : [];
          const parentTaskId = text(payload.parentTaskId);
          await this.rdService.attachTasksAsSubtasks(taskIds, parentTaskId, {
            userId: user.userId,
            userName: user.name,
            canEditAny: canManageTaskStructure(user.permissions ?? []),
          });
          return `已把 ${taskIds.length} 条任务并入父任务 ${parentTaskId}，修改已生效。`;
        },
      },

      request_task_abandon: {
        plan: async (args) => {
          const taskId = text(args.task_id);
          const reason = text(args.reason);
          if (!taskId) return { error: '需要提供要申请放弃的任务编号。' };
          if (!reason) return { error: '需要提供放弃原因，审核人要据此判断是否通过。' };
          const task = await this.findTaskById(taskId);
          if (!task) return { error: this.taskNotFoundHint(taskId, '任务') };
          // 与工作台「申请放弃」的可发起状态一致：只有活跃任务能申请放弃
          if (!ABANDONABLE_TASK_STATUSES.includes(task.status)) {
            return { error: `任务 ${taskId} 当前状态为「${task.status}」，只有进行中/挂起类的任务才能申请放弃。` };
          }
          return {
            payload: { taskId, reason },
            summary: `申请放弃：${task.title}`,
            fields: [
              { label: '任务', value: `[${task.taskId}] ${task.title}` },
              { label: '当前负责人', value: task.owner },
              { label: '放弃原因', value: reason },
              { label: '影响', value: '审核通过后任务及其子任务将被彻底移除，不可恢复' },
            ],
            detail: `任务 ${task.taskId}「${task.title}」提交放弃申请`,
          };
        },
        apply: async (payload, user) => {
          const taskId = text(payload.taskId);
          await this.applyTaskUpdate(
            taskId,
            {
              status: 'pending_review',
              pending_review_type: 'abandon',
              pending_abandon_reason: text(payload.reason),
              pending_abandon_requested_at: new Date().toISOString(),
            },
            user,
          );
          return `已提交任务 ${taskId} 的放弃申请，等待管理员审核；审核通过后任务才会被移除。`;
        },
      },
    };
  }

  /** 找不到任务时的统一提示：说清为什么找不到，并给出纠偏动作 */
  private taskNotFoundHint(taskId: string, role: string): string {
    return `找不到${role} ${taskId}（中美协同池的任务不支持此操作）。请先用 query_tasks 确认任务编号。`;
  }

  /** 批量参数归一化：去空去重、卡上限。上限存在的意义见 AGENT_BATCH_MAX_TASKS。 */
  private normalizeTaskIds(raw: unknown): { value: string[] } | { error: string } {
    if (!Array.isArray(raw)) return { error: 'task_ids 必须是任务编号数组。' };
    const ids = Array.from(new Set(raw.map((v) => String(v ?? '').trim()).filter(Boolean)));
    if (ids.length === 0) return { error: '至少要提供一个任务编号。' };
    if (ids.length > AGENT_BATCH_MAX_TASKS) {
      return {
        error: `一次最多处理 ${AGENT_BATCH_MAX_TASKS} 个任务，本次传了 ${ids.length} 个。请分批调用，每批单独由用户确认。`,
      };
    }
    return { value: ids };
  }

  /**
   * 批量定位任务；只要有一个定位不到就整批拒绝——半批生效比整批失败更难收拾。
   *
   * 整棵任务树只读一次：findTaskById 每次调用都会重读全树，逐个查 20 条就是 20 次全表读，
   * 单个工具只有 10s 预算（TOOL_TIMEOUT_MS），那样必超时。
   */
  private async locateTasks(taskIds: string[]): Promise<{ tasks: TaskRow[] } | { error: string }> {
    const rows = await this.loadTaskRows();
    const byId = new Map(rows.map((t) => [t.taskId, t]));
    const tasks: TaskRow[] = [];
    const missing: string[] = [];
    for (const id of taskIds) {
      const task = byId.get(id);
      if (task) tasks.push(task);
      else missing.push(id);
    }
    if (missing.length > 0) {
      return {
        error: `找不到这些任务：${missing.join('、')}（中美协同池的任务不支持此操作）。请先用 query_tasks 核对编号后重试，本次未做任何改动。`,
      };
    }
    return { tasks };
  }

  /** 确认卡上的任务清单：全列出来，用户要看得到自己在确认什么 */
  private describeTasks(tasks: TaskRow[]): string {
    return tasks.map((t) => `[${t.taskId}] ${t.title}`).join('\n');
  }

  /**
   * 调用 rdService.updateTask，requester 上下文与控制器逐字一致。
   * canEditAny 复用控制器导出的 canManageTaskStructure——两边各写一份迟早会分叉。
   * 归属校验（普通成员只能改自己主责/协作的任务）由服务层负责，这里不重复实现。
   */
  private async applyTaskUpdate(
    taskId: string,
    payload: Record<string, unknown>,
    user: RagUserContext,
  ): Promise<void> {
    await this.rdService.updateTask(taskId, payload, {
      requesterUserId: user.userId,
      requesterName: user.name,
      canEditAny: canManageTaskStructure(user.permissions ?? []),
    });
  }

  /** 执行工具（带超时 + 审计）。任何失败都以文本结果返回给模型，不抛异常。 */
  async execute(
    name: string,
    rawArgs: string,
    user: RagUserContext,
    conversationId: string,
    ctx: ChatToolContext = {},
  ): Promise<ChatToolResult> {
    const spec = this.tools[name];
    const agentAction = AGENT_ACTIONS.find((a) => a.tool === name);
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
    if (agentAction) {
      // 注册表操作：超时与审计沿用同一条路径，只是执行体不同
      try {
        result = await Promise.race([
          this.executeAgentAction(agentAction, args, user, conversationId),
          new Promise<ChatToolResult>((resolve) =>
            setTimeout(
              () => resolve({ ok: false, summary: '执行超时', content: '操作超时，请如实告知用户，不要假定已生效。' }),
              TOOL_TIMEOUT_MS,
            ),
          ),
        ]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Agent 操作 ${name} 执行失败: ${message}`);
        result = { ok: false, summary: '执行失败', content: `操作失败：${message}。请如实告知用户。` };
      }
    } else if (!spec) {
      result = { ok: false, summary: '未知工具', content: `工具 ${name} 不存在，请改用已提供的工具。` };
    } else {
      const timeoutMs = spec.timeoutMs ?? TOOL_TIMEOUT_MS;
      try {
        result = await Promise.race([
          spec.execute(args, user, conversationId, ctx),
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

  // ── 采购查询（只读） ─────────────────────────────────────────────────────────

  /** 采购数据三视图：缺料补货 / 在途单据 / 进行中任务。口径与采购模块页面完全一致。 */
  private async queryProcurement(args: Record<string, unknown>, user: RagUserContext): Promise<ChatToolResult> {
    if (!this.hasAnyPermission(user, PROC_QUERY_PERMISSIONS)) {
      return { ok: false, summary: '无采购数据权限', content: '当前用户没有采购数据查看权限，无法查询。请如实告知用户。' };
    }
    const view = String(args.view ?? 'shortage');
    const keyword = typeof args.keyword === 'string' ? args.keyword.trim().toLowerCase() : '';
    const hit = (...fields: Array<string | null | undefined>) =>
      !keyword || fields.some((f) => (f ?? '').toLowerCase().includes(keyword));

    if (view === 'shortage') {
      // 与 MaterialReplenishService.suggestions 同口径（共用 replenish-core 计算）
      const materials = await this.prisma.procMaterial.findMany({
        where: { safeStock: { gt: 0 } },
        select: { id: true, erpCode: true, name: true, spec: true, unit: true, safeStock: true, balances: { select: { stockQty: true } } },
      });
      const shortage = materials
        .map((m) => ({
          id: m.id,
          erpCode: m.erpCode,
          name: m.name,
          spec: m.spec,
          unit: m.unit,
          safeStock: Number(m.safeStock),
          stock: m.balances.reduce((s, b) => s + Number(b.stockQty), 0),
        }))
        .filter((m) => m.stock < m.safeStock);
      const ids = shortage.map((m) => m.id);
      const [mirrorRows, openTasks] = await Promise.all([
        this.prisma.procPurchaseOrderMirror.findMany({
          where: { materialId: { in: ids } },
          select: { materialId: true, orderedQty: true, receivedQty: true, supplierName: true, unitPrice: true, status: true, approvalStatus: true },
          orderBy: { orderDate: 'desc' },
        }),
        this.prisma.procTask.findMany({
          where: { materialId: { in: ids }, status: { notIn: PROC_TERMINAL_STATUSES } },
          select: { materialId: true, quantity: true, arrivedQty: true },
        }),
      ]);
      const rows = computeReplenishRows(
        shortage,
        mirrorRows.map((r) => ({
          materialId: r.materialId as string,
          orderedQty: Number(r.orderedQty),
          receivedQty: Number(r.receivedQty),
          supplierName: r.supplierName,
          unitPrice: r.unitPrice === null ? null : Number(r.unitPrice),
          status: r.status,
          approvalStatus: r.approvalStatus,
        })),
        openTasks.map((t) => ({ materialId: t.materialId as string, quantity: Number(t.quantity), arrivedQty: Number(t.arrivedQty) })),
      ).filter((r) => hit(r.name, r.code));
      // covered 的物料仍然缺料，只是暂时被在途/任务覆盖，不该出现在「建议下单」清单里，
      // 但要在结尾如实报数——在途量算错时这句是唯一的线索。
      const actionable = rows.filter((r) => !r.covered);
      const coveredCount = rows.length - actionable.length;
      const coveredNote = coveredCount > 0
        ? `另有 ${coveredCount} 项物料低于安全库存但缺口已被在途或进行中任务覆盖，暂不建议下单；若其中有物料迟迟不到货，请核对 T+ 在途数据是否过时。`
        : '';
      if (actionable.length === 0) {
        const base = keyword ? `没有匹配「${keyword}」的待补货物料。` : '当前没有需要下单的物料。';
        return { ok: true, summary: '无缺料', content: coveredNote ? `${base}${coveredNote}` : base };
      }
      const lines = actionable.slice(0, 20).map((r) =>
        `- ${r.code} ${r.name}：库存 ${r.stock}/安全 ${r.safeStock}，在途 ${r.inTransit}，任务中 ${r.openTaskQty}，建议补 ${r.suggestQty}${r.unit ? ` ${r.unit}` : ''}${r.lastSupplier ? `（最近：${r.lastSupplier}${r.lastPrice != null ? ` ¥${r.lastPrice}` : ''}）` : ''}`,
      );
      return {
        ok: true,
        summary: `缺料 ${actionable.length} 项`,
        content: [
          `共 ${actionable.length} 项物料需要补货（建议量已扣除在途与进行中任务）${actionable.length > 20 ? '，以下为缺口金额最大的 20 项' : ''}：`,
          ...lines,
          ...(coveredNote ? ['', coveredNote] : []),
          '',
          '可引导用户到「物料库」页点击「缺料预警」卡片一键生成补货采购任务。',
        ].join('\n'),
      };
    }

    if (view === 'transit') {
      const rows = await this.prisma.procPurchaseOrderMirror.findMany({
        select: { tpOrderNo: true, tpLineNo: true, inventoryCode: true, inventoryName: true, orderedQty: true, receivedQty: true, supplierName: true, etaDate: true, orderDate: true },
        orderBy: { orderDate: 'desc' },
        take: 1000,
      });
      const open = rows
        .filter((r) => Number(r.orderedQty) - Number(r.receivedQty) > 0)
        .filter((r) => hit(r.inventoryName, r.inventoryCode, r.tpOrderNo, r.supplierName));
      if (open.length === 0) {
        return { ok: true, summary: '无在途单据', content: keyword ? `没有匹配「${keyword}」的在途采购单。` : '当前没有未到齐的采购单。' };
      }
      const lines = open.slice(0, 30).map((r) => {
        const openQty = Number(r.orderedQty) - Number(r.receivedQty);
        return `- ${r.tpOrderNo}#${r.tpLineNo} ${r.inventoryName || r.inventoryCode}：订 ${Number(r.orderedQty)} 到 ${Number(r.receivedQty)}（差 ${openQty}）· ${r.supplierName || '供应商未知'}${r.etaDate ? ` · 预计 ${r.etaDate.toISOString().slice(0, 10)}` : ''}`;
      });
      return {
        ok: true,
        summary: `在途 ${open.length} 行`,
        content: [`共 ${open.length} 行采购单未到齐${open.length > 30 ? '，以下为最近 30 行' : ''}（数据来自畅捷通 T+ 镜像）：`, ...lines].join('\n'),
      };
    }

    if (view === 'tasks') {
      const tasks = await this.prisma.procTask.findMany({
        where: { status: { notIn: PROC_TERMINAL_STATUSES } },
        select: { code: true, materialName: true, quantity: true, arrivedQty: true, status: true, buyer: true, needDate: true, priority: true },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      });
      const filtered = tasks.filter((t) => hit(t.materialName, t.code, t.buyer));
      if (filtered.length === 0) {
        return { ok: true, summary: '无进行中采购任务', content: keyword ? `没有匹配「${keyword}」的进行中采购任务。` : '当前没有进行中的采购任务。' };
      }
      const lines = filtered.slice(0, 30).map((t) =>
        `- ${t.code} ${t.materialName}：${Number(t.quantity)} 到 ${Number(t.arrivedQty)} · ${PROC_STATUS_LABELS[t.status as ProcStatus] ?? t.status}${t.buyer ? ` · ${t.buyer}` : ''}${t.priority === 'high' ? ' · 高优' : ''}${t.needDate ? ` · 需 ${t.needDate.toISOString().slice(0, 10)}` : ''}`,
      );
      return {
        ok: true,
        summary: `进行中任务 ${filtered.length} 个`,
        content: [`共 ${filtered.length} 个进行中的采购任务${filtered.length > 30 ? '，以下为最近更新的 30 个' : ''}：`, ...lines].join('\n'),
      };
    }

    return { ok: false, summary: '未知视图', content: `view 参数无效：${view}，可选 shortage/transit/tasks。` };
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

    // 人员维度脱敏：按负责人排名、待审核明细（含负责人姓名）是敏感聚合，只对能看驾驶舱/管理任务
    // 的人给全量；普通成员看总量/状态/逾期/进度这类非敏感数字，看不到「全公司谁的活最多」。
    // 总量行里的「待审核 N」是数字统计，全员可见；脱敏的只是明细。
    const canSeeOwnerBreakdown = this.hasAnyPermission(user, [
      'page:rd-director-dashboard',
      ...RD_TASK_MANAGER_PERMISSIONS,
    ]);
    const content = [
      `研发任务总量 ${rows.length} 条：已完成 ${done.length}，未完成 ${open.length}（其中逾期 ${overdue.length}），待审核 ${pendingReview.length}。未完成任务平均进度 ${avgProgress}%。`,
      canSeeOwnerBreakdown ? `\n【按负责人（未完成，Top10）】\n${ownerLines.join('\n')}` : '',
      canSeeOwnerBreakdown
        ? (pendingReview.length > 0
            ? `\n【待审核队列】\n${reviewLines.join('\n')}${pendingReview.length > reviewLines.length ? `\n（另有 ${pendingReview.length - reviewLines.length} 条未列出）` : ''}`
            : '\n【待审核队列】无')
        : (pendingReview.length > 0 ? `\n【待审核】共 ${pendingReview.length} 条（明细需管理权限查看）` : '\n【待审核】无'),
    ].filter(Boolean).join('\n');
    return {
      ok: true,
      summary: `汇总 ${rows.length} 条任务`,
      content: `以下是研发任务全景汇总数据${canSeeOwnerBreakdown ? '' : '（当前用户为普通成员，已隐去人员维度明细）'}，请据此为用户组织回答（可做成表格）：\n\n${content}`,
    };
  }

  // ── 任务审批（走确认卡） ─────────────────────────────────────────────────────

  private async prepareApproveTaskReview(
    args: Record<string, unknown>,
    user: RagUserContext,
    conversationId: string,
  ): Promise<ChatToolResult> {
    // 审批是管理员/审核人专属：与 updateTask 的 _review_action 越权守卫同口径
    if (!this.hasAnyPermission(user, RD_TASK_REVIEW_PERMISSIONS)) {
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
    const directChange = ['proposal', 'due_date', 'collaboration', 'merge'].includes(task.pendingReviewType);
    const actionLabel = directChange
      ? (decision === 'approve' ? '应用变更' : '取消变更')
      : (decision === 'approve' ? '审批通过' : '驳回任务');
    const typeLabel =
      { proposal: '立项', result: '成果验收', due_date: '截止日期变更', collaboration: '协作变更', abandon: '放弃申请', merge: '合并' }[
        task.pendingReviewType
      ] ?? '待审核';
    const card = await this.savePendingAction(
      user,
      conversationId,
      'approve_task_review',
      { taskId, decision, reason, taskTitle: task.title, directChange },
      {
        label: actionLabel,
        summary: `${actionLabel}：「${task.title}」的${typeLabel}`,
        fields: [
          { label: '任务', value: `[${taskId}] ${task.title}` },
          { label: directChange ? '变更类型' : '审核类型', value: typeLabel },
          { label: '负责人', value: task.owner },
          { label: '决定', value: actionLabel },
          ...(decision === 'reject' ? [{ label: '驳回原因', value: reason.slice(0, 200) }] : []),
        ],
      },
    );
    return {
      ok: true,
      summary: `已生成${directChange ? '变更' : '审批'}确认卡：${task.title}`,
      content: `已生成「${actionLabel}」待确认动作（任务「${task.title}」的${typeLabel}）。尚未生效：需要用户点击「确认执行」后才会执行。请告知用户核对并确认，不要声称已经完成。`,
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

  /**
   * 作品库检索：语义召回（向量库 sourceType='image'）+ 关键词召回（prompt 文本）两路合并。
   *
   * 两路都要：向量库能命中「同义不同词」（库里写"蓝色机箱渲染图"、用户问"设备外观图"），
   * 关键词能兜住刚生成还没索引、或没配 embedding 模型的情况。
   * 归属一律以 SQL 的 userId 为准——向量库那层超管直通 visible_user_ids，不能拿来当权限闸。
   */
  private async searchImageLibrary(
    args: Record<string, unknown>,
    user: RagUserContext,
    conversationId: string,
  ): Promise<ChatToolResult> {
    const query = String(args.query ?? '').trim();
    if (!query) {
      return { ok: false, summary: '缺少检索词', content: '未提供检索词 query。' };
    }
    const limitRaw = Number(args.limit);
    const limit = Number.isFinite(limitRaw) ? Math.min(12, Math.max(1, Math.round(limitRaw))) : 6;
    const onlyFavorite = args.only_favorite === true;
    const categoryName = String(args.category ?? '').trim();

    // 分类名 → id：模型只知道名字，库里按 id 过滤。作品库分类是全局共享目录，不按人过滤。
    let categoryId: string | undefined;
    if (categoryName) {
      const category = await this.prisma.imageCategory.findFirst({
        where: { name: { contains: categoryName, mode: 'insensitive' } },
        orderBy: { name: 'asc' },
        select: { id: true },
      });
      categoryId = category?.id;
    }

    // 1) 语义召回：没配 embedding 模型或上游抽风时静默降级为「只走关键词」
    let semanticIds: string[] = [];
    try {
      const response = await withBudget(
        this.ragService.search(query, user, { topK: limit * 3, sourceTypes: ['image'] }),
        SEMANTIC_BUDGET_MS,
        { results: [], filteredByPermission: 0 },
      );
      semanticIds = response.results.map((r) => r.sourceId);
    } catch (error) {
      this.logger.warn(`作品库语义检索失败，降级为关键词检索：${error instanceof Error ? error.message : error}`);
    }

    // 2) 关键词召回 + 3) 语义命中按 id 回填（都带 userId 过滤）
    const [keywordPage, semanticRows] = await Promise.all([
      this.imageGenerationService.listImages(
        user.userId,
        1,
        limit * 2,
        onlyFavorite,
        undefined,
        undefined,
        query,
        categoryId,
      ),
      this.imageGenerationService.findOwnedImagesByIds(user.userId, semanticIds),
    ]);

    type LibraryHit = {
      id: string;
      prompt?: string;
      size?: string;
      model?: string;
      isFavorite?: boolean;
      createdAt?: Date | string;
      imageUrl?: string | null;
      imageData?: string;
      category?: { name: string } | null;
      categoryId?: string | null;
      /** 疑似缓存串图：描述与画面不符，不能拿去当"库里有这张图"推给用户 */
      mismatched?: boolean;
    };
    const semanticOrder = new Map(semanticIds.map((id, index) => [id, index] as const));
    const semanticHits = (semanticRows as LibraryHit[])
      .filter((row) => !row.mismatched)
      .filter((row) => !onlyFavorite || row.isFavorite)
      .filter((row) => !categoryId || row.categoryId === categoryId || row.category != null)
      .sort((a, b) => (semanticOrder.get(a.id) ?? 999) - (semanticOrder.get(b.id) ?? 999));

    // 字面命中全部关键词的是「严格匹配」，只有向量相近的是「相关」。
    // 不区分的话，问「小狗」会先列一串语义相近的兔子老虎，模型照单全收就成了误导。
    const terms = query.split(/[\s,，。;；、]+/).map((t) => t.trim()).filter(Boolean);
    const textOf = (row: LibraryHit) => `${row.prompt ?? ''} ${row.category?.name ?? ''}`.toLowerCase();
    const isStrict = (row: LibraryHit) =>
      terms.length > 0 && terms.every((t) => textOf(row).includes(t.toLowerCase()));
    // 放宽匹配时按命中的 2 字滑窗数量重排：SQL 只能按时间排，命中最多的那张才该排第一
    const windowsOf = (text: string) => {
      const set = new Set<string>();
      for (const term of terms) {
        if (term.length <= 2) set.add(term.toLowerCase());
        else for (let i = 0; i + 2 <= term.length; i += 1) set.add(term.slice(i, i + 2).toLowerCase());
      }
      return [...set].filter((w) => text.includes(w)).length;
    };
    // 串图记录（同一张图被多条不同描述共用）向量库里已经排除了，
    // 但关键词召回是直接查库的，这里必须再挡一次，否则又把柯基当成仓鼠推出去
    const keywordHits = ((keywordPage.items ?? []) as LibraryHit[]).filter((row) => !row.mismatched);
    const rankedKeywordHits = keywordPage.relaxed
      ? [...keywordHits].sort((a, b) => windowsOf(textOf(b)) - windowsOf(textOf(a)))
      : keywordHits;

    const merged: LibraryHit[] = [];
    // 严格匹配优先，其次放宽/关键词命中，最后才是纯语义相近
    const ordered = [
      ...rankedKeywordHits.filter(isStrict),
      ...semanticHits.filter(isStrict),
      ...rankedKeywordHits,
      ...semanticHits,
    ];
    for (const row of ordered) {
      if (merged.length >= limit) break;
      if (merged.some((item) => item.id === row.id)) continue;
      merged.push(row);
    }
    const strictCount = merged.filter(isStrict).length;

    if (merged.length === 0) {
      return {
        ok: true,
        summary: '作品库无匹配',
        content: `作品库里没有找到与「${query}」相关的现成图片${categoryName ? `（分类：${categoryName}）` : ''}。可以据此告诉用户库里没有，并在用户需要时用 generate_image 生成一张新的。`,
      };
    }

    // 最相关的一张作为附件直接展示；其余以列表给出（ChatToolResult 只支持一个附件）
    let attachment: StoredChatAttachment | undefined;
    try {
      const top = merged[0];
      // 原图已经在 OSS 里：直接引用同一个对象，不再下载+回传（实测十几秒，会把工具拖超时）
      const objectKey = await this.imageGenerationService.getOwnedImageObjectKey(user.userId, top.id);
      const filename = `作品库-${(top.prompt ?? '图片').trim().slice(0, 16) || '图片'}`;
      attachment = await withBudget(
        objectKey
          ? this.fileExportService.persistExistingObject(
              user.userId,
              { objectKey, filename: `${filename}.png` },
              conversationId,
            )
          : this.persistGeneratedImage(
              { id: top.id, imageData: top.imageData, imageUrl: top.imageUrl ?? undefined },
              user.userId,
              conversationId,
            ),
        ATTACHMENT_BUDGET_MS,
        undefined,
      );
    } catch (error) {
      this.logger.warn(`作品库图片附件生成失败（降级为纯文本）：${error instanceof Error ? error.message : error}`);
    }

    const lines = merged.map((row, index) => {
      const desc = (row.prompt ?? '').trim().replace(/\s+/g, ' ').slice(0, 60) || '（无描述）';
      const parts = [
        `${index + 1}. [${isStrict(row) ? '严格匹配' : '语义相近'}] id=${row.id}`,
        desc,
        row.category?.name ? `分类：${row.category.name}` : '未归类',
        row.size || '尺寸未知',
        row.model === UPLOADED_MEDIA_MARKER ? '本地上传' : 'AI 生成',
        row.isFavorite ? '已收藏' : '',
        row.createdAt ? new Date(row.createdAt).toISOString().slice(0, 10) : '',
      ].filter(Boolean);
      return `- ${parts.join(' · ')}`;
    });

    return {
      ok: true,
      summary: strictCount > 0 ? `作品库命中 ${merged.length} 张` : `作品库仅有 ${merged.length} 张相近作品`,
      content: [
        `作品库里找到 ${merged.length} 张作品（严格匹配 ${strictCount} 张，其余仅语义相近）：`,
        ...lines,
        '',
        attachment
          ? '第 1 张已作为附件展示在你的回答下方。'
          : '（图片附件加载失败，可让用户到「图像作品库」页按描述查看。）',
        strictCount === 0
          ? '注意：这些都只是语义相近，没有一张字面命中用户要的东西。先看描述判断是不是用户想要的：不是就直接说「作品库里没有 XX 的图」，可以顺带提一句库里有哪些相近的，别把不相干的图当成命中推给用户。'
          : '请先把严格匹配的作品介绍给用户，说明可以直接用。',
        '用户想在其中某张上改，就把它的 id 传给 edit_image；只有在库里没有、或用户明确表示都不合适要新的时，才调用 generate_image。不要输出图片链接或 markdown 图片语法。',
      ].join('\n'),
      attachment,
    };
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

  /**
   * 生成视频：解析来源图 → 评估成本闸门 → 免确认则直接提交异步任务，否则生成待确认卡。
   * 视频分钟级异步，工具本身不等生成完成；完成后由 VideoGenerationService 站内通知。
   */
  private async generateVideo(
    args: Record<string, unknown>,
    user: RagUserContext,
    conversationId: string,
    ctx: ChatToolContext,
  ): Promise<ChatToolResult> {
    const mode = args.mode === 'i2v' || args.mode === 't2v' || args.mode === 'r2v' ? args.mode : null;
    if (!mode) {
      return { ok: false, summary: '缺少视频模式', content: 'generate_video 需要 mode：i2v / t2v / r2v。' };
    }
    const prompt = String(args.prompt ?? '').trim();
    if (!prompt) {
      return { ok: false, summary: '缺少视频描述', content: '生成视频需要 prompt（画面/动作/风格描述）。' };
    }
    const resolution = args.resolution === '1080P' ? '1080P' : '720P';
    const durationRaw = Number(args.duration);
    const duration = Number.isFinite(durationRaw) ? Math.min(15, Math.max(3, Math.round(durationRaw))) : 5;
    const imageIds = Array.isArray(args.image_ids)
      ? args.image_ids.map((x) => String(x).trim()).filter(Boolean)
      : [];
    const uploadedUrls = ctx.uploadedImageUrls ?? [];

    const modeLabel = mode === 'i2v' ? '图生视频' : mode === 't2v' ? '文生视频' : '参考生视频';

    // 解析来源图 → 可对外直连访问的 URL（供上游 DashScope 拉取）。
    // 优先用 generate_image 生成图的 id；未给 id 时回退用「本轮用户上传的图片」。
    let sourceUrls: string[] = [];
    let sourceRefs: string[] = [];
    if (mode === 'i2v' || mode === 'r2v') {
      if (imageIds.length > 0) {
        for (const id of imageIds) {
          const url = await this.imageGenerationService.getShareableImageUrl(user.userId, id);
          if (!url) {
            return {
              ok: false,
              summary: '来源图不存在',
              content: `图片 id=${id} 不存在或不属于当前用户，无法作为视频来源。若来源是用户上传的图，image_ids 应留空。`,
            };
          }
          sourceUrls.push(url);
        }
        sourceRefs = imageIds;
      } else if (uploadedUrls.length > 0) {
        sourceUrls = uploadedUrls;
        sourceRefs = uploadedUrls.map(() => '(用户上传图)');
      }

      if (mode === 'i2v') {
        if (sourceUrls.length === 0) {
          return {
            ok: false,
            summary: '缺少首帧图',
            content:
              '图生视频(i2v)需要 1 张来源图。用户本轮没有上传图片、也没有可用的 image_id：请让用户上传一张图，或先用 generate_image 生成一张再做首帧。',
          };
        }
        // i2v 只取 1 张作首帧
        sourceUrls = sourceUrls.slice(0, 1);
        sourceRefs = sourceRefs.slice(0, 1);
      } else if (sourceUrls.length < 1 || sourceUrls.length > 9) {
        return {
          ok: false,
          summary: '参考生视频需 1~9 张图',
          content: '参考生视频(r2v)需要 1~9 张参考图（用户上传或 generate_image 生成）。',
        };
      }
    }

    const gate = await this.videoGenerationService.evaluateGate(resolution, duration);

    // 免确认（且未超预算）：直接提交异步任务
    if (!gate.require_confirm) {
      try {
        await this.videoGenerationService.submit(user.userId, {
          mode,
          prompt,
          resolution,
          duration,
          source_image_urls: sourceUrls,
          source_image_refs: sourceRefs,
          conversation_id: conversationId,
        });
        return {
          ok: true,
          summary: '视频已提交生成',
          content: `视频任务已提交（${modeLabel} · ${resolution} · ${duration}秒，预计 ¥${gate.estimate_yuan}），生成约需几分钟，完成后会通过站内通知告知用户。请告知用户"已开始生成，稍后通知"，不要声称已生成完成，也不要输出任何视频链接。`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, summary: '视频提交失败', content: `视频任务提交失败：${message}。请如实告知用户。` };
      }
    }

    // 需确认：生成待确认动作卡（成本 / 预算显式展示）
    const fields: Array<{ label: string; value: string }> = [
      { label: '模式', value: modeLabel },
      { label: '时长', value: `${duration} 秒` },
      { label: '分辨率', value: resolution },
      { label: '预计消耗', value: `¥${gate.estimate_yuan}` },
    ];
    if (gate.remaining_yuan != null) fields.push({ label: '剩余预算', value: `¥${gate.remaining_yuan}` });
    if (gate.blocked) fields.push({ label: '⚠️ 提示', value: '预算不足，确认将被拒绝' });

    const card = await this.savePendingAction(
      user,
      conversationId,
      'generate_video',
      { mode, prompt, resolution, duration, sourceUrls, sourceRefs, conversationId },
      {
        label: '生成视频',
        summary: `${modeLabel} · ${resolution} · ${duration}s · 预计 ¥${gate.estimate_yuan}`,
        fields,
      },
    );
    return {
      ok: true,
      summary: '已生成视频确认卡',
      content: `已生成「生成视频」待确认动作卡（${modeLabel}，${resolution}，${duration}秒，预计消耗 ¥${gate.estimate_yuan}${gate.blocked ? '；⚠️ 预算不足，确认会被拒绝' : ''}）。视频尚未开始生成：需要用户点击确认卡的「确认执行」后才会提交。请告知用户核对并确认，不要声称已生成，也不要输出视频链接。`,
      pendingAction: card,
    };
  }

  // ── 写操作（二期）：生成待确认动作，用户确认后才执行 ─────────────────────────

  private hasAnyPermission(user: RagUserContext, required: string[]): boolean {
    const perms = user.permissions ?? [];
    return perms.includes('*') || required.some((p) => perms.includes(p));
  }

  /** 立项：校验权限与分类后生成待确认动作，确认后直接进入进行中 */
  private async prepareCreateTask(
    args: Record<string, unknown>,
    user: RagUserContext,
    conversationId: string,
  ): Promise<ChatToolResult> {
    // 与 POST /research-development/task-categories/tasks 端点权限一致
    if (!this.hasAnyPermission(user, RD_TASK_CREATE_PERMISSIONS)) {
      return { ok: false, summary: '无立项权限', content: '当前用户没有立项申请或直接立项权限，无法发起立项，请如实告知用户。' };
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
      status: 'in_progress',
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
        { label: '流程', value: '确认后直接创建进行中的任务' },
      ],
    });
    return {
      ok: true,
      summary: `已生成立项确认卡：${title}`,
      content: `已生成「发起立项」待确认动作（标题「${title}」，分类「${resolved.pathLabel}」，负责人 ${ownerName}）。任务尚未创建：需要用户在界面上点击确认卡的「确认执行」后才会直接创建进行中的任务。请告知用户核对信息并确认，不要声称任务已创建。`,
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
    const collect = (
      tasks: unknown[],
      path: string,
      store: string,
      parent: { id: string; title: string } | null = null,
    ) => {
      for (const raw of tasks) {
        if (rows.length >= MAX_TASK_ROWS) return;
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
            parentTaskId: parent?.id || null,
            parentTitle: parent?.title ?? '',
          });
        }
        collect(asArray(task.subtasks), taskPath, store, {
          id: clean(task.task_id),
          title: title || clean(task.task_id),
        });
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
    // 通用兜底池：优先用「运营素材管理」配置的自定义列表，未配置回退内置默认
    const fallback = await this.resolveQuickSuggestionPool();
    const suggestions: string[] = [];
    try {
      const rows = await this.loadTaskRows(user);
      const isDone = (s: string) => /完成|已关闭|closed|done|complete/i.test(s);
      const todayKey = new Date().toISOString().slice(0, 10);
      const myName = user.name?.trim() ?? '';
      const mine = myName ? rows.filter((t) => t.owner.includes(myName) || myName.includes(t.owner)) : [];
      const myOpen = mine.filter((t) => !isDone(t.status));
      const myOverdue = myOpen.filter((t) => t.due && t.due.slice(0, 10) < todayKey);
      const canManage = this.hasAnyPermission(user, RD_TASK_REVIEW_PERMISSIONS);
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

  /** 快捷建议兜底池：素材位 mode=static 且列表非空时用自定义，否则用内置默认 */
  private async resolveQuickSuggestionPool(): Promise<string[]> {
    try {
      const row = await this.prisma.systemSetting.findUnique({
        where: { key: CONTENT_SLOT_QUICK_SUGGESTIONS_KEY },
        select: { value: true },
      });
      const v = (row?.value ?? {}) as { mode?: unknown; staticList?: unknown };
      if (v.mode === 'static' && Array.isArray(v.staticList)) {
        const list = v.staticList.map((x) => String(x).trim()).filter(Boolean);
        if (list.length > 0) return list;
      }
    } catch {
      /* 读失败回退默认 */
    }
    return DEFAULT_QUICK_SUGGESTIONS;
  }

  /** 按任务编号查找任务（研发池：主库+产品库；协同池任务不支持写操作，有意不含） */
  private async findTaskById(taskId: string): Promise<TaskRow | null> {
    const rows = await this.loadTaskRows();
    return rows.find((t) => t.taskId === taskId) ?? null;
  }

  /**
   * 按分类名解析 category_id / sub_project_id（支持「分类」或「分类/子项目」）。
   *
   * 走 rdService.getTaskCategories 而不是直接读 rd.taskCategories：原始 KV 没有经过
   * BOM 归一化，也不含一级分类自动补出的默认子项，Agent 会看到一棵和页面不一样的树
   * ——表现为「页面上能选的分类，Agent 说不存在」。
   */
  private async resolveCategory(
    input: string,
  ): Promise<
    | { ok: true; categoryId: string; subProjectId: string; pathLabel: string }
    | { ok: false; message: string }
  > {
    const categories = (await this.rdService.getTaskCategories({ skipMirrorRefresh: true })).map((c) =>
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
      // 正常情况下 ensureDefaultSubProject 已保证每个分类至少有一个子项；
      // 走到这里说明拿到的树本身是坏的，保留兜底而不是假装成功。
      return { ok: false, message: `分类「${clean(category.label)}」下没有任何子项目，无法立项。` };
    }
    // 自动补出来的默认子项不是用户建的层级，不能出现在确认卡与回答里，
    // 否则纯一级分类会显示成「电源部分 / 默认」，看的人会以为自己漏建了什么。
    const isDefaultSub = subProject[RD_DEFAULT_SUBPROJECT_FLAG] === true;
    return {
      ok: true,
      categoryId: clean(category.id),
      subProjectId: clean(subProject.id),
      pathLabel: isDefaultSub
        ? clean(category.label)
        : [clean(category.label), clean(subProject.label)].filter(Boolean).join(' / '),
    };
  }

  // ── 待确认动作：独立表存储 + 确认/取消 ───────────────────────────────────────

  private async savePendingAction(
    user: RagUserContext,
    conversationId: string,
    tool: PendingActionTool,
    payload: Record<string, unknown>,
    cardBase: { label: string; summary: string; fields: Array<{ label: string; value: string }> },
  ): Promise<PendingActionCard> {
    const now = new Date();
    const id = `act-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
    const expiresAt = new Date(now.getTime() + PENDING_ACTION_TTL_MS);
    const card: PendingActionCard = {
      id,
      tool,
      expiresAt: expiresAt.toISOString(),
      ...cardBase,
    };
    await this.prisma.chatPendingAction.create({
      data: {
        id,
        userId: user.userId,
        conversationId,
        tool,
        payload: payload as Prisma.InputJsonValue,
        card: card as unknown as Prisma.InputJsonValue,
        status: 'pending',
        expiresAt,
      },
    });
    // 过期卡清理（fire-and-forget）：原 KV 实现靠每次写入时裁剪，独立表后单独收口
    void this.purgeStalePendingActions();
    return card;
  }

  /**
   * 清理不再有价值的卡：已过期仍挂 pending 的，和终结超过 24h 的。
   * 失败只记日志——清理是卫生工作，不能影响正在进行的对话。
   */
  private async purgeStalePendingActions(): Promise<void> {
    const now = new Date();
    try {
      await this.prisma.chatPendingAction.updateMany({
        where: { status: 'pending', expiresAt: { lt: now } },
        data: { status: 'canceled', resultMessage: '已过期' },
      });
      await this.prisma.chatPendingAction.deleteMany({
        where: {
          status: { in: ['executed', 'canceled'] },
          updatedAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
        },
      });
    } catch (error) {
      this.logger.warn(`待确认动作清理失败: ${error instanceof Error ? error.message : error}`);
    }
  }

  /** 回答落库后，把本轮生成的待确认动作绑定到 assistant 消息（供刷新后按消息恢复卡片） */
  async bindActionsToMessage(actionIds: string[], messageId: string): Promise<void> {
    if (actionIds.length === 0) return;
    await this.prisma.chatPendingAction.updateMany({
      where: { id: { in: actionIds } },
      data: { messageId },
    });
  }

  /** 列出会话内仍待确认（pending 且未过期）的动作卡，带其所属消息 id，供前端刷新后恢复 */
  async listConversationPendingActions(
    conversationId: string,
    user: RagUserContext,
  ): Promise<Array<{ messageId: string | null; card: PendingActionCard }>> {
    const rows = await this.prisma.chatPendingAction.findMany({
      where: {
        conversationId,
        userId: user.userId,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows
      .map(toPendingActionEntry)
      .map((e) => ({ messageId: e.messageId, card: e.card }));
  }

  /**
   * 用户点击「确认执行」：以用户本人身份执行动作（权限二次校验）。
   *
   * 并发防护靠 `WHERE status='pending'` 的条件更新原子抢占——多标签页连点、
   * 多实例同时收到请求，只有一个能把状态改成 executing，其余直接被拒。
   * 原实现用进程内 Map 锁，加一个实例就失效。
   */
  async confirmPendingAction(actionId: string, user: RagUserContext): Promise<{ ok: true; message: string }> {
    const row = await this.prisma.chatPendingAction.findUnique({ where: { id: actionId } });
    if (!row) throw new NotFoundException('该动作不存在或已过期清理');
    const entry = toPendingActionEntry(row);
    if (entry.userId !== user.userId) throw new ForbiddenException('只能确认自己发起的动作');
    if (entry.status !== 'pending') throw new BadRequestException(pendingActionBusyMessage(entry.status));
    if (entry.expiresAt.getTime() < Date.now()) {
      await this.prisma.chatPendingAction.updateMany({
        where: { id: actionId, status: 'pending' },
        data: { status: 'canceled', resultMessage: '已过期' },
      });
      throw new BadRequestException('该动作已过期（30 分钟有效），请在对话里重新发起');
    }

    // 原子抢占：输掉竞争的请求 count=0，直接拒绝，绝不重复执行写操作
    const claimed = await this.prisma.chatPendingAction.updateMany({
      where: { id: actionId, status: 'pending', expiresAt: { gt: new Date() } },
      data: { status: 'executing' },
    });
    if (claimed.count !== 1) throw new BadRequestException('该动作正在执行或已处理，不能重复操作');

    let message: string;
    try {
      message = await this.executePendingAction(entry, user);
    } catch (error) {
      // 执行失败（权限不足 / 下游报错）：退回 pending，这张卡还能重试，不静默作废
      await this.prisma.chatPendingAction.updateMany({
        where: { id: actionId, status: 'executing' },
        data: { status: 'pending' },
      });
      throw error;
    }

    await this.prisma.chatPendingAction.update({
      where: { id: actionId },
      data: { status: 'executed', resultMessage: message },
    });
    this.auditAction(user.userId, entry, 'confirmed', message);
    return { ok: true, message };
  }

  /** 真正执行动作卡对应的写操作，返回回给用户的结果文案。权限在此二次校验。 */
  private async executePendingAction(entry: PendingActionEntry, user: RagUserContext): Promise<string> {
    // 注册表操作：确认时重新反射权限再执行，与首次调用同一把闸门
    const agentAction = AGENT_ACTIONS.find((a) => a.tool === entry.tool);
    if (agentAction) {
      const verdict = checkAgentPermission(agentAction.controller, agentAction.handler, user.permissions ?? []);
      if (!verdict.allowed || !this.satisfiesAgentActionExtra(agentAction.tool, user)) {
        throw new ForbiddenException(`没有执行「${agentAction.label}」的权限`);
      }
      // 出口必须与发起时同源分派：field 型走 updateTask，custom 型走各自的执行体。
      // 这里若只留 updateTask 一条路，custom 型的卡会被拿错 payload 去写任务字段。
      if (!isFieldAction(agentAction)) {
        return this.customActionRunners()[agentAction.tool].apply(entry.payload, user);
      }
      const taskId = String(entry.payload.taskId ?? '');
      const payload = (entry.payload.payload ?? {}) as Record<string, unknown>;
      await this.applyTaskUpdate(taskId, payload, user);
      return `已完成「${agentAction.label.replace('（待确认）', '')}」（任务 ${taskId}）。`;
    }

    let message: string;
    if (entry.tool === 'create_task') {
      if (!this.hasAnyPermission(user, RD_TASK_CREATE_PERMISSIONS)) throw new ForbiddenException('没有立项权限');
      const canCreateDirectly = this.hasAnyPermission(user, ['rd-task:create', 'rd-project:direct']);
      const task = (await this.rdService.createTask(entry.payload, {
        requesterUserId: user.userId,
        requesterName: user.name,
        canEditAny: this.hasAnyPermission(user, RD_TASK_STRUCTURE_MANAGER_PERMISSIONS),
        proposalOnly: !canCreateDirectly && this.hasAnyPermission(user, ['rd-project:propose']),
      })) as Record<string, unknown>;
      message = `已创建任务「${String(entry.payload.title ?? '')}」（任务号 ${String(task.task_id ?? '未知')}），状态为进行中。`;
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
      if (!this.hasAnyPermission(user, RD_TASK_REVIEW_PERMISSIONS)) throw new ForbiddenException('没有任务审核权限');
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
        { requesterUserId: user.userId, requesterName: user.name, canEditAny: true, permissions: user.permissions },
      );
      message = entry.payload.directChange
        ? `已${decision === 'approve' ? '应用' : '取消'}任务「${String(entry.payload.taskTitle ?? taskId)}」的变更。`
        : `已${decision === 'approve' ? '审批通过' : '驳回'}任务「${String(entry.payload.taskTitle ?? taskId)}」。`;
    } else if (entry.tool === 'generate_video') {
      const p = entry.payload;
      const mode = p.mode === 'i2v' || p.mode === 't2v' || p.mode === 'r2v' ? p.mode : 't2v';
      const resolution = p.resolution === '1080P' ? '1080P' : '720P';
      const duration = typeof p.duration === 'number' ? p.duration : 5;
      const sourceUrls = Array.isArray(p.sourceUrls) ? (p.sourceUrls as unknown[]).map(String) : [];
      const sourceRefs = Array.isArray(p.sourceRefs) ? (p.sourceRefs as unknown[]).map(String) : [];
      await this.videoGenerationService.submit(user.userId, {
        mode,
        prompt: String(p.prompt ?? ''),
        resolution,
        duration,
        source_image_urls: sourceUrls,
        source_image_refs: sourceRefs,
        conversation_id: typeof p.conversationId === 'string' ? p.conversationId : undefined,
      });
      const modeLabel = mode === 'i2v' ? '图生视频' : mode === 't2v' ? '文生视频' : '参考生视频';
      message = `已提交视频生成任务（${modeLabel} · ${resolution} · ${duration}秒），生成约需几分钟，完成后将通过站内通知告知你。`;
    } else {
      if (!this.hasAnyPermission(user, SEND_MESSAGE_PERMISSIONS)) throw new ForbiddenException('没有发送站内通知的权限');
      await this.rdService.createMessage({
        source: 'assistant',
        sender: { id: user.userId, name: user.name ?? '未知用户', role: user.roleName ?? null },
        recipient_id: (entry.payload.recipient_id as string) ?? null,
        recipient_person_id: (entry.payload.recipient_person_id as string) ?? null,
        recipient_name: (entry.payload.recipient_name as string) ?? null,
        subject: (entry.payload.subject as string) ?? null,
        body: String(entry.payload.body ?? ''),
      });
      message = `已发送通知给 ${String(entry.payload.recipient_name ?? '')}。`;
    }

    return message;
  }

  /** 用户点击「取消」 */
  async cancelPendingAction(actionId: string, user: RagUserContext): Promise<{ ok: true; message: string }> {
    const row = await this.prisma.chatPendingAction.findUnique({ where: { id: actionId } });
    if (!row) throw new NotFoundException('该动作不存在或已过期清理');
    const entry = toPendingActionEntry(row);
    if (entry.userId !== user.userId) throw new ForbiddenException('只能取消自己发起的动作');
    // 条件更新：已在执行中的动作不能取消（写操作已经投出去了），并发取消也只有一个能成
    const canceled = await this.prisma.chatPendingAction.updateMany({
      where: { id: actionId, status: 'pending' },
      data: { status: 'canceled', resultMessage: '用户已取消' },
    });
    if (canceled.count !== 1) throw new BadRequestException(pendingActionBusyMessage(entry.status));
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
