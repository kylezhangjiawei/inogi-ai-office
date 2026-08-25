import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type RdMessage as RdMessageRow } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';

import { PrismaService } from '../../prisma/prisma.service';
import { OcrService } from '../ocr/ocr.service';
import { OssService } from '../oss/oss.service';
import { RagService } from '../rag/rag.service';
import { isBlockedProgressAttachment } from './attachment-security';
import { DEPT_KBS, DEPT_KB_DEFAULT_CATEGORIES, LEVEL_FILTERED_DEPT_KB_IDS, deptKbPageCode } from './dept-knowledge.constants';
import {
  PRODUCTION_WORKSPACE,
  buildProductionMirrorTask,
  isProductionMirrorTask,
  mergeProductionMirrorTasks,
  type ProductionMirrorPlacement,
} from './production-task-sync';
import { RdAiService } from './rd-ai.service';
import { buildRdTaskProgressRelationGroup } from './rd-task-progress-group';
import { RD_WORKSPACE_IDS, WORKSPACE_PAGE_CODES, currentRdWorkspace, resolveRdStoreKey, runInRdWorkspace } from './rd-workspace.context';

type JsonRecord = Record<string, unknown>;
const RD_TASK_TREE_MAX_DEPTH = 5;
const RD_TASK_RELATION_BATCH_LIMIT = 50;
type TaskCategoryLocation = {
  categoryId: string;
  categoryKey: string;
  categoryLabel: string;
  subProjectId: string;
  subProjectLabel: string;
};
type TaskCreateActor = {
  requesterUserId?: string;
  requesterName?: string;
  canEditAny?: boolean;
  proposalOnly?: boolean;
};
type TaskProgressNoteViewer = {
  userId?: string;
  userName?: string;
  hasFullAccess?: boolean;
  canReadAll?: boolean;
  canEditAttachments?: boolean;
};
/**
 * 全员日报/月报生成时一次性预读、跨成员复用的共享数据。
 * 避免每位成员各自重读「合并任务库 + 进度留痕表」，把 N×(全表读) 降到 1×。
 */
type RdReportSharedData = {
  categories: JsonRecord[];
  noteMap: Record<string, JsonRecord[]>;
};

/** 绩效考核的 5 个评分维度（自评与主管评分共用同一套，各维度 0-100）。 */
const PERF_SCORE_DIMENSIONS = ['delivery', 'quality', 'collaboration', 'initiative', 'norm'] as const;
type PerfScoreDimension = (typeof PERF_SCORE_DIMENSIONS)[number];
type PerfDimensionScores = Record<PerfScoreDimension, number>;

/**
 * 绩效考核表「一、事项指标（80分）」的固定考核项与分值权重（与前端下载模板一致）。
 * 「具体业务事项 / 评价标准」由 AI 结合本月任务逐项生成，存入 summary.item_kpis。
 */
const PERF_ITEM_KPIS: ReadonlyArray<{ name: string; weight: string }> = [
  { name: '研发项目', weight: '30' },
  { name: '分析不良品', weight: '20' },
  { name: '工艺稽查', weight: '10' },
  { name: '工艺优化持续改进', weight: '10' },
  { name: '完成领导布置的任务', weight: '10' },
];

// 行为指标（20分）为固定写死项，由前端 RDPerformanceReportDialog 直接渲染，后端不再参与生成。

/**
 * 逐考核项评分规整：入参为 {考核项名称: 分数} 映射，输出非负整数分（0-100 作兜底上限，
 * 逐项权重上限由前端保证）。忽略空键与非数值项。
 */
function normalizePerfItemScores(value: unknown): Record<string, number> {
  if (!isRecord(value)) {
    throw new BadRequestException('评分数据格式不正确');
  }
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const name = key.trim();
    if (!name) continue;
    const num = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(num)) continue;
    out[name] = Math.max(0, Math.min(100, Math.round(num)));
  }
  return out;
}
type IdentityUser = {
  id: string;
  name: string;
  username: string | null;
  email: string;
  department: string | null;
  status: string;
};
type IdentityContext = {
  users: IdentityUser[];
  people: JsonRecord[];
};
type MessageRecipientIdentity = {
  userId: string;
  nameKey: string;
  personIds: Set<string>;
};
/** 消息来源：哪个业务模块发的。研发服务内部按当前工作区取值，跨模块调用方自报。 */
export type MessageSource =
  | 'rd'
  | 'us-collab'
  | 'production'
  | 'procurement'
  | 'video'
  | 'performance'
  | 'assistant';

/** 消息分类：给用户看的那一层，由 type 派生。 */
export type MessageCategory = 'todo' | 'result' | 'mention' | 'notice';

/**
 * type → 分类的唯一映射口径。
 * ⚠️ 迁移 20260813190000 的回填 SQL 是这张表的镜像，改这里必须同步改那里，
 * 否则会出现「历史消息归在待办、同类新消息归在通知」的分裂。
 * 新增消息类型时只需在这里加一行，前端筛选器不用动。
 */
function messageCategoryOf(type: string | null | undefined): MessageCategory {
  switch (cleanText(type)) {
    case 'review_request':
    case 'perf_self_assessment':
      return 'todo';
    case 'review_result':
    case 'procurement_review_result':
      return 'result';
    case 'procurement_assignment':
      return 'todo';
    case 'discussion_mention':
      return 'mention';
    default:
      return 'notice';
  }
}

type CreateMessagePayload = {
  sender: { id?: string | null; name?: string | null; role?: string | null };
  /** 省略时按当前工作区推断（研发服务内部调用的默认行为） */
  source?: MessageSource;
  recipient_id?: string | null;
  recipient_person_id?: string | null;
  recipient_name?: string | null;
  subject?: string | null;
  body: string;
  /** 结构化元数据（如视频完成通知的跳转信息），随消息透传给前端渲染动作/跳转按钮 */
  meta?: Record<string, unknown> | null;
};
type DiscussionAnchorType = 'task' | 'progress_note' | 'message';
type DiscussionViewer = {
  userId?: string;
  userName?: string;
  userRole?: string;
  canAccessAny?: boolean;
  canPost?: boolean;
};
type DiscussionAccess = {
  task: JsonRecord;
  scope: 'task' | 'thread_invitee';
  invitation: {
    invitedById: string | null;
    invitedByName: string;
    invitedAt: Date;
  } | null;
};
type TaskDiscussionResponse = JsonRecord & { can_post: boolean };
type NormalizedAiSettings = JsonRecord & {
  scenes: JsonRecord[];
  file_policy: JsonRecord & { rules: JsonRecord[] };
  disclosure: JsonRecord;
};
type RdStoreKey =
  | 'rd.taskCategories'
  | 'rd.workspace'
  | 'rd.directorDashboard'
  | 'rd.people'
  | 'rd.approvalFlows'
  | 'rd.auditLogs'
  | 'rd.aiSettings'
  | 'rd.taskProgressNotes'
  // 留痕评论的任务级已读位点：{ [userId]: { [taskId]: lastReadAt } }，未读红点据此计算
  | 'rd.noteReads'
  | 'rd.dailyReports'
  | 'rd.monthlyReports'
  | 'rd.performanceReports'
  | 'rd.proposalDrafts'
  | 'rd.products'
  | 'rd.productTaskCategories'
  | 'rd.knowledgeCategories'
  | 'rd.knowledgeEntries'
  | 'rd.taskCompletionScores'
  // 研发 → 生产同步登记与不可变更的操作轨迹。仅存于默认研发工作区，生产池不直接维护。
  | 'rd.productionTaskSyncs'
  | 'rd.productionTaskSyncAudit'
  | 'rd.sheets'
  // 部门知识库：复用知识库 CRUD，按 kbId 切换存储键（缺省 kbId = 研发库走上面的 rd.* 键）
  | `deptkb.${string}.knowledgeCategories`
  | `deptkb.${string}.knowledgeEntries`
  // 部门库成员分值表（仅分值过滤启用的库使用，见 LEVEL_FILTERED_DEPT_KB_IDS）
  | `deptkb.${string}.memberLevels`;

const CATEGORY = 'research-development';
/**
 * 「接收审核通知」独立权限码。
 *
 * 刻意与 rd-task:edit / rd-task:reassign 分开：那两个回答「能不能改任务」，
 * 默认「研发人员」角色就持有，拿来当收件依据会把任何被授予研发权限的岗位
 * （例如同时兼研发权限的采购主管）一并卷进研发审核通知。
 * 迁移 20260813150000 已按原口径把此码灌给现有角色，切换当天收件人不变；
 * 之后在角色管理页取消勾选即可精确收敛，不必再改代码。
 *
 * ⚠️ 命名空间必须是 rd-task：角色管理页把操作码挂到哪个页面下，是按命名空间
 * token 与页面码求交集算分的（RoleManagement.actionPageScore，≥180 分才归到页面）。
 * 叫 rd-review:notify 只能匹配上 rd 一个 token（100 分），会掉进「模块公共功能权限」，
 * 管理员在「研发任务驾驶舱」下根本找不到它。
 */
const RD_REVIEW_NOTIFY_PERMISSION = 'rd-task:review-notify';
const RD_ANY_TASK_TRANSFER_PERMISSIONS = [
  'rd-task:reassign',
  'rd-project:direct',
  'rd-project:review-l1',
  'rd-project:review-l2',
  'rd-people:manage',
] as const;
const MAX_AUDIT_LOGS = 1000;

/** 服务端留痕的操作人。控制器从 req.user 取，服务层不自己猜。 */
type AuditActorRef = { userId?: string; userName?: string };

/**
 * 进留痕的任务字段。其余都是内部记账字段（creation_request_*、subtask_attached_* 等），
 * diff 出来只会淹没真正的业务变更。
 *
 * 优先级有三个字段：priority 是 AI 给的初值、ai_priority 是 AI 复算值、
 * final_priority 才是界面上改的那个生效值——只盯 priority 会漏掉用户的每一次调整。
 */
const AUDITED_TASK_FIELDS = [
  'title',
  'status',
  'final_priority',
  'priority',
  'progress',
  'due_date',
  'description',
  'primary_owner',
  'collaborators',
  'category_path',
  'archived',
  'work_items',
] as const;

/** 进留痕的研发成员字段。 */
const AUDITED_PERSON_FIELDS = ['name', 'role', 'department', 'status', 'skills', 'kb_level'] as const;

/** 审核类型的中文说法，留痕文案与通知用同一套叫法。 */
const REVIEW_TYPE_LABELS: Record<string, string> = {
  result: '成果审核',
  collaboration: '协同申请',
  due_date: '延期申请',
  abandon: '放弃申请',
  merge: '合并申请',
  procurement_transfer: '转采购申请',
};

/** 提交各类审核时对应的动作码，与前端各页原先手写的口径一致。 */
const PENDING_REVIEW_ACTIONS: Record<string, string> = {
  result: 'task.submitted',
  collaboration: 'task.collaboration_requested',
  due_date: 'task.due_date_requested',
  abandon: 'task.abandon_requested',
  merge: 'task.merge_requested',
};
const DEFAULT_BOM_TASK_TYPE = '研发任务';
// 主产品（便携式制氧机）：其任务分类树存于 rd.taskCategories；其余产品存于 rd.productTaskCategories[productId]。
// 与前端 MAIN_PRODUCT_ID 保持一致，是跨产品移动任务时判断「写哪个 store」的唯一依据。
export const RD_MAIN_PRODUCT_ID = 'prod-portable-o2';
// 一级分类没有子项时自动补的默认子项。任务只能存在于第二级，这个容器让「纯一级分类」
// 也能承载任务；前端按 RD_DEFAULT_SUBPROJECT_FLAG 把这一层从展示与选择器里隐去。
export const RD_DEFAULT_SUBPROJECT_LABEL = '默认';
export const RD_DEFAULT_SUBPROJECT_ID_SUFFIX = '-default';
export const RD_DEFAULT_SUBPROJECT_FLAG = 'is_default';
const PROGRESS_NOTE_MAX_FILES = 10;
const PROGRESS_NOTE_MAX_FILE_BYTES = 25 * 1024 * 1024;
const PROGRESS_NOTE_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const IMMUTABLE_RESOURCE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
type DirectProgressNoteUpload = {
  objectKey: string;
  originalname: string;
  mimetype?: string;
  size?: number;
  cleanupExp?: number;
  cleanupSig?: string;
};
type StoredProgressNoteAttachment = {
  id: string;
  name: string;
  mime: string;
  size: number;
  object_key?: string;
  oss_url?: string;
  data_url?: string;
};
type ProgressNoteAttachmentBuild = {
  attachment: StoredProgressNoteAttachment;
  buffer?: Buffer;
  mimetype?: string;
  originalname: string;
};
// ─── 研发数据表（B2：Univer 工作簿快照 · 已去除行级密级）─────────────────────
// rd.sheets 存「单个 Univer 工作簿快照」：{ snapshot, updated_at, updated_by }。
// 图片以 base64 内嵌在快照（SHEET_DRAWING_PLUGIN 资源）里，无需 OSS；不再做行级密级裁剪，
// 拥有 page:rd-sheet 即可只读查看，拥有 rd-sheet:edit 方可编辑保存。
// 旧格式（{headers,rows,secrecy_column}[] 扁平数组）在读取时按「值」无损迁移成快照。
const RD_SHEET_WORKBOOK_ID = 'rd-sheet-workbook';
const RD_SHEET_IMAGE_MARK_RE = /\[图片:[^\[\]\s]+\]/g;

/**
 * 任务在分类树中的结构位置。parentTaskId 由「所处数组」决定（顶层任务为 null），
 * 不读任务上的 parent_task_id 字段——存量子任务并没有该字段。
 */
type TaskSlot = {
  productId: string;
  categoryId: string;
  categoryLabel: string;
  subProjectId: string;
  subProjectLabel: string;
  parentTaskId: string | null;
  /** 根任务深度为 1，用于限制整棵来源树挂载后的最大层级。 */
  depth: number;
  task: JsonRecord;
};

type ProductionTaskSyncRecord = {
  task_id: string;
  active: boolean;
  first_synced_at: string;
  synced_at: string;
  synced_by_id: string | null;
  synced_by_name: string;
  revoked_at: string | null;
  revoked_by_id: string | null;
  revoked_by_name: string | null;
};

// ─── 审核类型「单一事实源」───────────────────────────────────────────────
// 四种审核类型的标签、通过后目标状态、审计动作集中在此定义，前后端各处只引用、
// 不再各写各的，避免不同类型的文案/流程互相污染（立项被记成成果、成果被当协作等）。
type ReviewType = 'proposal' | 'result' | 'collaboration' | 'due_date' | 'abandon' | 'merge' | 'procurement_transfer';
const REVIEW_TYPES: ReviewType[] = ['proposal', 'result', 'collaboration', 'due_date', 'abandon', 'merge', 'procurement_transfer'];
/** 中文标签，用于通知标题、留痕、类型 badge 等所有展示处。 */
const REVIEW_TYPE_LABEL: Record<ReviewType, string> = {
  proposal: '立项',
  result: '成果',
  collaboration: '协作变更',
  due_date: '截止日期变更',
  abandon: '放弃任务',
  merge: '任务合并',
  procurement_transfer: '转采购',
};
/**
 * 审核「通过」后的目标状态：成果通过=已完成；放弃通过=封存（随后硬删除，等同删除任务）；其余=进行中。
 * 合并通过后源任务先回 in_progress，随后由 applyTaskMerge 原子完成归档+迁移（失败则不产生部分写，源任务保持 in_progress）。
 * 这是唯一裁决处。
 */
const REVIEW_APPROVE_STATUS: Record<ReviewType, 'in_progress' | 'completed' | 'archived'> = {
  proposal: 'in_progress',
  result: 'completed',
  collaboration: 'in_progress',
  due_date: 'in_progress',
  abandon: 'archived',
  merge: 'in_progress',
  procurement_transfer: 'in_progress',
};
function isKnownReviewType(value: string): value is ReviewType {
  return (REVIEW_TYPES as string[]).includes(value);
}
/** 取审核类型中文标签；未知类型回退原值（仅用于展示，不参与裁决）。 */
function reviewTypeLabel(value: string): string {
  return REVIEW_TYPE_LABEL[value as ReviewType] ?? value;
}

const RD_POC_BOM_CATEGORIES = [
  { id: 'cat-power', label: '电源部分', parts: ['电池', '电池PCB'] },
  { id: 'cat-base', label: '底部结构', parts: ['底座', '底座减震器', '底座进气隔板', '底座过滤棉'] },
  { id: 'cat-compression', label: '压缩系统', parts: ['压缩机', '压缩机罩'] },
  { id: 'cat-valve-310', label: '310阀系统', parts: ['310阀组', '310电磁阀'] },
  { id: 'cat-cooling', label: '风冷系统', parts: ['电风扇'] },
  { id: 'cat-air-storage', label: '储气系统', parts: ['储气罐', '储气罐进气隔板'] },
  { id: 'cat-valve-210', label: '210阀系统', parts: ['210阀组', '210电磁阀'] },
  { id: 'cat-top', label: 'Top结构', parts: ['Top板', '成孔螺丝', '显示屏'] },
  {
    id: 'cat-molecular-sieve',
    label: '分子筛系统',
    parts: ['分子筛转接板', '分子筛', '分子筛衬板', '分子筛隔板', '分子筛筛料', '分子筛弹簧', '分子筛上密封圈', '分子筛下密封圈'],
  },
  { id: 'cat-exterior', label: '外观结构', parts: ['外罩', '隔热贴'] },
  { id: 'cat-accessories', label: '配件系统', parts: ['车充', '快充', '普充'] },
  { id: 'cat-tube', label: '气管系统', parts: ['硅胶管', '接头', '卡箍'] },
  { id: 'cat-harness', label: '线束系统', parts: ['主线束', '电池线', '风扇线', '屏线'] },
  { id: 'cat-fastener', label: '紧固件系统', parts: ['螺丝', '铜柱', '螺母'] },
  { id: 'cat-sealing', label: '密封系统', parts: ['O-ring', '泡棉', '密封胶'] },
] as const;

const DEFAULT_KB_CATEGORIES = [
  { id: 'kb-hardware', label: '硬件研发', icon: 'Cpu', color: '#3b82f6', order: 1, children: [
    { id: 'kb-pcb', label: '电路/PCB设计', order: 1 },
    { id: 'kb-structure', label: '结构设计', order: 2 },
    { id: 'kb-bom', label: 'BOM管理', order: 3 },
    { id: 'kb-components', label: '元器件选型', order: 4 },
  ]},
  { id: 'kb-software', label: '软件研发', icon: 'Code2', color: '#8b5cf6', order: 2, children: [
    { id: 'kb-firmware', label: '固件/嵌入式', order: 1 },
    { id: 'kb-app', label: '应用软件', order: 2 },
    { id: 'kb-protocol', label: '接口协议', order: 3 },
  ]},
  { id: 'kb-test', label: '测试验证', icon: 'FlaskConical', color: '#10b981', order: 3, children: [
    { id: 'kb-test-plan', label: '测试方案', order: 1 },
    { id: 'kb-test-report', label: '测试报告', order: 2 },
    { id: 'kb-issue', label: '问题记录', order: 3 },
  ]},
  { id: 'kb-standard', label: '规范标准', icon: 'ShieldCheck', color: '#f59e0b', order: 4, children: [
    { id: 'kb-industry', label: '行业标准', order: 1 },
    { id: 'kb-internal', label: '内部规范', order: 2 },
    { id: 'kb-cert', label: '法规/认证', order: 3 },
  ]},
  { id: 'kb-archive', label: '项目归档', icon: 'Archive', color: '#6366f1', order: 5, children: [
    { id: 'kb-milestone', label: '里程碑材料', order: 1 },
    { id: 'kb-review', label: '评审记录', order: 2 },
    { id: 'kb-decision', label: '决策留痕', order: 3 },
  ]},
  { id: 'kb-other', label: '其他', icon: 'FolderOpen', color: '#94a3b8', order: 6, children: [] },
];

const KB_CATEGORY_PATH_RULES: { keywords: string[]; categoryId: string }[] = [
  { keywords: ['电路', 'PCB', 'pcb', '电源部分', '电源'], categoryId: 'kb-pcb' },
  { keywords: ['结构', '外观', 'Top结构', '底部结构'], categoryId: 'kb-structure' },
  { keywords: ['BOM', 'bom'], categoryId: 'kb-bom' },
  { keywords: ['测试', '验证', '检验', '放行'], categoryId: 'kb-test-report' },
  { keywords: ['固件', '软件', '嵌入式', '协议'], categoryId: 'kb-firmware' },
  { keywords: ['分子筛', '储气', '阀系统', '压缩', '风冷', '气管', '密封', '紧固', '线束', '配件'], categoryId: 'kb-hardware' },
];

function inferKbCategoryId(categoryPath: string): string {
  for (const rule of KB_CATEGORY_PATH_RULES) {
    if (rule.keywords.some(kw => categoryPath.includes(kw))) return rule.categoryId;
  }
  return 'kb-other';
}

const DEFAULT_AI_SETTINGS = {
  version: 1,
  updated_at: '',
  updated_by: '',
  scenes: [
    {
      id: 'file_task_extract',
      name: '文件任务解析',
      description: '上传文件解析、结构化字段提取和任务草稿生成',
      enabled: true,
      model_id: '',
      fallback_model_id: '',
      prompt_version: 'rd-file-task-extract-v1',
      confidence_threshold: 0.85,
      require_human_review: true,
      show_to_user: true,
    },
    {
      id: 'text_task_extract',
      name: '文本任务解析',
      description: '会议纪要、邮件正文、手工输入文本转研发任务',
      enabled: true,
      model_id: '',
      fallback_model_id: '',
      prompt_version: 'rd-text-task-extract-v1',
      confidence_threshold: 0.82,
      require_human_review: true,
      show_to_user: true,
    },
    {
      id: 'ocr_cleanup',
      name: 'OCR 结果清洗',
      description: '图片、扫描件 OCR 后的错字纠正、段落合并和表格线索整理',
      enabled: true,
      model_id: '',
      fallback_model_id: '',
      prompt_version: 'rd-ocr-cleanup-v1',
      confidence_threshold: 0.85,
      require_human_review: true,
      show_to_user: true,
    },
    {
      id: 'progress_summary',
      name: '进度材料总结',
      description: '从上传材料、记录和备注中总结当前进展',
      enabled: true,
      model_id: '',
      fallback_model_id: '',
      prompt_version: 'rd-progress-summary-v1',
      confidence_threshold: 0.8,
      require_human_review: true,
      show_to_user: true,
    },
    {
      id: 'daily_report_summary',
      name: '日报智能汇总',
      description: '把当日任务变更、进度记录和风险信号汇总成可读日报',
      enabled: true,
      model_id: '',
      fallback_model_id: '',
      prompt_version: 'rd-daily-report-summary-v1',
      confidence_threshold: 0.78,
      require_human_review: false,
      show_to_user: true,
    },
    {
      id: 'monthly_report_summary',
      name: '月报智能汇总',
      description: '把当月任务进展、里程碑与风险信号汇总成主题化、可读的月报',
      enabled: true,
      model_id: '',
      fallback_model_id: '',
      prompt_version: 'rd-monthly-report-summary-v1',
      confidence_threshold: 0.78,
      require_human_review: false,
      show_to_user: true,
    },
    {
      id: 'performance_review',
      name: '月度绩效评估',
      description: '基于成员当月任务量与产出生成正式、宽容的绩效考核结论',
      enabled: true,
      model_id: '',
      fallback_model_id: '',
      prompt_version: 'rd-performance-review-v1',
      confidence_threshold: 0.75,
      require_human_review: true,
      show_to_user: true,
    },
  ],
  file_policy: {
    ocr_provider: 'tencent_ocr',
    ocr_service_key: 'accurate_text',
    ocr_confidence_threshold: 0.85,
    low_confidence_action: 'manual_review',
    allow_vision_fallback: false,
    save_original_text: true,
    save_ocr_text: true,
    save_ai_result: true,
    require_confirmation_before_write: true,
    rules: [
      {
        id: 'spreadsheet',
        label: '表格文件',
        extensions: ['csv', 'xlsx', 'xls', 'tsv'],
        strategy: 'structured_parse',
        ai_after_parse: true,
        ocr_fallback: false,
        direct_ai: false,
      },
      {
        id: 'document',
        label: '文档文件',
        extensions: ['doc', 'docx', 'txt', 'md'],
        strategy: 'text_extract',
        ai_after_parse: true,
        ocr_fallback: false,
        direct_ai: false,
      },
      {
        id: 'archive',
        label: '压缩包',
        extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz'],
        strategy: 'archive_extract_then_parse',
        ai_after_parse: true,
        ocr_fallback: true,
        direct_ai: false,
      },
      {
        id: 'pdf',
        label: 'PDF 文件',
        extensions: ['pdf'],
        strategy: 'text_extract_then_ocr',
        ai_after_parse: true,
        ocr_fallback: true,
        direct_ai: false,
      },
      {
        id: 'image',
        label: '图片/扫描件',
        extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff'],
        strategy: 'ocr_first',
        ai_after_parse: true,
        ocr_fallback: true,
        direct_ai: false,
      },
    ],
  },
  disclosure: {
    show_provider: true,
    show_model: true,
    show_prompt_version: true,
    show_confidence: true,
    show_fallback: true,
    show_source_document: true,
  },
};

const EMPTY_WORKSPACE = {
  myTasks: [],
  collabTasks: [],
  todayTodos: [],
  aiSuggestions: [],
  notifications: [],
};

const EMPTY_DIRECTOR_DASHBOARD = {
  categoryProgress: [],
  personLoads: [],
  blockedTasks: [],
  pendingAssign: [],
};

const UNASSIGNED_OWNER_PATTERN = /待指派|外部机构|已离职/;

function todayDateString(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 当前月份 'YYYY-MM'（服务器本地时区）。 */
function monthDateString(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * 月份字符串 'YYYY-MM' → 该月的起止边界与中文标签。
 * start 含、endExclusive 不含（次月 1 号）；ISO 日期字符串可直接做 >= / < 字典序比较。
 * 非法输入回退到当前月。
 */
function monthRange(month: string): { start: string; endExclusive: string; label: string } {
  const m = /^(\d{4})-(\d{2})$/.exec((month ?? '').trim());
  const now = new Date();
  const year = m ? Number(m[1]) : now.getFullYear();
  const mon = m ? Math.min(12, Math.max(1, Number(m[2]))) : now.getMonth() + 1;
  const nextYear = mon === 12 ? year + 1 : year;
  const nextMon = mon === 12 ? 1 : mon + 1;
  const start = `${String(year).padStart(4, '0')}-${String(mon).padStart(2, '0')}-01`;
  const endExclusive = `${String(nextYear).padStart(4, '0')}-${String(nextMon).padStart(2, '0')}-01`;
  return { start, endExclusive, label: `${year}年${String(mon).padStart(2, '0')}月` };
}

/** 月报「按任务分组」枚举：本月完成 / 本月推进 / 长期停滞 / 月末仍阻塞。 */
type MonthlyReportGroup = 'completed' | 'progressed' | 'stalled' | 'blocked';

/** 月报单任务画像（月报与绩效共用）。 */
type MonthlyReportTaskItem = {
  task_id: string;
  title: string;
  status: string;
  status_label: string;
  progress: number | null;
  due_date: string | null;
  role: 'owner' | 'collaborator';
  group: MonthlyReportGroup;
  month_notes_count: number;
  month_excerpt: string | null;
  month_progress: number | null;
  month_attachments: number;
  blocked_reason: string | null;
  overdue: boolean;
};

/** 绩效考核的客观指标（由任务画像汇总而来）。 */
type PerformanceMetrics = {
  total_tasks: number;
  owner_tasks: number;
  collab_tasks: number;
  completed: number;
  in_progress: number;
  blocked: number;
  stalled: number;
  pending: number;
  notes_count: number;
  attachments_count: number;
  overdue_tasks: number;
  completion_rate: number;
};

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value: unknown): string {
  return String(value ?? '').trim();
}

function identityLookupKey(value: unknown): string {
  return cleanText(value).toLocaleLowerCase('zh-CN').replace(/\s+/g, '');
}

function personNameLookupKey(value: unknown): string {
  return identityLookupKey(cleanText(value).replace(/[（(].*?[）)]/g, ''));
}

function cleanUserId(value: unknown): string {
  return cleanText(value);
}

/**
 * 判定某人是否为任务的「参与者」——主责人或协作人。用于写操作的越权防护：
 * 仅持页面权限（page:rd-my-workspace）的普通成员只能改/记自己负责的任务。
 * 与 moveTasks 的 ownsTask、getWorkspace 的 isPrimary 同口径：每个主责/协作条目
 * 若已绑定 user_id 则按 id 严格匹配，历史上仅按姓名指派、未绑定用户ID的再按姓名归一化兜底。
 */
function isTaskParticipant(
  task: JsonRecord,
  requesterUserId?: string,
  requesterName?: string,
): boolean {
  const uid = cleanUserId(requesterUserId);
  const nameKey = personNameLookupKey(requesterName);
  if (!uid && !nameKey) return false;
  const matches = (idVal: unknown, nameVal: unknown): boolean => {
    const targetId = cleanUserId(idVal);
    if (targetId) return Boolean(uid) && targetId === uid;
    return Boolean(nameKey) && personNameLookupKey(nameVal) === nameKey;
  };
  if (matches(task.primary_owner_user_id ?? task.owner_user_id, task.primary_owner ?? task.owner)) {
    return true;
  }
  return asArray(task.collaborators)
    .filter(isRecord)
    .some((c) => matches((c as JsonRecord).user_id, (c as JsonRecord).name));
}

function isUnassignedOwner(value: unknown): boolean {
  const text = cleanText(value);
  return !text || UNASSIGNED_OWNER_PATTERN.test(text);
}

/**
 * 任务协作人列表归一化：
 *  1) 去除空条目（无 name 也无 id）
 *  2) 同一人去重（按 user_id > person id > 姓名归一化 优先级匹配）
 *  3) 排除主责人（同一人不能既是主责又是协作）
 *  4) 排除"待指派"占位
 * 适用于 createTask / updateTask 写入前的兜底校验。
 */
function normalizeCollaboratorList(
  rawList: unknown,
  primaryOwner?: { name?: string | null; user_id?: string | null },
): JsonRecord[] {
  const list = asArray(rawList).filter(isRecord);
  const ownerKey = (() => {
    const uid = cleanUserId(primaryOwner?.user_id ?? '');
    if (uid) return `u:${uid}`;
    const nameKey = personNameLookupKey(cleanText(primaryOwner?.name ?? ''));
    return nameKey ? `n:${nameKey}` : '';
  })();

  const seen = new Set<string>();
  if (ownerKey) seen.add(ownerKey);

  const result: JsonRecord[] = [];
  for (const c of list) {
    const name = cleanText(c.name);
    const userId = cleanUserId(c.user_id);
    const personId = cleanText(c.id);
    if (!name && !userId && !personId) continue;
    if (isUnassignedOwner(name)) continue;

    const key = userId
      ? `u:${userId}`
      : personId
        ? `p:${personId}`
        : `n:${personNameLookupKey(name)}`;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(c);
  }
  return result;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeTaskRelationIds(value: unknown): string[] {
  const ids = asArray(value).map(cleanText).filter(Boolean);
  return [...new Set(ids)];
}

function taskTreeContainsId(task: JsonRecord, targetTaskId: string): boolean {
  if (cleanText(task.task_id) === targetTaskId) return true;
  return asArray(task.subtasks)
    .filter(isRecord)
    .some((child) => taskTreeContainsId(child, targetTaskId));
}

/** 当前节点计为 1；空的异常节点不进入调用。 */
function taskTreeHeight(task: JsonRecord): number {
  let childHeight = 0;
  for (const child of asArray(task.subtasks).filter(isRecord)) {
    childHeight = Math.max(childHeight, taskTreeHeight(child));
  }
  return 1 + childHeight;
}

/** 在任意深度定位父任务并追加直接子任务；任务 id 全局唯一，命中后停止继续遍历。 */
function appendTaskChildren(
  tasks: unknown[],
  parentTaskId: string,
  children: JsonRecord[],
  updatedAt: string,
): { tasks: unknown[]; inserted: boolean } {
  let inserted = false;
  const nextTasks = tasks.map((task) => {
    if (inserted || !isRecord(task)) return task;
    if (cleanText(task.task_id) === parentTaskId) {
      inserted = true;
      return {
        ...task,
        subtasks: [...asArray(task.subtasks), ...children],
        updated_at: updatedAt,
      };
    }
    const nested = appendTaskChildren(asArray(task.subtasks), parentTaskId, children, updatedAt);
    if (!nested.inserted) return task;
    inserted = true;
    return { ...task, subtasks: nested.tasks };
  });
  return { tasks: nextTasks, inserted };
}

function asRecord(value: unknown, fallback: JsonRecord): JsonRecord {
  return isRecord(value) ? value : fallback;
}

function withGeneratedId(prefix: string, payload: JsonRecord): JsonRecord {
  return {
    ...payload,
    id:
      typeof payload.id === 'string' && payload.id.trim()
        ? payload.id
        : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
}

function generateTaskId(): string {
  const year = new Date().getFullYear();
  const suffix = `${Date.now().toString().slice(-6)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  return `RD-${year}-${suffix}`;
}

function isArchivedTask(task: JsonRecord): boolean {
  return task.archived === true || task.status === 'archived';
}

function isCompletedTask(task: JsonRecord): boolean {
  return task.status === 'completed';
}

function normalizePriority(value: unknown): 'high' | 'medium' | 'low' {
  return value === 'high' || value === 'low' || value === 'medium' ? value : 'medium';
}

function normalizeBomKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLocaleLowerCase('zh-CN')
    .replace(/\s+/g, '')
    .replace(/[\/／\\|>＞·•・._-]/g, '');
}

function splitCategoryPath(value: unknown): string[] {
  return String(value ?? '')
    .split(/[\/／>＞|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function bomChildId(systemId: string, partIndex: number): string {
  return `${systemId}-part-${partIndex + 1}`;
}

function customBomChildId(systemId: string, label: string): string {
  const key = normalizeBomKey(label).replace(/[^\da-z\u4e00-\u9fa5]/gi, '');
  return `${systemId}-custom-${key || Date.now().toString(36)}`;
}

function normalizeTaskShape(task: JsonRecord, categoryLabel: string, childLabel: string): JsonRecord {
  const segments = splitCategoryPath(task.category_path);
  const taskType = segments[2] || DEFAULT_BOM_TASK_TYPE;
  return {
    ...task,
    category_path: `${categoryLabel} / ${childLabel} / ${taskType}`,
    archived: task.archived === true,
    attachments: typeof task.attachments === 'number' ? task.attachments : 0,
    collaborators: Array.isArray(task.collaborators) ? task.collaborators : [],
    subtasks: asArray(task.subtasks)
      .filter(isRecord)
      .map((subtask) => normalizeTaskShape(subtask, categoryLabel, childLabel)),
  };
}

const RD_TASK_STRUCTURE_REVISION_FIELD = '_structure_revision';

function taskCategoryStructureRevision(categories: unknown[]): string {
  const projectTask = (task: JsonRecord): JsonRecord => ({
    task_id: cleanText(task.task_id),
    subtasks: asArray(task.subtasks).filter(isRecord).map(projectTask),
  });
  const projection = asArray(categories).filter(isRecord).map((category) => ({
    id: cleanText(category.id),
    label: cleanText(category.label),
    children: asArray(category.children).filter(isRecord).map((child) => ({
      id: cleanText(child.id),
      label: cleanText(child.label),
      tasks: asArray(child.tasks).filter(isRecord).map(projectTask),
    })),
  }));
  return createHash('sha256').update(JSON.stringify(projection)).digest('hex').slice(0, 24);
}

function decorateTaskCategoriesWithStructureRevision(categories: JsonRecord[]): JsonRecord[] {
  const revision = taskCategoryStructureRevision(categories);
  return categories.map((category) => ({
    ...category,
    [RD_TASK_STRUCTURE_REVISION_FIELD]: revision,
  }));
}

function submittedTaskCategoryStructureRevision(categories: unknown[]): string {
  const revisions = new Set(
    asArray(categories)
      .filter(isRecord)
      .map((category) => cleanText(category[RD_TASK_STRUCTURE_REVISION_FIELD]))
      .filter(Boolean),
  );
  if (revisions.size !== 1) {
    throw new ConflictException('系统树已更新，请刷新后再修改');
  }
  return Array.from(revisions)[0];
}

function assertTaskCategoryStructureRevision(current: JsonRecord[], submittedRevision: string): void {
  if (taskCategoryStructureRevision(current) !== submittedRevision) {
    throw new ConflictException('系统树已被其他人更新，请刷新后再修改');
  }
}

function cloneCategoryShell(category: JsonRecord): JsonRecord {
  const categoryData = { ...category };
  delete categoryData[RD_TASK_STRUCTURE_REVISION_FIELD];
  return {
    ...categoryData,
    id: String(category.id ?? `rd-cat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    label: String(category.label ?? '未命名分类'),
    children: asArray(category.children)
      .filter(isRecord)
      .map((child) => ({
        ...child,
        id: String(child.id ?? `rd-sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        label: String(child.label ?? '未命名子项'),
        tasks: [],
      })),
  };
}

function collectCategoryTasks(category: JsonRecord): Array<{ child: JsonRecord; task: JsonRecord }> {
  const rows: Array<{ child: JsonRecord; task: JsonRecord }> = [];
  for (const child of asArray(category.children)) {
    if (!isRecord(child)) continue;
    for (const task of asArray(child.tasks)) {
      if (!isRecord(task)) continue;
      rows.push({ child, task });
    }
  }
  return rows;
}

function findChildByLabel(children: unknown[], label: string): JsonRecord | undefined {
  const key = normalizeBomKey(label);
  return asArray(children)
    .filter(isRecord)
    .find((child) => normalizeBomKey(child.label) === key);
}

function findCategoryByLabel(categories: JsonRecord[], label: string): JsonRecord | undefined {
  const key = normalizeBomKey(label);
  return categories.find((category) => normalizeBomKey(category.label) === key);
}

function ensureChild(category: JsonRecord, label: string, id?: string): JsonRecord {
  const children = asArray(category.children).filter(isRecord);
  const existing = findChildByLabel(children, label);
  if (existing) return existing;

  const child = {
    id: id?.trim() ? id : customBomChildId(String(category.id ?? 'cat'), label),
    label,
    tasks: [],
  };
  children.push(child);
  category.children = children;
  return child;
}

/**
 * 只有一级、没有任何子项的分类，补一个默认子项。
 *
 * 任务在存储上只存在于 `分类 → 子项 → tasks` 的第二级，一级分类自身没有 tasks 容器。
 * 而「管理分类」允许建出 children 为空的一级分类，于是那个分类下既立不了项
 * （createTask 抛「指定的子项目不存在」）也移不进任务（moveTasks 要求子项必填）。
 * 这里在读取时补一个默认子项，让两级结构永远成立——协同池早就是这个模式
 * （所有立项统一落「协同任务 / 默认」容器，用户永远不用选）。
 *
 * 三条硬约束：
 * - **id 必须确定性派生**：随机 id 会让每次读出来的树都不同，而树结构要参与
 *   taskCategoryStructureRevision 计算，客户端提交时就会被判成「系统树已更新」。
 * - **必须幂等**：整树 PUT 回来时补出来的子项会被持久化，再读一次不能又补一个。
 * - **只补空 children**：已有子项的分类一律不碰。
 */
export function ensureDefaultSubProject(categories: JsonRecord[]): JsonRecord[] {
  return categories.map((category) => {
    if (!isRecord(category)) return category;
    const children = asArray(category.children).filter(isRecord);
    if (children.length > 0) return category;
    const categoryId = cleanText(category.id) || 'cat';
    return {
      ...category,
      children: [
        {
          id: `${categoryId}${RD_DEFAULT_SUBPROJECT_ID_SUFFIX}`,
          label: RD_DEFAULT_SUBPROJECT_LABEL,
          [RD_DEFAULT_SUBPROJECT_FLAG]: true,
          tasks: [],
        },
      ],
    };
  });
}

function ensurePocBomTaskCategories(rawCategories: unknown[]): JsonRecord[] {
  const rawRecords = asArray(rawCategories).filter(isRecord);
  const sourceRecords: JsonRecord[] = rawRecords.length > 0
    ? rawRecords
    : RD_POC_BOM_CATEGORIES.map((system) => ({
        id: system.id,
        label: system.label,
        children: system.parts.map((part, index) => ({
          id: bomChildId(system.id, index),
          label: part,
          tasks: [],
        })),
      }));

  // BOM only seeds a brand-new tree. Once data exists, its category/child structure is
  // user-managed and must be preserved exactly. Structural position is the source of
  // truth; task category_path is derived from the current labels for every consumer.
  const normalized = sourceRecords.map(cloneCategoryShell);
  sourceRecords.forEach((sourceCategory, categoryIndex) => {
    const sourceShell = normalized[categoryIndex];
    for (const { child: sourceChild, task } of collectCategoryTasks(sourceCategory)) {
      const shellChildren = asArray(sourceShell.children).filter(isRecord);
      const sourceChildId = String(sourceChild.id ?? '');
      const targetChild = shellChildren.find((child) => String(child.id ?? '') === sourceChildId)
        ?? findChildByLabel(shellChildren, String(sourceChild.label ?? ''))
        ?? ensureChild(sourceShell, String(sourceChild.label ?? '未命名子项'), sourceChildId);
      targetChild.tasks = [
        ...asArray(targetChild.tasks),
        normalizeTaskShape(task, String(sourceShell.label ?? '未命名分类'), String(targetChild.label ?? '未命名子项')),
      ];
    }
  });

  return normalized;
}

type CategoryTaskSnapshot = {
  allIdCounts: Map<string, number>;
  invalidTaskCount: number;
  rootTasksById: Map<string, JsonRecord>;
};

function snapshotCategoryTasks(categories: unknown[]): CategoryTaskSnapshot {
  const allIdCounts = new Map<string, number>();
  const rootTasksById = new Map<string, JsonRecord>();
  let invalidTaskCount = 0;

  const collectTasks = (tasks: unknown[], root: boolean) => {
    for (const task of tasks) {
      if (!isRecord(task)) continue;
      const taskId = cleanText(task.task_id);
      if (!taskId) {
        invalidTaskCount += 1;
      } else {
        allIdCounts.set(taskId, (allIdCounts.get(taskId) ?? 0) + 1);
        if (root && !rootTasksById.has(taskId)) rootTasksById.set(taskId, task);
      }
      collectTasks(asArray(task.subtasks), false);
    }
  };

  for (const category of categories) {
    if (!isRecord(category)) continue;
    for (const child of asArray(category.children)) {
      if (isRecord(child)) collectTasks(asArray(child.tasks), true);
    }
  }
  return { allIdCounts, invalidTaskCount, rootTasksById };
}

/**
 * 整树 PUT 只能修改分类结构：任务实体必须来自锁内刚读到的服务端真值。
 * 这同时拒绝删除、注入、重复或改变父子层级的 task_id，避免结构权限绕过任务 CRUD 权限。
 */
function reconcileStructureSaveWithServerTasks(current: unknown[], next: JsonRecord[]): JsonRecord[] {
  const currentSnapshot = snapshotCategoryTasks(current);
  const nextSnapshot = snapshotCategoryTasks(next);
  const hasDuplicateIds = (snapshot: CategoryTaskSnapshot) =>
    Array.from(snapshot.allIdCounts.values()).some((count) => count !== 1);

  if (
    currentSnapshot.invalidTaskCount > 0
    || nextSnapshot.invalidTaskCount > 0
    || hasDuplicateIds(currentSnapshot)
    || hasDuplicateIds(nextSnapshot)
  ) {
    throw new BadRequestException('任务树包含缺失或重复的任务编号，请刷新后重试');
  }

  const currentIds = new Set(currentSnapshot.allIdCounts.keys());
  const nextIds = new Set(nextSnapshot.allIdCounts.keys());
  const missingTaskIds = Array.from(currentIds).filter((taskId) => !nextIds.has(taskId));
  const extraTaskIds = Array.from(nextIds).filter((taskId) => !currentIds.has(taskId));
  const currentRootIds = new Set(currentSnapshot.rootTasksById.keys());
  const nextRootIds = new Set(nextSnapshot.rootTasksById.keys());
  const rootShapeChanged = currentRootIds.size !== nextRootIds.size
    || Array.from(currentRootIds).some((taskId) => !nextRootIds.has(taskId));
  if (missingTaskIds.length > 0 || extraTaskIds.length > 0 || rootShapeChanged) {
    throw new BadRequestException('节点下存在任务，只能修改名称或使用专用移动功能，不能直接增删任务');
  }

  return next.map((category) => {
    const categoryLabel = String(category.label ?? '未命名分类');
    return {
      ...category,
      children: asArray(category.children).filter(isRecord).map((child) => {
        const childLabel = String(child.label ?? '未命名子项');
        return {
          ...child,
          tasks: asArray(child.tasks).filter(isRecord).map((submittedTask) => {
            const taskId = cleanText(submittedTask.task_id);
            const serverTask = currentSnapshot.rootTasksById.get(taskId);
            if (!serverTask) {
              throw new BadRequestException('任务层级已变化，请刷新后重试');
            }
            return normalizeTaskShape(serverTask, categoryLabel, childLabel);
          }),
        };
      }),
    };
  });
}

function resolveCategoryTarget(
  categories: JsonRecord[],
  categoryPath: unknown,
  fallbackCategoryId: string,
  fallbackSubProjectId: string,
): { categoryId: string; subProjectId: string } {
  const [categoryLabel, childLabel] = splitCategoryPath(categoryPath);
  const category = categoryLabel ? findCategoryByLabel(categories, categoryLabel) : undefined;
  if (category) {
    const child = childLabel
      ? findChildByLabel(asArray(category.children), childLabel) ?? ensureChild(category, childLabel)
      : asArray(category.children).filter(isRecord)[0];
    if (child) {
      return { categoryId: String(category.id ?? ''), subProjectId: String(child.id ?? '') };
    }
  }

  return { categoryId: fallbackCategoryId, subProjectId: fallbackSubProjectId };
}

@Injectable()
export class ResearchDevelopmentService {
  /**
   * 日志器挂原型（静态实例 + getter），不用实例字段：单测普遍以
   * Object.create(ResearchDevelopmentService.prototype) 造桩，实例字段初始化器不会执行，
   * this.logger 会是 undefined —— 任何走到日志的分支都会抛错，
   * 尤其 best-effort catch 里的告警：本该「记一笔就算了」，反而变成新的故障源。
   */
  private static readonly sharedLogger = new Logger(ResearchDevelopmentService.name);
  private get logger(): Logger {
    return ResearchDevelopmentService.sharedLogger;
  }
  private rdStoreReadCache?: Map<string, { value: unknown; freshUntil: number }>;
  private rdStoreCacheGenerations?: Map<string, number>;
  private rdTaskResourceCache?: Map<string, { value: unknown; freshUntil: number }>;
  private rdTaskResourceCacheGeneration = 0;

  private static readonly RD_STORE_READ_CACHE_TTL_MS = 15_000;
  private static readonly RD_TASK_RESOURCE_CACHE_TTL_MS = 15_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ocrService: OcrService,
    private readonly ossService: OssService,
    private readonly rdAiService: RdAiService,
    private readonly ragService: RagService,
  ) {}

  // ─── RAG 同步钩子 ─────────────────────────────────────────────────────────
  // KB 增删改后 best-effort 同步到 KnowledgeChunk。embedding 失败不影响 CRUD 成功。

  /**
   * 全量回填：把现有所有未 archived 的 KB 条目重新 embedding 并写入 KnowledgeChunk。
   * 适用于：首次开启 RAG / 切换 embedding 模型后 / 清理脏数据后。
   * 失败会跳过单条继续，最后返回成功/失败计数。
   */
  async backfillAllKbToRag(): Promise<{
    total: number;
    succeeded: number;
    failed: number;
    failedIds: string[];
    byKb: Record<string, { total: number; succeeded: number }>;
  }> {
    let succeeded = 0;
    let failed = 0;
    const failedIds: string[] = [];
    const byKb: Record<string, { total: number; succeeded: number }> = {};
    // 研发库（kbId=undefined）+ 全部部门/协同库
    const kbIds: Array<string | undefined> = [undefined, ...DEPT_KBS.map((d) => d.id)];
    let total = 0;
    for (const kbId of kbIds) {
      const raw = await this.readValue(this.kbEntriesKey(kbId));
      const entries: JsonRecord[] = Array.isArray(raw) ? (raw as JsonRecord[]) : [];
      const active = entries.filter((e) => !e.archived);
      const kbKey = kbId ?? 'rd';
      byKb[kbKey] = { total: active.length, succeeded: 0 };
      total += active.length;
      for (const entry of active) {
        try {
          await this.syncKbEntryToRag(entry, kbId);
          succeeded += 1;
          byKb[kbKey].succeeded += 1;
        } catch (err) {
          failed += 1;
          failedIds.push(String(entry.id ?? ''));
          this.logger.warn(
            `[RAG backfill] 失败 kb=${kbKey} entry=${String(entry.id)}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    return { total, succeeded, failed, failedIds, byKb };
  }

  private async syncKbEntryToRag(entry: JsonRecord, kbId?: string): Promise<void> {
    try {
      const id = String(entry.id ?? '').trim();
      if (!id) return;
      // archived → 删除 chunks
      if (entry.archived === true) {
        await this.ragService.removeChunksForSource('kb', id);
        return;
      }
      const title = String(entry.title ?? '').trim();
      const description = String(entry.description ?? '').trim();
      const fileName = String(entry.file_name ?? '').trim();
      const tags = Array.isArray(entry.tags)
        ? (entry.tags as unknown[]).map((t) => String(t).trim()).filter(Boolean)
        : [];
      // 空标题 + 空描述 → 没必要索引（极少见，但兜底）
      if (!title && !description && !fileName) return;

      const text = [
        title && `【标题】${title}`,
        title, // 标题再放一次提升召回
        description && `【说明】${description}`,
        fileName && `【文件名】${fileName}`,
        tags.length > 0 && `【标签】${tags.join('、')}`,
      ]
        .filter(Boolean)
        .join('\n\n');

      const permissionLevel = typeof entry.permission_level === 'number'
        ? Math.max(0, Math.min(100, Math.round(entry.permission_level)))
        : ResearchDevelopmentService.visibilityToLevel(entry.visibility as string | undefined);

      // 分值过滤库（us-collab/purchasing）：库内成员分值表（deptkb.{id}.memberLevels）检索侧
      // 拿不到，若用全局 kbLevel 近似判定，"有页面码+全局分值高、但库内未授权"的用户会越权
      // 检索到受限条目 → 受限条目（permission_level>0）一律不入向量索引，只索引完全公开的。
      if (kbId && LEVEL_FILTERED_DEPT_KB_IDS.has(kbId) && permissionLevel > 0) {
        await this.ragService.removeChunksForSource('kb', id);
        return;
      }
      // 部门/协同库：页面码做检索隔离硬门槛（没有进库资格就检索不到）。
      const entryUrl = kbId
        ? kbId === 'us-collab'
          ? `/us-collab-kb?entry=${encodeURIComponent(id)}`
          : `/dept-kb/${kbId}?entry=${encodeURIComponent(id)}`
        : `/rd-knowledge-base?entry=${encodeURIComponent(id)}`;
      await this.ragService.syncDocument({
        sourceType: 'kb',
        sourceId: id,
        title,
        text,
        metadata: {
          title,
          permission_level: permissionLevel,
          ...(kbId ? { kb_id: kbId, required_any_permissions: [deptKbPageCode(kbId)] } : {}),
          category_id: String(entry.category_id ?? '') || undefined,
          author_id: String(entry.created_by_id ?? '') || undefined,
          author_name: String(entry.created_by_name ?? '') || undefined,
          url: entryUrl,
          file_name: fileName || undefined,
          tags: tags.length > 0 ? tags : undefined,
        },
      });
    } catch (err) {
      this.logger.warn(
        `[RAG] syncKbEntryToRag 失败 (entry=${String(entry.id)}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ─── 任务 / 留痕 → RAG 同步（best-effort，失败不影响业务） ────────────────
  // 池隔离：sourceId 带 `${workspace}:` 前缀防两池 task_id 撞车；metadata 用池页面码做检索门槛，
  // 与 RdWorkspaceInterceptor 的池准入同一集合，凭操作码无法跨池检索。

  private async syncTaskToRag(taskId: string): Promise<void> {
    try {
      const workspace = currentRdWorkspace();
      const task = await this.findTaskAcrossStores(taskId);
      if (!task) return;
      const sourceId = `${workspace}:${taskId}`;
      if (task.archived === true) {
        await this.ragService.removeChunksForSource('rd_task', sourceId);
        return;
      }
      const title = cleanText(task.title) ?? '';
      const description = cleanText(task.description) ?? '';
      const owner = cleanText(task.primary_owner) ?? '';
      const categoryPath = cleanText(task.category_path) ?? '';
      if (!title && !description) return;
      const text = [
        title && `【任务】${title}`,
        description && `【描述】${description}`,
        owner && `【主责人】${owner}`,
        categoryPath && `【分类】${categoryPath}`,
        cleanText(task.status) && `【状态】${cleanText(task.status)}`,
        cleanText(task.due_date) && `【截止】${cleanText(task.due_date)}`,
      ]
        .filter(Boolean)
        .join('\n');
      await this.ragService.syncDocument({
        sourceType: 'rd_task',
        sourceId,
        title,
        text,
        metadata: {
          title,
          workspace,
          task_id: taskId,
          required_any_permissions: WORKSPACE_PAGE_CODES[workspace] ?? [],
          author_name: owner || undefined,
          url:
            workspace === 'us-collab'
              ? `/us-collab-task/${encodeURIComponent(taskId)}`
              : `/rd-task/${encodeURIComponent(taskId)}`,
        },
      });
    } catch (err) {
      this.logger.warn(
        `[RAG] syncTaskToRag 失败 (task=${taskId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async syncProgressNoteToRag(taskId: string, note: JsonRecord): Promise<void> {
    try {
      const workspace = currentRdWorkspace();
      const text = cleanText(note.text) ?? '';
      if (!text) return;
      const task = await this.findTaskAcrossStores(taskId);
      const taskTitle = task ? (cleanText(task.title) ?? '') : '';
      const actorName = isRecord(note.actor) ? (cleanText(note.actor.name) ?? '') : '';
      await this.ragService.syncDocument({
        sourceType: 'rd_progress_note',
        sourceId: `${workspace}:note:${String(note.id ?? '')}`,
        title: taskTitle ? `${taskTitle} · 进展留痕` : '进展留痕',
        text: [taskTitle && `【任务】${taskTitle}`, `【进展】${text}`].filter(Boolean).join('\n'),
        metadata: {
          title: taskTitle || undefined,
          workspace,
          task_id: taskId,
          required_any_permissions: WORKSPACE_PAGE_CODES[workspace] ?? [],
          author_name: actorName || undefined,
          created_at: cleanText(note.created_at) || undefined,
          url:
            workspace === 'us-collab'
              ? `/us-collab-task/${encodeURIComponent(taskId)}`
              : `/rd-task/${encodeURIComponent(taskId)}`,
        },
      });
    } catch (err) {
      this.logger.warn(
        `[RAG] syncProgressNoteToRag 失败 (task=${taskId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * 全量回填两池任务与留痕到向量库：先清池内旧 chunks 再重建（顺带清掉已删任务的遗留索引）。
   * 适用于：首次接入任务源 / 清空数据后 / 切换 embedding 模型。
   */
  async backfillTasksToRag(): Promise<{
    byWorkspace: Record<string, { tasks: number; notes: number; failed: number }>;
  }> {
    const byWorkspace: Record<string, { tasks: number; notes: number; failed: number }> = {};
    for (const workspace of RD_WORKSPACE_IDS) {
      await runInRdWorkspace(workspace, async () => {
        const stat = { tasks: 0, notes: 0, failed: 0 };
        byWorkspace[workspace] = stat;
        await this.ragService.removeChunksBySourcePrefix(
          ['rd_task', 'rd_progress_note'],
          `${workspace}:`,
        );
        const categories = await this.readMergedTaskCategories();
        const taskIds: string[] = [];
        const walk = (tasks: unknown): void => {
          for (const t of asArray(tasks)) {
            if (!isRecord(t)) continue;
            const id = cleanText(t.task_id);
            if (id && t.archived !== true) taskIds.push(id);
            if (Array.isArray(t.subtasks)) walk(t.subtasks);
          }
        };
        for (const cat of categories) {
          for (const sub of asArray(cat.children)) {
            if (isRecord(sub)) walk(sub.tasks);
          }
        }
        for (const id of taskIds) {
          try {
            await this.syncTaskToRag(id);
            stat.tasks += 1;
          } catch {
            stat.failed += 1;
          }
        }
        const noteMap = await this.getProgressNoteMap();
        const aliveTaskIds = new Set(taskIds); // 已删/已归档任务的残留留痕不重建（noteMap 不随删除清理）
        for (const [taskId, notes] of Object.entries(noteMap)) {
          if (!aliveTaskIds.has(taskId)) continue;
          for (const note of asArray(notes)) {
            if (!isRecord(note)) continue;
            try {
              await this.syncProgressNoteToRag(taskId, note);
              stat.notes += 1;
            } catch {
              stat.failed += 1;
            }
          }
        }
      });
    }
    return { byWorkspace };
  }

  private async listIdentityUsers(): Promise<IdentityUser[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        username: true,
        email: true,
        department: true,
        status: true,
      },
    });

    return users.map((user) => ({
      ...user,
      status: String(user.status),
    }));
  }

  private findUserForPerson(person: JsonRecord, users: IdentityUser[]): IdentityUser | undefined {
    const explicitUserId = cleanUserId(person.user_id ?? person.auth_user_id);
    if (explicitUserId) {
      const user = users.find((item) => item.id === explicitUserId);
      if (user) return user;
    }

    const emailKey = identityLookupKey(person.email);
    if (emailKey) {
      const user = users.find((item) => identityLookupKey(item.email) === emailKey);
      if (user) return user;
    }

    const nameKey = personNameLookupKey(person.name);
    if (nameKey) {
      const activeUser = users.find(
        (item) => item.status === 'ACTIVE' && personNameLookupKey(item.name) === nameKey,
      );
      if (activeUser) return activeUser;

      const user = users.find(
        (item) =>
          personNameLookupKey(item.name) === nameKey ||
          identityLookupKey(item.username) === nameKey,
      );
      if (user) return user;
    }

    return undefined;
  }

  private normalizePeopleRecords(rawPeople: unknown[], users: IdentityUser[]): JsonRecord[] {
    return rawPeople.filter(isRecord).map((person) => {
      const user = this.findUserForPerson(person, users);
      const explicitUserId = cleanUserId(person.user_id ?? person.auth_user_id);
      const name = cleanText(person.name) || user?.name || '未命名成员';
      const maxTasks = Number(person.max_tasks);
      const explicitStatus = cleanText(person.status);
      const onLeave = explicitStatus ? explicitStatus === 'on_leave' : person.on_leave === true;
      const rawKbLevel = Number(person.kb_level);
      const kbLevel = cleanText(person.kb_level_scale) === 'score'
        ? ResearchDevelopmentService.clampLevel(rawKbLevel)
        : ResearchDevelopmentService.legacyKbLevelToScore(rawKbLevel);
      return {
        ...person,
        id: cleanText(person.id) || `rd-person-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        user_id: user?.id ?? (explicitUserId || null),
        name,
        email: cleanText(person.email) || user?.email || '',
        username: user?.username ?? (typeof person.username === 'string' ? person.username : null),
        // 绑定账号的成员始终跟随用户主档部门；person.department 仅作为未绑定成员的兜底。
        department: user?.department || cleanText(person.department) || '',
        position: cleanText(person.position) || '研发成员',
        status: explicitStatus || (onLeave ? 'on_leave' : user?.status === 'DISABLED' ? 'resigned' : 'active'),
        user_status: user?.status ?? (typeof person.user_status === 'string' ? person.user_status : null),
        on_leave: onLeave,
        task_count: typeof person.task_count === 'number' ? person.task_count : 0,
        max_tasks: Number.isFinite(maxTasks) && maxTasks > 0 ? Math.round(maxTasks) : 8,
        tasks: asArray(person.tasks).map((item) => cleanText(item)).filter(Boolean),
        task_ids: asArray(person.task_ids).map((item) => cleanText(item)).filter(Boolean),
        kb_level: kbLevel,
        kb_level_scale: 'score',
      };
    });
  }

  private async getIdentityContext(): Promise<IdentityContext> {
    const [users, rawPeople] = await Promise.all([
      this.listIdentityUsers(),
      this.readArray('rd.people'),
    ]);
    return {
      users,
      people: this.normalizePeopleRecords(rawPeople, users),
    };
  }

  private resolveOwnerIdentity(
    ownerValue: unknown,
    userIdValue: unknown,
    people: JsonRecord[],
    users: IdentityUser[],
  ): { name: string; userId: string | null } {
    const explicitUserId = cleanUserId(userIdValue);
    if (explicitUserId) {
      const person = people.find((item) => cleanUserId(item.user_id) === explicitUserId);
      const user = users.find((item) => item.id === explicitUserId);
      if (person || user) {
        return {
          name: cleanText(person?.name) || user?.name || cleanText(ownerValue) || '待指派',
          userId: explicitUserId,
        };
      }
    }

    const owner = cleanText(ownerValue);
    if (isUnassignedOwner(owner)) {
      return { name: owner || '待指派', userId: null };
    }

    const ownerKey = personNameLookupKey(owner);
    const person = people.find((item) => personNameLookupKey(item.name) === ownerKey);
    if (person) {
      return {
        name: cleanText(person.name) || owner,
        userId: cleanUserId(person.user_id) || null,
      };
    }

    const user = users.find(
      (item) =>
        personNameLookupKey(item.name) === ownerKey ||
        identityLookupKey(item.username) === ownerKey ||
        identityLookupKey(item.email) === ownerKey,
    );
    if (user) return { name: user.name, userId: user.id };

    return { name: owner, userId: null };
  }

  private normalizeCollaborators(
    value: unknown,
    people: JsonRecord[],
    users: IdentityUser[],
  ): JsonRecord[] {
    const normalized: JsonRecord[] = [];
    asArray(value).forEach((collaborator, index) => {
      if (isRecord(collaborator)) {
        const resolved = this.resolveOwnerIdentity(
          collaborator.name ?? collaborator.owner,
          collaborator.user_id,
          people,
          users,
        );
        if (!resolved.name || isUnassignedOwner(resolved.name)) return;
        normalized.push({
          ...collaborator,
          id: cleanText(collaborator.id) || resolved.userId || `collab-${index}`,
          name: resolved.name,
          user_id: resolved.userId,
          role: cleanText(collaborator.role) || '协作人',
        });
        return;
      }

      const resolved = this.resolveOwnerIdentity(collaborator, null, people, users);
      if (!resolved.name || isUnassignedOwner(resolved.name)) return;
      normalized.push({
        id: resolved.userId || `collab-${index}`,
        name: resolved.name,
        user_id: resolved.userId,
        role: '协作人',
      });
    });
    return normalized;
  }

  private normalizeTaskIdentity(task: JsonRecord, people: JsonRecord[], users: IdentityUser[]): JsonRecord {
    const owner = this.resolveOwnerIdentity(
      task.primary_owner ?? task.owner,
      task.primary_owner_user_id ?? task.owner_user_id,
      people,
      users,
    );

    return {
      ...task,
      primary_owner: owner.name,
      primary_owner_user_id: owner.userId,
      collaborators: this.normalizeCollaborators(task.collaborators, people, users),
      subtasks: asArray(task.subtasks)
        .filter(isRecord)
        .map((subtask) => this.normalizeTaskIdentity(subtask, people, users)),
    };
  }

  private normalizeCategoriesWithIdentity(
    categories: JsonRecord[],
    people: JsonRecord[],
    users: IdentityUser[],
  ): JsonRecord[] {
    return categories.map((category) => ({
      ...category,
      children: asArray(category.children)
        .filter(isRecord)
        .map((child) => ({
          ...child,
          tasks: asArray(child.tasks)
            .filter(isRecord)
            .map((task) => this.normalizeTaskIdentity(task, people, users)),
        })),
    }));
  }

  async snapshot(auditViewer?: { userId?: string; userName?: string; canReadAll: boolean }) {
    const [
      taskCategories,
      workspace,
      directorDashboard,
      people,
      approvalFlows,
      auditLogs,
      aiSettings,
    ] = await Promise.all([
      this.getTaskCategories(),
      this.getWorkspace(),
      this.getDirectorDashboard(),
      this.getPeople(),
      this.getApprovalFlows(),
      this.getAuditLogs(auditViewer),
      this.getAiSettings(),
    ]);

    return {
      taskCategories,
      workspace,
      directorDashboard,
      people,
      approvalFlows,
      auditLogs,
      aiSettings,
    };
  }

  async getTaskCategories(options: { includeCovers?: boolean; skipMirrorRefresh?: boolean } = {}) {
    if (!options.skipMirrorRefresh) await this.refreshProductionMirrorsIfNeeded();
    const cacheKey = this.taskResourceCacheKey(
      options.includeCovers ? 'task-categories:covers' : 'task-categories',
      [],
      { hasFullAccess: true },
    );
    const cached = this.readTaskResourceCache<JsonRecord[]>(cacheKey);
    if (cached) return cached;
    const [categories, noteMap, scoresRaw] = await Promise.all([
      this.readNormalizedTaskCategories(),
      this.getProgressNoteMap(),
      this.readValue('rd.taskCompletionScores'),
    ]);
    const scoreMap: JsonRecord = isRecord(scoresRaw) ? scoresRaw : {};
    return this.writeTaskResourceCache(
      cacheKey,
      decorateTaskCategoriesWithStructureRevision(
        this.applyProgressAttachmentCounts(categories, noteMap, scoreMap, options),
      ),
    );
  }

  /**
   * 主库 + 所有产品库合并后的分类树（前端格式，含附件数 / 完成评分）。
   * 与个人工作台 getWorkspace 同源（均走 readMergedTaskCategories），用于研发驾驶舱「概览」
   * 的人员任务跨产品聚合——「任务是任务，产品是产品」：一个人的任务是其在所有产品库任务的并集，
   * 不被「当前产品库」切分，故概览头像负载与个人工作台口径一致。
   */
  async getMergedTaskCategories(options: { includeCovers?: boolean } = {}) {
    await this.refreshProductionMirrorsIfNeeded();
    const cacheKey = this.taskResourceCacheKey(
      options.includeCovers ? 'merged-task-categories:covers' : 'merged-task-categories',
      [],
      { hasFullAccess: true },
    );
    const cached = this.readTaskResourceCache<JsonRecord[]>(cacheKey);
    if (cached) return cached;
    const [categories, noteMap, scoresRaw] = await Promise.all([
      this.readMergedTaskCategories(),
      this.getProgressNoteMap(),
      this.readValue('rd.taskCompletionScores'),
    ]);
    const scoreMap: JsonRecord = isRecord(scoresRaw) ? scoresRaw : {};
    return this.writeTaskResourceCache(
      cacheKey,
      this.applyProgressAttachmentCounts(categories, noteMap, scoreMap, options),
    );
  }

  /**
   * 研发管理员人员视角专用：把研发全产品任务与协同任务做只读拼接。
   * 两个任务池仍保持各自的存储、权限和业务流程；这里只给每个任务加来源标记，
   * 便于前端点击后进入正确的详情页。研发 KPI 与 AI 分析继续使用 getMergedTaskCategories。
   */
  async getMemberTaskCategories() {
    if (currentRdWorkspace() !== 'rd') {
      throw new ForbiddenException('跨工作区人员任务仅在研发管理员视角提供');
    }
    const [researchCategories, collaborationCategories] = await Promise.all([
      runInRdWorkspace('rd', () => this.getMergedTaskCategories()),
      runInRdWorkspace('us-collab', () => this.getMergedTaskCategories()),
    ]);
    return [
      ...this.markTaskCategoryWorkspace(researchCategories, 'rd'),
      ...this.markTaskCategoryWorkspace(collaborationCategories, 'us-collab', true),
    ];
  }

  private markTaskCategoryWorkspace(
    categories: JsonRecord[],
    workspace: 'rd' | 'us-collab',
    prefixCategoryIds = false,
  ): JsonRecord[] {
    const markTasks = (tasks: unknown[]): JsonRecord[] => tasks.filter(isRecord).map((task) => ({
      ...task,
      source_workspace: workspace,
      subtasks: markTasks(asArray(task.subtasks)),
    }));
    return categories.filter(isRecord).map((category) => ({
      ...category,
      ...(prefixCategoryIds ? { id: `${workspace}:${cleanText(category.id)}` } : {}),
      children: asArray(category.children).filter(isRecord).map((child) => ({
        ...child,
        ...(prefixCategoryIds ? { id: `${workspace}:${cleanText(child.id)}` } : {}),
        tasks: markTasks(asArray(child.tasks)),
      })),
    }));
  }

  // ── 研发任务同步到生产驾驶舱 ─────────────────────────────────────────────

  private productionMirrorRefreshLock: Promise<unknown> = Promise.resolve();
  private productionMirrorFreshUntil = 0;

  private withProductionMirrorRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.productionMirrorRefreshLock.then(fn, fn);
    this.productionMirrorRefreshLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private assertDefaultResearchWorkspace(): void {
    if (currentRdWorkspace() !== 'rd') {
      throw new ForbiddenException('同步到生产驾驶舱只能在研发任务驾驶舱中操作');
    }
  }

  private normalizeProductionSyncRegistry(value: unknown): Record<string, ProductionTaskSyncRecord> {
    if (!isRecord(value)) return {};
    const result: Record<string, ProductionTaskSyncRecord> = {};
    for (const [taskId, raw] of Object.entries(value)) {
      if (!isRecord(raw) || !cleanText(taskId)) continue;
      const firstSyncedAt = cleanText(raw.first_synced_at) || cleanText(raw.synced_at);
      const syncedAt = cleanText(raw.synced_at) || firstSyncedAt;
      if (!firstSyncedAt || !syncedAt) continue;
      result[taskId] = {
        task_id: taskId,
        active: raw.active === true,
        first_synced_at: firstSyncedAt,
        synced_at: syncedAt,
        synced_by_id: cleanUserId(raw.synced_by_id) || null,
        synced_by_name: cleanText(raw.synced_by_name) || '研发成员',
        revoked_at: cleanText(raw.revoked_at) || null,
        revoked_by_id: cleanUserId(raw.revoked_by_id) || null,
        revoked_by_name: cleanText(raw.revoked_by_name) || null,
      };
    }
    return result;
  }

  private async readProductionSyncRegistry(): Promise<Record<string, ProductionTaskSyncRecord>> {
    return this.normalizeProductionSyncRegistry(await this.readValue('rd.productionTaskSyncs'));
  }

  async listProductionTaskSyncs(): Promise<ProductionTaskSyncRecord[]> {
    this.assertDefaultResearchWorkspace();
    const registry = await this.readProductionSyncRegistry();
    return Object.values(registry).sort((a, b) => b.synced_at.localeCompare(a.synced_at));
  }

  private async appendProductionSyncAudit(entry: JsonRecord): Promise<void> {
    const current = await this.readArray('rd.productionTaskSyncAudit');
    const next = {
      id: `rd-production-sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      ...entry,
    }
    // 独立审计表不随撤销删除；保留足够长的操作历史，同时避免设置表无限膨胀。
    await this.writeValue('rd.productionTaskSyncAudit', [next, ...current].slice(0, 5000));
  }

  async syncTaskToProduction(
    taskId: string,
    actor?: { userId?: string; userName?: string },
  ): Promise<ProductionTaskSyncRecord> {
    this.assertDefaultResearchWorkspace();
    const id = cleanText(taskId);
    if (!id) throw new BadRequestException('taskId 不能为空');
    const task = await this.findTaskAcrossStores(id);
    if (!task) throw new NotFoundException('任务不存在');

    const registry = await this.readProductionSyncRegistry();
    const previous = registry[id];
    const now = new Date().toISOString();
    const record: ProductionTaskSyncRecord = {
      task_id: id,
      active: true,
      first_synced_at: previous?.first_synced_at ?? now,
      synced_at: now,
      synced_by_id: cleanUserId(actor?.userId) || null,
      synced_by_name: cleanText(actor?.userName) || '研发成员',
      revoked_at: null,
      revoked_by_id: null,
      revoked_by_name: null,
    };
    await this.writeValue('rd.productionTaskSyncs', { ...registry, [id]: record });
    await this.appendProductionSyncAudit({
      action: previous?.active ? 'task.production_sync_refreshed' : 'task.production_sync_enabled',
      task_id: id,
      actor: { id: record.synced_by_id, name: record.synced_by_name },
    });
    await this.createAuditLog({
      actor: { id: record.synced_by_id, name: record.synced_by_name },
      action: previous?.active ? 'task.production_sync_refreshed' : 'task.production_sync_enabled',
      resource: { type: 'task', id, name: cleanText(task.title) || id },
      comment: previous?.active ? '更新同步到生产驾驶舱的任务镜像' : '同步任务到生产驾驶舱',
      source: 'api',
    });
    await this.refreshProductionMirrors(true);
    return record;
  }

  async revokeTaskProductionSync(
    taskId: string,
    actor?: { userId?: string; userName?: string },
  ): Promise<ProductionTaskSyncRecord> {
    this.assertDefaultResearchWorkspace();
    const id = cleanText(taskId);
    if (!id) throw new BadRequestException('taskId 不能为空');
    const registry = await this.readProductionSyncRegistry();
    const previous = registry[id];
    if (!previous) throw new NotFoundException('该任务尚未同步到生产驾驶舱');
    if (!previous.active) return previous;

    const now = new Date().toISOString();
    const record: ProductionTaskSyncRecord = {
      ...previous,
      active: false,
      revoked_at: now,
      revoked_by_id: cleanUserId(actor?.userId) || null,
      revoked_by_name: cleanText(actor?.userName) || '研发成员',
    };
    await this.writeValue('rd.productionTaskSyncs', { ...registry, [id]: record });
    await this.appendProductionSyncAudit({
      action: 'task.production_sync_revoked',
      task_id: id,
      actor: { id: record.revoked_by_id, name: record.revoked_by_name },
    });
    await this.createAuditLog({
      actor: { id: record.revoked_by_id, name: record.revoked_by_name },
      action: 'task.production_sync_revoked',
      resource: { type: 'task', id, name: id },
      comment: '撤销同步到生产驾驶舱',
      source: 'api',
    });
    await this.refreshProductionMirrors(true);
    return record;
  }

  private collectTaskTreeIds(task: JsonRecord): string[] {
    const ids: string[] = [];
    const walk = (item: JsonRecord) => {
      const id = cleanText(item.task_id);
      if (id) ids.push(id);
      for (const child of asArray(item.subtasks).filter(isRecord)) walk(child);
    };
    walk(task);
    return ids;
  }

  private async refreshProductionMirrorsIfNeeded(): Promise<void> {
    if (currentRdWorkspace() === PRODUCTION_WORKSPACE) {
      await this.refreshProductionMirrors();
    }
  }

  /** Materialize the latest active R&D snapshots into the isolated production task/note/score stores. */
  private refreshProductionMirrors(force = false): Promise<void> {
    return this.withProductionMirrorRefreshLock(async () => {
      // 驾驶舱首屏会并行请求分类树、合并树和附件预览；短时间内合并为一次源数据刷新。
      if (!force && this.productionMirrorFreshUntil > Date.now()) return;
      const source = await runInRdWorkspace('rd', async () => {
        const [registry, allTrees, noteMap, scoreRaw] = await Promise.all([
          this.readProductionSyncRegistry(),
          this.readAllTaskTrees(),
          this.getProgressNoteMap(),
          this.readValue('rd.taskCompletionScores'),
        ]);
        const placements: ProductionMirrorPlacement[] = [];
        const mirroredNotes: Record<string, JsonRecord[]> = {};
        const mirroredScores: JsonRecord = {};
        const scoreMap = isRecord(scoreRaw) ? scoreRaw : {};
        const activeSources = Object.values(registry)
          .filter((record) => record.active)
          .map((record) => ({
            record,
            slot: this.locateTaskInTrees(allTrees.trees, record.task_id),
          }))
          .filter((item): item is { record: ProductionTaskSyncRecord; slot: TaskSlot } => Boolean(item.slot))
          // 父任务先投影；如果子任务也被单独同步，后续会因已被父树覆盖而跳过，保证生产池 task_id 唯一。
          .sort((a, b) => this.collectTaskTreeIds(b.slot.task).length - this.collectTaskTreeIds(a.slot.task).length);
        const coveredTaskIds = new Set<string>();

        for (const { record, slot } of activeSources) {
          if (coveredTaskIds.has(record.task_id)) continue;
          const mirror = buildProductionMirrorTask(slot.task, {
            rootTaskId: record.task_id,
            syncedAt: record.synced_at,
          });
          // 独立同步子任务时，它在生产侧作为顶层镜像展示；真实父子关系仍保留在来源信息中。
          mirror.parent_task_id = null;
          placements.push({
            categoryId: slot.categoryId,
            categoryLabel: slot.categoryLabel,
            subProjectId: slot.subProjectId,
            subProjectLabel: slot.subProjectLabel,
            task: mirror,
          });
          for (const sourceTaskId of this.collectTaskTreeIds(slot.task)) {
            coveredTaskIds.add(sourceTaskId);
            if (Array.isArray(noteMap[sourceTaskId])) mirroredNotes[sourceTaskId] = noteMap[sourceTaskId];
            if (isRecord(scoreMap[sourceTaskId])) mirroredScores[sourceTaskId] = scoreMap[sourceTaskId];
          }
        }
        return { placements, mirroredNotes, mirroredScores };
      });

      await runInRdWorkspace(PRODUCTION_WORKSPACE, () => this.withTaskTreeLock(async () => {
        const [currentCategories, currentNotesRaw, currentScoresRaw] = await Promise.all([
          this.readNormalizedTaskCategories(),
          this.readValue('rd.taskProgressNotes'),
          this.readValue('rd.taskCompletionScores'),
        ]);
        const previousMirrorIds = new Set<string>();
        for (const task of this.collectAllCategoryTasks(currentCategories)) {
          if (isProductionMirrorTask(task)) previousMirrorIds.add(cleanText(task.task_id));
        }
        const nextCategories = mergeProductionMirrorTasks(currentCategories, source.placements);
        const nextNotes: Record<string, JsonRecord[]> = isRecord(currentNotesRaw)
          ? { ...(currentNotesRaw as Record<string, JsonRecord[]>) }
          : {};
        const nextScores: JsonRecord = isRecord(currentScoresRaw) ? { ...currentScoresRaw } : {};
        for (const id of previousMirrorIds) {
          delete nextNotes[id];
          delete nextScores[id];
        }
        Object.assign(nextNotes, source.mirroredNotes);
        Object.assign(nextScores, source.mirroredScores);

        const operations: ReturnType<ResearchDevelopmentService['buildSettingUpsert']>[] = [];
        if (JSON.stringify(currentCategories) !== JSON.stringify(nextCategories)) {
          operations.push(this.buildSettingUpsert('rd.taskCategories', nextCategories));
        }
        if (JSON.stringify(currentNotesRaw ?? {}) !== JSON.stringify(nextNotes)) {
          operations.push(this.buildSettingUpsert('rd.taskProgressNotes', nextNotes));
        }
        if (JSON.stringify(currentScoresRaw ?? {}) !== JSON.stringify(nextScores)) {
          operations.push(this.buildSettingUpsert('rd.taskCompletionScores', nextScores));
        }
        if (operations.length > 0) {
          await this.prisma.$transaction(operations);
          this.invalidateCachedStoreValues([
            'rd.taskCategories',
            'rd.taskProgressNotes',
            'rd.taskCompletionScores',
          ]);
        }
      }));
      this.productionMirrorFreshUntil = Date.now() + 1_000;
    });
  }

  private assertTaskWritable(task: JsonRecord): void {
    if (isProductionMirrorTask(task)) {
      throw new ForbiddenException('该任务由研发同步，在生产驾驶舱中为只读，不能执行任何操作');
    }
  }

  private async assertTaskIdWritable(taskId: string): Promise<JsonRecord> {
    await this.refreshProductionMirrorsIfNeeded();
    const task = await this.findTaskAcrossStores(taskId);
    if (!task) throw new NotFoundException('任务不存在');
    this.assertTaskWritable(task);
    return task;
  }

  private async isProductionMirrorTaskId(taskId: string): Promise<boolean> {
    if (currentRdWorkspace() !== PRODUCTION_WORKSPACE) return false;
    await this.refreshProductionMirrorsIfNeeded();
    const task = await this.findTaskAcrossStores(taskId);
    return Boolean(task && isProductionMirrorTask(task));
  }

  private productionMirrorFingerprint(categories: JsonRecord[]): string {
    const mirrors: unknown[] = [];
    for (const category of categories) {
      for (const subProject of asArray(category.children).filter(isRecord)) {
        for (const task of asArray(subProject.tasks).filter(isRecord)) {
          if (!isProductionMirrorTask(task)) continue;
          mirrors.push({
            category_id: cleanText(category.id),
            sub_project_id: cleanText(subProject.id),
            task,
          });
        }
      }
    }
    return JSON.stringify(mirrors);
  }

  async saveTaskCategories(payload: unknown[], actor?: AuditActorRef) {
    const structureBefore = await this.readNormalizedTaskCategories();
    await this.refreshProductionMirrorsIfNeeded();
    const submittedRevision = submittedTaskCategoryStructureRevision(payload);
    const normalized = ensurePocBomTaskCategories(payload);
    // 结构编辑允许改名/移动，但不能顺带丢失任务。校验与写入放在同一把锁内，
    // 避免校验后有新任务写入、随后又被旧整树快照覆盖。
    const saved = await this.withTaskTreeLock(async () => {
      const current = await this.readNormalizedTaskCategories();
      assertTaskCategoryStructureRevision(current, submittedRevision);
      const reconciled = reconcileStructureSaveWithServerTasks(current, normalized);
      if (currentRdWorkspace() === PRODUCTION_WORKSPACE) {
        if (this.productionMirrorFingerprint(current) !== this.productionMirrorFingerprint(reconciled)) {
          throw new ForbiddenException('研发同步任务在生产驾驶舱中为只读，不能修改、移动或删除');
        }
      }
      // 必须与读路径做同一次注入再算版本号：读路径会给空 children 的一级分类补默认子项，
      // 若这里按客户端提交的原树落盘并回传版本号，下一次读取补完后版本号就变了，
      // 客户端拿着回传的旧版本号再提交必然被判「系统树已更新」——新建一级分类后
      // 紧接着做任何结构修改都会失败。
      const withDefaults = ensureDefaultSubProject(reconciled);
      await this.writeValue('rd.taskCategories', withDefaults);
      return decorateTaskCategoriesWithStructureRevision(withDefaults);
    });
    // 分类/子项目的增删改走的是整树覆盖保存，服务端拿不到「改了哪一个」的语义，
    // 只能记录结构规模的变化。粒度粗，但这是唯一绕不过去的落点——
    // 合并前前后端都没为这条路径留过痕，等于系统树可以被静默改动。
    await this.recordStructureAudit(structureBefore, saved, actor);
    await this.recomputeDirectorDashboard();
    return saved;
  }

  /** 系统树的节点清单：id → 名称，一级分类与子项目分开收集。 */
  private collectStructureNodes(categories: unknown[]) {
    const categoryLabels = new Map<string, string>();
    const subProjectLabels = new Map<string, string>();
    for (const category of categories) {
      if (!isRecord(category)) continue;
      const categoryId = cleanText(category.id);
      if (categoryId) categoryLabels.set(categoryId, cleanText(category.label));
      for (const child of asArray(category.children)) {
        if (!isRecord(child)) continue;
        const childId = cleanText(child.id);
        if (childId) subProjectLabels.set(childId, cleanText(child.label));
      }
    }
    return { categoryLabels, subProjectLabels };
  }

  /** 两份节点清单的增 / 删 / 改名。 */
  private diffStructureNodes(before: Map<string, string>, after: Map<string, string>) {
    const added: string[] = [];
    const removed: string[] = [];
    const renamed: Array<{ before: string; after: string }> = [];
    for (const [id, label] of after) {
      if (!before.has(id)) added.push(label || id);
      else if (before.get(id) !== label) renamed.push({ before: before.get(id) || id, after: label || id });
    }
    for (const [id, label] of before) {
      if (!after.has(id)) removed.push(label || id);
    }
    return { added, removed, renamed };
  }

  /**
   * 系统树结构变化的留痕。
   *
   * 分类/子项目的增删改走整树覆盖保存，请求体里没有「我改了哪一个」的语义，
   * 所以在服务端按节点 id 比对前后两棵树，把具体加了什么、删了什么、谁改名了算出来——
   * 只记数量的话，删一个又加一个会显示成「没变化」。
   */
  private async recordStructureAudit(before: unknown[], after: unknown[], actor?: AuditActorRef) {
    const prev = this.collectStructureNodes(before);
    const next = this.collectStructureNodes(after);
    const categories = this.diffStructureNodes(prev.categoryLabels, next.categoryLabels);
    const subProjects = this.diffStructureNodes(prev.subProjectLabels, next.subProjectLabels);

    const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
    const push = (field: string, diff: ReturnType<typeof this.diffStructureNodes>) => {
      if (diff.added.length) changes.push({ field: `${field}_added`, before: '', after: diff.added.join('、') });
      if (diff.removed.length) changes.push({ field: `${field}_removed`, before: diff.removed.join('、'), after: '' });
      for (const item of diff.renamed) changes.push({ field: `${field}_renamed`, before: item.before, after: item.after });
    };
    push('category', categories);
    push('sub_project', subProjects);
    if (changes.length === 0) return;

    // 动作码按「本次主要干了什么」取：新增优先于删除，都没有则算编辑（改名/移动）
    const created = categories.added.length + subProjects.added.length;
    const deleted = categories.removed.length + subProjects.removed.length;
    const action = created > 0 ? 'category.created' : deleted > 0 ? 'category.deleted' : 'category.edited';
    const summary = [
      created > 0 ? `新增 ${created} 项` : '',
      deleted > 0 ? `删除 ${deleted} 项` : '',
      categories.renamed.length + subProjects.renamed.length > 0
        ? `改名 ${categories.renamed.length + subProjects.renamed.length} 项`
        : '',
    ].filter(Boolean).join('，');

    await this.recordServerAudit({
      action,
      resource: { type: 'category', id: `task-tree-${currentRdWorkspace()}`, name: '任务系统树' },
      actor: { id: actor?.userId, name: actor?.userName },
      comment: `调整任务系统树：${summary}`,
      changes,
    });
  }

  /**
   * 为立项创建一个空的分类/子项目容器。客户端不能提交任务树，避免普通立项人借整树 PUT 绕过审核策略。
   */
  async ensureProposalTarget(input: {
    productId?: string;
    categoryLabel?: string;
    subProjectLabel?: string;
  }): Promise<{ category_id: string; sub_project_id: string }> {
    const productId = cleanText(input.productId) || RD_MAIN_PRODUCT_ID;
    const categoryLabel = cleanText(input.categoryLabel);
    const subProjectLabel = cleanText(input.subProjectLabel) || '立项任务';
    if (!categoryLabel) throw new BadRequestException('分类名称不能为空');
    if (categoryLabel.length > 100 || subProjectLabel.length > 100) {
      throw new BadRequestException('分类名称过长');
    }

    return this.withTaskTreeLock(async () => {
      const categories = await this.readTaskCategoriesForProduct(productId);
      const next: JsonRecord[] = categories.filter(isRecord).map((category) => ({
        ...category,
        children: asArray(category.children).map((child) => isRecord(child) ? { ...child } : child),
      }));
      let category: JsonRecord | undefined = next.find(
        (item) => normalizeBomKey(item.label) === normalizeBomKey(categoryLabel),
      );
      let changed = false;
      if (!category) {
        category = {
          id: `rd-cat-${randomUUID()}`,
          label: categoryLabel,
          children: [],
        };
        next.push(category);
        changed = true;
      }

      const children = asArray(category.children).filter(isRecord);
      let subProject = children.find(
        (item) => normalizeBomKey(item.label) === normalizeBomKey(subProjectLabel),
      ) ?? children[0];
      if (!subProject) {
        subProject = {
          id: `rd-sub-${randomUUID()}`,
          label: subProjectLabel,
          tasks: [],
        };
        category.children = [...children, subProject];
        changed = true;
      }
      if (changed || productId !== RD_MAIN_PRODUCT_ID) {
        await this.writeTaskCategoriesForProduct(productId, next);
      }
      return {
        category_id: cleanText(category.id),
        sub_project_id: cleanText(subProject.id),
      };
    });
  }

  // ── Products (产品线) ────────────────────────────────────────────────────────

  async getProducts(): Promise<JsonRecord[]> {
    const raw = await this.readValue('rd.products');
    if (Array.isArray(raw) && raw.length > 0) return (raw as unknown[]).filter(isRecord);
    const defaults = this.buildDefaultProducts();
    await this.writeValue('rd.products', defaults);
    return defaults;
  }

  async saveProducts(products: unknown[]): Promise<{ ok: boolean }> {
    if (!Array.isArray(products)) throw new BadRequestException('products 必须是数组');
    await this.writeValue('rd.products', products);
    return { ok: true };
  }

  // ── Per-product task categories ────────────────────────────────────────────

  /** 读取指定产品的独立研发分类树（首次访问自动 seed 空 BOM） */
  async getProductTaskCategories(productId: string): Promise<JsonRecord[]> {
    const snapshot = await this.readProductTaskCategorySnapshot(productId);
    if (!snapshot.needsWrite) return decorateTaskCategoriesWithStructureRevision(snapshot.categories);

    // 快路径保持纯读；只有 seed/迁移需要写回时才获取写锁，并在锁内重读避免覆盖并发任务更新。
    return this.withTaskTreeLock(async () => {
      const latest = await this.readProductTaskCategorySnapshot(productId);
      if (latest.needsWrite) {
        await this.saveProductCategoryStore({ ...latest.store, [productId]: latest.categories });
      }
      return decorateTaskCategoriesWithStructureRevision(latest.categories);
    });
  }

  private async getProductTaskCategoriesUnlocked(productId: string): Promise<JsonRecord[]> {
    // 锁内调用者后续若有变更会显式写回；锁外只读场景不得因归一化产生隐式整库写。
    return (await this.readProductTaskCategorySnapshot(productId)).categories;
  }

  private async readProductTaskCategorySnapshot(productId: string): Promise<{
    store: Record<string, unknown>;
    categories: JsonRecord[];
    needsWrite: boolean;
  }> {
    const store = await this.readProductCategoryStore();
    if (Array.isArray(store[productId]) && (store[productId] as unknown[]).length > 0) {
      const current = store[productId] as unknown[];
      const normalized = ensurePocBomTaskCategories(current);
      // needsWrite 只比较 BOM 归一化的结果：默认子项在这之后补，故它自身永远不会触发
      // 「读的时候整树写回」——那是本文件明确禁止的（会覆盖并发的任务写入）。
      // 补出来的子项会在下一次真实写入（建/移任务）时顺带落盘。
      return {
        store,
        categories: ensureDefaultSubProject(normalized),
        needsWrite: JSON.stringify(current) !== JSON.stringify(normalized),
      };
    }
    return { store, categories: ensureDefaultSubProject(ensurePocBomTaskCategories([])), needsWrite: true };
  }

  /**
   * 为项目归类总结提供只读、服务端可信的任务快照。
   * 前端只提交产品/类目范围，不能自行拼任务列表，避免越界分析或伪造任务内容。
   */
  async getProjectClassificationContext(input: {
    productId?: string;
    categoryId?: string;
    subProjectId?: string;
  }): Promise<{
    product_id: string;
    category_id: string;
    sub_project_id?: string;
    label: string;
    task_count: number;
    tasks: Array<{
      task_id: string;
      title: string;
      description: string;
      status: string;
      progress: number;
      priority: string;
      primary_owner: string;
      due_date: string;
      category_path: string;
      parent_task_id: string | null;
      tree_depth: number;
      product_id?: string;
      product_name?: string;
      category_label?: string;
      sub_project_label?: string;
    }>;
  }> {
    const productId = cleanText(input.productId) || RD_MAIN_PRODUCT_ID;
    const categoryId = cleanText(input.categoryId);
    const subProjectId = cleanText(input.subProjectId);

    // 驾驶舱总览的全量治理入口：跨主库与全部产品库，不以现有类目作为分析边界。
    if (!categoryId) {
      const [mainCategories, productStore, products] = await Promise.all([
        this.readNormalizedTaskCategories(),
        this.readProductCategoryStore(),
        this.getProducts(),
      ]);
      const productNameById = new Map(
        products.map((product) => [cleanText(product.id), cleanText(product.name) || '未命名产品']),
      );
      const sources: Array<{ productId: string; categories: JsonRecord[] }> = [
        { productId: RD_MAIN_PRODUCT_ID, categories: mainCategories },
        ...Object.entries(productStore)
          .filter(([id]) => id !== RD_MAIN_PRODUCT_ID)
          .map(([id, raw]) => ({ productId: id, categories: ensurePocBomTaskCategories(asArray(raw)) })),
      ];
      const allTasks: Array<{
        task_id: string;
        title: string;
        description: string;
        status: string;
        progress: number;
        priority: string;
        primary_owner: string;
        due_date: string;
        category_path: string;
        parent_task_id: string | null;
        tree_depth: number;
        product_id?: string;
        product_name?: string;
        category_label?: string;
        sub_project_label?: string;
      }> = [];
      const collectAll = (
        items: unknown[],
        parentTaskId: string | null,
        depth: number,
        location: { productId: string; categoryLabel: string; subProjectLabel: string },
      ) => {
        for (const item of items) {
          if (!isRecord(item) || allTasks.length >= 1000) continue;
          const taskId = cleanText(item.task_id);
          const archived = item.archived === true || cleanText(item.status) === 'archived';
          if (!taskId || archived) continue;
          allTasks.push({
            task_id: taskId,
            title: cleanText(item.title) || '未命名任务',
            description: cleanText(item.description).slice(0, 1200),
            status: cleanText(item.status) || 'draft',
            progress: Math.max(0, Math.min(100, Math.round(Number(item.progress) || 0))),
            priority: cleanText(item.final_priority) || cleanText(item.ai_priority) || 'medium',
            primary_owner: cleanText(item.primary_owner) || '待指派',
            due_date: cleanText(item.due_date),
            category_path: cleanText(item.category_path),
            parent_task_id: parentTaskId,
            tree_depth: depth,
            product_id: location.productId,
            product_name: productNameById.get(location.productId) || location.productId,
            category_label: location.categoryLabel,
            sub_project_label: location.subProjectLabel,
          });
          collectAll(asArray(item.subtasks), taskId, depth + 1, location);
        }
      };
      for (const source of sources) {
        for (const category of source.categories) {
          if (!isRecord(category)) continue;
          for (const child of asArray(category.children).filter(isRecord)) {
            collectAll(asArray(child.tasks), null, 0, {
              productId: source.productId,
              categoryLabel: cleanText(category.label) || '未分类',
              subProjectLabel: cleanText(child.label) || '未分组',
            });
            if (allTasks.length >= 1000) break;
          }
          if (allTasks.length >= 1000) break;
        }
        if (allTasks.length >= 1000) break;
      }
      return {
        product_id: 'all-products',
        category_id: 'all',
        label: '全部线上任务',
        task_count: allTasks.length,
        tasks: allTasks,
      };
    }

    const categories = await this.readTaskCategoriesForProduct(productId);
    const category = categories.find((item) => cleanText(item.id) === categoryId);
    if (!category) throw new BadRequestException('当前项目不存在或已被移除');

    const children = asArray(category.children).filter(isRecord);
    const subProject = subProjectId
      ? children.find((item) => cleanText(item.id) === subProjectId)
      : undefined;
    if (subProjectId && !subProject) throw new BadRequestException('当前子项目不存在或已被移除');

    const tasks: Array<{
      task_id: string;
      title: string;
      description: string;
      status: string;
      progress: number;
      priority: string;
      primary_owner: string;
      due_date: string;
      category_path: string;
      parent_task_id: string | null;
      tree_depth: number;
    }> = [];
    const collect = (items: unknown[], parentTaskId: string | null, depth: number) => {
      for (const item of items) {
        if (!isRecord(item)) continue;
        const taskId = cleanText(item.task_id);
        if (!taskId) continue;
        const archived = item.archived === true || cleanText(item.status) === 'archived';
        if (archived) continue;
        if (tasks.length < 300) {
          tasks.push({
            task_id: taskId,
            title: cleanText(item.title) || '未命名任务',
            description: cleanText(item.description).slice(0, 1200),
            status: cleanText(item.status) || 'draft',
            progress: Math.max(0, Math.min(100, Math.round(Number(item.progress) || 0))),
            priority: cleanText(item.final_priority) || cleanText(item.ai_priority) || 'medium',
            primary_owner: cleanText(item.primary_owner) || '待指派',
            due_date: cleanText(item.due_date),
            category_path: cleanText(item.category_path),
            parent_task_id: parentTaskId,
            tree_depth: depth,
          });
        }
        if (tasks.length < 300) collect(asArray(item.subtasks), taskId, depth + 1);
      }
    };

    if (subProject) {
      collect(asArray(subProject.tasks), null, 0);
    } else {
      for (const child of children) {
        collect(asArray(child.tasks), null, 0);
        if (tasks.length >= 300) break;
      }
    }

    const categoryLabel = cleanText(category.label) || '未命名项目';
    const subProjectLabel = subProject ? cleanText(subProject.label) : '';
    return {
      product_id: productId,
      category_id: categoryId,
      ...(subProjectId ? { sub_project_id: subProjectId } : {}),
      label: subProjectLabel ? `${categoryLabel} / ${subProjectLabel}` : categoryLabel,
      task_count: tasks.length,
      tasks,
    };
  }

  /** 保存指定产品的研发分类树 */
  async saveProductTaskCategoriesForProduct(
    productId: string,
    categories: unknown[],
  ): Promise<{ ok: true; categories: JsonRecord[] }> {
    const submittedRevision = submittedTaskCategoryStructureRevision(categories);
    const normalized = ensurePocBomTaskCategories(categories);
    const result = await this.withTaskTreeLock(async () => {
      const store = await this.readProductCategoryStore();
      // 与 readProductTaskCategorySnapshot 逐字同源：客户端手里的版本号是按注入后的树算的，
      // 这里少一次注入就会把正常提交判成「系统树已更新」。
      const current = ensureDefaultSubProject(
        Array.isArray(store[productId])
          ? ensurePocBomTaskCategories(store[productId] as unknown[])
          : ensurePocBomTaskCategories([]),
      );
      assertTaskCategoryStructureRevision(current, submittedRevision);
      const reconciled = reconcileStructureSaveWithServerTasks(current, normalized);
      if (currentRdWorkspace() === PRODUCTION_WORKSPACE) {
        if (this.productionMirrorFingerprint(current) !== this.productionMirrorFingerprint(reconciled)) {
          throw new ForbiddenException('研发同步任务在生产驾驶舱中为只读，不能修改、移动或删除');
        }
      }
      const withDefaults = ensureDefaultSubProject(reconciled);
      await this.saveProductCategoryStore({ ...store, [productId]: withDefaults });
      return { ok: true as const, categories: decorateTaskCategoriesWithStructureRevision(withDefaults) };
    });
    await this.recomputeDirectorDashboard();
    return result;
  }

  /**
   * 跨产品 / 跨系统移动任务（原子）。
   * 主产品(prod-portable-o2)的任务树存于 rd.taskCategories，其余产品存于 rd.productTaskCategories[productId]，
   * 因此一次移动可能同时改动两个 store（出/入主产品）或仅改动其一。两个 store 的写入用单个
   * prisma.$transaction 批量提交，避免「源已删、目标未写」的中间态。
   *
   * 仅移动顶层任务（与移动对话框一致）；任务的 category_path 第三段（任务类型）保持不变。
   */
  async moveTasks(
    taskIds: unknown,
    target: { productId: unknown; categoryId: unknown; subId: unknown },
    options?: { requesterUserId?: string; requesterName?: string; canMoveAny?: boolean },
  ): Promise<{
    ok: true;
    movedCount: number;
    categories: JsonRecord[];
    targetProductId: string;
    targetCategoryLabel: string;
    targetSubLabel: string;
  }> {
    // 跨库移动同为「读树→改→写回」，纳入任务树写锁
    return this.withTaskTreeLock(() => this.moveTasksUnlocked(taskIds, target, options));
  }

  private async moveTasksUnlocked(
    taskIds: unknown,
    target: { productId: unknown; categoryId: unknown; subId: unknown },
    options?: { requesterUserId?: string; requesterName?: string; canMoveAny?: boolean },
  ): Promise<{
    ok: true;
    movedCount: number;
    categories: JsonRecord[];
    targetProductId: string;
    targetCategoryLabel: string;
    targetSubLabel: string;
  }> {
    const ids = Array.from(
      new Set(asArray(taskIds).map((v) => cleanText(v)).filter(Boolean)),
    );
    if (ids.length === 0) throw new BadRequestException('未提供要移动的任务');

    const targetProductId = cleanText(target?.productId);
    const targetCategoryId = cleanText(target?.categoryId);
    // 子项可以不传：纯一级分类由调用方只给到系统这一层，落到该分类的默认子项。
    // 产品与系统仍然必填——那两个缺了就无从定位目标树。
    const targetSubId = cleanText(target?.subId);
    if (!targetProductId || !targetCategoryId) {
      throw new BadRequestException('移动目标不完整（缺少产品 / 系统）');
    }

    // 校验目标产品存在，避免 typo 的 productId 在 store 里写出脏条目
    const products = await this.getProducts();
    const productExists = products.some((p) => cleanText(p.id) === targetProductId);
    if (!productExists) throw new BadRequestException('目标产品不存在');

    const mainTree = await this.readNormalizedTaskCategories();
    const productStore = await this.readProductCategoryStore();

    // 构建「productId → 规范化后的分类树」工作副本（主产品单列）。
    const productTrees = new Map<string, JsonRecord[]>();
    for (const [pid, raw] of Object.entries(productStore)) {
      if (pid === RD_MAIN_PRODUCT_ID) continue;
      // 与 readProductTaskCategorySnapshot 保持同一套归一化：少补默认子项会让
      // 「移到产品库的纯一级分类」找不到落点。
      productTrees.set(pid, ensureDefaultSubProject(ensurePocBomTaskCategories(asArray(raw))));
    }
    // 目标产品若尚未在 store（首次承接任务），按空 BOM 种入工作副本。
    if (targetProductId !== RD_MAIN_PRODUCT_ID && !productTrees.has(targetProductId)) {
      productTrees.set(targetProductId, ensureDefaultSubProject(ensurePocBomTaskCategories([])));
    }

    const targetTree = targetProductId === RD_MAIN_PRODUCT_ID ? mainTree : productTrees.get(targetProductId)!;
    const targetCategory = targetTree.find(
      (c): c is JsonRecord => isRecord(c) && cleanText(c.id) === targetCategoryId,
    );
    if (!targetCategory) throw new BadRequestException('目标系统不存在');
    const targetChildren = asArray(targetCategory.children).filter(isRecord);
    // 没传子项 → 落到第一个子项。经 ensureDefaultSubProject 后每个分类至少有一个，
    // 纯一级分类拿到的就是那个默认子项。
    const targetChild = targetSubId
      ? targetChildren.find((ch) => cleanText(ch.id) === targetSubId)
      : targetChildren[0];
    if (!targetChild) throw new BadRequestException('目标子项不存在');
    const targetCatLabel = String(targetCategory.label ?? '');
    const targetSubLabel = String(targetChild.label ?? '');

    // 从所有树（主 + 各产品）的顶层任务中摘出待移动任务。
    const idSet = new Set(ids);
    const collected = new Map<string, JsonRecord>();
    let mainDirty = false;
    const dirtyProducts = new Set<string>();

    const removeFromTree = (tree: JsonRecord[]): boolean => {
      let changed = false;
      for (const cat of tree) {
        if (!isRecord(cat)) continue;
        for (const child of asArray(cat.children)) {
          if (!isRecord(child)) continue;
          const tasks = asArray(child.tasks);
          if (tasks.length === 0) continue;
          const kept: unknown[] = [];
          let childChanged = false;
          for (const t of tasks) {
            const tid = isRecord(t) ? cleanText(t.task_id) : '';
            if (tid && idSet.has(tid) && !collected.has(tid)) {
              collected.set(tid, t as JsonRecord);
              childChanged = true;
              changed = true;
            } else {
              kept.push(t);
            }
          }
          if (childChanged) child.tasks = kept;
        }
      }
      return changed;
    };

    if (removeFromTree(mainTree)) mainDirty = true;
    for (const [pid, tree] of productTrees) {
      if (removeFromTree(tree)) dirtyProducts.add(pid);
    }

    if (collected.size === 0) throw new NotFoundException('任务不存在');

    for (const task of collected.values()) this.assertTaskWritable(task);

    // 部分 id 未在任何顶层任务中命中（多为子任务 id 或已不存在的 id）。
    // 旧逻辑会静默丢弃这些 id、只移动命中的部分，导致「提示成功实则少移」的数据静默丢失。
    // 这里改为明确报错。移动选择 UI 仅会传入顶层任务 id，正常流程不会触发；
    // 仅用于防御直连 API / 脏数据。此处尚未写库（仅改了内存工作副本），抛错即安全回滚。
    if (collected.size < ids.length) {
      const missing = ids.filter((id) => !collected.has(id));
      throw new BadRequestException(this.describeUnmovableTasks(missing, productTrees, collected));
    }

    // 个人工作台来的移动请求：非管理员只能移动「自己负责的任务」。与 getWorkspace 的 isPrimary 同口径——
    // 优先按 user_id 匹配，历史上「仅按姓名指派、未绑定用户ID」的任务再按姓名兜底匹配。
    // 管理员（canMoveAny）跳过此校验。此处尚未写库（仅改了内存工作副本），抛错即安全回滚。
    if (!options?.canMoveAny) {
      const requesterUserId = cleanUserId(options?.requesterUserId);
      const requesterNameKey = personNameLookupKey(options?.requesterName);
      const ownsTask = (task: JsonRecord): boolean => {
        const ownerUserId = cleanUserId(task.primary_owner_user_id ?? task.owner_user_id);
        if (ownerUserId) return Boolean(requesterUserId) && ownerUserId === requesterUserId;
        return (
          Boolean(requesterNameKey) &&
          personNameLookupKey(task.primary_owner ?? task.owner) === requesterNameKey
        );
      };
      const hasForeignTask = Array.from(collected.values()).some((task) => !ownsTask(task));
      if (hasForeignTask) {
        throw new ForbiddenException('只能移动自己负责的任务');
      }
    }

    // 写入目标子项（置顶，category_path 改写为目标系统/子项，任务类型段保留）。
    const shaped = Array.from(collected.values()).map((t) =>
      normalizeTaskShape(t, targetCatLabel, targetSubLabel),
    );
    targetChild.tasks = [...shaped, ...asArray(targetChild.tasks)];
    if (targetProductId === RD_MAIN_PRODUCT_ID) mainDirty = true;
    else dirtyProducts.add(targetProductId);

    // 原子提交受影响的 store。
    const writeOps: ReturnType<ResearchDevelopmentService['buildSettingUpsert']>[] = [];
    if (mainDirty) writeOps.push(this.buildSettingUpsert('rd.taskCategories', mainTree));
    if (dirtyProducts.size > 0) {
      const nextStore: Record<string, unknown> = { ...productStore };
      for (const pid of dirtyProducts) nextStore[pid] = productTrees.get(pid) ?? [];
      writeOps.push(this.buildSettingUpsert('rd.productTaskCategories', nextStore));
    }
    if (writeOps.length > 0) {
      await this.prisma.$transaction(writeOps);
      this.invalidateCachedStoreValues([
        ...(mainDirty ? ['rd.taskCategories' as const] : []),
        ...(dirtyProducts.size > 0 ? ['rd.productTaskCategories' as const] : []),
      ]);
    }

    await this.recomputeDirectorDashboard();

    return {
      ok: true,
      movedCount: collected.size,
      categories: await this.getTaskCategories({ skipMirrorRefresh: true }),
      targetProductId,
      targetCategoryLabel: targetCatLabel,
      targetSubLabel,
    };
  }

  private async readProductCategoryStore(): Promise<Record<string, unknown>> {
    const raw = await this.readValue('rd.productTaskCategories');
    return isRecord(raw) ? (raw as Record<string, unknown>) : {};
  }

  private async saveProductCategoryStore(store: Record<string, unknown>) {
    await this.writeValue('rd.productTaskCategories', store);
  }

  // ── 跨 store 任务读写（主库 rd.taskCategories + 各产品库 rd.productTaskCategories[pid]）──

  /** 读取指定产品的规范化分类树（主产品→主库；其余→对应产品库，首访自动 seed 空 BOM）。 */
  private async readTaskCategoriesForProduct(productId: string): Promise<JsonRecord[]> {
    const pid = cleanText(productId);
    if (!pid || pid === RD_MAIN_PRODUCT_ID) return this.readNormalizedTaskCategories();
    // 内部读路径保持纯读，可安全用于锁内变更和锁外分类上下文。
    return this.getProductTaskCategoriesUnlocked(pid);
  }

  /** 写回指定产品的分类树（主产品→主库；其余→对应产品库）。 */
  private async writeTaskCategoriesForProduct(productId: string, categories: unknown[]): Promise<void> {
    const pid = cleanText(productId);
    if (!pid || pid === RD_MAIN_PRODUCT_ID) {
      await this.writeValue('rd.taskCategories', categories);
      return;
    }
    // 调用者均在任务树写锁内；直接合并当前 product store，避免重入公开整树保存方法死锁。
    const store = await this.readProductCategoryStore();
    await this.saveProductCategoryStore({
      ...store,
      [pid]: ensurePocBomTaskCategories(categories),
    });
  }

  /**
   * 跨 store 按 task_id 定位并写回：先在主库尝试 transform，命中即写主库；否则遍历各产品库，
   * 命中即仅写回那个产品库。transform 接收某个 store 的分类树、返回 { categories(改写后), found }，
   * found 通常由调用方在闭包内置位（与各 mutator 现有写法一致）。主库优先 → 主产品行为不变。
   * 用于 updateTask / deleteTask / 附件计数等「按 task_id 定位单个任务」的写操作。
   */
  private async mutateTaskAcrossStores(
    transform: (categories: JsonRecord[]) => { categories: unknown[]; found: boolean },
  ): Promise<{ found: boolean; productId: string | null }> {
    // 任务树写锁：读-改-写整体串行化。否则并发 PATCH（如批量转派对每个任务并发 updateTask）
    // 会各自基于同一份旧树写回、后写覆盖先写，批量操作只有最后一条生效（lost update）。
    return this.withTaskTreeLock(async () => {
      const mainCats = await this.readNormalizedTaskCategories();
      const mainResult = transform(mainCats);
      if (mainResult.found) {
        await this.writeValue('rd.taskCategories', mainResult.categories);
        return { found: true, productId: RD_MAIN_PRODUCT_ID };
      }
      const store = await this.readProductCategoryStore();
      for (const [pid, raw] of Object.entries(store)) {
        if (pid === RD_MAIN_PRODUCT_ID) continue;
        const cats = ensurePocBomTaskCategories(asArray(raw));
        const result = transform(cats);
        if (result.found) {
          await this.saveProductCategoryStore({ ...store, [pid]: result.categories });
          return { found: true, productId: pid };
        }
      }
      return { found: false, productId: null };
    });
  }

  /**
   * 任务树写锁（与 withProgressNoteLock 同模式）：所有「读树→改→写回」的路径必须整体串行，
   * 否则并发写互相覆盖。仅进程内串行（与现有单实例假设一致）。
   * ⚠️ 不可重入：锁内回调禁止再调用任何加锁方法（mutateTaskAcrossStores / mutateAllStores /
   * createTask / moveTasks），否则 promise 链自等待死锁。
   */
  private taskTreeWriteLock: Promise<unknown> = Promise.resolve();
  private withTaskTreeLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.taskTreeWriteLock.then(fn, fn);
    this.taskTreeWriteLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * 跨所有产品库的分类树合集（主库 + 各产品库简单拼接）。仅用于「全部/我的」这类把任务展平来用的
   * 聚合视图（我的工作台、AI 评分按 task_id 定位、参与者收集等）。任务 task_id 全局唯一，展平后不重复。
   * 注意：同一 BOM 一级系统 id 会在不同产品下重复出现，故不可用于「按系统 id 分组」——
   * 那类场景见 recomputeDirectorDashboard 的按 id 合并。
   */
  private async readMergedTaskCategories(): Promise<JsonRecord[]> {
    const [mainCats, store] = await Promise.all([
      this.readNormalizedTaskCategories(),
      this.readProductCategoryStore(),
    ]);
    const merged: JsonRecord[] = [...mainCats.filter(isRecord)];
    for (const [pid, raw] of Object.entries(store)) {
      if (pid === RD_MAIN_PRODUCT_ID) continue;
      merged.push(...ensurePocBomTaskCategories(asArray(raw)).filter(isRecord));
    }
    return merged;
  }

  /**
   * 跨所有产品库按 task_id 定位单个任务（含子任务），找不到返回 null。
   * 用于写操作（如进度留痕）前的归属/越权校验——此时还没有任务对象在手，需先查出来。
   */
  private async findTaskAcrossStores(taskId: string): Promise<JsonRecord | null> {
    const id = (taskId ?? '').trim();
    if (!id) return null;
    const categories = await this.readMergedTaskCategories();
    let found: JsonRecord | null = null;
    const walk = (tasks: unknown[]): void => {
      for (const t of tasks) {
        if (!isRecord(t)) continue;
        if (t.task_id === id) {
          found = t;
          return;
        }
        if (Array.isArray(t.subtasks)) {
          walk(t.subtasks);
          if (found) return;
        }
      }
    };
    for (const cat of categories) {
      if (!isRecord(cat)) continue;
      for (const child of asArray(cat.children).filter(isRecord)) {
        walk(asArray(child.tasks));
        if (found) break;
      }
      if (found) break;
    }
    return found;
  }

  /**
   * 采购模块发起转采购前的任务级授权与主数据校验。
   * 普通研发成员即使能查看全量驾驶舱，也只能转自己主责/协作的任务；研发管理员可处理任意任务。
   * 同时返回服务端任务标题，避免客户端伪造任务名称写入采购记录和审核通知。
   */
  async requireProcurementTransferAccess(
    taskId: string,
    viewer: { userId: string; userName: string; permissions: string[] },
  ): Promise<{ taskId: string; title: string; participantUserIds: string[]; participantNames: string[] }> {
    const id = cleanText(taskId);
    if (!id) throw new BadRequestException('研发任务编号不能为空');
    const task = await this.findTaskAcrossStores(id);
    if (!task) throw new NotFoundException('研发任务不存在');
    if (task.archived === true) throw new BadRequestException('已归档的研发任务不能转采购');
    const canAccessAny = viewer.permissions.includes('*')
      || RD_ANY_TASK_TRANSFER_PERMISSIONS.some((permission) => viewer.permissions.includes(permission));
    if (!canAccessAny && !isTaskParticipant(task, viewer.userId, viewer.userName)) {
      throw new ForbiddenException('只能将自己主责或协作的研发任务转采购');
    }
    const participants = [
      {
        userId: cleanUserId(task.primary_owner_user_id ?? task.owner_user_id),
        name: cleanText(task.primary_owner ?? task.owner),
      },
      ...asArray(task.collaborators).filter(isRecord).map((collaborator) => ({
        userId: cleanUserId(collaborator.user_id),
        name: cleanText(collaborator.name),
      })),
    ];
    return {
      taskId: id,
      title: cleanText(task.title) || id,
      participantUserIds: Array.from(new Set(participants.map((person) => person.userId).filter(Boolean))),
      participantNames: Array.from(new Set(participants.map((person) => person.name).filter(Boolean))),
    };
  }

  /**
   * 对「所有 store」(主库 + 各产品库) 各自套用同一 transform 并按需写回（每库独立判断 changed）。
   * 用于「人员改名/删除需波及其名下全部产品任务」这类按人批量改写。与 mutateTaskAcrossStores
   * （按单个 task_id 命中即停）不同，这里要遍历并改写命中到的每一个库。
   */
  private async mutateAllStores(
    transform: (categories: JsonRecord[]) => { categories: unknown[]; changed: boolean },
  ): Promise<void> {
    // 与 mutateTaskAcrossStores 共用任务树写锁，防并发读改写互相覆盖
    return this.withTaskTreeLock(async () => {
      const ops: Array<Promise<unknown>> = [];
      const mainCats = await this.readNormalizedTaskCategories();
      const mainResult = transform(mainCats);
      if (mainResult.changed) {
        ops.push(this.writeValue('rd.taskCategories', mainResult.categories));
      }
      const store = await this.readProductCategoryStore();
      const nextStore: Record<string, unknown> = { ...store };
      let storeChanged = false;
      for (const [pid, raw] of Object.entries(store)) {
        if (pid === RD_MAIN_PRODUCT_ID) continue;
        const cats = ensurePocBomTaskCategories(asArray(raw));
        const result = transform(cats);
        if (result.changed) {
          nextStore[pid] = result.categories;
          storeChanged = true;
        }
      }
      if (storeChanged) ops.push(this.saveProductCategoryStore(nextStore));
      await Promise.all(ops);
    });
  }

  private buildDefaultProducts(): JsonRecord[] {
    const now = new Date().toISOString();
    return [
      {
        id: 'prod-portable-o2',
        name: '便携式制氧机',
        description: '便携式家用制氧机，适用于医疗保健场景',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'prod-5l-dc-o2',
        name: '5L直流式制氧机',
        description: '5L大流量直流式医用制氧机',
        status: 'developing',
        createdAt: now,
        updatedAt: now,
      },
    ];
  }

  // ── 子任务树：直建 / 把已有任务树挂为子任务 / 取消子任务关系 ────────────────
  //
  // 数据形态沿用既有的 task.subtasks 递归数组（无需迁移）；新增标记字段：
  // - parent_task_id：父任务 id（顶层任务为 null）
  // - subtask_origin：'created'（在父任务下直建）| 'attached'（把已有任务挂进来）
  // - subtask_attached_at / _by / _by_id：挂载留痕（仅 attached）
  //
  // ⚠️ 父子关系的判定一律走「结构位置」（是否位于某任务的 subtasks 数组内），
  // 不依赖 parent_task_id 标记：存量数据里已存在带 subtasks 的任务，其子任务没有该字段。

  /**
   * 读入「主库 + 各产品库」的分类树工作副本（productId → 树），并连带返回产品库原始 store。
   * 调用方须已持有任务树写锁。单库改动用 writeTaskCategoriesForProduct；
   * 跨库改动必须用 commitTaskTrees（原始 store 用于保留未改动的其他产品条目）。
   */
  private async readAllTaskTrees(): Promise<{
    trees: Map<string, JsonRecord[]>;
    store: Record<string, unknown>;
  }> {
    const trees = new Map<string, JsonRecord[]>();
    trees.set(RD_MAIN_PRODUCT_ID, await this.readNormalizedTaskCategories());
    const store = await this.readProductCategoryStore();
    for (const [pid, raw] of Object.entries(store)) {
      if (pid === RD_MAIN_PRODUCT_ID) continue;
      trees.set(pid, ensurePocBomTaskCategories(asArray(raw)));
    }
    return { trees, store };
  }

  /**
   * 原子写回受影响的 store（与 moveTasksUnlocked 同一模型）：主库与产品库各构造一个
   * upsert，用单个 $transaction 提交。跨库操作必须走这里，否则会出现
   * 「源库已摘出、目标库未写入」的中间态——任务凭空消失。
   * originalStore 用于保留未改动的其他产品条目（产品库是一个整体 JSON，不能只写一个 key）。
   */
  private async commitTaskTrees(
    dirty: Map<string, JsonRecord[]>,
    originalStore: Record<string, unknown>,
  ): Promise<void> {
    const writeOps: ReturnType<ResearchDevelopmentService['buildSettingUpsert']>[] = [];
    const mainTree = dirty.get(RD_MAIN_PRODUCT_ID);
    if (mainTree) writeOps.push(this.buildSettingUpsert('rd.taskCategories', mainTree));
    const productPids = [...dirty.keys()].filter((pid) => pid !== RD_MAIN_PRODUCT_ID);
    if (productPids.length > 0) {
      const nextStore: Record<string, unknown> = { ...originalStore };
      for (const pid of productPids) nextStore[pid] = dirty.get(pid) ?? [];
      writeOps.push(this.buildSettingUpsert('rd.productTaskCategories', nextStore));
    }
    if (writeOps.length > 0) {
      await this.prisma.$transaction(writeOps);
      this.invalidateCachedStoreValues([
        ...(mainTree ? ['rd.taskCategories' as const] : []),
        ...(productPids.length > 0 ? ['rd.productTaskCategories' as const] : []),
      ]);
    }
  }

  /**
   * 把「没能移动的 id」翻译成人看得懂的原因。
   *
   * 旧文案是「可能是子任务或已不存在」——两种处境完全不同却混在一句里：
   * 前者要去父任务里摘出，后者要重新生成确认卡，用户无从判断该做哪个。
   * 而 Agent 的查询工具是递归进 subtasks 的，它会说「任务都存在」，
   * 与这里只认顶层的判定直接冲突，用户看到的就是自相矛盾的两句话。
   *
   * ⚠️ 必须同时扫 collected：调用方若同时选了父任务和它的子任务，
   * 父任务已被 removeFromTree 摘走，子任务在剩下的树里也就找不到了。
   */
  private describeUnmovableTasks(
    missingIds: string[],
    trees: Map<string, JsonRecord[]>,
    collected: Map<string, JsonRecord>,
  ): string {
    const parentOf = new Map<string, JsonRecord>();
    const walk = (tasks: unknown[], parent: JsonRecord | null): void => {
      for (const t of tasks) {
        if (!isRecord(t)) continue;
        const tid = cleanText(t.task_id);
        if (tid && parent) parentOf.set(tid, parent);
        walk(asArray(t.subtasks), t);
      }
    };
    for (const categories of trees.values()) {
      for (const cat of categories) {
        if (!isRecord(cat)) continue;
        for (const child of asArray(cat.children).filter(isRecord)) walk(asArray(child.tasks), null);
      }
    }
    for (const task of collected.values()) walk(asArray(task.subtasks), task);

    const nested: string[] = [];
    const absent: string[] = [];
    for (const id of missingIds) {
      const parent = parentOf.get(id);
      if (parent) {
        const title = cleanText(parent.title) || cleanText(parent.task_id) || '未命名任务';
        nested.push(`${id}（已并入「${title}」）`);
      } else {
        absent.push(id);
      }
    }

    const parts: string[] = [];
    if (nested.length > 0) {
      parts.push(
        `以下任务已经是子任务，不能直接移动归类：${nested.join('、')}。请先在任务详情里从父任务摘出，再重新移动。`,
      );
    }
    if (absent.length > 0) {
      parts.push(
        `以下任务不存在，可能已被删除或合并：${absent.join('、')}。若这是 AI 生成的确认卡，请重新生成后再执行。`,
      );
    }
    return parts.join('\n');
  }

  /** 在工作副本里按 task_id 定位任务及其结构位置（含所属库/分类/子项目/结构父任务）。 */
  private locateTaskInTrees(trees: Map<string, JsonRecord[]>, taskId: string): TaskSlot | null {
    const id = cleanText(taskId);
    if (!id) return null;
    for (const [productId, categories] of trees) {
      for (const cat of categories) {
        if (!isRecord(cat)) continue;
        for (const child of asArray(cat.children).filter(isRecord)) {
          const walk = (tasks: unknown[], parentTaskId: string | null, depth: number): TaskSlot | null => {
            for (const t of tasks) {
              if (!isRecord(t)) continue;
              if (cleanText(t.task_id) === id) {
                return {
                  productId,
                  categoryId: cleanText(cat.id),
                  categoryLabel: String(cat.label ?? ''),
                  subProjectId: cleanText(child.id),
                  subProjectLabel: String(child.label ?? ''),
                  parentTaskId,
                  depth,
                  task: t,
                };
              }
              const hit = walk(asArray(t.subtasks), cleanText(t.task_id), depth + 1);
              if (hit) return hit;
            }
            return null;
          };
          const found = walk(asArray(child.tasks), null, 1);
          if (found) return found;
        }
      }
    }
    return null;
  }

  /** 子任务的 category_path 跟随父任务所在分类，任务类型段（第三段）保留自身。 */
  private subtaskCategoryPath(task: JsonRecord, parent: TaskSlot): string {
    const taskType = splitCategoryPath(task.category_path)[2] || DEFAULT_BOM_TASK_TYPE;
    return `${parent.categoryLabel} / ${parent.subProjectLabel} / ${taskType}`;
  }

  /**
   * 把已有的顶层任务树挂到任意层级目标下。来源仍须是顶层独立任务；目标可为中间节点。
   * 整批操作在一次任务树锁和一次提交中完成，全成功或全失败。
   */
  async attachTasksAsSubtasks(
    taskIds: string[],
    parentTaskId: string,
    actor?: { userId?: string; userName?: string; canEditAny?: boolean },
  ) {
    return this.withTaskTreeLock(() =>
      this.attachTasksAsSubtasksUnlocked(taskIds, parentTaskId, actor ?? {}),
    );
  }

  async attachTaskAsSubtask(
    taskId: string,
    parentTaskId: string,
    actor?: { userId?: string; userName?: string; canEditAny?: boolean },
  ) {
    return this.withTaskTreeLock(() => this.attachTaskAsSubtaskUnlocked(taskId, parentTaskId, actor ?? {}));
  }

  private async attachTaskAsSubtaskUnlocked(
    taskId: string,
    parentTaskId: string,
    actor: { userId?: string; userName?: string; canEditAny?: boolean },
  ) {
    const childId = cleanText(taskId);
    const result = await this.attachTasksAsSubtasksUnlocked([childId], parentTaskId, actor);
    return { ok: true as const, task_id: childId, parent_task_id: result.parent_task_id };
  }

  private async attachTasksAsSubtasksUnlocked(
    taskIds: unknown,
    parentTaskId: string,
    actor: { userId?: string; userName?: string; canEditAny?: boolean },
  ) {
    const childIds = normalizeTaskRelationIds(taskIds);
    const parentId = cleanText(parentTaskId);
    if (childIds.length === 0 || !parentId) throw new BadRequestException('缺少任务或父任务 id');
    if (childIds.length > RD_TASK_RELATION_BATCH_LIMIT) {
      throw new BadRequestException(`单次最多并入 ${RD_TASK_RELATION_BATCH_LIMIT} 个任务`);
    }
    if (childIds.includes(parentId)) throw new BadRequestException('不能把任务挂到自己下面');

    const { trees, store } = await this.readAllTaskTrees();
    const parentSlot = this.locateTaskInTrees(trees, parentId);
    if (!parentSlot) throw new NotFoundException('父任务不存在');
    this.assertTaskWritable(parentSlot.task);

    const childSlots = childIds.map((childId) => {
      const slot = this.locateTaskInTrees(trees, childId);
      if (!slot) throw new NotFoundException(`任务不存在：${childId}`);
      this.assertTaskWritable(slot.task);
      return slot;
    });

    if (!actor.canEditAny) {
      if (!isTaskParticipant(parentSlot.task, actor.userId, actor.userName)) {
        throw new ForbiddenException('只能并入自己负责的任务');
      }
      for (const slot of childSlots) {
        if (!isTaskParticipant(slot.task, actor.userId, actor.userName)) {
          throw new ForbiddenException(`只能操作自己负责的任务：${cleanText(slot.task.task_id)}`);
        }
      }
    }

    for (const slot of childSlots) {
      const childId = cleanText(slot.task.task_id);
      if (slot.parentTaskId) {
        throw new BadRequestException(`任务已经是子任务，不能重复挂载：${childId}`);
      }
      if (taskTreeContainsId(slot.task, parentId)) {
        throw new BadRequestException(`不能把上级任务并入自己的下级任务：${childId}`);
      }
      const resultDepth = parentSlot.depth + taskTreeHeight(slot.task);
      if (resultDepth > RD_TASK_TREE_MAX_DEPTH) {
        throw new BadRequestException(
          `任务 ${childId} 并入后将达到 ${resultDepth} 层，最多支持 ${RD_TASK_TREE_MAX_DEPTH} 层`,
        );
      }
    }

    const nowIso = new Date().toISOString();
    const rehomeTaskTree = (node: JsonRecord, structuralParentId: string, root: boolean): JsonRecord => {
      const nodeId = cleanText(node.task_id);
      return {
        ...node,
        parent_task_id: structuralParentId,
        ...(root
          ? {
              subtask_origin: 'attached',
              subtask_attached_at: nowIso,
              subtask_attached_by: cleanText(actor.userName) || '研发管理员',
              subtask_attached_by_id: cleanUserId(actor.userId) || null,
              updated_at: nowIso,
            }
          : {}),
        category_path: this.subtaskCategoryPath(node, parentSlot),
        subtasks: asArray(node.subtasks)
          .filter(isRecord)
          .map((subtask) => rehomeTaskTree(subtask, nodeId, false)),
      };
    };
    const attachedTasks = childSlots.map((slot) => rehomeTaskTree(slot.task, parentId, true));

    const sourceIds = new Set(childIds);
    const sourceProductIds = new Set(childSlots.map((slot) => slot.productId));
    const workingTrees = new Map(trees);
    for (const productId of sourceProductIds) {
      let removedCount = 0;
      const rebuilt = (workingTrees.get(productId) ?? []).map((cat) => {
        if (!isRecord(cat)) return cat;
        return {
          ...cat,
          children: asArray(cat.children).map((child) => {
            if (!isRecord(child)) return child;
            return {
              ...child,
              tasks: asArray(child.tasks).filter((candidate) => {
                if (!isRecord(candidate) || !sourceIds.has(cleanText(candidate.task_id))) return true;
                removedCount += 1;
                return false;
              }),
            };
          }),
        };
      });
      const expectedCount = childSlots.filter((slot) => slot.productId === productId).length;
      if (removedCount !== expectedCount) {
        throw new BadRequestException('批量并入失败：部分来源任务定位失败');
      }
      workingTrees.set(productId, rebuilt as JsonRecord[]);
    }

    let inserted = false;
    const targetBase = workingTrees.get(parentSlot.productId) ?? [];
    const targetRebuilt = targetBase.map((cat) => {
      if (inserted || !isRecord(cat)) return cat;
      return {
        ...cat,
        children: asArray(cat.children).map((child) => {
          if (inserted || !isRecord(child)) return child;
          const result = appendTaskChildren(asArray(child.tasks), parentId, attachedTasks, nowIso);
          if (!result.inserted) return child;
          inserted = true;
          return { ...child, tasks: result.tasks };
        }),
      };
    });
    if (!inserted) throw new BadRequestException('批量并入失败：父任务定位失败');

    const dirty = new Map<string, JsonRecord[]>();
    for (const productId of sourceProductIds) {
      dirty.set(productId, workingTrees.get(productId) ?? []);
    }
    dirty.set(parentSlot.productId, targetRebuilt as JsonRecord[]);
    await this.commitTaskTrees(dirty, store);

    await this.recomputeDirectorDashboard();
    for (const childId of childIds) void this.syncTaskToRag(childId);
    return { ok: true as const, task_ids: childIds, parent_task_id: parentId };
  }

  /** 批量解除同一父任务下的直接子任务关系；每棵选中子树整体提升为顶层任务。 */
  async detachSubtasks(
    taskIds: string[],
    parentTaskId: string | undefined,
    actor?: { userId?: string; userName?: string; canEditAny?: boolean },
  ) {
    return this.withTaskTreeLock(() =>
      this.detachSubtasksUnlocked(taskIds, parentTaskId, actor ?? {}),
    );
  }

  /** 取消子任务关系：把子任务提升为顶层任务，落在原父任务所在子项目里（与父任务同级）。 */
  async detachSubtask(taskId: string, actor?: { userId?: string; userName?: string; canEditAny?: boolean }) {
    return this.withTaskTreeLock(() => this.detachSubtaskUnlocked(taskId, actor ?? {}));
  }

  private async detachSubtaskUnlocked(
    taskId: string,
    actor: { userId?: string; userName?: string; canEditAny?: boolean },
  ) {
    const childId = cleanText(taskId);
    const result = await this.detachSubtasksUnlocked([childId], undefined, actor);
    return { ok: true as const, task_id: result.task_ids[0] };
  }

  private async detachSubtasksUnlocked(
    taskIds: unknown,
    expectedParentTaskId: string | undefined,
    actor: { userId?: string; userName?: string; canEditAny?: boolean },
  ) {
    const childIds = normalizeTaskRelationIds(taskIds);
    if (childIds.length === 0) throw new BadRequestException('缺少任务 id');
    if (childIds.length > RD_TASK_RELATION_BATCH_LIMIT) {
      throw new BadRequestException(`单次最多取消 ${RD_TASK_RELATION_BATCH_LIMIT} 个子任务关系`);
    }

    const { trees } = await this.readAllTaskTrees();
    const slots = childIds.map((childId) => {
      const slot = this.locateTaskInTrees(trees, childId);
      if (!slot) throw new NotFoundException(`任务不存在：${childId}`);
      this.assertTaskWritable(slot.task);
      if (!slot.parentTaskId) throw new BadRequestException(`任务不是子任务：${childId}`);
      return slot;
    });

    const parentIds = new Set(slots.map((slot) => slot.parentTaskId));
    if (parentIds.size !== 1) throw new BadRequestException('批量取消仅支持同一父任务下的直接子任务');
    const parentId = slots[0].parentTaskId!;
    const expectedParentId = cleanText(expectedParentTaskId);
    if (expectedParentId && expectedParentId !== parentId) {
      throw new BadRequestException('所选任务不属于指定父任务');
    }
    const productIds = new Set(slots.map((slot) => slot.productId));
    if (productIds.size !== 1) throw new BadRequestException('所选任务不在同一产品库');

    if (!actor.canEditAny) {
      for (const slot of slots) {
        if (!isTaskParticipant(slot.task, actor.userId, actor.userName)) {
          throw new ForbiddenException(`只能操作自己负责的任务：${cleanText(slot.task.task_id)}`);
        }
      }
    }

    const parentSlot = this.locateTaskInTrees(trees, parentId);
    if (!parentSlot) throw new NotFoundException('父任务不存在');
    const selectedIds = new Set(childIds);
    const directChildren = asArray(parentSlot.task.subtasks).filter(isRecord);
    const selectedDirectChildren = directChildren.filter((child) => selectedIds.has(cleanText(child.task_id)));
    if (selectedDirectChildren.length !== childIds.length) {
      throw new BadRequestException('批量取消仅支持所选父任务的直接子任务');
    }

    const nowIso = new Date().toISOString();
    const detached = selectedDirectChildren.map((task): JsonRecord => ({
      ...task,
      parent_task_id: null,
      subtask_origin: null,
      subtask_attached_at: null,
      subtask_attached_by: null,
      subtask_attached_by_id: null,
      updated_at: nowIso,
    }));

    const removeFromParent = (tasks: unknown[]): { tasks: unknown[]; removedCount: number } => {
      let removedCount = 0;
      const nextTasks = tasks.map((task) => {
        if (!isRecord(task)) return task;
        if (cleanText(task.task_id) === parentId) {
          const subtasks = asArray(task.subtasks);
          const nextSubtasks = subtasks.filter((subtask) => {
            const remove = isRecord(subtask) && selectedIds.has(cleanText(subtask.task_id));
            if (remove) removedCount += 1;
            return !remove;
          });
          return { ...task, subtasks: nextSubtasks, updated_at: nowIso };
        }
        const nested = removeFromParent(asArray(task.subtasks));
        if (nested.removedCount === 0) return task;
        removedCount += nested.removedCount;
        return { ...task, subtasks: nested.tasks };
      });
      return { tasks: nextTasks, removedCount };
    };

    let removedCount = 0;
    const categories = trees.get(slots[0].productId) ?? [];
    const rebuilt = categories.map((cat) => {
      if (!isRecord(cat)) return cat;
      return {
        ...cat,
        children: asArray(cat.children).map((child) => {
          if (!isRecord(child)) return child;
          if (cleanText(cat.id) !== parentSlot.categoryId || cleanText(child.id) !== parentSlot.subProjectId) {
            return child;
          }
          const result = removeFromParent(asArray(child.tasks));
          removedCount += result.removedCount;
          return {
            ...child,
            tasks: result.removedCount > 0 ? [...detached, ...result.tasks] : result.tasks,
          };
        }),
      };
    });
    if (removedCount !== childIds.length) {
      throw new BadRequestException('批量取消失败：部分子任务定位失败');
    }

    await this.writeTaskCategoriesForProduct(slots[0].productId, rebuilt);
    await this.recomputeDirectorDashboard();
    for (const childId of childIds) void this.syncTaskToRag(childId);
    return { ok: true as const, task_ids: childIds, parent_task_id: parentId };
  }

  private applyTaskCreatePolicy(payload: JsonRecord, actor?: TaskCreateActor): JsonRecord {
    if (!actor?.proposalOnly) return payload;
    if (
      cleanText(payload.status) !== 'pending_review'
      || cleanText(payload.pending_review_type) !== 'proposal'
    ) {
      throw new ForbiddenException('立项申请只能创建待审核任务');
    }
    if (!cleanUserId(actor.requesterUserId) && !cleanText(actor.requesterName)) {
      throw new ForbiddenException('无法确认立项申请人身份');
    }
    return {
      ...payload,
      status: 'pending_review',
      pending_review_type: 'proposal',
      primary_owner: cleanText(actor.requesterName) || cleanText(payload.primary_owner),
      primary_owner_user_id: cleanUserId(actor.requesterUserId) || null,
    };
  }

  async createTask(payload: JsonRecord, actor?: TaskCreateActor) {
    // 建任务同为「读树→插入→写回」，纳入任务树写锁防并发互相覆盖
    return this.withTaskTreeLock(() => this.createTaskUnlocked(payload, actor));
  }

  private async createTaskUnlocked(payload: JsonRecord, actor?: TaskCreateActor) {
    const createPayload = this.applyTaskCreatePolicy(payload, actor);

    // 带 parent_task_id → 走子任务直建分支（分类继承父任务，不要求传 category_id）
    const parentTaskId = cleanText(createPayload.parent_task_id);
    if (parentTaskId) return this.createSubtaskUnlocked(createPayload, parentTaskId, actor);

    const productId = cleanText(createPayload.product_id) || RD_MAIN_PRODUCT_ID;
    const [categories, identity] = await Promise.all([
      this.readTaskCategoriesForProduct(productId),
      this.getIdentityContext(),
    ]);
    const {
      category_id,
      sub_project_id,
      product_id: _productId,
      parent_task_id: _parentTaskId,
      task_id: _requestedTaskId,
      id: _requestedInternalId,
      created_at: _requestedCreatedAt,
      updated_at: _requestedUpdatedAt,
      creation_request_id: _creationRequestId,
      creation_request_scope: _creationRequestScope,
      creation_request_hash: _creationRequestHash,
      creation_request_index: _creationRequestIndex,
      ...taskData
    } = createPayload;
    void _productId;
    void _parentTaskId;
    void _requestedTaskId;
    void _requestedInternalId;
    void _requestedCreatedAt;
    void _requestedUpdatedAt;
    void _creationRequestId;
    void _creationRequestScope;
    void _creationRequestHash;
    void _creationRequestIndex;
    const categoryId = typeof category_id === 'string' ? category_id.trim() : '';
    const requestedSubProjectId = typeof sub_project_id === 'string' ? sub_project_id.trim() : '';

    if (!categoryId) {
      throw new BadRequestException('请选择任务所属分类');
    }

    const newTask = this.normalizeTaskIdentity(
      withGeneratedId('rd-task', {
        ...taskData,
        task_id: generateTaskId(),
        status: taskData.status ?? 'draft',
        progress: typeof taskData.progress === 'number' ? taskData.progress : 0,
        ai_priority: taskData.ai_priority ?? taskData.final_priority ?? 'medium',
        final_priority: taskData.final_priority ?? taskData.ai_priority ?? 'medium',
        archived: false,
        attachments: 0,
        // 兜底：去重 + 排除主责人 + 排除"待指派"
        collaborators: normalizeCollaboratorList(taskData.collaborators, {
          name: typeof taskData.primary_owner === 'string' ? taskData.primary_owner : null,
          user_id:
            typeof taskData.primary_owner_user_id === 'string'
              ? taskData.primary_owner_user_id
              : null,
        }),
        subtasks: [],
        // 立项时间：任务创建即写死，后续更新不再变（个人工作台按此排序）。
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }),
      identity.people,
      identity.users,
    );

    // 直建即阻塞的任务也要打阻塞起点，否则「已阻塞 N 天」对其永远不显示（与 updateTask 的状态钩子对齐）
    if (newTask.status === 'paused_blocked' && !cleanText(newTask.blocked_since)) {
      (newTask as JsonRecord).blocked_since = new Date().toISOString();
    }

    const fallbackCategory = categories.find((cat) => isRecord(cat) && cat.id === categoryId);
    if (!fallbackCategory || !isRecord(fallbackCategory)) {
      throw new NotFoundException('指定的分类不存在');
    }
    const fallbackChildren = asArray(fallbackCategory.children).filter(isRecord);
    const fallbackSubProject = requestedSubProjectId
      ? fallbackChildren.find((child) => child.id === requestedSubProjectId)
      : fallbackChildren[0];
    const target = resolveCategoryTarget(
      categories.filter(isRecord),
      taskData.category_path,
      categoryId,
      String(fallbackSubProject?.id ?? ''),
    );

    let inserted = false;
    let categoryFound = false;
    const updated = categories.map((cat) => {
      if (!isRecord(cat)) return cat;
      if (cat.id !== target.categoryId) return cat;
      categoryFound = true;
      const children = asArray(cat.children);
      const targetSubProjectId = target.subProjectId || String(children.find(isRecord)?.id ?? '');
      if (!targetSubProjectId) return cat;
      return {
        ...cat,
        children: children.map((child) => {
          if (!isRecord(child)) return child;
          if (child.id !== targetSubProjectId) return child;
          inserted = true;
          return { ...child, tasks: [newTask, ...asArray(child.tasks)] };
        }),
      };
    });

    if (!categoryFound) throw new NotFoundException('指定的分类不存在');
    if (!inserted) throw new NotFoundException('指定的子项目不存在');
    await this.writeTaskCategoriesForProduct(productId, updated);
    await this.recomputeDirectorDashboard();
    // 成员立项提交（status=pending_review）时，自动通知具备审核权限的管理员，
    // 触发管理员个人工作台通知中心的待审核卡片。直接派单（status=in_progress/draft）不触发。
    if (newTask.status === 'pending_review') {
      void this.notifyAdminsOfPendingReview(newTask, {});
    }
    await this.recordServerAudit({
      action: 'task.created',
      resource: { type: 'task', id: String(newTask.task_id ?? ''), name: cleanText(newTask.title) },
      actor: { id: actor?.requesterUserId, name: actor?.requesterName },
      comment: newTask.status === 'pending_review' ? '提交立项申请' : '新建任务',
      metadata: {
        status: cleanText(newTask.status),
        primary_owner: cleanText(newTask.primary_owner),
        category_path: cleanText(newTask.category_path),
      },
    });
    // 任务入向量索引（fire-and-forget）：AI 问答可按语义检索到任务
    void this.syncTaskToRag(String(newTask.task_id ?? ''));
    return newTask;
  }

  async createSubtasks(
    parentTaskId: string,
    payloads: JsonRecord[],
    requestId: string,
    actor?: TaskCreateActor,
  ) {
    if (!cleanText(requestId)) throw new BadRequestException('缺少批量创建请求标识');
    const createPayloads = payloads.map((payload) => this.applyTaskCreatePolicy(payload, actor));
    return this.withTaskTreeLock(() =>
      this.createSubtasksUnlocked(createPayloads, parentTaskId, requestId, actor),
    );
  }

  /**
   * 在指定父任务下直建子任务。分类（库/系统/子项目/category_path）一律继承父任务，
   * 因此不要求调用方传 product_id / category_id —— 父任务在哪，子任务就在哪。
   */
  private async createSubtaskUnlocked(payload: JsonRecord, parentTaskId: string, actor?: TaskCreateActor) {
    const created = await this.createSubtasksUnlocked([payload], parentTaskId, '', actor);
    return created[0];
  }

  private async createSubtasksUnlocked(
    payloads: JsonRecord[],
    parentTaskId: string,
    requestId: string,
    actor?: TaskCreateActor,
  ) {
    if (payloads.length === 0) throw new BadRequestException('请至少提交一个子任务');
    if (payloads.length > RD_TASK_RELATION_BATCH_LIMIT) {
      throw new BadRequestException(`单次最多创建 ${RD_TASK_RELATION_BATCH_LIMIT} 个子任务`);
    }
    if (payloads.some((payload) => !cleanText(payload.title))) {
      throw new BadRequestException('子任务标题不能为空');
    }
    const normalizedRequestId = cleanText(requestId);
    if (normalizedRequestId.length > 128) throw new BadRequestException('批量创建请求标识过长');
    const requestHash = normalizedRequestId
      ? createHash('sha256').update(JSON.stringify(payloads)).digest('hex')
      : '';

    // 新子任务直接建在父任务所在库 → 单库写回即可
    const { trees } = await this.readAllTaskTrees();
    const parentSlot = this.locateTaskInTrees(trees, parentTaskId);
    if (!parentSlot) throw new NotFoundException('父任务不存在');
    this.assertTaskWritable(parentSlot.task);
    if (
      actor
      && !actor.canEditAny
      && !isTaskParticipant(parentSlot.task, actor.requesterUserId, actor.requesterName)
    ) {
      throw new ForbiddenException('只能在自己负责或协作的任务下立项');
    }
    if (parentSlot.depth >= RD_TASK_TREE_MAX_DEPTH) {
      throw new BadRequestException(`任务最多支持 ${RD_TASK_TREE_MAX_DEPTH} 层，当前任务不能再新建下级`);
    }

    const requestScope = normalizedRequestId
      ? createHash('sha256').update([
          currentRdWorkspace(),
          cleanUserId(actor?.requesterUserId) || cleanText(actor?.requesterName) || 'system',
          cleanText(parentSlot.task.task_id),
          normalizedRequestId,
        ].join('\u0000')).digest('hex')
      : '';

    if (normalizedRequestId) {
      const existing = [...trees.values()]
        .flatMap((categories) => this.collectAllCategoryTasks(categories))
        .filter((task) => cleanText(task.creation_request_scope) === requestScope)
        .sort((left, right) => Number(left.creation_request_index) - Number(right.creation_request_index));
      if (existing.length > 0) {
        const sameParent = existing.every(
          (task) => cleanText(task.parent_task_id) === cleanText(parentSlot.task.task_id),
        );
        const samePayload = existing.every(
          (task) => cleanText(task.creation_request_hash) === requestHash,
        );
        if (!sameParent || !samePayload || existing.length !== payloads.length) {
          throw new ConflictException('批量创建请求标识已被其它任务使用');
        }
        return existing;
      }
    }

    const identity = await this.getIdentityContext();
    const nowIso = new Date().toISOString();
    const newTasks = payloads.map((payload, index) => {
      const {
        category_id: _categoryId,
        sub_project_id: _subProjectId,
        product_id: _productId,
        parent_task_id: _parentTaskId,
        category_path: _categoryPath,
        task_id: _requestedTaskId,
        id: _requestedInternalId,
        created_at: _requestedCreatedAt,
        updated_at: _requestedUpdatedAt,
        creation_request_id: _creationRequestId,
        creation_request_scope: _creationRequestScope,
        creation_request_hash: _creationRequestHash,
        creation_request_index: _creationRequestIndex,
        ...taskData
      } = payload;
      void _categoryId;
      void _subProjectId;
      void _productId;
      void _parentTaskId;
      void _categoryPath;
      void _requestedTaskId;
      void _requestedInternalId;
      void _requestedCreatedAt;
      void _requestedUpdatedAt;
      void _creationRequestId;
      void _creationRequestScope;
      void _creationRequestHash;
      void _creationRequestIndex;

      const newTask = this.normalizeTaskIdentity(
        withGeneratedId('rd-task', {
          ...taskData,
          task_id: generateTaskId(),
          status: taskData.status ?? 'draft',
          progress: typeof taskData.progress === 'number' ? taskData.progress : 0,
          ai_priority: taskData.ai_priority ?? taskData.final_priority ?? 'medium',
          final_priority: taskData.final_priority ?? taskData.ai_priority ?? 'medium',
          archived: false,
          attachments: 0,
          collaborators: normalizeCollaboratorList(taskData.collaborators, {
            name: typeof taskData.primary_owner === 'string' ? taskData.primary_owner : null,
            user_id:
              typeof taskData.primary_owner_user_id === 'string'
                ? taskData.primary_owner_user_id
                : null,
          }),
          subtasks: [],
          parent_task_id: cleanText(parentSlot.task.task_id),
          subtask_origin: 'created',
          category_path: this.subtaskCategoryPath(taskData, parentSlot),
          ...(normalizedRequestId
            ? {
                creation_request_id: normalizedRequestId,
                creation_request_scope: requestScope,
                creation_request_hash: requestHash,
                creation_request_index: index,
              }
            : {}),
          created_at: nowIso,
          updated_at: nowIso,
        }),
        identity.people,
        identity.users,
      );

      if (newTask.status === 'paused_blocked' && !cleanText(newTask.blocked_since)) {
        (newTask as JsonRecord).blocked_since = nowIso;
      }
      return newTask;
    });

    let inserted = false;
    const categories = trees.get(parentSlot.productId) ?? [];
    const updated = categories.map((cat) => {
      if (inserted || !isRecord(cat)) return cat;
      return {
        ...cat,
        children: asArray(cat.children).map((child) => {
          if (inserted || !isRecord(child)) return child;
          const result = appendTaskChildren(
            asArray(child.tasks),
            cleanText(parentSlot.task.task_id),
            newTasks,
            nowIso,
          );
          if (!result.inserted) return child;
          inserted = true;
          return { ...child, tasks: result.tasks };
        }),
      };
    });
    if (!inserted) throw new NotFoundException('父任务定位失败');

    await this.writeTaskCategoriesForProduct(parentSlot.productId, updated);
    await this.recomputeDirectorDashboard().catch((error: unknown) => {
      this.logger.warn(
        `批量子任务已落库，但驾驶舱派生统计重算失败：${error instanceof Error ? error.message : String(error)}`,
      );
    });
    for (const newTask of newTasks) {
      if (newTask.status === 'pending_review') {
        void this.notifyAdminsOfPendingReview(newTask, {});
      }
      void this.syncTaskToRag(String(newTask.task_id ?? ''));
    }
    return newTasks;
  }

  async updateTask(
    taskId: string,
    patch: JsonRecord,
    options?: { requesterUserId?: string; requesterName?: string; canEditAny?: boolean },
  ) {
    // Strip private notification-metadata fields before persisting
    const {
      task_id: _protected,
      id: _protectedInternalId,
      created_at: _protectedCreatedAt,
      updated_at: _protectedUpdatedAt,
      parent_task_id: _protectedParentTaskId,
      subtasks: _protectedSubtasks,
      subtask_origin: _protectedSubtaskOrigin,
      subtask_attached_at: _protectedSubtaskAttachedAt,
      subtask_attached_by: _protectedSubtaskAttachedBy,
      subtask_attached_by_id: _protectedSubtaskAttachedById,
      creation_request_id: _protectedCreationRequestId,
      creation_request_scope: _protectedCreationRequestScope,
      creation_request_hash: _protectedCreationRequestHash,
      creation_request_index: _protectedCreationRequestIndex,
      _review_action,
      _reviewer_name,
      _reject_reason,
      _actor_name,
      ...persistPatch
    } = patch as JsonRecord & {
      _review_action?: string;
      _reviewer_name?: string;
      _reject_reason?: string;
      _actor_name?: string;
    };
    void _protected;
    void _protectedInternalId;
    void _protectedCreatedAt;
    void _protectedUpdatedAt;
    void _protectedParentTaskId;
    void _protectedSubtasks;
    void _protectedSubtaskOrigin;
    void _protectedSubtaskAttachedAt;
    void _protectedSubtaskAttachedBy;
    void _protectedSubtaskAttachedById;
    void _protectedCreationRequestId;
    void _protectedCreationRequestScope;
    void _protectedCreationRequestHash;
    void _protectedCreationRequestIndex;

    // work_items 在写入口统一归一化：任意客户端 PATCH 非法形状（对象/字符串/缺字段项）
    // 一律清洗为合法数组，防止污染后所有消费端（任务卡/详情页/AI prompt/报告导出）崩溃
    if (Object.prototype.hasOwnProperty.call(persistPatch, 'work_items')) {
      (persistPatch as JsonRecord).work_items = asArray(persistPatch.work_items)
        .filter(isRecord)
        .map((it) => ({
          id: cleanText(it.id),
          title: cleanText(it.title),
          owner_name: cleanText(it.owner_name) || null,
          done: it.done === true,
        }))
        .filter((it) => it.id && it.title)
        .slice(0, 100);
    }

    // When _review_action is provided but no explicit status is in the patch,
    // auto-derive the new task status so the downstream notification fires correctly.
    // approve: result-review → completed; collaboration-review → in_progress
    // reject:  always → in_progress (task sent back for revision)
    let resolvedPatch: JsonRecord = persistPatch;

    const identity = await this.getIdentityContext();
    let found = false;
    let originalTask: JsonRecord | null = null;

    const updateInTasks = (tasks: unknown[]): unknown[] => {
      return tasks.map((t) => {
        if (!isRecord(t)) return t;
        if (t.task_id === taskId) {
          this.assertTaskWritable(t);
          found = true;
          originalTask = { ...t };

          // 越权防护（与 moveTasks 同口径）：仅持页面权限 page:rd-my-workspace 的普通成员
          // 只能修改"自己负责"的任务（主责人或协作人），且不得审批(_review_action)或移交(primary_owner)
          // ——审批/移交是任务管理员/审核人专属。管理员级权限(canEditAny)完全跳过，行为不变。
          // 此处仅改了内存工作副本、尚未写库（见 mutateTaskAcrossStores 先 transform 后 write），
          // 抛错即安全回滚，无任何副作用。
          if (!options?.canEditAny) {
            if (!isTaskParticipant(t as JsonRecord, options?.requesterUserId, options?.requesterName)) {
              throw new ForbiddenException('只能修改自己负责的任务');
            }
            if (_review_action) {
              throw new ForbiddenException('无审核权限：仅研发主管可审批任务');
            }
            if (Object.prototype.hasOwnProperty.call(persistPatch, 'primary_owner')) {
              throw new ForbiddenException('无权移交任务：仅研发主管可变更主责人');
            }
          }

          // Resolve review actions now that we have the original task.
          if (_review_action) {
            const reviewType = String((t as JsonRecord).pending_review_type ?? '');
            // 守卫：审核动作只对"处于待审核且类型已知"的任务生效，否则直接拒绝——
            // 杜绝"未知/缺失类型被兜底成已完成"，以及对已处理任务的重复审核。
            if (!isKnownReviewType(reviewType)) {
              throw new BadRequestException('该任务没有待处理的审核（审核类型缺失或未知），无法审核');
            }
            if (String((t as JsonRecord).status ?? '') !== 'pending_review') {
              throw new BadRequestException('该任务当前不是待审核状态，可能已被处理，请勿重复审核');
            }

            const actionPatch: JsonRecord = { ...persistPatch };

            // 状态由后端按审核类型唯一裁决，忽略前端传入的 status：
            // 通过 → 成果=已完成，立项/协作/截止日期=进行中；驳回 → 一律回进行中。
            actionPatch.status =
              _review_action === 'approve' ? REVIEW_APPROVE_STATUS[reviewType] : 'in_progress';

            actionPatch.pending_review_type = null;

            if (reviewType === 'collaboration') {
              actionPatch.pending_collaborators = [];
              actionPatch.pending_collaboration_reason = null;
              actionPatch.pending_collaboration_requested_at = null;
              if (_review_action === 'approve') {
                actionPatch.collaborators = asArray((t as JsonRecord).pending_collaborators).filter(isRecord);
              }
            }

            // 截止日期变更审核：通过 → 把申请值写入 due_date；驳回 → 不改 due_date。
            // 两种情况都清空 pending_due_date* 字段，状态走上面的派生逻辑（非 result → in_progress）。
            if (reviewType === 'due_date') {
              if (_review_action === 'approve') {
                const pendingDue = (t as JsonRecord).pending_due_date;
                if (typeof pendingDue === 'string' && pendingDue.trim()) {
                  actionPatch.due_date = pendingDue.trim();
                }
              }
              actionPatch.pending_due_date = null;
              actionPatch.pending_due_date_reason = null;
              actionPatch.pending_due_date_requested_at = null;
            }

            // 放弃任务审核：通过 → 状态先派生为 archived（见 REVIEW_APPROVE_STATUS），
            // 随后在 mutate 完成后由本方法硬删除该任务（等同管理员删除）；驳回 → 回进行中。
            // 两种情况都清空 pending_abandon* 字段。
            if (reviewType === 'abandon') {
              actionPatch.pending_abandon_reason = null;
              actionPatch.pending_abandon_requested_at = null;
            }

            // 任务合并审核：通过 → 源任务先回 in_progress（上面已裁决），随后由 applyTaskMerge 归档并迁移到目标；
            // 驳回 → 回 in_progress。两种情况都清空 pending_merge_* 字段。
            if (reviewType === 'merge') {
              actionPatch.pending_merge_target = null;
              actionPatch.pending_merge_reason = null;
              actionPatch.pending_merge_requested_at = null;
              actionPatch.pending_merge_requested_by = null;
              actionPatch.pending_merge_requested_by_id = null;
            }

            resolvedPatch = actionPatch;
          }

          const ownerNameChanged = Object.prototype.hasOwnProperty.call(resolvedPatch, 'primary_owner');
          const ownerUserIdProvided = Object.prototype.hasOwnProperty.call(resolvedPatch, 'primary_owner_user_id');
          const identityPatch =
            ownerNameChanged && !ownerUserIdProvided
              ? { ...resolvedPatch, primary_owner_user_id: null }
              : resolvedPatch;

          // 兜底：如果本次 patch 涉及 collaborators，归一化（去重 + 排除主责人 + 排除待指派）
          if (Object.prototype.hasOwnProperty.call(identityPatch, 'collaborators')) {
            const effectiveOwnerName = Object.prototype.hasOwnProperty.call(identityPatch, 'primary_owner')
              ? String(identityPatch.primary_owner ?? '')
              : String((t as JsonRecord).primary_owner ?? '');
            const effectiveOwnerUserId = Object.prototype.hasOwnProperty.call(identityPatch, 'primary_owner_user_id')
              ? (typeof identityPatch.primary_owner_user_id === 'string' ? identityPatch.primary_owner_user_id : null)
              : (typeof (t as JsonRecord).primary_owner_user_id === 'string' ? ((t as JsonRecord).primary_owner_user_id as string) : null);
            identityPatch.collaborators = normalizeCollaboratorList(identityPatch.collaborators, {
              name: effectiveOwnerName,
              user_id: effectiveOwnerUserId,
            });
            // resolvedPatch 后续通知逻辑会用到，保持同步
            resolvedPatch = { ...resolvedPatch, collaborators: identityPatch.collaborators };
          }

          const nowIso = new Date().toISOString();
          // 进入"待审核"的瞬间记录提交时间，供"逾期提交"判定（方案B）：
          // 申请者按时提交则不算逾期；只有提交时间晚于截止日才算其逾期。仅在状态从非待审核切到待审核时记。
          const enteringReview =
            String((t as JsonRecord).status ?? '') !== 'pending_review' &&
            String((identityPatch.status ?? (t as JsonRecord).status) ?? '') === 'pending_review';
          // 「仅截止日期变更」不刷新 updated_at：驾驶舱按 last_activity_at(=max(updated_at,最新留痕)) 排序，
          // 改截止时间不应被当作"操作"把任务顶到最前、打乱按最后活动时间的排列。
          // 命中：截止日期变更的申请（patch.pending_review_type==='due_date'）或其审核（本任务待审类型为 due_date）。
          const dueDateOnlyChange =
            (!!_review_action && String((t as JsonRecord).pending_review_type ?? '') === 'due_date') ||
            (!_review_action && String((identityPatch as JsonRecord).pending_review_type ?? '') === 'due_date');
          const preservedUpdatedAt =
            dueDateOnlyChange && typeof (t as JsonRecord).updated_at === 'string'
              ? ((t as JsonRecord).updated_at as string)
              : nowIso;
          // 阻塞时长跟踪：状态切入 paused_blocked 记起点（blocked_since），离开时清除。
          // 字段随任务对象静默持久化，仅协同模块前端消费展示（其他驾驶舱不读不显示）。
          const prevStatus = String((t as JsonRecord).status ?? '');
          const nextStatus = String((identityPatch.status ?? prevStatus) ?? '');
          const blockedPatch =
            nextStatus === 'paused_blocked' && prevStatus !== 'paused_blocked'
              ? { blocked_since: nowIso }
              : nextStatus !== 'paused_blocked' && prevStatus === 'paused_blocked'
                ? { blocked_since: null }
                : {};
          const merged = {
            ...t,
            ...identityPatch,
            ...blockedPatch,
            task_id: taskId,
            updated_at: preservedUpdatedAt,
            ...(enteringReview ? { submitted_for_review_at: nowIso } : {}),
          };
          return this.normalizeTaskIdentity(merged, identity.people, identity.users);
        }
        if (Array.isArray(t.subtasks)) {
          return { ...t, subtasks: updateInTasks(t.subtasks) };
        }
        return t;
      });
    };

    await this.mutateTaskAcrossStores((categories) => {
      const updated = categories.map((cat) => {
        if (!isRecord(cat)) return cat;
        return {
          ...cat,
          children: asArray(cat.children).map((child) => {
            if (!isRecord(child)) return child;
            return { ...child, tasks: updateInTasks(asArray(child.tasks)) };
          }),
        };
      });
      return { categories: updated, found };
    });

    if (!found) throw new NotFoundException('任务不存在');
    await this.recomputeDirectorDashboard();

    // 服务端审计：变更集由「改动前的任务 + 实际落库的补丁」在服务层自行 diff，
    // 不依赖前端上报——绕开界面直调本接口同样留痕。
    if (originalTask) {
      const auditBefore = originalTask as JsonRecord;
      const auditChanges = this.buildTaskChanges(auditBefore, resolvedPatch);
      const review = _review_action
        ? { action: _review_action, reviewerName: _reviewer_name, rejectReason: _reject_reason }
        : undefined;
      // 无字段变化且非审批动作：多为幂等重存，不值得占一条留痕
      if (auditChanges.length > 0 || review) {
        const { action, comment } = this.classifyTaskUpdate(auditBefore, resolvedPatch, auditChanges, review);
        await this.recordServerAudit({
          action,
          resource: { type: 'task', id: taskId, name: cleanText(auditBefore.title) || taskId },
          // 操作人只认 JWT 身份：_actor_name 是请求体自报的，拿它兜底等于让调用方决定留痕算在谁头上
          actor: { id: options?.requesterUserId, name: options?.requesterName },
          comment,
          changes: auditChanges,
          ...(review ? { metadata: { review_type: cleanText(auditBefore.pending_review_type) || 'result' } } : {}),
        });
      }
    }

    // Auto-send review notifications (best-effort, never blocks response)
    if (originalTask) {
      const oldStatus = String((originalTask as JsonRecord).status ?? '');
      const newStatus = String(resolvedPatch.status ?? oldStatus);
      // Also re-notify when a member explicitly re-submits a task already in pending_review
      // (e.g., admin missed the first notification). Exclude admin review actions.
      const explicitlySubmittingForReview =
        !_review_action &&
        newStatus === 'pending_review' &&
        Object.prototype.hasOwnProperty.call(persistPatch, 'status');
      if (newStatus === 'pending_review' && (oldStatus !== 'pending_review' || explicitlySubmittingForReview)) {
        void this.notifyAdminsOfPendingReview(originalTask as JsonRecord, resolvedPatch);
      } else if (oldStatus === 'pending_review' && newStatus !== 'pending_review' && _review_action) {
        const reviewType = String((originalTask as JsonRecord).pending_review_type ?? 'result');
        try {
          await this.markReviewRequestMessagesHandled(taskId, reviewType);
        } catch {
          // best-effort: task status has already been updated
        }
        void (async () => {
          await this.notifySubmitterOfReviewResult(
            originalTask as JsonRecord,
            _review_action,
            String(_reviewer_name ?? '管理员'),
            String(_reject_reason ?? ''),
            reviewType,
          );
          if (_review_action === 'approve' && reviewType === 'collaboration') {
            await this.notifyCollaboratorsOfCollaborationApproval(
              originalTask as JsonRecord,
              asArray((originalTask as JsonRecord).pending_collaborators).filter(isRecord),
              String(_reviewer_name ?? '管理员'),
            );
          }
        })();
        // 审核通过且为成果审核（任务进入 completed）→ 触发 AI 复盘评分（fire-and-forget）
        if (_review_action === 'approve' && reviewType === 'result' && newStatus === 'completed') {
          void this.triggerTaskCompletionScoring(taskId);
        }
        // 放弃任务审核通过 → 硬删除该任务（含子任务），等同管理员在驾驶舱「删除」的效果：
        // 任务从所有视图（驾驶舱/工作台/看板）彻底消失。须在通知提交人之后执行
        // （通知读取的是 originalTask 快照，删除不影响）。
        if (_review_action === 'approve' && reviewType === 'abandon') {
          await this.deleteTask(taskId);
        }
        // 任务合并审核通过 → 执行合并：把源任务（含子任务/留痕/附件/协作人）并入目标任务，源任务归档保留。
        // 读取 originalTask 快照上的合并目标与发起人（actionPatch 已清空 pending，故用快照）。
        if (_review_action === 'approve' && reviewType === 'merge') {
          const src = originalTask as JsonRecord;
          const targetId = cleanText(src.pending_merge_target);
          const initiator = {
            id: cleanUserId(src.pending_merge_requested_by_id) || cleanUserId(src.primary_owner_user_id),
            name: cleanText(src.pending_merge_requested_by) || cleanText(src.primary_owner) || '研发成员',
          };
          if (targetId) {
            await this.applyTaskMerge(taskId, targetId, initiator).catch((err) => {
              // eslint-disable-next-line no-console
              console.error('[updateTask] applyTaskMerge failed', err);
              // 审核已判「通过」且状态已落库，这里再抛会让整个 updateTask 失败、把审核也回滚掉。
              // 所以不抛——但绝不能只留一行服务端日志：审核人看到的是「已通过」，
              // 发起人以为已合并，实际源任务原封不动，没有任何人会发现。
              void this.notifyTaskMergeFailure(
                originalTask as JsonRecord,
                targetId,
                initiator,
                String(_reviewer_name ?? '管理员'),
                err instanceof Error ? err.message : String(err),
              );
            });
          }
        }
      }

      // 非审核动作（管理员直接改协作人/主责人）→ 给被影响的成员发系统通知
      if (!_review_action) {
        const actorName = String(_actor_name ?? '管理员');

        // 1. 协作人直接添加 → 通知新加入的协作人
        if (Object.prototype.hasOwnProperty.call(persistPatch, 'collaborators')) {
          const oldCollaborators = asArray((originalTask as JsonRecord).collaborators).filter(isRecord);
          const newCollaborators = asArray(resolvedPatch.collaborators).filter(isRecord);
          void this.notifyNewlyAddedCollaborators(
            originalTask as JsonRecord,
            oldCollaborators,
            newCollaborators,
            actorName,
          );
        }

        // 2. 主责人直接变更 → 通知新主责人
        if (Object.prototype.hasOwnProperty.call(persistPatch, 'primary_owner')) {
          const oldOwnerName = String((originalTask as JsonRecord).primary_owner ?? '');
          const newOwnerName = String(resolvedPatch.primary_owner ?? '');
          const newOwnerUserId =
            typeof resolvedPatch.primary_owner_user_id === 'string'
              ? resolvedPatch.primary_owner_user_id
              : null;
          void this.notifyNewPrimaryOwner(
            originalTask as JsonRecord,
            newOwnerName,
            newOwnerUserId,
            oldOwnerName,
            actorName,
          );
        }
      }
    }

    // 任务字段变更后刷新向量索引（fire-and-forget；archived 时内部转为删除 chunks）
    void this.syncTaskToRag(taskId);
    return { ok: true, task_id: taskId };
  }

  /** 请求者的界面语言偏好（i18n.user-langs KV，与 i18n 模块同源）：AI 生成内容据此定输出语言 */
  private async getRequesterLang(userId?: string): Promise<'zh' | 'en'> {
    const id = cleanText(userId);
    if (!id) return 'zh';
    try {
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: 'i18n.user-langs' },
        select: { value: true },
      });
      const map =
        setting?.value && typeof setting.value === 'object' && !Array.isArray(setting.value)
          ? (setting.value as Record<string, string>)
          : {};
      return map[id] === 'en' ? 'en' : 'zh';
    } catch {
      return 'zh';
    }
  }

  private async getUsersWithAnyPermission(codes: string[]): Promise<Array<{ id: string; name: string }>> {
    // 收件人须同时具备：指定操作码之一 + 当前工作区的页面码（超管 '*' 通行）。
    // 操作码跨池共享（协同角色同样持有 rd-task:edit 等），只按操作码捞人会把
    // 研发池的审核通知发给协同角色用户——RdMessage 是全局消息表（用户级过滤、
    // 有意豁免池隔离），一旦发错人，对方在任何工作台都能看到研发通知。
    // 页面码定池：用「page:」前缀的页面码约束收件人所属池（rd-people:manage 等
    // 双池准入特殊码不作为归属依据）。
    const workspacePages = (WORKSPACE_PAGE_CODES[currentRdWorkspace()] ?? []).filter((code) =>
      code.startsWith('page:'),
    );
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, role: { select: { permissions: true } } },
    });
    return users
      .filter((u) => {
        const perms = Array.isArray(u.role?.permissions) ? (u.role!.permissions as string[]) : [];
        if (perms.includes('*')) return true;
        return (
          codes.some((c) => perms.includes(c)) &&
          workspacePages.some((page) => perms.includes(page))
        );
      })
      .map((u) => ({ id: u.id, name: u.name }));
  }

  /**
   * 立项审核通知的收件人：优先按「审批流第一节点的有效池」捞人——
   * 有效池 = 权限码派生（操作码 ∩ 当前工作区页面码，getUsersWithAnyPermission 口径）
   *          − 节点手动移出(excluded_member_ids) ∪ 节点手动增补(extra_members)。
   * 与前端 approvalFlowConfig.effectiveNodePool 同构；审批流未配置或池为空时返回 []，
   * 调用方回退到固定管理员集，历史行为不变。
   */
  private async getProposalReviewRecipients(): Promise<Array<{ id: string; name: string }>> {
    const flows = await this.readArray('rd.approvalFlows');
    const flow =
      flows.find((f) => isRecord(f) && f.scope === 'project_proposal' && f.is_default === true) ??
      flows.find((f) => isRecord(f) && f.scope === 'project_proposal');
    if (!isRecord(flow)) return [];
    const firstNode = asArray(flow.nodes).find(isRecord);
    if (!firstNode) return [];

    const code = String(firstNode.permission_code ?? '').trim();
    const derived = code ? await this.getUsersWithAnyPermission([code]) : [];
    const excluded = new Set(asArray(firstNode.excluded_member_ids).map((id) => String(id)));
    const kept = derived.filter((u) => !excluded.has(u.id));
    const seen = new Set(kept.map((u) => u.id));
    // 与前端 effectiveNodePool 同口径：excluded 优先于 extras（旧数据两数组可能相交），并去重
    const extras = asArray(firstNode.extra_members)
      .filter(isRecord)
      .map((m) => ({ id: String(m.id ?? ''), name: String(m.name ?? '') }))
      .filter((m) => {
        if (!m.id || excluded.has(m.id) || seen.has(m.id)) return false;
        seen.add(m.id);
        return true;
      });
    return [...kept, ...extras];
  }

  private async notifyAdminsOfPendingReview(task: JsonRecord, patch: JsonRecord): Promise<void> {
    // 在 try 外：catch 里的日志要能报出是哪一类审核的通知失败了
    const reviewType = String(patch.pending_review_type ?? task.pending_review_type ?? 'result');
    try {
      // 收件人只看「接收审核通知」这一个独立码，不再复用 rd-task:edit / rd-task:reassign。
      // 那两个是「能不能改任务」的操作码，默认「研发人员」角色就持有；拿它当收件依据，
      // 等于任何被授予研发权限的岗位（哪怕本职是采购）都会被卷进研发审核通知里。
      // 能否审批仍由控制器的 @Permissions 把关，与这里彻底解耦。
      let admins = await this.getUsersWithAnyPermission([RD_REVIEW_NOTIFY_PERMISSION]);
      if (reviewType === 'proposal') {
        // 立项类：审批流配置了谁审，就通知谁（含手动增删的结果）；未配置回退管理员集
        const poolRecipients = await this.getProposalReviewRecipients().catch(() => []);
        if (poolRecipients.length > 0) admins = poolRecipients;
      }
      const body = JSON.stringify({
        type: 'review_request',
        review_type: reviewType,
        task_id: String(task.task_id ?? ''),
        task_title: String(task.title ?? ''),
        submitter_name: String(task.primary_owner ?? ''),
        submitter_user_id: String(task.primary_owner_user_id ?? ''),
        // 理由按审核类型取本类型的字段，避免协作/截止日期/放弃理由互相串味
        note: String(
          reviewType === 'collaboration'
            ? (patch.pending_collaboration_reason ?? task.pending_collaboration_reason ?? '')
            : reviewType === 'due_date'
              ? (patch.pending_due_date_reason ?? task.pending_due_date_reason ?? '')
              : reviewType === 'abandon'
                ? (patch.pending_abandon_reason ?? task.pending_abandon_reason ?? '')
                : '',
        ),
        pending_collaborators: patch.pending_collaborators ?? task.pending_collaborators ?? [],
        // 截止日期变更审核：把申请的新日期 + 任务当前日期带给审核人查看。
        pending_due_date: String(patch.pending_due_date ?? task.pending_due_date ?? ''),
        current_due_date: String(task.due_date ?? ''),
        current_progress: typeof task.progress === 'number' ? task.progress : 0,
      });
      const typeLabel = reviewTypeLabel(reviewType);
      const subject = `[待审核·${typeLabel}] 「${task.title}」申请${typeLabel}审核`;
      // 收件人是「全体审核人」，一条 INSERT 落 N 行，不逐个来回
      await this.createMessages(
        admins.map((admin) => ({
          sender: { id: null, name: '系统通知', role: 'system' },
          recipient_id: admin.id,
          subject,
          body,
        })),
      );
    } catch (err) {
      // best-effort：通知失败不阻断审核提交，但必须留痕，否则线上「没收到通知」无从排查
      this.logger.warn(
        `[待审核通知] 发送失败 (task=${cleanText(task.task_id)}, type=${reviewType}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async notifySubmitterOfReviewResult(
    task: JsonRecord,
    action: string,
    reviewerName: string,
    rejectReason: string,
    reviewType = 'result',
  ): Promise<void> {
    try {
      const submitterId = String(task.primary_owner_user_id ?? '').trim();
      const submitterName = String(task.primary_owner ?? '').trim();
      // Need at least one recipient identifier to deliver the message
      if (!submitterId && !submitterName) return;
      const isApproved = action === 'approve';
      const typeLabel = reviewTypeLabel(reviewType);
      const taskTitle = String(task.title ?? '');
      const body = JSON.stringify({
        type: 'review_result',
        review_type: reviewType,
        result: isApproved ? 'approved' : 'rejected',
        task_id: String(task.task_id ?? ''),
        task_title: taskTitle,
        reviewer_name: reviewerName,
        reason: rejectReason,
      });
      // 各审核类型独立文案，互不复用，避免类型混淆
      const subject =
        reviewType === 'result'
          ? `[审核结果·成果] 「${taskTitle}」成果验收${isApproved ? '已通过，任务完成' : '被驳回，请修改后重新提交'}`
          : reviewType === 'proposal'
            ? `[审核结果·立项] 「${taskTitle}」立项${isApproved ? '已通过，任务进入执行' : '被退回，请完善后重新提交'}`
            : reviewType === 'collaboration'
              ? `[审核结果·协作变更] 「${taskTitle}」协作变更${isApproved ? '已通过并生效' : '被驳回，保持原协作人'}`
              : reviewType === 'due_date'
                ? `[审核结果·截止日期变更] 「${taskTitle}」截止日期变更${isApproved ? '已通过并生效' : '被驳回，保持原日期'}`
                : reviewType === 'abandon'
                  ? `[审核结果·放弃任务] 「${taskTitle}」放弃申请${isApproved ? '已通过，任务已移除' : '被驳回，任务继续进行'}`
                  : `[审核结果·${typeLabel}] 「${taskTitle}」${isApproved ? '已通过' : '被驳回'}`;
      await this.createMessage({
        sender: { id: null, name: '系统通知', role: 'system' },
        recipient_id: submitterId || null,
        recipient_name: submitterName || null, // keep a name fallback in case a task has a stale linked user_id
        subject,
        body,
      });
    } catch (err) {
      // best-effort：审核结果已落库，告知失败不回滚，但要留痕
      this.logger.warn(
        `[审核结果通知] 发送失败 (task=${cleanText(task.task_id)}, type=${reviewType}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * 合并审核已通过、但 applyTaskMerge 执行失败时的兜底告知。
   *
   * 这条路径的危险之处在于「所有人都以为成功了」：审核接口返回 200，审核人看到「已通过」，
   * 发起人收到的是审核通过通知，而源任务其实原封不动。所以这里必须同时做到
   * ①通知发起人 ②通知审核人 ③落审计——少任何一条，失败就还是隐形的。
   *
   * 整个方法 best-effort：告知失败不能再把已经落库的审核结果搅乱。
   */
  private async notifyTaskMergeFailure(
    task: JsonRecord,
    targetId: string,
    initiator: { id: string; name: string },
    reviewerName: string,
    reason: string,
  ): Promise<void> {
    const taskId = cleanText(task.task_id);
    const taskTitle = cleanText(task.title);
    const subject = `[合并未执行] 「${taskTitle}」审核已通过，但合并失败`;
    const body =
      `任务「${taskTitle}」(${taskId}) 的合并申请已审核通过，但系统执行合并到目标任务 ${targetId} 时失败，` +
      `该任务**未被合并、也未归档，保持原状**。失败原因：${reason || '未知'}。请到研发任务驾驶舱确认后重新发起合并。`;

    try {
      await this.createMessage({
        sender: { id: null, name: '系统通知', role: 'system' },
        recipient_id: initiator.id || null,
        recipient_name: initiator.name || null,
        subject,
        body,
      });
    } catch (err) {
      // best-effort：发起人可能已离职/无账号，不能因此挡住后面给审核人的告知
      this.logger.warn(
        `[合并失败告知] 发给发起人失败 (task=${taskId}, to=${initiator.name || initiator.id}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // 审核人是「点了通过」的那个人，最需要知道结果与他看到的不一致
    try {
      if (reviewerName && reviewerName !== initiator.name) {
        await this.createMessage({
          sender: { id: null, name: '系统通知', role: 'system' },
          recipient_name: reviewerName,
          subject,
          body,
        });
      }
    } catch (err) {
      this.logger.warn(
        `[合并失败告知] 发给审核人失败 (task=${taskId}, to=${reviewerName}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    try {
      await this.createAuditLog({
        actor: { id: initiator.id || null, name: initiator.name || '系统' },
        action: 'task.merge_failed',
        resource: { type: 'task', id: taskId, name: taskTitle || taskId },
        comment: `合并到 ${targetId} 失败：${reason || '未知'}；任务保持原状`,
        metadata: { target_task_id: targetId, reviewer_name: reviewerName },
        source: 'api',
      });
    } catch (err) {
      this.logger.warn(
        `[合并失败留痕] 审计日志写入失败 (task=${taskId}, target=${targetId}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async notifyCollaboratorsOfCollaborationApproval(
    task: JsonRecord,
    collaborators: JsonRecord[],
    reviewerName: string,
  ): Promise<void> {
    try {
      const taskTitle = String(task.title ?? '');
      const ownerName = String(task.primary_owner ?? task.owner ?? '');
      const body = `${reviewerName} 已批准协作申请，你现在是任务「${taskTitle}」的协作人。${ownerName ? `主责人：${ownerName}` : ''}`;
      const subject = `[协作任务] 「${taskTitle}」你已被加入协作`;
      const seenRecipients = new Set<string>();
      const payloads: CreateMessagePayload[] = [];

      for (const collaborator of collaborators) {
        const recipientId = cleanUserId(collaborator.user_id);
        const recipientPersonId = cleanText(collaborator.id);
        const recipientName = cleanText(collaborator.name);
        const recipientNameKey = personNameLookupKey(recipientName);
        const recipientKey = recipientId
          ? `u:${recipientId}`
          : recipientPersonId
            ? `p:${recipientPersonId}`
            : recipientNameKey
              ? `n:${recipientNameKey}`
              : '';
        if (!recipientKey || seenRecipients.has(recipientKey)) continue;
        seenRecipients.add(recipientKey);

        payloads.push({
          sender: { id: null, name: '系统通知', role: 'system' },
          recipient_id: recipientId || null,
          recipient_person_id: recipientPersonId || null,
          recipient_name: recipientName || null,
          subject,
          body,
        });
      }
      await this.createMessages(payloads);
    } catch (err) {
      this.logger.warn(
        `[协作批准通知] 发送失败 (task=${cleanText(task.task_id)}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 给"新被加入的协作人"发通知（管理员直接添加，跳过协作变更审核）。oldList / newList 差集 = 新增 */
  private async notifyNewlyAddedCollaborators(
    task: JsonRecord,
    oldList: JsonRecord[],
    newList: JsonRecord[],
    actorName: string,
  ): Promise<void> {
    try {
      const collaboratorKey = (c: JsonRecord): string => {
        const uid = cleanUserId((c as JsonRecord).user_id);
        if (uid) return `u:${uid}`;
        const pid = cleanText((c as JsonRecord).id);
        if (pid) return `p:${pid}`;
        const nameKey = personNameLookupKey(cleanText((c as JsonRecord).name));
        if (nameKey) return `n:${nameKey}`;
        return '';
      };
      const oldKeys = new Set(oldList.map(collaboratorKey).filter(Boolean));
      const newOnes = newList.filter((c) => {
        const k = collaboratorKey(c);
        return k && !oldKeys.has(k);
      });
      if (newOnes.length === 0) return;

      const taskTitle = String(task.title ?? '');
      const ownerName = String(task.primary_owner ?? '');
      const body = `${actorName} 将你加入任务「${taskTitle}」的协作。${ownerName ? `主责人：${ownerName}` : ''}`;
      const subject = `[协作任务] 「${taskTitle}」你已被加入协作`;
      const seen = new Set<string>();
      const payloads: CreateMessagePayload[] = [];
      for (const c of newOnes) {
        const recipientId = cleanUserId((c as JsonRecord).user_id);
        const recipientPersonId = cleanText((c as JsonRecord).id);
        const recipientName = cleanText((c as JsonRecord).name);
        const recipientNameKey = personNameLookupKey(recipientName);
        const key = recipientId ? `u:${recipientId}`
          : recipientPersonId ? `p:${recipientPersonId}`
          : recipientNameKey ? `n:${recipientNameKey}` : '';
        if (!key || seen.has(key)) continue;
        seen.add(key);
        payloads.push({
          sender: { id: null, name: '系统通知', role: 'system' },
          recipient_id: recipientId || null,
          recipient_person_id: recipientPersonId || null,
          recipient_name: recipientName || null,
          subject,
          body,
        });
      }
      await this.createMessages(payloads);
    } catch (err) {
      this.logger.warn(
        `[新增协作人通知] 发送失败 (task=${cleanText(task.task_id)}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** 给"新主责人"发通知（管理员直接移交任务）。oldOwnerName / newOwnerName 不同即触发 */
  private async notifyNewPrimaryOwner(
    task: JsonRecord,
    newOwnerName: string,
    newOwnerUserId: string | null,
    oldOwnerName: string,
    actorName: string,
  ): Promise<void> {
    try {
      const trimmedNew = (newOwnerName || '').trim();
      const trimmedOld = (oldOwnerName || '').trim();
      if (!trimmedNew || trimmedNew === trimmedOld || trimmedNew === '待指派') return;

      const taskTitle = String(task.title ?? '');
      const body = `${actorName} 将任务「${taskTitle}」指派给你为主责人。${trimmedOld ? `原主责人：${trimmedOld}` : '原状态：未指派'}`;
      const subject = `[任务指派] 「${taskTitle}」你已被指派为主责人`;

      await this.createMessage({
        sender: { id: null, name: '系统通知', role: 'system' },
        recipient_id: (newOwnerUserId || '').trim() || null,
        recipient_person_id: null,
        recipient_name: trimmedNew || null,
        subject,
        body,
      });
    } catch (err) {
      this.logger.warn(
        `[主责指派通知] 发送失败 (task=${cleanText(task.task_id)}, to=${newOwnerName}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async markReviewRequestMessagesHandledForTasks(
    taskIds: ReadonlySet<string>,
    reviewType = '',
  ): Promise<void> {
    if (taskIds.size === 0) return;
    // (type, taskId, handled) 走索引先把候选缩到这几个任务的待审通知；
    // review_type 没单独落列，在这个极小的集合里解析 body 判定即可
    // （表化前这里要对全部 5000 条消息逐条 JSON.parse）。
    const candidates = await this.prisma.rdMessage.findMany({
      where: { type: 'review_request', taskId: { in: [...taskIds] }, handled: false },
      select: { id: true, body: true },
    });
    if (candidates.length === 0) return;

    const matchedIds = candidates
      .filter((message) => {
        if (!reviewType) return true;
        let parsed: Record<string, unknown> | null = null;
        try {
          parsed = JSON.parse(cleanText(message.body)) as Record<string, unknown>;
        } catch {
          return false;
        }
        return cleanText(parsed.review_type || 'result') === reviewType;
      })
      .map((message) => message.id);
    if (matchedIds.length === 0) return;

    await this.prisma.rdMessage.updateMany({
      where: { id: { in: matchedIds } },
      data: { handled: true, read: true },
    });
  }

  private async markReviewRequestMessagesHandled(taskId: string, reviewType: string): Promise<void> {
    const normalizedTaskId = cleanText(taskId);
    if (!normalizedTaskId) return;
    await this.markReviewRequestMessagesHandledForTasks(new Set([normalizedTaskId]), reviewType);
  }

  async patchMessage(
    messageId: string,
    patch: { read?: boolean; handled?: boolean },
    viewer: { userId?: string; hasFullAccess?: boolean },
  ) {
    const msg = await this.prisma.rdMessage.findUnique({ where: { id: messageId } });
    if (!msg) throw new NotFoundException('消息不存在');
    if (!viewer.hasFullAccess && viewer.userId !== msg.recipientId && viewer.userId !== msg.senderId) {
      // Name-based fallback: system messages may carry only a recipient name, or a stale linked user_id.
      if (msg.recipientName && viewer.userId) {
        const users = await this.listIdentityUsers();
        const caller = users.find((u) => u.id === viewer.userId);
        if (!caller || personNameLookupKey(caller.name) !== personNameLookupKey(msg.recipientName)) {
          throw new BadRequestException('无权修改此消息');
        }
      } else {
        throw new BadRequestException('无权修改此消息');
      }
    }
    // 只改本条的标志位，行级更新天然不会碰到别人的消息（表化前这里要重写整个数组）
    const updated = await this.prisma.rdMessage.update({
      where: { id: messageId },
      data: {
        ...(typeof patch.read === 'boolean' ? { read: patch.read } : {}),
        ...(typeof patch.handled === 'boolean' ? { handled: patch.handled } : {}),
      },
    });
    // 只有「关闭通知」这一下才值得留痕；已读标记是浏览行为，记下来只会淹没审计流
    if (patch.handled === true && msg.handled !== true) {
      await this.recordServerAudit({
        action: 'notification.handled',
        resource: { type: 'system', id: messageId, name: cleanText(msg.subject) },
        actor: { id: viewer.userId, name: cleanText(msg.recipientName) },
        comment: '关闭通知中心提醒',
        metadata: { message_category: cleanText(msg.category), message_source: cleanText(msg.source) },
      });
    }
    return this.serializeMessage(updated);
  }

  /** 取用户在「人员管理」配置的知识库权限分值 kb_level（0-100，缺省 20）。 */
  async getUserKbLevel(userId?: string | null): Promise<number> {
    if (!userId) return 20;
    const people = (await this.readArray('rd.people')).filter(isRecord);
    const me = people.find((p) => cleanUserId(p.user_id ?? (p as JsonRecord).auth_user_id) === userId);
    const raw = Number((me as JsonRecord | undefined)?.kb_level);
    return Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : 20;
  }

  /**
   * 解析知识库上传/入库应写入的权限分值（后端兜底，防止绕过前端置灰越权设置）：
   * - KB 管理员（rd-kb:manage 或超管）：用其请求值（0-100，越界则交由下游默认）；
   * - 研发成员：强制用其在「人员管理」配置的 kb_level，忽略前端传值。
   */
  async resolveKbPermissionLevel(
    viewer: { userId?: string | null; permissions?: string[] },
    requested?: number,
  ): Promise<number | undefined> {
    const perms = viewer.permissions ?? [];
    const isKbManager = perms.includes('*') || perms.includes('rd-kb:manage');
    if (isKbManager) {
      return typeof requested === 'number' && Number.isFinite(requested) && requested >= 0 && requested <= 100
        ? Math.round(requested)
        : undefined;
    }
    return this.getUserKbLevel(viewer.userId);
  }

  async deleteTask(taskId: string, actor?: { userId?: string; userName?: string; canEditAny?: boolean }) {
    let found = false;
    // 被删任务快照（用于删除后通知其负责人 / 协作人）。
    let removedTask: JsonRecord | null = null;
    // 记录被删除的全部 task_id（含子任务），用于连带清理其待审核通知
    const removedTaskIds: string[] = [];
    const collectIds = (t: JsonRecord): void => {
      const id = cleanText(t.task_id);
      if (id) removedTaskIds.push(id);
      asArray(t.subtasks).forEach((s) => { if (isRecord(s)) collectIds(s); });
    };

    const deleteFromTasks = (tasks: unknown[]): unknown[] => {
      const filtered = tasks.filter((t) => {
        if (isRecord(t) && t.task_id === taskId) {
          this.assertTaskWritable(t);
          if (actor && !actor.canEditAny && !isTaskParticipant(t, actor.userId, actor.userName)) {
            throw new ForbiddenException('只能删除自己负责或协作的任务');
          }
          found = true;
          removedTask = t;
          collectIds(t);
          return false;
        }
        return true;
      });
      return filtered.map((t) => {
        if (!isRecord(t) || !Array.isArray(t.subtasks)) return t;
        return { ...t, subtasks: deleteFromTasks(t.subtasks) };
      });
    };

    await this.mutateTaskAcrossStores((categories) => {
      const updated = categories.map((cat) => {
        if (!isRecord(cat)) return cat;
        return {
          ...cat,
          children: asArray(cat.children).map((child) => {
            if (!isRecord(child)) return child;
            return { ...child, tasks: deleteFromTasks(asArray(child.tasks)) };
          }),
        };
      });
      return { categories: updated, found };
    });

    if (!found) throw new NotFoundException('任务不存在');
    // 连带清理向量索引：任务与其全部进展留痕的 chunks（否则已删任务仍可被 AI 检索到）
    {
      const workspace = currentRdWorkspace();
      for (const removedId of removedTaskIds) {
        void this.ragService.removeChunksForTask(`${workspace}:`, removedId).catch((err) => {
          this.logger.warn(`[RAG] 删除任务清理 chunks 失败(${removedId}): ${err instanceof Error ? err.message : err}`);
        });
      }
    }

    // 任务及子任务删除后同步清理进展留痕，避免留下不可见的文本、附件引用和孤儿数据。
    await this.withProgressNoteLock(async () => {
      const noteMap = await this.getProgressNoteMap();
      let changed = false;
      for (const removedId of removedTaskIds) {
        if (!Object.prototype.hasOwnProperty.call(noteMap, removedId)) continue;
        delete noteMap[removedId];
        changed = true;
      }
      if (changed) await this.writeValue('rd.taskProgressNotes', noteMap);
    });

    // 协作讨论是任务的从属数据：任务被硬删除后线程已无可访问入口，必须同步清理，
    // 由外键级联删除消息与已读游标，避免留下孤立文本和 data_url 附件。
    await this.prisma.rdTaskDiscussionThread.deleteMany({
      where: {
        workspace: currentRdWorkspace(),
        taskId: { in: removedTaskIds },
      },
    });

    // 连带清理：删除任务（含子任务）后，把它们关联的"待审核"通知标记为已处理，
    // 避免管理员收件箱残留指向已删任务的孤儿待审核卡片（清理立项脏数据时常见）。
    try {
      await this.markReviewRequestMessagesHandledForTasks(new Set(removedTaskIds));
    } catch {
      // best-effort：任务已删除成功，通知清理失败不应阻断本次删除
    }
    // 通知被删任务的负责人与协作人（best-effort，失败不阻断删除）。
    if (removedTask) {
      await this.notifyTaskDeleted(removedTask, actor?.userName?.trim() || '管理员', cleanUserId(actor?.userId)).catch(
        () => {},
      );
    }
    // 删除任务原先没有任何留痕（前端各页都没记）——这是最该留痕的动作之一，本次补上
    if (removedTask) {
      const deleted = removedTask as JsonRecord;
      await this.recordServerAudit({
        action: 'task.deleted',
        resource: { type: 'task', id: taskId, name: cleanText(deleted.title) || taskId },
        actor: { id: actor?.userId, name: actor?.userName },
        comment: removedTaskIds.length > 1 ? `删除任务及其 ${removedTaskIds.length - 1} 个子任务` : '删除任务',
        metadata: {
          status: cleanText(deleted.status),
          primary_owner: cleanText(deleted.primary_owner),
          removed_task_ids: removedTaskIds,
        },
      });
    }
    await this.recomputeDirectorDashboard();
    return { ok: true };
  }

  /** 删除任务后，通知其负责人 + 全部协作人（去重、排除操作者本人）。 */
  private async notifyTaskDeleted(task: JsonRecord, actorName: string, actorUserId: string): Promise<void> {
    try {
      const taskTitle = String(task.title ?? '');
      const taskNo = cleanText(task.task_no ?? task.task_id);
      const subject = `[任务删除] 「${taskTitle}」已被删除`;
      const body = `${actorName} 删除了任务「${taskTitle}」${taskNo ? `（${taskNo}）` : ''}。如有疑问请联系管理员。`;

      const recipients: Array<{ user_id: string; person_id: string; name: string }> = [];
      // 负责人（待指派 / 空名跳过）。
      const ownerUserId = cleanUserId(task.primary_owner_user_id ?? task.owner_user_id);
      const ownerName = cleanText(task.primary_owner ?? task.owner);
      if (ownerUserId || (ownerName && ownerName !== '待指派')) {
        recipients.push({ user_id: ownerUserId, person_id: '', name: ownerName });
      }
      // 协作人。
      for (const c of asArray(task.collaborators)) {
        if (!isRecord(c)) continue;
        recipients.push({
          user_id: cleanUserId(c.user_id),
          person_id: cleanText(c.id),
          name: cleanText(c.name),
        });
      }

      const seen = new Set<string>();
      const payloads: CreateMessagePayload[] = [];
      for (const rcp of recipients) {
        const nameKey = personNameLookupKey(rcp.name);
        const key = rcp.user_id ? `u:${rcp.user_id}` : rcp.person_id ? `p:${rcp.person_id}` : nameKey ? `n:${nameKey}` : '';
        if (!key) continue;
        if (actorUserId && rcp.user_id === actorUserId) continue; // 不通知操作者本人
        if (seen.has(key)) continue;
        seen.add(key);
        payloads.push({
          sender: { id: null, name: '系统通知', role: 'system' },
          recipient_id: rcp.user_id || null,
          recipient_person_id: rcp.person_id || null,
          recipient_name: rcp.name || null,
          subject,
          body,
        });
      }
      await this.createMessages(payloads);
    } catch (err) {
      this.logger.warn(
        `[任务删除通知] 发送失败 (task=${cleanText(task.task_id)}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * 执行任务合并（一期：仅同产品库）：把源任务并入目标任务。
   * - 目标：追加源的子任务；主责改为发起人；描述由 AI 重写（失败则拼接）；截止取较晚；进度取较大；协作人并集去重；记录 merged_from。
   * - 源：归档保留（archived + merged_into + merged_at + 清空子任务）。
   * - 进度留痕/附件：源的留痕并入目标（附件计数随留痕在读取时自动派生）。
   * 源与目标必须在同一库（transform 需同时命中二者，否则 found=false → 不写任何库 → 抛错，天然拒绝跨库、不产生部分写）。
   */
  private async applyTaskMerge(
    sourceId: string,
    targetId: string,
    initiator: { id: string; name: string },
  ): Promise<void> {
    if (!sourceId || !targetId || sourceId === targetId) {
      throw new BadRequestException('合并的源任务与目标任务无效');
    }
    const source = await this.findTaskAcrossStores(sourceId);
    const target = await this.findTaskAcrossStores(targetId);
    if (!source || !target) throw new NotFoundException('源任务或目标任务不存在');

    const migratedSubtasks = asArray(source.subtasks).filter(isRecord);

    // 描述：AI 重写（合并两条任务的描述），失败则拼接兜底。
    const aiDesc = await this.rdAiService
      .mergeTaskDescriptions({
        targetTitle: cleanText(target.title),
        targetDescription: cleanText(target.description),
        sourceTitle: cleanText(source.title),
        sourceDescription: cleanText(source.description),
      })
      .catch(() => null);
    const fallbackDesc = [cleanText(target.description), cleanText(source.description)]
      .filter(Boolean)
      .join('\n')
      .trim();
    const mergedDescription = (aiDesc && aiDesc.trim()) || fallbackDesc;

    // 截止取较晚（YYYY-MM-DD 字符串可直接比较）；进度取较大。
    const srcDue = cleanText(source.due_date);
    const tgtDue = cleanText(target.due_date);
    const mergedDue = srcDue && tgtDue ? (srcDue > tgtDue ? srcDue : tgtDue) : srcDue || tgtDue || null;
    const toNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
    const mergedProgress = Math.max(0, Math.min(100, Math.max(toNum(source.progress), toNum(target.progress))));

    // 协作人并集去重（排除新主责=发起人）。把源主责也纳为协作人（除非就是发起人）。
    const collabKey = (c: JsonRecord) =>
      cleanUserId(c.user_id) ? `u:${cleanUserId(c.user_id)}` : personNameLookupKey(cleanText(c.name)) ? `n:${personNameLookupKey(cleanText(c.name))}` : '';
    const collabPool: JsonRecord[] = [
      ...asArray(target.collaborators).filter(isRecord),
      ...asArray(source.collaborators).filter(isRecord),
    ];
    const srcOwnerName = cleanText(source.primary_owner);
    if (srcOwnerName && srcOwnerName !== '待指派') {
      collabPool.push({ name: srcOwnerName, user_id: cleanUserId(source.primary_owner_user_id) || null });
    }
    const initiatorKey = initiator.id ? `u:${initiator.id}` : personNameLookupKey(initiator.name) ? `n:${personNameLookupKey(initiator.name)}` : '';
    const seenCollab = new Set<string>();
    const mergedCollaborators = collabPool.filter((c) => {
      const k = collabKey(c);
      if (!k || k === initiatorKey || seenCollab.has(k)) return false;
      seenCollab.add(k);
      return true;
    });

    const mergedFrom = [
      ...asArray(target.merged_from).map((x) => cleanText(x)).filter(Boolean),
      sourceId,
    ];
    const nowIso = new Date().toISOString();
    const targetPatch: JsonRecord = {
      description: mergedDescription,
      due_date: mergedDue,
      progress: mergedProgress,
      primary_owner: initiator.name,
      primary_owner_user_id: initiator.id || null,
      collaborators: mergedCollaborators,
      merged_from: mergedFrom,
      updated_at: nowIso,
    };

    // 同库内改写：同时命中源与目标才写（found = 二者皆命中），否则不写任何库 → 抛跨库错误。
    const rebuild = (tasks: unknown[], flags: { fs: boolean; ft: boolean }): unknown[] =>
      tasks.map((t) => {
        if (!isRecord(t)) return t;
        if (t.task_id === sourceId) {
          flags.fs = true;
          return { ...t, archived: true, status: 'archived', merged_into: targetId, merged_at: nowIso, subtasks: [] };
        }
        if (t.task_id === targetId) {
          flags.ft = true;
          return { ...t, ...targetPatch, subtasks: [...asArray(t.subtasks), ...migratedSubtasks] };
        }
        if (Array.isArray(t.subtasks)) return { ...t, subtasks: rebuild(t.subtasks, flags) };
        return t;
      });

    const result = await this.mutateTaskAcrossStores((categories) => {
      const flags = { fs: false, ft: false };
      const cats = categories.map((cat) => {
        if (!isRecord(cat)) return cat;
        return {
          ...cat,
          children: asArray(cat.children).map((child) =>
            isRecord(child) ? { ...child, tasks: rebuild(asArray(child.tasks), flags) } : child,
          ),
        };
      });
      return { categories: cats, found: flags.fs && flags.ft };
    });
    if (!result.found) {
      throw new BadRequestException('源任务与目标任务不在同一产品库，暂不支持跨库合并');
    }

    // 迁移进度留痕：源的留痕并入目标（重写 task_id），删除源的留痕键。锁内重读写，避免与并发写竞态。
    try {
      await this.withProgressNoteLock(async () => {
        const noteMap = await this.getProgressNoteMap();
        const srcNotes = asArray(noteMap[sourceId]).filter(isRecord);
        if (srcNotes.length > 0) {
          const rekeyed = srcNotes.map((n) => ({ ...n, task_id: targetId }));
          noteMap[targetId] = [...rekeyed, ...asArray(noteMap[targetId]).filter(isRecord)].slice(0, 100);
          delete noteMap[sourceId];
          await this.writeValue('rd.taskProgressNotes', noteMap);
        }
      });
    } catch {
      // best-effort：留痕迁移失败不回滚合并主流程
    }

    await this.notifyTaskMerged(source, target, initiator).catch(() => {});
    await this.recomputeDirectorDashboard();
    // 向量索引：源任务已归档（syncTaskToRag 内部转删除）、目标任务字段/留痕已变（刷新）
    void this.syncTaskToRag(sourceId);
    void this.syncTaskToRag(targetId);
  }

  /** 合并后通知：源任务负责人/协作人 + 目标任务原负责人（主责已换为发起人，原负责人需知悉）。 */
  private async notifyTaskMerged(
    source: JsonRecord,
    target: JsonRecord,
    initiator: { id: string; name: string },
  ): Promise<void> {
    try {
      const srcTitle = cleanText(source.title);
      const tgtTitle = cleanText(target.title);
      const recipients: Array<{ user_id: string; person_id: string; name: string }> = [];
      // 源任务负责人 + 协作人
      const srcOwnerName = cleanText(source.primary_owner);
      if (cleanUserId(source.primary_owner_user_id) || (srcOwnerName && srcOwnerName !== '待指派')) {
        recipients.push({ user_id: cleanUserId(source.primary_owner_user_id), person_id: '', name: srcOwnerName });
      }
      for (const c of asArray(source.collaborators)) {
        if (isRecord(c)) recipients.push({ user_id: cleanUserId(c.user_id), person_id: cleanText(c.id), name: cleanText(c.name) });
      }
      // 目标任务原负责人（主责被换掉，需知悉）
      const tgtOwnerName = cleanText(target.primary_owner);
      if (cleanUserId(target.primary_owner_user_id) || (tgtOwnerName && tgtOwnerName !== '待指派')) {
        recipients.push({ user_id: cleanUserId(target.primary_owner_user_id), person_id: '', name: tgtOwnerName });
      }

      const subject = `[任务合并] 「${srcTitle}」已并入「${tgtTitle}」`;
      const body = `${initiator.name || '研发成员'} 将任务「${srcTitle}」合并到「${tgtTitle}」（合并后由其担任主责）。原任务已归档保留，进度留痕与附件已并入目标任务。`;
      const seen = new Set<string>();
      const payloads: CreateMessagePayload[] = [];
      for (const rcp of recipients) {
        const nameKey = personNameLookupKey(rcp.name);
        const key = rcp.user_id ? `u:${rcp.user_id}` : rcp.person_id ? `p:${rcp.person_id}` : nameKey ? `n:${nameKey}` : '';
        if (!key || seen.has(key)) continue;
        seen.add(key);
        payloads.push({
          sender: { id: null, name: '系统通知', role: 'system' },
          recipient_id: rcp.user_id || null,
          recipient_person_id: rcp.person_id || null,
          recipient_name: rcp.name || null,
          subject,
          body,
        });
      }
      await this.createMessages(payloads);
    } catch (err) {
      this.logger.warn(
        `[任务合并通知] 发送失败 (source=${cleanText(source.task_id)}, target=${cleanText(target.task_id)}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async recomputeDashboard() {
    await this.recomputeDirectorDashboard();
    return { ok: true };
  }

  private directorDashboardWriteLock: Promise<unknown> = Promise.resolve();

  private recomputeDirectorDashboard(): Promise<void> {
    // 每次重算在轮到自己执行时才读取最新树，避免旧快照的慢重算最后覆盖新看板。
    const run = this.directorDashboardWriteLock.then(
      () => this.recomputeDirectorDashboardUnlocked(),
      () => this.recomputeDirectorDashboardUnlocked(),
    );
    this.directorDashboardWriteLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async recomputeDirectorDashboardUnlocked(): Promise<void> {
    const [mainCategories, people, users, productStore] = await Promise.all([
      this.readNormalizedTaskCategories(),
      this.getPeople(),
      this.listIdentityUsers(),
      this.readProductCategoryStore(),
    ]);

    // 汇总主库 + 所有产品库的分类树，让总监看板覆盖全部产品的任务（人员负载/阻塞/待指派/系统进度均跨产品）。
    const allTrees: JsonRecord[][] = [mainCategories.filter(isRecord)];
    for (const [pid, raw] of Object.entries(productStore)) {
      if (pid === RD_MAIN_PRODUCT_ID) continue;
      allTrees.push(ensurePocBomTaskCategories(asArray(raw)).filter(isRecord));
    }

    // Flatten all tasks from every product's category tree
    const allTasks: JsonRecord[] = [];
    function collectTasksInto(tasks: unknown[], output: JsonRecord[]) {
      for (const t of tasks) {
        if (!isRecord(t)) continue;
        output.push(t);
        if (Array.isArray(t.subtasks)) collectTasksInto(t.subtasks, output);
      }
    }
    for (const tree of allTrees) {
      for (const cat of tree) {
        if (!isRecord(cat)) continue;
        for (const child of asArray(cat.children)) {
          if (!isRecord(child)) continue;
          collectTasksInto(asArray(child.tasks), allTasks);
        }
      }
    }

    // Category progress — 按顶层系统 id 跨所有产品聚合（BOM 系统 id 在各产品间稳定一致，
    // 故按 id 合并即「按系统」把全部产品的任务汇总到一条）。
    const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];
    type ProgressEntry = { id: string; label: string; total: number; completed: number; in_progress: number; blocked: number };
    const progressMap = new Map<string, ProgressEntry>();
    const progressOrder: string[] = [];
    for (const tree of allTrees) {
      for (const cat of tree) {
        if (!isRecord(cat)) continue;
        const id = String(cat.id ?? '');
        const catTasks: JsonRecord[] = [];
        for (const child of asArray(cat.children)) {
          if (!isRecord(child)) continue;
          collectTasksInto(asArray(child.tasks), catTasks);
        }
        const visibleTasks = catTasks.filter((t) => !isArchivedTask(t));
        let entry = progressMap.get(id);
        if (!entry) {
          entry = { id, label: String(cat.label ?? ''), total: 0, completed: 0, in_progress: 0, blocked: 0 };
          progressMap.set(id, entry);
          progressOrder.push(id);
        }
        entry.total += visibleTasks.length;
        entry.completed += visibleTasks.filter((t) => t.status === 'completed').length;
        entry.in_progress += visibleTasks.filter((t) => t.status === 'in_progress').length;
        entry.blocked += visibleTasks.filter((t) => t.status === 'paused_blocked').length;
      }
    }
    const categoryProgress = progressOrder.map((id, idx) => ({
      ...progressMap.get(id)!,
      color: COLORS[idx % COLORS.length],
    }));

    // Person loads — merge rd.people with active live task counts only.
    const ownerTaskIds = new Map<string, string[]>();
    const ownerTaskTitles = new Map<string, string[]>();
    const ownerBlockedCounts = new Map<string, number>();
    const ownerDisplayNames = new Map<string, string>();
    const personTaskKey = (person: JsonRecord) => {
      const userId = cleanUserId(person.user_id);
      if (userId) return `u:${userId}`;
      return `n:${personNameLookupKey(person.name)}`;
    };
    const ownerTaskKey = (owner: string, userId?: unknown) => {
      const id = cleanUserId(userId);
      if (id) return `u:${id}`;
      return `n:${personNameLookupKey(owner)}`;
    };
    const addOwnerTask = (owner: string, task: JsonRecord, userId?: unknown) => {
      const name = owner.trim();
      if (isUnassignedOwner(name)) return;
      const key = ownerTaskKey(name, userId);
      if (!key || key === 'n:') return;
      if (!ownerTaskIds.has(key)) {
        ownerTaskIds.set(key, []);
        ownerTaskTitles.set(key, []);
      }
      if (!ownerDisplayNames.has(key)) ownerDisplayNames.set(key, name);
      ownerTaskIds.get(key)!.push(String(task.task_id ?? ''));
      ownerTaskTitles.get(key)!.push(String(task.title ?? ''));
      if (task.status === 'paused_blocked') {
        ownerBlockedCounts.set(key, (ownerBlockedCounts.get(key) ?? 0) + 1);
      }
    };
    const activeTasks = allTasks.filter((t) => !isArchivedTask(t) && !isCompletedTask(t));
    for (const t of activeTasks) {
      addOwnerTask(String(t.primary_owner ?? t.owner ?? ''), t, t.primary_owner_user_id ?? t.owner_user_id);
      for (const collaborator of asArray(t.collaborators)) {
        if (isRecord(collaborator)) {
          addOwnerTask(String(collaborator.name ?? ''), t, collaborator.user_id);
        } else if (typeof collaborator === 'string') {
          addOwnerTask(collaborator, t);
        }
      }
    }
    const knownPersonKeys = new Set<string>();
    const personLoads: JsonRecord[] = people.filter(isRecord).map((p) => {
      const key = personTaskKey(p);
      knownPersonKeys.add(key);
      const liveIds = ownerTaskIds.get(key) ?? [];
      const liveTitles = ownerTaskTitles.get(key) ?? [];
      return {
        ...p,
        task_count: liveIds.length,
        task_ids: liveIds,
        tasks: liveTitles,
        blocked_count: ownerBlockedCounts.get(key) ?? 0,
      };
    });
    for (const [key, liveIds] of ownerTaskIds.entries()) {
      if (knownPersonKeys.has(key)) continue;
      const userId = key.startsWith('u:') ? key.slice(2) : '';
      const user = userId ? users.find((item) => item.id === userId) : undefined;
      const liveTitles = ownerTaskTitles.get(key) ?? [];
      personLoads.push({
        id: userId ? `rd-user-${userId}` : `rd-unbound-${key.slice(2)}`,
        user_id: userId || null,
        name: user?.name ?? ownerDisplayNames.get(key) ?? '未绑定成员',
        email: user?.email ?? '',
        username: user?.username ?? null,
        department: user?.department ?? '',
        position: '研发成员',
        status: user?.status === 'DISABLED' ? 'resigned' : 'active',
        user_status: user?.status ?? null,
        task_count: liveIds.length,
        max_tasks: 8,
        on_leave: false,
        task_ids: liveIds,
        tasks: liveTitles,
        blocked_count: ownerBlockedCounts.get(key) ?? 0,
      });
    }

    // Blocked tasks
    const blockedTasks = allTasks
      .filter((t) => !isArchivedTask(t) && t.status === 'paused_blocked')
      .map((t) => ({
        task_id: String(t.task_id ?? ''),
        title: String(t.title ?? ''),
        owner: String(t.primary_owner ?? t.owner ?? ''),
        reason: String(t.blocked_reason ?? '已阻塞'),
        days_blocked: typeof t.blocked_days === 'number' ? t.blocked_days : 0,
      }));

    // Pending assign tasks
    const pendingAssign = allTasks
      .filter((t) => !isArchivedTask(t) && (t.status === 'pending_assign' || t.status === 'draft'))
      .map((t) => ({
        task_id: String(t.task_id ?? ''),
        title: String(t.title ?? ''),
        category_path: String(t.category_path ?? ''),
        ai_priority: normalizePriority(t.ai_priority ?? t.final_priority),
      }));

    await this.writeValue('rd.directorDashboard', {
      categoryProgress,
      personLoads,
      blockedTasks,
      pendingAssign,
    });
  }

  // ── Task progress notes (text + attachments) ───────────────────────────

  /** Resolve the immutable OSS object key from new attachments or historical signed URLs. */
  private attachmentObjectKey(attachmentOrUrl: JsonRecord | string): string | null {
    if (isRecord(attachmentOrUrl)) {
      const storedKey = cleanText(attachmentOrUrl.object_key);
      if (storedKey) return storedKey;
      return this.attachmentObjectKey(cleanText(attachmentOrUrl.oss_url));
    }
    if (!attachmentOrUrl) return null;
    try {
      return decodeURIComponent(new URL(attachmentOrUrl).pathname).replace(/^\/+/, '') || null;
    } catch {
      return null;
    }
  }

  /** Prefer a stable CDN capability URL; fall back to the same-origin preview proxy. */
  private buildAttachmentPreviewUrl(attachmentOrUrl: JsonRecord | string): string | null {
    const objectKey = this.attachmentObjectKey(attachmentOrUrl);
    if (!objectKey) return null;
    const cdnUrl = this.ossService.getCdnReadUrl(objectKey, undefined, 'inline');
    if (cdnUrl) return cdnUrl;
    const { exp, sig } = this.ossService.signPreviewToken(objectKey, 24 * 3600);
    const params = new URLSearchParams({ key: objectKey, exp: String(exp), sig });
    return `/api/research-development/oss-preview?${params.toString()}`;
  }

  /** Force a download response while keeping the object bytes on the CDN path. */
  private buildAttachmentDownloadUrl(attachmentOrUrl: JsonRecord | string): string | null {
    const objectKey = this.attachmentObjectKey(attachmentOrUrl);
    if (!objectKey) return null;
    const rawName = isRecord(attachmentOrUrl) ? cleanText(attachmentOrUrl.name) : '';
    const safeName = (rawName || objectKey.split('/').pop() || 'attachment')
      .replace(/["\r\n]/g, '_')
      .slice(0, 180);
    const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`;
    return this.ossService.getCdnReadUrl(objectKey, undefined, disposition)
      ?? this.buildAttachmentPreviewUrl(attachmentOrUrl);
  }

  /** 缩略图签名 URL 记忆化（24h 复用同一 URL，保证浏览器缓存可命中；签名 TTL 48h 留余量）。 */
  private readonly attachmentThumbCache = new Map<string, { url: string; freshUntil: number }>();

  /** Generate a size-appropriate WebP thumbnail instead of loading the original on list cards. */
  private buildAttachmentThumbUrl(
    attachmentOrUrl: JsonRecord | string,
    mime: unknown,
    width = 320,
  ): string | null {
    if (typeof mime !== 'string' || !mime.startsWith('image/')) return null;
    const objectKey = this.attachmentObjectKey(attachmentOrUrl);
    if (!objectKey) return null;
    const safeWidth = Math.max(120, Math.min(1280, Math.round(width)));
    const cacheKey = `${objectKey}|${safeWidth}`;
    const cached = this.attachmentThumbCache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.freshUntil > now) return cached.url;
    const process = `image/resize,m_lfit,w_${safeWidth}/format,webp/quality,q_72`;
    const url = this.ossService.getCdnReadUrl(objectKey, process, 'inline')
      ?? this.ossService.getSignedUrl(objectKey, 48 * 3600, process);
    if (!url) return null;
    // 上限防泄漏：长期运行进程只保留活跃工作集，超限整体清空（重建成本仅为一次签名）
    if (this.attachmentThumbCache.size >= 5000) this.attachmentThumbCache.clear();
    this.attachmentThumbCache.set(cacheKey, { url, freshUntil: now + 24 * 3600 * 1000 });
    return url;
  }

  private decorateAttachmentForDisplay(att: JsonRecord, thumbnailWidth = 320): JsonRecord {
    const previewUrl = this.buildAttachmentPreviewUrl(att);
    const downloadUrl = this.buildAttachmentDownloadUrl(att);
    const thumbUrl = this.buildAttachmentThumbUrl(att, att.mime, thumbnailWidth);
    return {
      ...att,
      ...(previewUrl ? { preview_url: previewUrl } : {}),
      ...(downloadUrl ? { download_url: downloadUrl } : {}),
      ...(thumbUrl ? { thumb_url: thumbUrl } : {}),
    };
  }

  /** Decorate progress-note attachments with `preview_url` (same-origin inline proxy) so the client can iframe-preview OSS files. */
  private decorateNotesWithPreview(notes: JsonRecord[]): JsonRecord[] {
    if (!Array.isArray(notes)) return notes;
    return notes.map((note) => {
      const attachments = isRecord(note) ? note.attachments : null;
      if (!Array.isArray(attachments)) return note;
      const decorated = attachments.map((att) => {
        if (!isRecord(att)) return att;
        return this.decorateAttachmentForDisplay(att);
      });
      return { ...note, attachments: decorated };
    });
  }

  private visibleTaskProgressNotes(
    task: JsonRecord | null | undefined,
    rawNotes: JsonRecord[],
    viewer?: TaskProgressNoteViewer,
  ): JsonRecord[] {
    let visibleNotes = rawNotes;
    if (!viewer?.hasFullAccess && !viewer?.canReadAll) {
      if (!task || !isTaskParticipant(task, viewer?.userId, viewer?.userName)) {
        visibleNotes = viewer?.userId
          ? rawNotes.filter((note) => isRecord(note.actor) && note.actor.id === viewer.userId)
          : [];
      }
    }

    const decorated = this.decorateNotesWithPreview(visibleNotes);
    if (!task || !this.taskAttachmentsMutable(task)) return decorated;
    return decorated.map((decoratedNote, index) => ({
      ...decoratedNote,
      can_edit_attachments: this.canUserMutateNoteAttachments(task, visibleNotes[index] as JsonRecord, {
        userId: viewer?.userId,
        userName: viewer?.userName,
        canEditAny: viewer?.canEditAttachments,
      }),
    }));
  }

  async getTaskProgressNotes(taskId: string, viewer?: TaskProgressNoteViewer) {
    await this.refreshProductionMirrorsIfNeeded();
    const map = await this.getProgressNoteMap();
    const notes = map[taskId] ?? [];
    // 任务取一次：既用于参与人可见性判断，也用于附件可编辑标记（锁定/主责人判定）
    const task = await this.findTaskAcrossStores(taskId);
    // 附件可编辑标记由服务端统一计算随留痕下发：前端只认此标记渲染管理入口，
    // 与写接口锁内的 canUserMutateNoteAttachments 同一实现，杜绝前后端口径漂移。
    return this.visibleTaskProgressNotes(task, notes, viewer);
  }

  /**
   * Return one permission-filtered, chronological progress feed for the complete
   * relation tree containing taskId. Notes remain stored under their source task;
   * the source metadata below is view-only and makes detach operations lossless.
   */
  async getTaskProgressNoteGroup(taskId: string, viewer?: TaskProgressNoteViewer) {
    await this.refreshProductionMirrorsIfNeeded();
    const [noteMap, categories] = await Promise.all([
      this.getProgressNoteMap(),
      this.readMergedTaskCategories(),
    ]);
    const relation = buildRdTaskProgressRelationGroup(categories, taskId);
    if (!relation) throw new NotFoundException('任务不存在');

    const tasks = relation.tasks.map(({ task, taskId: sourceTaskId, title, path, joinedAt }) => {
      const visibleNotes = this.visibleTaskProgressNotes(task, noteMap[sourceTaskId] ?? [], viewer);
      const canPost = this.taskAttachmentsMutable(task) && Boolean(
        viewer?.canEditAttachments || isTaskParticipant(task, viewer?.userId, viewer?.userName),
      );
      return {
        task_id: sourceTaskId,
        title,
        path,
        joined_at: joinedAt,
        can_post: canPost,
        note_count: visibleNotes.length,
        notes: visibleNotes.map((note): JsonRecord => ({
          ...note,
          source_task: {
            task_id: sourceTaskId,
            title,
            path,
            joined_at: joinedAt,
            is_before_merge: Boolean(
              joinedAt
              && typeof note.created_at === 'string'
              && note.created_at.localeCompare(joinedAt) < 0
            ),
          },
        })),
      };
    });

    const notes = tasks
      .flatMap((task) => task.notes)
      .sort((left, right) => {
        const timeOrder = cleanText(right.created_at).localeCompare(cleanText(left.created_at));
        return timeOrder || cleanText(right.id).localeCompare(cleanText(left.id));
      });

    return {
      root_task_id: relation.rootTaskId,
      current_task_id: relation.currentTaskId,
      tasks: tasks.map(({ notes: _notes, ...task }) => task),
      notes,
    };
  }

  /**
   * Card-only attachment summaries for many tasks in one request.
   * This intentionally excludes note text, extracted_text and embedded data URLs: the cockpit
   * only needs five recent attachment tiles, while full notes remain lazy-loaded on detail open.
   */
  async getTaskAttachmentPreviews(
    rawTaskIds: string[],
    viewer?: { userId?: string; hasFullAccess?: boolean; canReadAll?: boolean; userName?: string },
  ) {
    await this.refreshProductionMirrorsIfNeeded();
    const taskIds = Array.from(new Set(rawTaskIds.map((id) => cleanText(id)).filter(Boolean))).slice(0, 60);
    if (taskIds.length === 0) return {};
    const cacheKey = this.taskResourceCacheKey('attachment-previews', taskIds, viewer);
    const cached = this.readTaskResourceCache<Record<string, { attachment_count: number; attachments: JsonRecord[] }>>(
      cacheKey,
    );
    if (cached) return cached;
    const [noteMap, categories] = await Promise.all([
      this.getProgressNoteMap(),
      this.readMergedTaskCategories(),
    ]);
    const taskById = new Map(
      this.collectAllCategoryTasks(categories).map((task) => [String(task.task_id ?? ''), task] as const),
    );
    const output: Record<string, { attachment_count: number; attachments: JsonRecord[] }> = {};

    for (const taskId of taskIds) {
      const task = taskById.get(taskId);
      const allNotes = noteMap[taskId] ?? [];
      let visibleNotes = allNotes;
      if (!viewer?.hasFullAccess && !viewer?.canReadAll) {
        if (!task || !isTaskParticipant(task, viewer?.userId, viewer?.userName)) {
          visibleNotes = viewer?.userId
            ? allNotes.filter((note) => isRecord(note.actor) && note.actor.id === viewer.userId)
            : [];
        }
      }
      const orderedNotes = visibleNotes
        .slice()
        .sort((a, b) => cleanText(b.created_at).localeCompare(cleanText(a.created_at)));
      const allAttachments = orderedNotes.flatMap((note) =>
        Array.isArray(note.attachments) ? note.attachments.filter(isRecord) : [],
      );
      // Preserve the old card behavior: show recent images first, then fill remaining slots with
      // files. Simply slicing the first five could hide every image behind a note's document batch.
      const previewAttachments = [
        ...allAttachments.filter((attachment) => cleanText(attachment.mime).startsWith('image/')),
        ...allAttachments.filter((attachment) => !cleanText(attachment.mime).startsWith('image/')),
      ].slice(0, 5);
      const attachments = previewAttachments.map((attachment) => {
        const decorated = this.decorateAttachmentForDisplay(attachment, 240);
        return {
          id: String(decorated.id ?? ''),
          name: String(decorated.name ?? ''),
          mime: String(decorated.mime ?? 'application/octet-stream'),
          size: typeof decorated.size === 'number' ? decorated.size : 0,
          ...(typeof decorated.preview_url === 'string' ? { preview_url: decorated.preview_url } : {}),
          ...(typeof decorated.download_url === 'string' ? { download_url: decorated.download_url } : {}),
          ...(typeof decorated.thumb_url === 'string' ? { thumb_url: decorated.thumb_url } : {}),
        };
      });
      output[taskId] = { attachment_count: allAttachments.length, attachments };
    }
    return this.writeTaskResourceCache(cacheKey, output);
  }

  /**
   * Full attachment metadata for one task, loaded only after an explicit user action.
   * The cockpit's batch endpoint intentionally returns five previews; this endpoint preserves the
   * complete business view without sending note bodies, extraction text, or embedded fallback data
   * unless the embedded data is the attachment's only usable source.
   */
  async getTaskAttachments(
    taskId: string,
    viewer?: { userId?: string; hasFullAccess?: boolean; canReadAll?: boolean; userName?: string },
  ) {
    const cacheKey = this.taskResourceCacheKey('task-attachments', [taskId], viewer);
    const cached = this.readTaskResourceCache<{ attachment_count: number; attachments: JsonRecord[] }>(cacheKey);
    if (cached) return cached;
    const notes = await this.getTaskProgressNotes(taskId, viewer);
    const orderedNotes = notes
      .slice()
      .sort((a, b) => cleanText(b.created_at).localeCompare(cleanText(a.created_at)));
    const allAttachments = orderedNotes.flatMap((note) =>
      Array.isArray(note.attachments) ? note.attachments.filter(isRecord) : [],
    );
    const attachments = allAttachments.map((attachment) => ({
      id: String(attachment.id ?? ''),
      name: String(attachment.name ?? ''),
      mime: String(attachment.mime ?? 'application/octet-stream'),
      size: typeof attachment.size === 'number' ? attachment.size : 0,
      ...(typeof attachment.object_key === 'string' ? { object_key: attachment.object_key } : {}),
      ...(typeof attachment.preview_url === 'string' ? { preview_url: attachment.preview_url } : {}),
      ...(typeof attachment.download_url === 'string' ? { download_url: attachment.download_url } : {}),
      ...(typeof attachment.thumb_url === 'string' ? { thumb_url: attachment.thumb_url } : {}),
      ...(typeof attachment.oss_url === 'string' ? { oss_url: attachment.oss_url } : {}),
      ...(typeof attachment.data_url === 'string'
        && typeof attachment.preview_url !== 'string'
        && typeof attachment.object_key !== 'string'
        ? { data_url: attachment.data_url }
        : {}),
    }));
    return this.writeTaskResourceCache(cacheKey, { attachment_count: attachments.length, attachments });
  }

  async listAllTaskProgressNotes(viewer?: { userId?: string; hasFullAccess?: boolean; canReadAll?: boolean }) {
    await this.refreshProductionMirrorsIfNeeded();
    const map = await this.getProgressNoteMap();
    // 管理权限或只读跨部门查看权（rd-task:view-all）均可看到全部留痕与附件。
    if (viewer?.hasFullAccess || viewer?.canReadAll) {
      const out: Record<string, JsonRecord[]> = {};
      for (const [taskId, notes] of Object.entries(map)) out[taskId] = this.decorateNotesWithPreview(notes);
      return out;
    }
    const userId = viewer?.userId;
    if (!userId) return {};
    const filtered: Record<string, JsonRecord[]> = {};
    for (const [taskId, notes] of Object.entries(map)) {
      const own = notes.filter((note) => {
        const actor = isRecord(note.actor) ? note.actor : null;
        return Boolean(actor && actor.id === userId);
      });
      if (own.length > 0) filtered[taskId] = this.decorateNotesWithPreview(own);
    }
    return filtered;
  }

  /**
   * Sign browser-to-OSS uploads for progress-note attachments. Bytes no longer pass through
   * Nest/multer, so concurrent large attachments do not consume API memory or upstream bandwidth.
   */
  async presignTaskProgressNoteUploads(
    files: Array<{ originalname?: string; mimetype?: string; size?: number }>,
    requesterUserId?: string,
  ) {
    const userId = cleanUserId(requesterUserId);
    if (!userId) throw new ForbiddenException('登录状态无效，无法上传附件');
    const normalized = (Array.isArray(files) ? files : []).map((file) => ({
      originalname: cleanText(file.originalname),
      mimetype: cleanText(file.mimetype) || 'application/octet-stream',
      size: typeof file.size === 'number' ? Math.max(0, Math.round(file.size)) : 0,
    }));
    if (normalized.length === 0) throw new BadRequestException('至少需要提供一个附件');
    if (normalized.length > PROGRESS_NOTE_MAX_FILES) {
      throw new BadRequestException(`附件最多 ${PROGRESS_NOTE_MAX_FILES} 个`);
    }
    this.assertAttachmentFilesValid(normalized);
    const totalSize = normalized.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > PROGRESS_NOTE_MAX_TOTAL_BYTES) {
      throw new BadRequestException('附件总大小超过 50MB 限制');
    }
    if (!this.ossService.isEnabled) return { enabled: false, files: [] };

    const businessType = this.progressNoteUploadBusinessType(userId);
    return {
      enabled: true,
      files: normalized.map((file) => {
        const objectKey = this.ossService.buildObjectKey(businessType, file.originalname);
        const cleanup = this.ossService.signCleanupToken(objectKey);
        return {
          objectKey,
          putUrl: this.ossService.generatePutSignedUrl(objectKey, file.mimetype, 3600),
          contentType: file.mimetype,
          cacheControl: IMMUTABLE_RESOURCE_CACHE_CONTROL,
          cleanupExp: cleanup.exp,
          cleanupSig: cleanup.sig,
        };
      }),
    };
  }

  /**
   * Delete direct-uploaded objects that never became attachments. Referenced keys are always
   * retained, which makes cleanup safe when a client times out after the server already committed.
   */
  async cleanupUnregisteredProgressNoteUploads(
    files: DirectProgressNoteUpload[],
    requesterUserId?: string,
  ) {
    const userId = cleanUserId(requesterUserId);
    if (!userId) throw new ForbiddenException('登录状态无效，无法清理附件');
    const businessType = this.progressNoteUploadBusinessType(userId);
    const candidates = (Array.isArray(files) ? files : []).slice(0, PROGRESS_NOTE_MAX_FILES);
    const noteMap = await this.getProgressNoteMap();
    const referenced = new Set<string>();
    for (const notes of Object.values(noteMap)) {
      for (const note of notes) {
        for (const attachment of asArray(note.attachments)) {
          if (isRecord(attachment) && typeof attachment.object_key === 'string') {
            referenced.add(attachment.object_key);
          }
        }
      }
    }

    let deleted = 0;
    let retained = 0;
    for (const file of candidates) {
      const owned = this.ossService.isKeyUnderBusinessType(file.objectKey, businessType);
      const authorized = this.ossService.verifyCleanupToken(
        file.objectKey,
        Number(file.cleanupExp),
        String(file.cleanupSig ?? ''),
      );
      if (!owned || !authorized || referenced.has(file.objectKey)) {
        retained += 1;
        continue;
      }
      await this.ossService.deleteObject(file.objectKey);
      deleted += 1;
    }
    return { success: true, deleted, retained };
  }

  async createTaskProgressNote(payload: {
    taskId: string;
    text: string;
    progress?: number;
    actor?: { id?: string; name?: string; role?: string };
    files: Array<{ originalname: string; mimetype?: string; size?: number; buffer: Buffer }>;
    uploadedFiles?: DirectProgressNoteUpload[];
    requesterUserId?: string;
    requesterName?: string;
    canEditAny?: boolean;
    /** 可选：关联到任务的哪个工作项（任务内部轻量拆分，不校验存在性——工作项可被改名/删除，留痕保留原关联） */
    workItemId?: string;
    /** 可选：评论中 @ 的成员（结构化存储，不靠正文正则反解析；创建后给每人发站内消息） */
    mentions?: Array<{ user_id?: string; name?: string }>;
  }) {
    const taskId = (payload.taskId ?? '').trim();
    if (!taskId) throw new BadRequestException('taskId 不能为空');
    const task = await this.assertTaskIdWritable(taskId);

    // 越权防护：进展留痕会带附件入知识库并参与 AI 评分，必须防止向他人任务注入内容。
    // 非管理员（仅 page:rd-my-workspace）只能为"自己负责"的任务（主责人或协作人）添加进展；
    // 管理员级权限(canEditAny)跳过，行为不变。用可信的 req.user 身份校验，不信任前端传入的 actor.name。
    if (!payload.canEditAny) {
      if (!isTaskParticipant(task, payload.requesterUserId, payload.requesterName)) {
        throw new ForbiddenException('只能为自己负责的任务添加进展');
      }
    }

    const text = (payload.text ?? '').trim();
    const files = Array.isArray(payload.files) ? payload.files : [];
    const uploadedFiles = Array.isArray(payload.uploadedFiles) ? payload.uploadedFiles : [];

    if (!text && files.length + uploadedFiles.length === 0) {
      throw new BadRequestException('进展说明或附件至少需要提供一项');
    }

    if (files.length + uploadedFiles.length > PROGRESS_NOTE_MAX_FILES) {
      throw new BadRequestException(`附件最多 ${PROGRESS_NOTE_MAX_FILES} 个`);
    }
    this.assertAttachmentFilesValid([...files, ...uploadedFiles]);
    const totalSize = [...files, ...uploadedFiles]
      .reduce((sum, file) => sum + (file.size ?? ('buffer' in file ? file.buffer.length : 0)), 0);
    if (totalSize > PROGRESS_NOTE_MAX_TOTAL_BYTES) {
      throw new BadRequestException('附件总大小超过 50MB 限制');
    }

    const attachmentsWithBuffers = [
      ...(await this.buildNoteAttachments(files)),
      ...(await this.buildRegisteredNoteAttachments(uploadedFiles, payload.requesterUserId)),
    ];
    const attachments = attachmentsWithBuffers.map((a) => a.attachment);

    // @ 提及：结构化清洗（至少要有 user_id 或 name），封顶 20 人防滥用
    const mentions = (Array.isArray(payload.mentions) ? payload.mentions : [])
      .map((m) => ({
        user_id: cleanUserId(m?.user_id) || null,
        name: cleanText(m?.name) || null,
      }))
      .filter((m) => m.user_id || m.name)
      .slice(0, 20);

    const note = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      task_id: taskId,
      text,
      progress: typeof payload.progress === 'number' ? Math.max(0, Math.min(100, Math.round(payload.progress))) : undefined,
      ...(payload.workItemId ? { work_item_id: payload.workItemId } : {}),
      ...(mentions.length > 0 ? { mentions } : {}),
      attachments,
      actor: {
        id: payload.actor?.id ?? null,
        name: payload.actor?.name ?? '我',
        role: payload.actor?.role ?? '研发成员',
      },
      created_at: new Date().toISOString(),
    };

    // 锁内重读→插入→写回，避免与异步抽取回写/并发留痕创建发生 lost-update。
    await this.withProgressNoteLock(async () => {
      const map = await this.getProgressNoteMap();
      const existing = Array.isArray(map[taskId]) ? map[taskId] : [];
      map[taskId] = [note, ...existing].slice(0, 100);
      await this.writeValue('rd.taskProgressNotes', map);
    });
    await this.incrementTaskAttachmentCount(taskId, attachments.length);
    // 留痕入向量索引（fire-and-forget）：AI 问答可语义检索到进展内容
    void this.syncProgressNoteToRag(taskId, note as unknown as JsonRecord);

    // @ 提及通知（fire-and-forget）：给每个被 @ 的人发站内消息——
    // 顶栏铃铛 / 消息中心 / 工作台通知读同一张 RdMessage 表，一次投递多处到位
    if (mentions.length > 0) {
      void this.notifyNoteMentions({
        taskId,
        noteText: text,
        mentions,
        actorName: payload.actor?.name ?? '同事',
        actorId: cleanUserId(payload.actor?.id) || null,
      }).catch(() => {});
    }

    // L1+L2+L3 异步抽取附件文本：图片走 OCR/vision，文档走 ExtractDocBasic/doc-turbo。
    // fire-and-forget，失败不影响留痕主流程。结果会回写到 rd.taskProgressNotes 对应附件的 extracted_text 字段。
    if (attachmentsWithBuffers.length > 0) {
      void this.backfillAttachmentExtractedTexts(taskId, note.id, attachmentsWithBuffers);
    }

    // Auto-ingest attachments into the knowledge base
    if (attachments.length > 0) {
      // Lookup task title and category path (best-effort, don't block the response)
      try {
        const categories = await this.readNormalizedTaskCategories();
        let taskTitle: string | undefined;
        let categoryPath: string | undefined;
        outer: for (const cat of categories) {
          for (const sub of (isRecord(cat) ? asArray(cat.children) : [])) {
            for (const task of (isRecord(sub) ? asArray(sub.tasks) : [])) {
              if (String((task as JsonRecord).task_id) === taskId) {
                taskTitle = String((task as JsonRecord).title ?? '');
                categoryPath = String((task as JsonRecord).category_path ?? (isRecord(cat) ? cat.label : ''));
                break outer;
              }
            }
          }
        }
        void this.ingestProgressNoteAttachments({
          taskId,
          taskTitle,
          categoryPath,
          attachments,
          actorId: payload.actor?.id,
          actorName: payload.actor?.name,
        });
      } catch {
        // Best-effort: never let KB ingestion fail the main request
      }
    }

    // 进展留痕的审计：与留痕本体同路径写入，绕过界面直调本接口同样留下记录
    await this.recordServerAudit({
      action: 'task.progress_updated',
      resource: { type: 'task', id: taskId },
      actor: payload.actor ?? { id: payload.requesterUserId, name: payload.requesterName },
      comment: cleanText(note.text) || '提交进展留痕',
      ...(typeof payload.progress === 'number'
        ? { changes: [{ field: 'progress', before: '', after: String(payload.progress) }] }
        : {}),
      metadata: {
        note_id: String(note.id ?? ''),
        attachment_count: asArray(note.attachments).length,
      },
    });

    return this.decorateNotesWithPreview([note])[0];
  }

  // ── 任务协作对话：主会话 + 进度/消息原位线程 ───────────────────────────────

  private normalizeDiscussionAnchor(
    rawType?: string,
    rawId?: string,
  ): { anchorType: DiscussionAnchorType; anchorId: string | null } {
    const anchorType: DiscussionAnchorType =
      rawType === 'progress_note' || rawType === 'message' ? rawType : 'task';
    const anchorId = anchorType === 'task' ? null : cleanText(rawId);
    if (anchorType !== 'task' && !anchorId) {
      throw new BadRequestException('讨论锚点不能为空');
    }
    return { anchorType, anchorId };
  }

  /** 线程 id 由工作区 + 任务 + 锚点稳定派生，GET 空线程不需要先写库，首次发送时再 upsert。 */
  private discussionThreadId(taskId: string, anchorType: DiscussionAnchorType, anchorId: string | null): string {
    const digest = createHash('sha256')
      .update(`${currentRdWorkspace()}\u0000${taskId}\u0000${anchorType}\u0000${anchorId ?? ''}`)
      .digest('hex')
      .slice(0, 40);
    return `rd-discussion-${digest}`;
  }

  private async requireDiscussionAccess(
    taskId: string,
    viewer: DiscussionViewer,
    threadId: string,
  ): Promise<DiscussionAccess> {
    const cleanTaskId = cleanText(taskId);
    if (!cleanTaskId) throw new BadRequestException('taskId 不能为空');
    const task = await this.findTaskAcrossStores(cleanTaskId);
    if (!task) throw new NotFoundException('任务不存在');
    if (viewer.canAccessAny || isTaskParticipant(task, viewer.userId, viewer.userName)) {
      return { task, scope: 'task', invitation: null };
    }
    const userId = cleanUserId(viewer.userId);
    const invited = userId
      ? await this.prisma.rdTaskDiscussionParticipant.findFirst({
          where: {
            threadId,
            userId,
            revokedAt: null,
            thread: { workspace: currentRdWorkspace(), taskId: cleanTaskId },
          },
          select: { invitedById: true, invitedByName: true, invitedAt: true },
        })
      : null;
    if (!invited) {
      throw new ForbiddenException('你没有参与这条讨论的权限');
    }
    return {
      task,
      scope: 'thread_invitee',
      invitation: {
        invitedById: invited.invitedById,
        invitedByName: invited.invitedByName,
        invitedAt: invited.invitedAt,
      },
    };
  }

  private async assertDiscussionAnchorExists(
    taskId: string,
    anchorType: DiscussionAnchorType,
    anchorId: string | null,
  ): Promise<void> {
    if (anchorType === 'task') return;
    if (anchorType === 'progress_note') {
      const map = await this.getProgressNoteMap();
      if (!(map[taskId] ?? []).some((note) => String(note.id ?? '') === anchorId)) {
        throw new NotFoundException('进度记录不存在');
      }
      return;
    }
    const anchor = await this.prisma.rdTaskDiscussionMessage.findUnique({
      where: { id: anchorId ?? '' },
      include: { thread: { select: { workspace: true, taskId: true } } },
    });
    if (!anchor || anchor.thread.workspace !== currentRdWorkspace() || anchor.thread.taskId !== taskId) {
      throw new NotFoundException('被回复的消息不存在');
    }
  }

  private async getDiscussionAnchorPreview(
    taskId: string,
    anchorType: DiscussionAnchorType,
    anchorId: string | null,
  ) {
    if (anchorType === 'task') return null;
    if (anchorType === 'progress_note') {
      const map = await this.getProgressNoteMap();
      const note = (map[taskId] ?? []).find((item) => String(item.id ?? '') === anchorId);
      if (!note) return null;
      const decorated = this.decorateNotesWithPreview([note])[0];
      const actor = isRecord(note.actor) ? note.actor : null;
      return {
        type: anchorType,
        id: anchorId,
        author_id: cleanUserId(actor?.id) || null,
        author_name: cleanText(actor?.name) || '同事',
        body: cleanText(note.text),
        created_at: cleanText(note.created_at),
        attachments: asArray(decorated.attachments).filter(isRecord),
      };
    }
    const message = await this.prisma.rdTaskDiscussionMessage.findUnique({
      where: { id: anchorId ?? '' },
      select: {
        id: true,
        authorId: true,
        authorName: true,
        body: true,
        attachments: true,
        createdAt: true,
      },
    });
    if (!message) return null;
    const decorated = this.decorateNotesWithPreview([
      { attachments: Array.isArray(message.attachments) ? message.attachments.filter(isRecord) : [] },
    ])[0];
    return {
      type: anchorType,
      id: message.id,
      author_id: message.authorId,
      author_name: message.authorName,
      body: message.body,
      created_at: message.createdAt.toISOString(),
      attachments: asArray(decorated.attachments).filter(isRecord),
    };
  }

  private async resolveMentionTargetUserIds(
    mentions: Array<{ user_id: string | null; name: string | null }>,
    actorId: string | null,
  ): Promise<string[]> {
    const people = (await this.readArray('rd.people')).filter(isRecord);
    const targets = new Set<string>();
    for (const mention of mentions) {
      let userId = cleanUserId(mention.user_id);
      if (!userId) {
        const nameKey = personNameLookupKey(mention.name);
        if (!nameKey) continue;
        const matched = people
          .filter((person) => personNameLookupKey(person.name) === nameKey)
          .map((person) => cleanUserId(person.user_id))
          .filter((value): value is string => Boolean(value));
        const unique = Array.from(new Set(matched));
        if (unique.length === 1) userId = unique[0];
      }
      if (!userId || (actorId && userId === actorId)) continue;
      targets.add(userId);
    }
    return Array.from(targets);
  }

  private serializeDiscussionMessage(message: {
    id: string;
    authorId: string | null;
    authorName: string;
    authorRole: string | null;
    body: string;
    attachments: unknown;
    mentions: unknown;
    replyToId: string | null;
    createdAt: Date;
    editedAt: Date | null;
    replyTo?: {
      id: string;
      authorName: string;
      body: string;
    } | null;
  }) {
    const rawAttachments = Array.isArray(message.attachments)
      ? message.attachments.filter(isRecord)
      : [];
    const decorated = this.decorateNotesWithPreview([{ attachments: rawAttachments }])[0];
    const rawMentions = Array.isArray(message.mentions) ? message.mentions.filter(isRecord) : [];
    return {
      id: message.id,
      author_id: message.authorId,
      author_name: message.authorName,
      author_role: message.authorRole,
      body: message.body,
      attachments: asArray(decorated.attachments).filter(isRecord),
      mentions: rawMentions.map((mention) => ({
        user_id: cleanUserId(mention.user_id) || null,
        name: cleanText(mention.name) || null,
      })),
      reply_to_id: message.replyToId,
      reply_to: message.replyTo
        ? {
            id: message.replyTo.id,
            author_name: message.replyTo.authorName,
            body: message.replyTo.body,
          }
        : null,
      created_at: message.createdAt.toISOString(),
      edited_at: message.editedAt?.toISOString() ?? null,
    };
  }

  async getTaskDiscussion(
    taskId: string,
    query: { anchorType?: string; anchorId?: string; cursor?: string; limit?: string },
    viewer: DiscussionViewer,
  ): Promise<TaskDiscussionResponse> {
    const cleanTaskId = cleanText(taskId);
    if (await this.isProductionMirrorTaskId(cleanTaskId)) {
      const sourceDiscussion = await runInRdWorkspace('rd', () => this.getTaskDiscussion(
        cleanTaskId,
        query,
        { ...viewer, canAccessAny: true, canPost: false },
      ));
      return { ...sourceDiscussion, can_post: false };
    }
    const { anchorType, anchorId } = this.normalizeDiscussionAnchor(query.anchorType, query.anchorId);
    const threadId = this.discussionThreadId(cleanTaskId, anchorType, anchorId);
    const access = await this.requireDiscussionAccess(cleanTaskId, viewer, threadId);
    await this.assertDiscussionAnchorExists(cleanTaskId, anchorType, anchorId);
    const workspace = currentRdWorkspace();
    const userId = cleanUserId(viewer.userId);
    const requestedLimit = Number.parseInt(cleanText(query.limit), 10);
    const pageLimit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(20, requestedLimit)) : 100;
    const cursor = cleanText(query.cursor);
    if (cursor) {
      const validCursor = await this.prisma.rdTaskDiscussionMessage.findFirst({
        where: { id: cursor, threadId },
        select: { id: true },
      });
      if (!validCursor) throw new BadRequestException('消息分页游标无效');
    }

    type DiscussionSummaryRow = {
      thread_id: string;
      anchor_type: string;
      anchor_id: string | null;
      message_count: bigint;
      unread_count: bigint;
      last_message_at: Date | null;
    };
    const [messagePage, summaryRows] = await Promise.all([
      this.prisma.rdTaskDiscussionMessage.findMany({
        where: { threadId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: pageLimit + 1,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
          replyTo: { select: { id: true, authorName: true, body: true } },
        },
      }),
      this.prisma.$queryRaw<DiscussionSummaryRow[]>`
        SELECT
          t."id" AS "thread_id",
          t."anchorType" AS "anchor_type",
          t."anchorId" AS "anchor_id",
          COUNT(m."id")::bigint AS "message_count",
          CASE
            WHEN ${userId} = '' THEN 0::bigint
            ELSE COUNT(m."id") FILTER (
              WHERE m."authorId" IS DISTINCT FROM ${userId}
                AND (r."lastReadAt" IS NULL OR m."createdAt" > r."lastReadAt")
            )::bigint
          END AS "unread_count",
          MAX(m."createdAt") AS "last_message_at"
        FROM "RdTaskDiscussionThread" t
        LEFT JOIN "RdTaskDiscussionMessage" m ON m."threadId" = t."id"
        LEFT JOIN "RdTaskDiscussionRead" r
          ON r."threadId" = t."id" AND r."userId" = ${userId}
        WHERE t."workspace" = ${workspace} AND t."taskId" = ${cleanTaskId}
        GROUP BY t."id", t."anchorType", t."anchorId", r."lastReadAt"
        ORDER BY MAX(m."createdAt") DESC NULLS LAST
      `,
    ]);
    const hasMore = messagePage.length > pageLimit;
    const pageMessages = (hasMore ? messagePage.slice(0, pageLimit) : messagePage).reverse();
    const threadSummaries = summaryRows
      .filter((item) => access.scope === 'task' || item.thread_id === threadId)
      .map((item) => ({
        thread_id: item.thread_id,
        anchor_type: item.anchor_type as DiscussionAnchorType,
        anchor_id: item.anchor_id,
        message_count: Number(item.message_count),
        unread_count: Number(item.unread_count),
        last_message_at: item.last_message_at?.toISOString() ?? null,
      }));
    const currentSummary = threadSummaries.find((item) => item.thread_id === threadId);
    const anchorPreview = await this.getDiscussionAnchorPreview(cleanTaskId, anchorType, anchorId);

    return {
      can_post: Boolean(viewer.canPost || access.scope === 'thread_invitee'),
      access_scope: access.scope,
      task_title: cleanText(access.task.title) || cleanTaskId,
      invitation: access.invitation
        ? {
            invited_by_id: access.invitation.invitedById,
            invited_by_name: access.invitation.invitedByName,
            invited_at: access.invitation.invitedAt.toISOString(),
          }
        : null,
      anchor_preview: anchorPreview,
      thread: {
        id: threadId,
        task_id: cleanTaskId,
        anchor_type: anchorType,
        anchor_id: anchorId,
        message_count: currentSummary?.message_count ?? 0,
        unread_count: currentSummary?.unread_count ?? 0,
      },
      messages: pageMessages.map((message) => this.serializeDiscussionMessage(message)),
      thread_summaries: threadSummaries,
      page_info: {
        has_more: hasMore,
        next_cursor: hasMore && pageMessages.length > 0 ? pageMessages[0].id : null,
      },
    };
  }

  async createTaskDiscussionMessage(payload: {
    taskId: string;
    anchorType?: string;
    anchorId?: string;
    body?: string;
    replyToId?: string;
    mentions?: Array<{ user_id?: string; name?: string }>;
    files: Array<{ originalname: string; mimetype?: string; size?: number; buffer: Buffer }>;
    actor: { id?: string; name?: string; role?: string };
    viewer: DiscussionViewer;
  }) {
    const taskId = cleanText(payload.taskId);
    await this.assertTaskIdWritable(taskId);
    const { anchorType, anchorId } = this.normalizeDiscussionAnchor(payload.anchorType, payload.anchorId);
    const workspace = currentRdWorkspace();
    const threadId = this.discussionThreadId(taskId, anchorType, anchorId);
    const access = await this.requireDiscussionAccess(taskId, payload.viewer, threadId);
    const task = access.task;
    if (!payload.viewer.canPost && access.scope !== 'thread_invitee') {
      throw new ForbiddenException('你没有发送讨论消息的权限');
    }
    await this.assertDiscussionAnchorExists(taskId, anchorType, anchorId);
    const body = cleanText(payload.body);
    const files = Array.isArray(payload.files) ? payload.files : [];
    if (!body && files.length === 0) {
      throw new BadRequestException('消息内容或附件至少需要提供一项');
    }
    if (body.length > 4000) throw new BadRequestException('消息内容最多 4000 字');
    if (files.length > PROGRESS_NOTE_MAX_FILES) {
      throw new BadRequestException(`附件最多 ${PROGRESS_NOTE_MAX_FILES} 个`);
    }
    this.assertAttachmentFilesValid(files);
    const totalSize = files.reduce((sum, file) => sum + (file.size ?? file.buffer.length), 0);
    if (totalSize > PROGRESS_NOTE_MAX_TOTAL_BYTES) {
      throw new BadRequestException('附件总大小超过 50MB 限制');
    }

    const mentions = (Array.isArray(payload.mentions) ? payload.mentions : [])
      .map((mention) => ({
        user_id: cleanUserId(mention?.user_id) || null,
        name: cleanText(mention?.name) || null,
      }))
      .filter((mention) => mention.user_id || mention.name)
      .slice(0, 20);
    const actorId = cleanUserId(payload.actor.id) || null;
    const actorName = cleanText(payload.actor.name) || '同事';
    const actorRole = cleanText(payload.actor.role) || null;
    const mentionedUserIds = await this.resolveMentionTargetUserIds(mentions, actorId);
    const builtAttachments = await this.buildNoteAttachments(files);
    const attachments = builtAttachments.map((item) => item.attachment);
    const replyToId = cleanText(payload.replyToId) || null;
    if (replyToId) {
      const replyTarget = await this.prisma.rdTaskDiscussionMessage.findFirst({
        where: { id: replyToId, threadId },
        select: { id: true },
      });
      if (!replyTarget) throw new BadRequestException('引用的消息不属于当前讨论');
    }

    const now = new Date();
    const saved = await this.prisma.$transaction(async (tx) => {
      await tx.rdTaskDiscussionThread.upsert({
        where: { id: threadId },
        create: { id: threadId, workspace, taskId, anchorType, anchorId },
        update: { updatedAt: now },
      });
      const message = await tx.rdTaskDiscussionMessage.create({
        data: {
          threadId,
          authorId: actorId,
          authorName: actorName,
          authorRole: actorRole,
          body,
          attachments,
          mentions,
          replyToId,
        },
        include: {
          replyTo: { select: { id: true, authorName: true, body: true } },
        },
      });
      if (actorId) {
        await tx.rdTaskDiscussionRead.upsert({
          where: { threadId_userId: { threadId, userId: actorId } },
          create: { threadId, userId: actorId, lastReadAt: now },
          update: { lastReadAt: now },
        });
      }
      for (const invitedUserId of mentionedUserIds) {
        await tx.rdTaskDiscussionParticipant.upsert({
          where: { threadId_userId: { threadId, userId: invitedUserId } },
          create: {
            threadId,
            userId: invitedUserId,
            invitedById: actorId,
            invitedByName: actorName,
            invitedAt: now,
          },
          update: {
            invitedById: actorId,
            invitedByName: actorName,
            invitedAt: now,
            revokedAt: null,
          },
        });
      }
      return message;
    });

    if (mentionedUserIds.length > 0) {
      void this.notifyNoteMentions({
        taskId,
        noteText: body || '发送了一个附件',
        mentions,
        actorName,
        actorId,
        targetUserIds: mentionedUserIds,
        discussion: {
          threadId,
          anchorType,
          anchorId,
          messageId: saved.id,
        },
      }).catch(() => {});
    }
    void this.notifyDiscussionRecipients({
      task,
      taskId,
      anchorType,
      anchorId,
      replyToId,
      actorId,
      actorName,
      body,
      mentionedUserIds: new Set(mentionedUserIds),
    }).catch(() => {});

    return {
      message: this.serializeDiscussionMessage(saved),
      thread_id: threadId,
    };
  }

  private async notifyDiscussionRecipients(params: {
    task: JsonRecord;
    taskId: string;
    anchorType: DiscussionAnchorType;
    anchorId: string | null;
    replyToId: string | null;
    actorId: string | null;
    actorName: string;
    body: string;
    mentionedUserIds: Set<string>;
  }): Promise<void> {
    const recipients: Array<{ userId: string; personId: string; name: string }> = [];
    const addRecipient = (userIdValue: unknown, personIdValue?: unknown, nameValue?: unknown) => {
      const userId = cleanUserId(userIdValue);
      const personId = cleanText(personIdValue);
      const name = cleanText(nameValue);
      if (userId || personId || name) recipients.push({ userId, personId, name });
    };

    if (params.replyToId) {
      const target = await this.prisma.rdTaskDiscussionMessage.findUnique({
        where: { id: params.replyToId },
        select: { authorId: true, authorName: true },
      });
      addRecipient(target?.authorId, null, target?.authorName);
    } else if (params.anchorType === 'message' && params.anchorId) {
      const target = await this.prisma.rdTaskDiscussionMessage.findUnique({
        where: { id: params.anchorId },
        select: { authorId: true, authorName: true },
      });
      addRecipient(target?.authorId, null, target?.authorName);
    } else if (params.anchorType === 'progress_note' && params.anchorId) {
      const map = await this.getProgressNoteMap();
      const note = (map[params.taskId] ?? []).find((item) => String(item.id ?? '') === params.anchorId);
      const actor = note && isRecord(note.actor) ? note.actor : null;
      addRecipient(actor?.id, null, actor?.name);
    } else if (params.anchorType === 'task') {
      // 主会话的新消息没有天然“被回复人”，默认通知主责人与全部协作人；
      // @ 提及仍走专门通知，下面会按 user_id 去重，作者本人也不会收到自己的消息。
      addRecipient(
        params.task.primary_owner_user_id ?? params.task.owner_user_id,
        null,
        params.task.primary_owner ?? params.task.owner,
      );
      for (const collaborator of asArray(params.task.collaborators)) {
        if (!isRecord(collaborator)) continue;
        addRecipient(collaborator.user_id, collaborator.id, collaborator.name);
      }
    }

    if (recipients.length === 0) return;
    const title = cleanText(params.task.title) || params.taskId;
    const excerpt = params.body
      ? (params.body.length > 160 ? `${params.body.slice(0, 160)}…` : params.body)
      : '发送了一个附件';
    // 正文与收件人无关，循环外算一次即可
    const messageBody = params.anchorType === 'task' && !params.replyToId
      ? `${params.actorName} 在任务《${title}》发起了讨论：\n${excerpt}`
      : `${params.actorName} 回复了任务《${title}》中的讨论：\n${excerpt}`;
    const seen = new Set<string>();
    const payloads: CreateMessagePayload[] = [];
    for (const recipient of recipients) {
      if (recipient.userId && recipient.userId === params.actorId) continue;
      if (recipient.userId && params.mentionedUserIds.has(recipient.userId)) continue;
      const nameKey = personNameLookupKey(recipient.name);
      const key = recipient.userId
        ? `u:${recipient.userId}`
        : recipient.personId
          ? `p:${recipient.personId}`
          : nameKey
            ? `n:${nameKey}`
            : '';
      if (!key || seen.has(key)) continue;
      seen.add(key);
      payloads.push({
        sender: { id: params.actorId, name: params.actorName, role: null },
        recipient_id: recipient.userId || null,
        recipient_person_id: recipient.personId || null,
        recipient_name: recipient.name || null,
        subject: `协作对话：${title}`,
        body: messageBody,
      });
    }
    await this.createMessages(payloads);
  }

  async markTaskDiscussionRead(
    taskId: string,
    threadId: string,
    viewer: DiscussionViewer,
  ): Promise<{ ok: boolean }> {
    const cleanTaskId = cleanText(taskId);
    if (await this.isProductionMirrorTaskId(cleanTaskId)) {
      return runInRdWorkspace('rd', () => this.markTaskDiscussionRead(
        cleanTaskId,
        threadId,
        { ...viewer, canAccessAny: true, canPost: false },
      ));
    }
    const userId = cleanUserId(viewer.userId);
    if (!userId) return { ok: false };
    const cleanThreadId = cleanText(threadId);
    await this.requireDiscussionAccess(cleanTaskId, viewer, cleanThreadId);
    const thread = await this.prisma.rdTaskDiscussionThread.findFirst({
      where: { id: cleanThreadId, workspace: currentRdWorkspace(), taskId: cleanTaskId },
      select: { id: true },
    });
    // 尚无消息的合成空线程无需落已读记录。
    if (!thread) return { ok: true };
    await this.prisma.rdTaskDiscussionRead.upsert({
      where: { threadId_userId: { threadId: thread.id, userId } },
      create: { threadId: thread.id, userId, lastReadAt: new Date() },
      update: { lastReadAt: new Date() },
    });
    return { ok: true };
  }

  private async getDiscussionUnreadSummary(viewer: DiscussionViewer): Promise<Record<string, number>> {
    const userId = cleanUserId(viewer.userId);
    if (!userId) return {};
    type UnreadTaskRow = { task_id: string; unread_count: bigint };
    const workspace = currentRdWorkspace();
    const [unreadRows, categories] = await Promise.all([
      this.prisma.$queryRaw<UnreadTaskRow[]>`
        SELECT
          t."taskId" AS "task_id",
          COUNT(m."id")::bigint AS "unread_count"
        FROM "RdTaskDiscussionThread" t
        JOIN "RdTaskDiscussionMessage" m ON m."threadId" = t."id"
        LEFT JOIN "RdTaskDiscussionRead" r
          ON r."threadId" = t."id" AND r."userId" = ${userId}
        WHERE t."workspace" = ${workspace}
          AND m."authorId" IS DISTINCT FROM ${userId}
          AND (r."lastReadAt" IS NULL OR m."createdAt" > r."lastReadAt")
        GROUP BY t."taskId"
      `,
      this.getMergedTaskCategories(),
    ]);
    const taskById = new Map<string, JsonRecord>();
    for (const category of asArray(categories).filter(isRecord)) {
      for (const child of asArray(category.children).filter(isRecord)) {
        for (const task of asArray(child.tasks).filter(isRecord)) {
          taskById.set(cleanText(task.task_id), task);
          for (const subtask of asArray(task.subtasks).filter(isRecord)) {
            taskById.set(cleanText(subtask.task_id), subtask);
          }
        }
      }
    }
    const summary: Record<string, number> = {};
    for (const row of unreadRows) {
      const task = taskById.get(row.task_id);
      if (!task || (!viewer.canAccessAny && !isTaskParticipant(task, viewer.userId, viewer.userName))) continue;
      const count = Number(row.unread_count);
      if (count > 0) summary[row.task_id] = count;
    }
    return summary;
  }

  /** @ 提及通知：给被 @ 的成员发站内消息（含任务标题与评论摘录），失败仅告警不阻断留痕主流程。 */
  private async notifyNoteMentions(params: {
    taskId: string;
    noteText: string;
    mentions: Array<{ user_id: string | null; name: string | null }>;
    actorName: string;
    actorId: string | null;
    targetUserIds?: string[];
    discussion?: {
      threadId: string;
      anchorType: DiscussionAnchorType;
      anchorId: string | null;
      messageId: string;
    };
  }): Promise<void> {
    const task = await this.findTaskAcrossStores(params.taskId);
    const title = task ? String(task.title ?? params.taskId) : params.taskId;
    const excerpt = params.noteText.length > 200 ? `${params.noteText.slice(0, 200)}…` : params.noteText;
    const targets = params.targetUserIds
      ?? await this.resolveMentionTargetUserIds(params.mentions, params.actorId);
    // 正文与被@的人无关，循环外算一次即可
    const body = params.discussion
      ? JSON.stringify({
          type: 'discussion_mention',
          task_id: params.taskId,
          task_title: title,
          thread_id: params.discussion.threadId,
          anchor_type: params.discussion.anchorType,
          anchor_id: params.discussion.anchorId,
          message_id: params.discussion.messageId,
          actor_name: params.actorName,
          excerpt,
          access_scope: 'thread_invitee',
        })
      : `${params.actorName} 在任务《${title}》的评论中提到了你：\n${excerpt}`;
    await this.createMessages(
      targets.map((uid) => ({
        sender: { id: params.actorId, name: params.actorName, role: null },
        recipient_id: uid,
        subject: `评论提及：${title}`,
        body,
      })),
    ).catch((err) => {
      this.logger.warn(
        `[评论@通知] 发送失败 (task=${params.taskId}, to=${targets.join(',')}): ${err instanceof Error ? err.message : err}`,
      );
    });
  }

  // ── 评论未读红点（微信式）：任务级已读位点 rd.noteReads ──────────────────────
  // { [userId]: { [taskId]: lastReadAt } }；未读数 = 该任务中他人新增且晚于位点的留痕数。
  // 只统计「本人参与（主责/协作）的任务」——与工作台/移动端列表的展示范围一致。

  /** 当前用户的全部任务未读评论数（仅返回 >0 的项）。 */
  async getNoteUnreadSummary(viewer: DiscussionViewer): Promise<Record<string, number>> {
    const userId = cleanUserId(viewer.userId);
    if (!userId) return {};
    const [map, readsRaw, categories] = await Promise.all([
      this.getProgressNoteMap(),
      this.readValue('rd.noteReads'),
      this.getMergedTaskCategories(),
    ]);
    const reads = isRecord(readsRaw) && isRecord(readsRaw[userId]) ? (readsRaw[userId] as Record<string, unknown>) : {};
    // 上线基线：用户首次访问且无任何位点时，把「此刻」写为基线——上线前的历史评论一律
    // 视为已读，避免老任务的存量评论在上线首日全量爆红点（懒初始化，只写一次）。
    let baseline = typeof reads._baseline === 'string' ? (reads._baseline as string) : '';
    if (!baseline) {
      baseline = new Date().toISOString();
      await this.withProgressNoteLock(async () => {
        const raw = await this.readValue('rd.noteReads');
        const all: Record<string, unknown> = isRecord(raw) ? { ...raw } : {};
        const mine: Record<string, unknown> = isRecord(all[userId]) ? { ...(all[userId] as Record<string, unknown>) } : {};
        if (typeof mine._baseline !== 'string') {
          mine._baseline = baseline;
          all[userId] = mine;
          await this.writeValue('rd.noteReads', all as unknown as JsonRecord);
        }
      });
    }
    const taskById = new Map<string, JsonRecord>();
    const relationRootByTaskId = new Map<string, string>();
    const indexTask = (task: JsonRecord, rootTaskId?: string): void => {
      const taskId = String(task.task_id ?? '').trim();
      if (!taskId) return;
      const resolvedRootTaskId = rootTaskId ?? taskId;
      taskById.set(taskId, task);
      relationRootByTaskId.set(taskId, resolvedRootTaskId);
      for (const child of asArray(task.subtasks).filter(isRecord)) indexTask(child, resolvedRootTaskId);
    };
    for (const cat of asArray(categories).filter(isRecord)) {
      for (const sub of asArray(cat.children).filter(isRecord)) {
        for (const task of asArray(sub.tasks).filter(isRecord)) indexTask(task);
      }
    }
    const relationRootOf = (taskId: string): string => relationRootByTaskId.get(taskId) ?? taskId;
    const summary: Record<string, number> = {};
    for (const [taskId, notes] of Object.entries(map)) {
      const task = taskById.get(taskId);
      if (!task || (!viewer.canAccessAny && !isTaskParticipant(task, viewer.userId, viewer.userName))) continue;
      // 有效已读线 = max(任务位点, 用户基线)：任务级已读优先，未打开过则以上线基线兜底
      const taskRead = typeof reads[taskId] === 'string' ? (reads[taskId] as string) : '';
      const lastRead = taskRead > baseline ? taskRead : baseline;
      const count = notes.filter((n) => {
        if (!isRecord(n)) return false;
        const actor = isRecord(n.actor) ? n.actor : null;
        // 自己发的不算未读（有 user_id 时按 id；早期无 id 的本人留痕按姓名兜底，避免幽灵红点）
        if (actor && cleanUserId(actor.id) === userId) return false;
        if (actor && !cleanUserId(actor.id) && personNameLookupKey(actor.name) === personNameLookupKey(viewer.userName)) return false;
        const createdAt = String(n.created_at ?? '');
        return createdAt > lastRead; // ISO 字符串可直接字典序比较
      }).length;
      if (count > 0) {
        const cardTaskId = relationRootOf(taskId);
        summary[cardTaskId] = (summary[cardTaskId] ?? 0) + count;
      }
    }
    // 协作对话采用逐线程已读；任务卡上的总角标仍合并展示，进入任务后只有真正打开
    // 对应会话/线程才会清除，避免“看了任务概览却把所有讨论都误标已读”。
    const discussionUnread = await this.getDiscussionUnreadSummary(viewer);
    for (const [taskId, count] of Object.entries(discussionUnread)) {
      const cardTaskId = relationRootOf(taskId);
      summary[cardTaskId] = (summary[cardTaskId] ?? 0) + count;
    }
    return summary;
  }

  /** 标记某任务的评论已读（任何入口打开留痕区都调用；写入当前时刻位点）。 */
  async markTaskNotesRead(taskId: string, viewer: { userId?: string }): Promise<{ ok: boolean }> {
    const userId = cleanUserId(viewer.userId);
    const cleanTaskId = taskId.trim();
    if (!userId || !cleanTaskId) return { ok: false };
    // The detail feed is relation-group scoped, so its read receipt must use the
    // same scope. Otherwise a parent can display a child's note while leaving
    // that child permanently unread on every device.
    const categories = await this.getMergedTaskCategories();
    const relation = buildRdTaskProgressRelationGroup(categories, cleanTaskId);
    if (!relation) return { ok: false };
    const readAt = new Date().toISOString();
    // 复用留痕锁串行化读改写，避免并发标记互相覆盖
    await this.withProgressNoteLock(async () => {
      const raw = await this.readValue('rd.noteReads');
      const all: Record<string, unknown> = isRecord(raw) ? { ...raw } : {};
      const mine: Record<string, unknown> = isRecord(all[userId]) ? { ...(all[userId] as Record<string, unknown>) } : {};
      for (const relationTask of relation.tasks) mine[relationTask.taskId] = readAt;
      all[userId] = mine;
      await this.writeValue('rd.noteReads', all as unknown as JsonRecord);
    });
    return { ok: true };
  }

  // ── 驾驶舱「备注回执」：管理员/他人给某任务留的备注，其目标人是否已查看/已跟进 ──
  // 所有有驾驶舱权限者可见（不按参与人过滤）；带留备注人姓名。三态：
  //   待查看(unread)：目标人在备注之后还没打开过该任务；
  //   已查看(read)  ：目标人打开过（已读），但还没在该备注之后提交新进展；
  //   （已跟进）    ：目标人在备注之后提交了新进展 → 该备注已闭环，不再返回。
  // 目标人以「备注 @ 的人」为准；未 @ 则取任务主责人。每个任务返回其最新一条未闭环备注。

  async getTaskNoteReceipts(): Promise<Record<string, {
    author_name: string;
    target_name: string;
    state: 'unread' | 'read';
    excerpt: string;
    created_at: string;
  }>> {
    const [map, readsRaw, categories] = await Promise.all([
      this.getProgressNoteMap(),
      this.readValue('rd.noteReads'),
      this.getMergedTaskCategories(),
    ]);
    const readsAll = isRecord(readsRaw) ? readsRaw : {};
    /** 某用户对某任务的有效已读线 = max(任务位点, 该用户基线) */
    const lastReadOf = (uid: string, taskId: string): string => {
      const mine = isRecord(readsAll[uid]) ? (readsAll[uid] as Record<string, unknown>) : {};
      const baseline = typeof mine._baseline === 'string' ? mine._baseline : '';
      const taskRead = typeof mine[taskId] === 'string' ? (mine[taskId] as string) : '';
      return taskRead > baseline ? taskRead : baseline;
    };
    const taskById = new Map<string, JsonRecord>();
    for (const cat of asArray(categories).filter(isRecord)) {
      for (const sub of asArray(cat.children).filter(isRecord)) {
        for (const t of asArray(sub.tasks).filter(isRecord)) {
          taskById.set(String(t.task_id ?? ''), t);
          for (const st of asArray(t.subtasks).filter(isRecord)) taskById.set(String(st.task_id ?? ''), st);
        }
      }
    }

    const out: Record<string, { author_name: string; target_name: string; state: 'unread' | 'read'; excerpt: string; created_at: string }> = {};
    for (const [taskId, notes] of Object.entries(map)) {
      const task = taskById.get(taskId);
      if (!task) continue;
      const ownerId = cleanUserId(task.primary_owner_user_id ?? task.owner_user_id);
      const ownerName = cleanText(task.primary_owner ?? task.owner) ?? '';
      const sorted = notes.filter(isRecord).slice().sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));

      // 从最新往旧找第一条「未闭环的他人备注」，作为该任务当前待办
      for (let i = sorted.length - 1; i >= 0; i -= 1) {
        const note = sorted[i];
        const actor = isRecord(note.actor) ? note.actor : null;
        const authorId = cleanUserId(actor?.id);
        const authorName = cleanText(actor?.name) ?? '';
        const noteAt = String(note.created_at ?? '');
        if (!noteAt) continue;

        // 目标人：备注 @ 的人（可多个）；未 @ 则取主责人
        const mentions = asArray(note.mentions).filter(isRecord);
        const targets = mentions.length > 0
          ? mentions.map((m) => ({ id: cleanUserId(m.user_id), name: cleanText(m.name) ?? '' })).filter((tg) => tg.id || tg.name)
          : (ownerId || ownerName ? [{ id: ownerId, name: ownerName }] : []);
        if (targets.length === 0) continue;

        // 「他人备注」：作者不是任一目标人本人（避免把自己写给自己的进展算作待办备注）
        const authoredBySelf = targets.some((tg) =>
          (tg.id && authorId && tg.id === authorId) ||
          (!authorId && tg.name && personNameLookupKey(tg.name) === personNameLookupKey(authorName)));
        if (authoredBySelf) continue;

        // 闭环判定：任一目标人在该备注之后提交过新进展留痕 → 已跟进，跳过本备注继续找更旧的
        const followedUp = targets.some((tg) => sorted.some((n2) => {
          const a2 = isRecord(n2.actor) ? n2.actor : null;
          const a2id = cleanUserId(a2?.id);
          const isTargetAuthor = (tg.id && a2id && tg.id === a2id) ||
            (!a2id && tg.name && personNameLookupKey(cleanText(a2?.name)) === personNameLookupKey(tg.name));
          return isTargetAuthor && String(n2.created_at ?? '') > noteAt;
        }));
        if (followedUp) continue;

        // 未闭环：判定已读/未读——任一目标人在备注之后打开过任务即视为「已查看」
        const anyRead = targets.some((tg) => tg.id && lastReadOf(tg.id, taskId) >= noteAt);
        const text = cleanText(note.text) ?? '';
        out[taskId] = {
          author_name: authorName || '同事',
          target_name: targets.map((tg) => tg.name || '成员').join('、'),
          state: anyRead ? 'read' : 'unread',
          excerpt: text.length > 60 ? `${text.slice(0, 60)}…` : text,
          created_at: noteAt,
        };
        break; // 每个任务只返回最新一条未闭环备注
      }
    }
    return out;
  }

  // ── 留痕附件的新增 / 替换 / 删除（工作台附件管理） ─────────────────────────
  // 口径：留痕作者本人 / 任务主责人 / 管理员可操作；已完成或已归档任务锁定
  // （附件是完成质量评分的「交付证据」，完成后可改会让评分与审计失去可信度）。
  // 并发安全：上限 / 锁定 / 存在性 / 权限的最终校验全部在留痕锁内完成；
  // OSS 上传在锁外先行（不能持锁做数分钟大文件上传），锁内校验失败时新对象
  // 成为无引用孤儿（沿用「OSS 只解除关联不物理删除」的既有口径，罕见且可接受）。
  // 审计：三个操作均在服务端写入审计流（不依赖前端回调），绕过前端直调 API 也留痕。

  /** 任务是否允许修改留痕附件（未完成且未归档） */
  private taskAttachmentsMutable(task: JsonRecord): boolean {
    if (isProductionMirrorTask(task)) return false;
    const status = String(task.status ?? '');
    return !(task.archived === true || status === 'archived' || status === 'completed');
  }

  /** 操作人是否可修改某条留痕的附件：管理员 / 留痕作者本人 / 任务主责人（id 优先、姓名归一化兜底） */
  private canUserMutateNoteAttachments(
    task: JsonRecord,
    note: JsonRecord,
    viewer: { userId?: string; userName?: string; canEditAny?: boolean },
  ): boolean {
    if (viewer.canEditAny) return true;
    const uid = cleanUserId(viewer.userId);
    const actor = isRecord(note.actor) ? note.actor : null;
    if (uid && actor && cleanUserId(actor.id) === uid) return true;
    const nameKey = personNameLookupKey(viewer.userName);
    const ownerId = cleanUserId(task.primary_owner_user_id ?? task.owner_user_id);
    if (ownerId) return Boolean(uid) && ownerId === uid;
    return Boolean(nameKey) && personNameLookupKey(task.primary_owner ?? task.owner) === nameKey;
  }

  /** 上传前的快速失败预检（只查任务级状态，不读留痕 map；权限等最终校验在锁内） */
  private async precheckTaskAttachmentMutation(taskId: string): Promise<void> {
    const task = await this.assertTaskIdWritable(taskId);
    if (!this.taskAttachmentsMutable(task)) {
      throw new ForbiddenException('已完成或已归档任务的附件已锁定，不可修改');
    }
  }

  /**
   * 附件变更的统一咽喉：锁内完成 状态锁定 / 权限 / 存在性 校验与写回，
   * mutator 在锁内基于最新附件列表计算变更（上限校验也在其中），杜绝 TOCTOU。
   */
  private async mutateNoteAttachments<T>(params: {
    taskId: string;
    noteId: string;
    requesterUserId?: string;
    requesterName?: string;
    canEditAny?: boolean;
    mutator: (attachments: JsonRecord[]) => { attachments: JsonRecord[]; result: T };
  }): Promise<{ task: JsonRecord; note: JsonRecord; result: T }> {
    return this.withProgressNoteLock(async () => {
      const task = await this.findTaskAcrossStores(params.taskId);
      if (!task) throw new NotFoundException('任务不存在');
      this.assertTaskWritable(task);
      if (!this.taskAttachmentsMutable(task)) {
        throw new ForbiddenException('已完成或已归档任务的附件已锁定，不可修改');
      }
      const map = await this.getProgressNoteMap();
      const notes = map[params.taskId] ?? [];
      const note = notes.find((n) => isRecord(n) && String(n.id) === params.noteId) as JsonRecord | undefined;
      if (!note) throw new NotFoundException('进展留痕不存在');
      if (!this.canUserMutateNoteAttachments(task, note, {
        userId: params.requesterUserId,
        userName: params.requesterName,
        canEditAny: params.canEditAny,
      })) {
        throw new ForbiddenException('只有留痕作者本人或任务主责人可以修改附件');
      }
      const { attachments, result } = params.mutator(asArray(note.attachments).filter(isRecord) as JsonRecord[]);
      note.attachments = attachments;
      await this.writeValue('rd.taskProgressNotes', map);
      return { task, note, result };
    });
  }

  private progressNoteUploadBusinessType(userId: string): string {
    return `rd/progress-notes/${userId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  }

  /** Verify direct-uploaded objects before registering them as note attachments. */
  private async buildRegisteredNoteAttachments(
    files: DirectProgressNoteUpload[],
    requesterUserId?: string,
  ): Promise<ProgressNoteAttachmentBuild[]> {
    if (files.length === 0) return [];
    const userId = cleanUserId(requesterUserId);
    if (!userId) throw new ForbiddenException('登录状态无效，无法登记附件');
    const businessType = this.progressNoteUploadBusinessType(userId);
    this.assertAttachmentFilesValid(files);

    return Promise.all(files.map(async (file, i) => {
      if (!this.ossService.isKeyUnderBusinessType(file.objectKey, businessType)) {
        throw new ForbiddenException('附件对象不属于当前用户的上传目录');
      }
      const head = await this.ossService.headObject(file.objectKey);
      if (!head) throw new BadRequestException(`附件 ${file.originalname} 尚未上传完成`);
      if (head.size > PROGRESS_NOTE_MAX_FILE_BYTES) {
        throw new BadRequestException(`附件 ${file.originalname} 超过单文件 25MB 限制`);
      }
      if (typeof file.size === 'number' && file.size !== head.size) {
        throw new BadRequestException(`附件 ${file.originalname} 大小校验失败，请重新上传`);
      }
      const mimetype = head.contentType || file.mimetype || 'application/octet-stream';
      const ossUrl = this.ossService.getSignedUrl(file.objectKey, 30 * 24 * 3600);
      if (!ossUrl) throw new BadRequestException(`附件 ${file.originalname} 无法生成访问地址`);
      return {
        attachment: {
          id: `att-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
          name: file.originalname,
          mime: mimetype,
          size: head.size,
          object_key: file.objectKey,
          oss_url: ossUrl,
        },
        mimetype,
        originalname: file.originalname,
      };
    }));
  }

  /** 上传文件并构造留痕附件对象（创建留痕与追加/替换共用同一实现，格式不允许分叉）。 */
  private async buildNoteAttachments(
    files: Array<{ originalname: string; mimetype?: string; size?: number; buffer: Buffer }>,
  ): Promise<ProgressNoteAttachmentBuild[]> {
    return Promise.all(files.map(async (f, i) => {
      const id = `att-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;
      const objectKey = await this.ossService.uploadBuffer(f.buffer, 'rd/progress-notes', f.originalname, f.mimetype);
      const ossUrl = objectKey ? this.ossService.getSignedUrl(objectKey, 30 * 24 * 3600) : null;
      const attachment = {
        id,
        name: f.originalname,
        mime: f.mimetype ?? 'application/octet-stream',
        size: f.size ?? f.buffer.length,
        ...(objectKey && ossUrl
          ? { object_key: objectKey, oss_url: ossUrl }
          : { data_url: `data:${f.mimetype ?? 'application/octet-stream'};base64,${f.buffer.toString('base64')}` }
        ),
      };
      return { attachment, buffer: f.buffer, mimetype: f.mimetype, originalname: f.originalname };
    }));
  }

  /** 追加/替换共用的文件尺寸校验（单文件 25MB；变更后单条留痕总量 50MB 由锁内 mutator 校验） */
  private assertAttachmentFilesValid(
    files: Array<{ originalname: string; mimetype?: string; size?: number; buffer?: Buffer }>,
  ) {
    const blocked = files.find((file) => isBlockedProgressAttachment(file.originalname, file.mimetype));
    if (blocked) throw new BadRequestException(`附件 ${blocked.originalname} 属于高风险可执行文件，不能上传`);
    const oversized = files.find((f) => (f.size ?? f.buffer?.length ?? 0) > PROGRESS_NOTE_MAX_FILE_BYTES);
    if (oversized) throw new BadRequestException(`附件 ${oversized.originalname} 超过单文件 25MB 限制`);
  }

  private sumAttachmentBytes(attachments: JsonRecord[]): number {
    return attachments.reduce((sum, a) => sum + (typeof a.size === 'number' ? a.size : 0), 0);
  }

  /**
   * 服务端审计统一入口。
   *
   * 留痕原先由前端在 88 处 `recordAudit()` 调用里发起——绕开界面直接打接口就不留痕，
   * 等于审计可以被绕过。现在所有数据变更都在服务层自己写留痕，前端只负责展示。
   *
   * 写失败不回滚业务变更（审计是旁路，不该让业务因它失败），但必须告警可追查。
   */
  private async recordServerAudit(entry: {
    action: string;
    resource: { type: string; id: string; name?: string };
    actor: { id?: string | null; name?: string; role?: string };
    comment?: string;
    changes?: Array<{ field: string; before: unknown; after: unknown }>;
    metadata?: JsonRecord;
    source?: 'web' | 'ai' | 'system' | 'api';
  }): Promise<void> {
    try {
      await this.createAuditLog({
        actor: {
          id: entry.actor.id ?? null,
          name: entry.actor.name ?? '未知用户',
          ...(entry.actor.role ? { role: entry.actor.role } : {}),
        },
        action: entry.action,
        resource: entry.resource,
        ...(entry.changes?.length ? { changes: entry.changes } : {}),
        ...(entry.comment ? { comment: entry.comment } : {}),
        ...(entry.metadata ? { metadata: entry.metadata } : {}),
        source: entry.source ?? 'web',
      });
    } catch (err) {
      this.logger.error(
        `[服务端审计] 写入失败 (${entry.action}, ${entry.resource.type}=${entry.resource.id}): ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * 任务补丁 → 可读变更集。
   *
   * 只挑用户看得懂的业务字段：任务记录里还有一大票内部字段（creation_request_*、
   * subtask_attached_* 等），全量 diff 会把留痕淹掉，看的人反而找不到重点。
   */
  private buildTaskChanges(before: JsonRecord, patch: JsonRecord) {
    const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
    for (const field of AUDITED_TASK_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
      const prev = this.auditFieldValue(before[field]);
      const next = this.auditFieldValue(patch[field]);
      if (prev === next) continue;
      changes.push({ field, before: prev, after: next });
    }
    return changes;
  }

  /** 任意实体的字段 diff，字段白名单由调用方给。 */
  private buildRecordChanges(before: JsonRecord, after: JsonRecord, fields: readonly string[]) {
    const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
    for (const field of fields) {
      const prev = this.auditFieldValue(before[field]);
      const next = this.auditFieldValue(after[field]);
      if (prev === next) continue;
      changes.push({ field, before: prev, after: next });
    }
    return changes;
  }

  /** 变更值统一转成可读字符串：协作人这类数组取姓名拼接，对象兜底 JSON。 */
  private auditFieldValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) {
      return value
        .map((item) => (isRecord(item) ? cleanText(item.name ?? item.title ?? item.id) : String(item)))
        .filter(Boolean)
        .join('、');
    }
    if (isRecord(value)) return cleanText(value.name ?? value.title ?? value.id) || JSON.stringify(value);
    return String(value);
  }

  /**
   * 任务更新落到哪个动作码。
   *
   * 审批动作优先（它决定了任务的流转语义），其次是状态/主责人/进度这类"有专门动作码"的
   * 单点变更，最后才回落到笼统的 task.updated —— 与合并前前端各页手写的口径保持一致，
   * 这样迁移前后同一个操作在留痕页里长得一样。
   */
  private classifyTaskUpdate(
    before: JsonRecord,
    patch: JsonRecord,
    changes: Array<{ field: string; before: unknown; after: unknown }>,
    review?: { action?: string; reviewerName?: string; rejectReason?: string },
  ): { action: string; comment: string } {
    const reviewType = cleanText(before.pending_review_type) || 'result';
    if (review?.action === 'approve') {
      return { action: 'task.review_approved', comment: `${REVIEW_TYPE_LABELS[reviewType] ?? '审核'}通过` };
    }
    if (review?.action === 'reject') {
      const reason = cleanText(review.rejectReason);
      return {
        action: 'task.review_rejected',
        comment: `${REVIEW_TYPE_LABELS[reviewType] ?? '审核'}驳回${reason ? `：${reason}` : ''}`,
      };
    }

    const changed = new Set(changes.map((item) => item.field));
    const nextStatus = cleanText(patch.status);
    if (changed.has('status') && nextStatus === 'pending_review') {
      const pendingType = cleanText(patch.pending_review_type) || reviewType;
      return {
        action: PENDING_REVIEW_ACTIONS[pendingType] ?? 'task.submitted',
        comment: `提交${REVIEW_TYPE_LABELS[pendingType] ?? '审核'}`,
      };
    }
    // 封存/解封走的是 archived 布尔位，不是 status
    if (changed.has('archived')) {
      const archived = String(this.auditFieldValue(patch.archived)) === 'true';
      return archived
        ? { action: 'task.archived', comment: '封存任务' }
        : { action: 'task.unarchived', comment: '解封任务' };
    }
    if (changed.has('status')) return { action: 'task.status_changed', comment: '变更任务状态' };
    if (changed.has('primary_owner')) return { action: 'task.reassigned', comment: '转派任务负责人' };
    if (changed.has('collaborators')) return { action: 'task.collaboration_updated', comment: '更新任务协同人' };
    if (changed.has('progress')) return { action: 'task.progress_updated', comment: '更新任务进度' };
    if (changed.has('work_items')) return { action: 'task.work_item_updated', comment: '更新任务工作项' };
    if (changed.has('final_priority') || changed.has('priority')) {
      return { action: 'task.priority_changed', comment: '调整任务优先级' };
    }
    if (changed.has('category_path')) return { action: 'task.edited', comment: '调整任务归类' };
    if (changed.has('title') || changed.has('description')) return { action: 'task.edited', comment: '编辑任务标题与描述' };
    return { action: 'task.updated', comment: '更新任务' };
  }

  /**
   * 知识库留痕。研发库与各部门库共用同一批方法（靠 kbId 区分存储键），
   * kb_id 记进 metadata，合并留痕页里才分得清是哪个库的操作。
   */
  private async recordKnowledgeAudit(
    action: string,
    resourceId: string,
    resourceName: string,
    comment: string,
    kbId?: string,
    actor?: AuditActorRef,
    metadata?: JsonRecord,
  ): Promise<void> {
    await this.recordServerAudit({
      action,
      resource: { type: 'knowledge', id: resourceId, name: resourceName },
      actor: { id: actor?.userId, name: actor?.userName },
      comment,
      metadata: { kb_id: kbId ?? 'rd', ...(metadata ?? {}) },
    });
  }

  /**
   * AI 调用留痕。AI 本身不改业务数据，但「谁在哪个对象上用了 AI」属于要追溯的操作，
   * 合并前由前端各页自己上报——同样绕得过去，现在移到接口侧。
   */
  async recordAiAudit(entry: {
    action: string;
    resourceType: string;
    resourceId: string;
    resourceName?: string;
    comment: string;
    actor: AuditActorRef;
    metadata?: JsonRecord;
  }): Promise<void> {
    await this.recordServerAudit({
      action: entry.action,
      resource: { type: entry.resourceType, id: entry.resourceId, name: entry.resourceName },
      actor: { id: entry.actor.userId, name: entry.actor.userName },
      comment: entry.comment,
      metadata: entry.metadata,
      source: 'ai',
    });
  }

  /** 附件增/删/换的留痕，走统一入口，额外把 note_id 带进 metadata。 */
  private async recordNoteAttachmentAudit(entry: {
    action: 'task.attachment_added' | 'task.attachment_removed' | 'task.attachment_replaced';
    task: JsonRecord;
    noteId: string;
    comment: string;
    changes?: Array<{ field: string; before: string; after: string }>;
    metadata?: JsonRecord;
    actor: { id?: string; name?: string; role?: string };
  }): Promise<void> {
    await this.recordServerAudit({
      action: entry.action,
      resource: { type: 'task', id: String(entry.task.task_id ?? ''), name: String(entry.task.title ?? '') },
      actor: { ...entry.actor, role: entry.actor.role ?? '研发成员' },
      comment: entry.comment,
      changes: entry.changes,
      metadata: { note_id: entry.noteId, ...(entry.metadata ?? {}) },
    });
  }

  /**
   * 附件变更后的统一善后：知识库同步（先删旧、后入新）在请求内 await 完成——
   * fire-and-forget 会造成跨请求竞态（替换后立刻删除时，删除的清理跑在替换的
   * 入库之前，新条目漏归档，实测复现）。抽取与留痕向量重建仍异步（慢且幂等）。
   */
  private async afterNoteAttachmentsMutated(params: {
    taskId: string;
    noteId: string;
    updatedNote: JsonRecord;
    added?: ProgressNoteAttachmentBuild[];
    removed?: JsonRecord[];
    actorId?: string;
    actorName?: string;
  }): Promise<void> {
    // 留痕向量重建：syncProgressNoteToRag 按 note 幂等覆盖写入
    void this.syncProgressNoteToRag(params.taskId, params.updatedNote).catch(() => {});
    // 新附件：异步抽取文本（OCR/vision/doc，可达数十秒，不阻塞响应）
    if (params.added && params.added.length > 0) {
      void this.backfillAttachmentExtractedTexts(
        params.taskId,
        params.noteId,
        params.added as Parameters<typeof this.backfillAttachmentExtractedTexts>[2],
      );
    }
    // 知识库同步：请求内完成，前端 busy 门闩串行化用户操作后即无跨请求乱序
    if (params.removed && params.removed.length > 0) {
      await this.removeIngestedAttachmentKbEntries(params.taskId, params.removed).catch((err) => {
        this.logger.warn(`[附件KB清理] 失败 (task=${params.taskId}): ${err instanceof Error ? err.message : err}`);
      });
    }
    if (params.added && params.added.length > 0) {
      // 补 taskTitle/categoryPath：否则追加/替换的附件入库时落到兜底分类、描述只剩裸 taskId，
      // 与创建留痕路径分叉（同一任务附件在知识库出现在两个分类，按分类检索漏新附件）。
      const task = await this.findTaskAcrossStores(params.taskId);
      await this.ingestProgressNoteAttachments({
        taskId: params.taskId,
        taskTitle: task ? String(task.title ?? '') || undefined : undefined,
        categoryPath: task ? String(task.category_path ?? '') || undefined : undefined,
        attachments: params.added.map((a) => a.attachment) as Array<{ id: string; name: string; mime: string; size: number; data_url?: string; oss_url?: string }>,
        actorId: params.actorId,
        actorName: params.actorName,
      }).catch((err) => {
        this.logger.warn(`[附件KB入库] 失败 (task=${params.taskId}): ${err instanceof Error ? err.message : err}`);
      });
    }
  }

  /**
   * 清理「任务附件自动入库」产生的知识条目：按 source_attachment_id 精确匹配（入库时持久化），
   * 单次读写完成批量归档，随后逐条清理向量索引。
   * 历史条目（无 source_attachment_id 字段）不自动清理——按文件名模糊匹配会误删同任务
   * 其他留痕中同名附件的条目（此前实测风险），宁可留存也不误删。
   */
  private async removeIngestedAttachmentKbEntries(taskId: string, removedAttachments: JsonRecord[]) {
    const ids = new Set(removedAttachments.map((a) => String(a.id ?? '')).filter(Boolean));
    if (ids.size === 0) return;
    const raw = await this.readValue('rd.knowledgeEntries');
    const entries: JsonRecord[] = Array.isArray(raw) ? (raw as JsonRecord[]) : [];
    const matchedIds: string[] = [];
    const updated = entries.map((entry) => {
      if (!isRecord(entry) || entry.archived === true) return entry;
      if (String(entry.source ?? '') !== 'task_attachment') return entry;
      if (String(entry.source_task_id ?? '') !== taskId) return entry;
      if (!ids.has(String(entry.source_attachment_id ?? ''))) return entry;
      matchedIds.push(String(entry.id));
      return { ...entry, archived: true, updated_at: new Date().toISOString() };
    });
    if (matchedIds.length === 0) return;
    await this.writeValue('rd.knowledgeEntries', updated);
    for (const id of matchedIds) {
      void this.ragService.removeChunksForSource('kb', id).catch(() => {});
    }
  }

  /** 向已有留痕追加附件。 */
  async addTaskProgressNoteAttachments(params: {
    taskId: string;
    noteId: string;
    files: Array<{ originalname: string; mimetype?: string; size?: number; buffer: Buffer }>;
    uploadedFiles?: DirectProgressNoteUpload[];
    requesterUserId?: string;
    requesterName?: string;
    requesterRole?: string;
    canEditAny?: boolean;
  }) {
    const files = Array.isArray(params.files) ? params.files : [];
    const uploadedFiles = Array.isArray(params.uploadedFiles) ? params.uploadedFiles : [];
    if (files.length + uploadedFiles.length === 0) throw new BadRequestException('至少需要提供一个附件');
    this.assertAttachmentFilesValid([...files, ...uploadedFiles]);
    await this.precheckTaskAttachmentMutation(params.taskId);

    const added = [
      ...(await this.buildNoteAttachments(files)),
      ...(await this.buildRegisteredNoteAttachments(uploadedFiles, params.requesterUserId)),
    ];
    const { task, note } = await this.mutateNoteAttachments({
      ...params,
      mutator: (attachments) => {
        if (attachments.length + added.length > PROGRESS_NOTE_MAX_FILES) {
          throw new BadRequestException(`单条留痕附件最多 ${PROGRESS_NOTE_MAX_FILES} 个（已有 ${attachments.length} 个）`);
        }
        const totalBytes = this.sumAttachmentBytes(attachments) + this.sumAttachmentBytes(added.map((a) => a.attachment));
        if (totalBytes > PROGRESS_NOTE_MAX_TOTAL_BYTES) {
          throw new BadRequestException('附件总大小超过单条留痕 50MB 限制');
        }
        return { attachments: [...attachments, ...added.map((a) => a.attachment)], result: null };
      },
    });
    await this.incrementTaskAttachmentCount(params.taskId, added.length);
    await this.recordNoteAttachmentAudit({
      action: 'task.attachment_added',
      task,
      noteId: params.noteId,
      comment: `新增附件：${added.map((a) => a.attachment.name).join('、')}`,
      metadata: { attachment_ids: added.map((a) => a.attachment.id) },
      actor: { id: params.requesterUserId, name: params.requesterName, role: params.requesterRole },
    });
    await this.afterNoteAttachmentsMutated({
      taskId: params.taskId,
      noteId: params.noteId,
      updatedNote: note,
      added,
      actorId: params.requesterUserId,
      actorName: params.requesterName,
    });
    return this.decorateNotesWithPreview([note])[0];
  }

  /** Delete removed OSS objects only after confirming that no progress note still references them. */
  private async deleteAttachmentObjectsIfUnreferenced(attachments: JsonRecord[]) {
    const keys = new Set(
      attachments
        .map((attachment) => cleanText(attachment.object_key))
        .filter(Boolean),
    );
    if (keys.size === 0) return;

    const noteMap = await this.getProgressNoteMap();
    for (const notes of Object.values(noteMap)) {
      for (const note of notes) {
        for (const attachment of asArray(note.attachments)) {
          if (isRecord(attachment)) keys.delete(cleanText(attachment.object_key));
        }
      }
    }
    await Promise.all([...keys].map((key) => this.ossService.deleteObject(key)));
  }

  async deleteTaskProgressNoteAttachment(params: {
    taskId: string;
    noteId: string;
    attachmentId: string;
    requesterUserId?: string;
    requesterName?: string;
    requesterRole?: string;
    canEditAny?: boolean;
  }) {
    const { task, note, result: removed } = await this.mutateNoteAttachments<JsonRecord>({
      ...params,
      mutator: (attachments) => {
        const idx = attachments.findIndex((a) => String(a.id) === params.attachmentId);
        if (idx < 0) throw new NotFoundException('附件不存在或已被删除');
        return {
          attachments: [...attachments.slice(0, idx), ...attachments.slice(idx + 1)],
          result: attachments[idx],
        };
      },
    });
    await this.incrementTaskAttachmentCount(params.taskId, -1);
    await this.recordNoteAttachmentAudit({
      action: 'task.attachment_removed',
      task,
      noteId: params.noteId,
      comment: `删除附件：${removed.name}`,
      metadata: { attachment_id: params.attachmentId },
      actor: { id: params.requesterUserId, name: params.requesterName, role: params.requesterRole },
    });
    await this.afterNoteAttachmentsMutated({
      taskId: params.taskId,
      noteId: params.noteId,
      updatedNote: note,
      removed: [removed],
    });
    await this.deleteAttachmentObjectsIfUnreferenced([removed]);
    return this.decorateNotesWithPreview([note])[0];
  }

  /** 原位替换留痕中的单个附件（位置保持不变；旧文件解除关联，新文件走完整抽取/入库管线）。 */
  async replaceTaskProgressNoteAttachment(params: {
    taskId: string;
    noteId: string;
    attachmentId: string;
    file?: { originalname: string; mimetype?: string; size?: number; buffer: Buffer };
    uploadedFile?: DirectProgressNoteUpload;
    requesterUserId?: string;
    requesterName?: string;
    requesterRole?: string;
    canEditAny?: boolean;
  }) {
    const file = params.file;
    const uploadedFile = params.uploadedFile;
    if ((!file || !file.buffer) && !uploadedFile) throw new BadRequestException('替换附件不能为空');
    this.assertAttachmentFilesValid([
      ...(file ? [file] : []),
      ...(uploadedFile ? [uploadedFile] : []),
    ]);
    await this.precheckTaskAttachmentMutation(params.taskId);

    const [added] = file
      ? await this.buildNoteAttachments([file])
      : await this.buildRegisteredNoteAttachments([uploadedFile!], params.requesterUserId);
    const { task, note, result: removed } = await this.mutateNoteAttachments<JsonRecord>({
      ...params,
      mutator: (attachments) => {
        const idx = attachments.findIndex((a) => String(a.id) === params.attachmentId);
        if (idx < 0) throw new NotFoundException('附件不存在或已被删除');
        const next = [...attachments];
        const old = next[idx];
        next[idx] = added.attachment;
        const totalBytes = this.sumAttachmentBytes(next);
        if (totalBytes > PROGRESS_NOTE_MAX_TOTAL_BYTES) {
          throw new BadRequestException('附件总大小超过单条留痕 50MB 限制');
        }
        return { attachments: next, result: old };
      },
    });
    // 数量不变，无需调整附件计数
    await this.recordNoteAttachmentAudit({
      action: 'task.attachment_replaced',
      task,
      noteId: params.noteId,
      comment: `替换附件：${removed.name} → ${added.attachment.name}`,
      changes: [{ field: 'attachment', before: String(removed.name ?? ''), after: String(added.attachment.name) }],
      metadata: { attachment_id: params.attachmentId, new_attachment_id: added.attachment.id },
      actor: { id: params.requesterUserId, name: params.requesterName, role: params.requesterRole },
    });
    await this.afterNoteAttachmentsMutated({
      taskId: params.taskId,
      noteId: params.noteId,
      updatedNote: note,
      added: [added],
      removed: [removed],
      actorId: params.requesterUserId,
      actorName: params.requesterName,
    });
    await this.deleteAttachmentObjectsIfUnreferenced([removed]);
    return this.decorateNotesWithPreview([note])[0];
  }

  /**
   * 历史附件批量补抽取：扫描所有进度留痕，对 extracted_text 为空（且未标记为已尝试过的）附件
   * 触发 OCR/doc/vision 抽取。幂等：已有 extracted_text（含空字符串 + extracted_source）的不重跑。
   * 用于在 L1-L4 上线后，把旧数据全部补一遍。
   *
   * 限制：单次最多处理 maxItems 个附件（默认 50），防止 HTTP 超时；剩余的让用户再点一次按钮。
   */
  async backfillTaskProgressNoteExtraction(opts: { maxItems?: number } = {}): Promise<{
    total_pending: number;
    processed: number;
    succeeded: number;
    failed: number;
    has_more: boolean;
    failed_ids: string[];
  }> {
    await this.refreshProductionMirrorsIfNeeded();
    const maxItems = Math.max(1, Math.min(200, opts.maxItems ?? 50));
    const map = await this.getProgressNoteMap();
    const mirrorTaskIds = new Set(
      this.collectAllCategoryTasks(await this.readMergedTaskCategories())
        .filter(isProductionMirrorTask)
        .map((task) => cleanText(task.task_id)),
    );

    // 收集所有待处理的附件（带 taskId / noteId / attachment 引用）
    type PendingItem = { taskId: string; noteId: string; attachment: JsonRecord };
    const pending: PendingItem[] = [];
    for (const [taskId, notes] of Object.entries(map)) {
      if (mirrorTaskIds.has(taskId)) continue;
      for (const note of notes) {
        if (!isRecord(note)) continue;
        const noteId = String(note.id ?? '');
        if (!noteId) continue;
        const atts = asArray(note.attachments).filter(isRecord);
        for (const att of atts) {
          // 跳过已经处理过的（有 extracted_source 字段表示尝试过，无论结果）
          if (typeof att.extracted_source === 'string') continue;
          pending.push({ taskId, noteId, attachment: att });
        }
      }
    }

    const total = pending.length;
    const toProcess = pending.slice(0, maxItems);
    let succeeded = 0;
    let failed = 0;
    const failedIds: string[] = [];

    // 并发 3 个，避免打爆 OCR 上游
    const CONCURRENCY = 3;
    const queue = [...toProcess];
    const runners: Promise<void>[] = [];
    for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
      runners.push(
        (async () => {
          while (queue.length > 0) {
            const item = queue.shift()!;
            const attId = String(item.attachment.id ?? '');
            try {
              const buffer = await this.downloadAttachmentBuffer(item.attachment);
              if (!buffer || buffer.length === 0) {
                await this.updateAttachmentExtractedText(item.taskId, item.noteId, attId, '', 'failed');
                failed++;
                failedIds.push(attId);
                continue;
              }
              const result = await this.rdAiService.extractAttachmentText({
                originalname: String(item.attachment.name ?? 'attachment'),
                mimetype: typeof item.attachment.mime === 'string' ? item.attachment.mime : undefined,
                buffer,
              });
              await this.updateAttachmentExtractedText(
                item.taskId,
                item.noteId,
                attId,
                result.text,
                result.source,
              );
              if (result.source === 'failed') {
                failed++;
                failedIds.push(attId);
              } else {
                succeeded++;
              }
            } catch (err) {
              this.logger.warn(
                `[backfillTaskProgressNoteExtraction] failed for ${attId}: ${(err as Error).message}`,
              );
              await this.updateAttachmentExtractedText(item.taskId, item.noteId, attId, '', 'failed').catch(
                () => {},
              );
              failed++;
              failedIds.push(attId);
            }
          }
        })(),
      );
    }
    await Promise.all(runners);

    return {
      total_pending: total,
      processed: toProcess.length,
      succeeded,
      failed,
      has_more: total > maxItems,
      failed_ids: failedIds,
    };
  }

  /** 从 OSS 签名 URL 或 base64 data URI 还原附件 Buffer。失败返回 null。 */
  private async downloadAttachmentBuffer(attachment: JsonRecord): Promise<Buffer | null> {
    const objectKey = this.attachmentObjectKey(attachment);
    if (objectKey) {
      try {
        const object = await this.ossService.getObjectStream(objectKey);
        if (object) {
          if (object.size > PROGRESS_NOTE_MAX_FILE_BYTES) return null;
          const chunks: Buffer[] = [];
          let total = 0;
          for await (const chunk of object.stream as unknown as AsyncIterable<Buffer | Uint8Array | string>) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += buffer.length;
            if (total > PROGRESS_NOTE_MAX_FILE_BYTES) return null;
            chunks.push(buffer);
          }
          return Buffer.concat(chunks, total);
        }
      } catch {
        // Historical URLs remain a final fallback below.
      }
    }
    const dataUrl = typeof attachment.data_url === 'string' ? attachment.data_url : '';
    if (dataUrl.startsWith('data:')) {
      const commaIdx = dataUrl.indexOf(',');
      if (commaIdx > 0) {
        const base64 = dataUrl.slice(commaIdx + 1);
        try {
          return Buffer.from(base64, 'base64');
        } catch {
          return null;
        }
      }
    }
    const ossUrl = typeof attachment.oss_url === 'string' ? attachment.oss_url : '';
    if (ossUrl) {
      try {
        const response = await fetch(ossUrl);
        if (!response.ok) return null;
        const arrayBuf = await response.arrayBuffer();
        return Buffer.from(arrayBuf);
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * 异步抽取附件文本并回写到 rd.taskProgressNotes。
   * 串行处理以避免短时间内打爆 OCR / doc-turbo API。
   * 任何单个附件失败仅记录日志，不影响其他附件。
   */
  private async backfillAttachmentExtractedTexts(
    taskId: string,
    noteId: string,
    items: ProgressNoteAttachmentBuild[],
  ): Promise<void> {
    for (const item of items) {
      try {
        const buffer = item.buffer ?? await this.downloadAttachmentBuffer(item.attachment);
        if (!buffer || buffer.length === 0) throw new Error('附件内容读取失败');
        const result = await this.rdAiService.extractAttachmentText({
          originalname: item.originalname,
          mimetype: item.mimetype,
          buffer,
        });
        await this.updateAttachmentExtractedText(
          taskId,
          noteId,
          String(item.attachment.id ?? ''),
          result.text,
          result.source,
        );
      } catch (err) {
        this.logger.warn(
          `[backfillAttachmentExtractedTexts] failed for ${item.originalname}: ${(err as Error).message}`,
        );
        // 仍然标记 failed，避免下次重复尝试时无状态
        await this.updateAttachmentExtractedText(
          taskId,
          noteId,
          String(item.attachment.id ?? ''),
          '',
          'failed',
        ).catch(() => {});
      }
    }
  }

  private async updateAttachmentExtractedText(
    taskId: string,
    noteId: string,
    attachmentId: string,
    text: string,
    source: string,
  ): Promise<void> {
    // 锁内重读→改→写，串行化附件抽取回写，避免与并发写发生 lost-update（覆盖别的留痕/附件）。
    await this.withProgressNoteLock(async () => {
      const map = await this.getProgressNoteMap();
      const notes = Array.isArray(map[taskId]) ? map[taskId] : [];
      let mutated = false;
      const updatedNotes = notes.map((n) => {
        if (!isRecord(n) || n.id !== noteId) return n;
        const atts = asArray(n.attachments).filter(isRecord);
        const newAtts = atts.map((a) => {
          if (a.id !== attachmentId) return a;
          mutated = true;
          return {
            ...a,
            extracted_text: text,
            extracted_source: source,
            extracted_at: new Date().toISOString(),
          };
        });
        return { ...n, attachments: newAtts };
      });
      if (mutated) {
        map[taskId] = updatedNotes;
        await this.writeValue('rd.taskProgressNotes', map);
      }
    });
  }

  private async incrementTaskAttachmentCount(taskId: string, delta: number): Promise<void> {
    // 支持负增量（删除留痕附件时 -1），计数保底不为负
    if (!taskId || delta === 0) return;
    let found = false;

    const updateInTasks = (tasks: unknown[]): unknown[] =>
      tasks.map((task) => {
        if (!isRecord(task)) return task;
        if (task.task_id === taskId) {
          found = true;
          const current = typeof task.attachments === 'number' ? task.attachments : 0;
          return { ...task, attachments: Math.max(0, current + delta) };
        }
        if (Array.isArray(task.subtasks)) {
          return { ...task, subtasks: updateInTasks(task.subtasks) };
        }
        return task;
      });

    const { found: didFind } = await this.mutateTaskAcrossStores((categories) => {
      const updated = categories.map((category) => {
        if (!isRecord(category)) return category;
        return {
          ...category,
          children: asArray(category.children).map((child) => {
            if (!isRecord(child)) return child;
            return { ...child, tasks: updateInTasks(asArray(child.tasks)) };
          }),
        };
      });
      return { categories: updated, found };
    });

    if (!didFind) return;
    await this.recomputeDirectorDashboard();
  }

  /**
   * 进度留痕 map 的进程内写锁：`rd.taskProgressNotes` 是单个 JSON blob，创建留痕与异步附件抽取回写
   * 都做「读整块→改→写整块」。抽取(OCR/视觉)耗时数秒，多个 fire-and-forget 写在各自 await 处交错会造成
   * lost-update（后写的旧快照覆盖先写的更新）→ 留痕/附件被覆盖，出现「显示的图与刚上传的不一致」。
   * 用一个 promise 链把所有读-改-写串行化；读必须在锁内进行，才能拿到最新快照。
   * 注意：仅进程内串行（与现有单实例假设一致）；多实例部署需改用 DB 行级锁/乐观并发。
   */
  private progressNoteWriteLock: Promise<unknown> = Promise.resolve();
  private withProgressNoteLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.progressNoteWriteLock.then(fn, fn);
    this.progressNoteWriteLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async getProgressNoteMap(): Promise<Record<string, JsonRecord[]>> {
    const raw = await this.readValue('rd.taskProgressNotes');
    if (!isRecord(raw)) return {};
    const result: Record<string, JsonRecord[]> = {};
    for (const [taskId, list] of Object.entries(raw)) {
      if (Array.isArray(list)) {
        result[taskId] = (list as unknown[]).filter(isRecord);
      }
    }
    return result;
  }

  /** 从评分存储里取「总分 + 等级」摘要（移动端流式卡片只需这两项，不下发整份维度明细）。 */
  private extractCompletionScoreSummary(raw: unknown): { total: number; grade: string } | null {
    if (!isRecord(raw)) return null;
    const total = typeof raw.total === 'number' ? raw.total : null;
    const grade = typeof raw.grade === 'string' ? raw.grade.trim() : '';
    if (total === null || !grade) return null;
    return { total, grade };
  }

  private applyProgressAttachmentCounts(
    categories: JsonRecord[],
    noteMap: Record<string, JsonRecord[]>,
    scoreMap: JsonRecord = {},
    options: { includeCovers?: boolean } = {},
  ): JsonRecord[] {
    const attachmentCounts = new Map<string, number>();
    const latestNotes = new Map<string, JsonRecord>();
    // 移动端卡片只加载 480px WebP；原图能力 URL 仅在用户点开灯箱后加载。
    const coverImages = new Map<string, { full: string[]; thumbnails: string[] }>();
    for (const [taskId, notes] of Object.entries(noteMap)) {
      const count = notes.reduce((sum, note) => {
        return sum + (Array.isArray(note.attachments) ? note.attachments.length : 0);
      }, 0);
      attachmentCounts.set(taskId, count);
      const ordered = notes
        .slice()
        .sort((a, b) => cleanText(b.created_at).localeCompare(cleanText(a.created_at)));
      if (ordered[0]) latestNotes.set(taskId, ordered[0]);
      if (options.includeCovers) {
        const fullUrls: string[] = [];
        const thumbnailUrls: string[] = [];
        const seenObjectKeys = new Set<string>();
        for (const note of ordered) {
          if (!Array.isArray(note.attachments)) continue;
          for (const att of note.attachments) {
            if (!isRecord(att)) continue;
            const mime = typeof att.mime === 'string' ? att.mime : '';
            if (!mime.startsWith('image/')) continue;
            const objectKey = this.attachmentObjectKey(att);
            if (!objectKey || seenObjectKeys.has(objectKey)) continue;
            const fullUrl = this.buildAttachmentPreviewUrl(att);
            const thumbnailUrl = this.buildAttachmentThumbUrl(att, mime, 480);
            if (!fullUrl || !thumbnailUrl) continue;
            seenObjectKeys.add(objectKey);
            fullUrls.push(fullUrl);
            thumbnailUrls.push(thumbnailUrl);
            if (fullUrls.length >= 6) break;
          }
          if (fullUrls.length >= 6) break;
        }
        if (fullUrls.length) coverImages.set(taskId, { full: fullUrls, thumbnails: thumbnailUrls });
      }
    }

    const updateTasks = (tasks: unknown[]): unknown[] =>
      tasks.map((task) => {
        if (!isRecord(task)) return task;
        const taskKey = String(task.task_id ?? '');
        const progressAttachmentCount = attachmentCounts.get(taskKey) ?? 0;
        const existing = typeof task.attachments === 'number' ? task.attachments : 0;
        const latestNote = latestNotes.get(taskKey);
        const latestProgressSummary = this.normalizeLatestProgressSummary(latestNote);
        // 「最后活动时间」= max(任务字段更新时间, 最新进度留痕时间)。进度留痕写入独立存储、
        // 不刷新 task.updated_at；若列表仅按 updated_at 排序，会让刚写留痕的任务沉底，而卡片
        // 又按留痕时间显示「N 分钟前」——两套口径打架就会出现逆序。这里统一派生一个口径供
        // 排序与显示共用（派生值不入库、随读取实时计算，历史数据自动生效）。
        const noteTime = latestNote && typeof latestNote.created_at === 'string' ? latestNote.created_at : '';
        const updatedAt = typeof task.updated_at === 'string' ? task.updated_at : '';
        const lastActivityAt = noteTime > updatedAt ? noteTime : updatedAt;
        const taskCovers = coverImages.get(taskKey);
        const scoreSummary = this.extractCompletionScoreSummary(scoreMap[taskKey]);
        const {
          latest_progress_summary: _latestProgressSummary,
          last_activity_at: _lastActivityAt,
          cover_images: _coverImages,
          cover_image_thumbnails: _coverImageThumbnails,
          completion_score: _completionScore,
          ...taskRest
        } = task;
        return {
          ...taskRest,
          attachments: Math.max(existing, progressAttachmentCount),
          ...(latestProgressSummary ? { latest_progress_summary: latestProgressSummary } : {}),
          ...(lastActivityAt ? { last_activity_at: lastActivityAt } : {}),
          ...(taskCovers?.full.length
            ? {
                cover_images: taskCovers.full,
                cover_image_thumbnails: taskCovers.thumbnails,
              }
            : {}),
          ...(scoreSummary ? { completion_score: scoreSummary } : {}),
          subtasks: Array.isArray(task.subtasks) ? updateTasks(task.subtasks) : task.subtasks,
        };
      });

    return categories.map((category) => ({
      ...category,
      children: asArray(category.children).map((child) => {
        if (!isRecord(child)) return child;
        return { ...child, tasks: updateTasks(asArray(child.tasks)) };
      }),
    }));
  }

  private normalizeLatestProgressSummary(value: unknown): JsonRecord | null {
    if (!isRecord(value)) return null;
    const actor = isRecord(value.actor) ? value.actor : {};
    const attachmentsCount = Array.isArray(value.attachments)
      ? value.attachments.length
      : Number.isFinite(Number(value.attachments_count))
        ? Number(value.attachments_count)
        : 0;
    const text = cleanText(value.text);
    const fallbackText = attachmentsCount > 0 ? `上传了 ${attachmentsCount} 个附件` : '';
    const createdAt = cleanText(value.created_at);
    const progressValue = Number(value.progress);
    if (!text && !fallbackText) return null;

    return {
      text: text || fallbackText,
      progress: Number.isFinite(progressValue) ? Math.round(progressValue) : null,
      actor_name: cleanText(value.actor_name ?? actor.name) || '系统',
      actor_user_id: cleanUserId(value.actor_user_id ?? value.actor_id ?? actor.user_id ?? actor.id) || null,
      created_at: createdAt,
      attachments_count: attachmentsCount,
    };
  }

  // ── Daily reports ───────────────────────────────────────────────────────

  async listDailyReports(
    filters?: { user_id?: string; date?: string; limit?: number },
    viewer?: { userId?: string; hasFullAccess?: boolean },
  ) {
    const all = await this.readArray('rd.dailyReports');
    const reports = all.filter(isRecord);
    const limit = Math.max(1, Math.min(500, filters?.limit ?? 100));
    let filtered = reports;

    // Privacy: non-managers can only see their own daily reports
    if (viewer && !viewer.hasFullAccess) {
      const ownId = viewer.userId;
      if (!ownId) return [];
      filtered = filtered.filter((r) => r.user_id === ownId);
    }

    if (filters?.user_id) filtered = filtered.filter((r) => r.user_id === filters.user_id);
    if (filters?.date) filtered = filtered.filter((r) => r.date === filters.date);
    return filtered
      .slice()
      .sort((a, b) => {
        const aTime = typeof a.created_at === 'string' ? a.created_at : '';
        const bTime = typeof b.created_at === 'string' ? b.created_at : '';
        return bTime.localeCompare(aTime);
      })
      .slice(0, limit);
  }

  /**
   * 仅构造单份日报记录（含 AI 汇总），不落库。供 createDailyReport（写库）与
   * generateDailyReportsForAll（并发构造 + 末尾一次性写库）复用。
   */
  private async buildDailyReportRecord(
    payload: {
      user_id?: string | null;
      user_name?: string | null;
      date?: string;
      trigger?: 'manual' | 'cron';
    },
    shared?: RdReportSharedData,
  ): Promise<JsonRecord & { user_id: string | null; date: string }> {
    const date = payload.date && /^\d{4}-\d{2}-\d{2}$/.test(payload.date) ? payload.date : todayDateString();
    const userId = (payload.user_id ?? '').trim() || null;
    const userName = (payload.user_name ?? '').trim() || '我';

    // Collect today's activity for this user from progress notes + task changes
    const summary = await this.buildDailyReportSummary(userId, userName, date, shared);
    return {
      id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      user_id: userId,
      user_name: userName,
      date,
      trigger: payload.trigger ?? 'manual',
      summary,
      created_at: new Date().toISOString(),
    };
  }

  async createDailyReport(payload: {
    user_id?: string | null;
    user_name?: string | null;
    date?: string;
    trigger?: 'manual' | 'cron';
  }) {
    const report = await this.buildDailyReportRecord(payload);
    const { user_id: userId, date } = report;

    const all = await this.readArray('rd.dailyReports');
    const filtered = all.filter(isRecord);
    // Replace existing same-day report for the same user (keep one per user per day)
    const deduped = filtered.filter((r) => !(r.user_id === userId && r.date === date));
    const next = [report, ...deduped].slice(0, 1000);
    await this.writeValue('rd.dailyReports', next);
    return report;
  }

  /**
   * Auto-run by cron: generate a daily report for every active user who had
   * activity today (progress notes, tasks assigned to them, etc.).
   */
  async generateDailyReportsForAll(date?: string, trigger: 'manual' | 'cron' = 'cron') {
    const targetDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : todayDateString();

    // Determine users with activity today: union of (people from rd.people) and
    // anyone who created a progress note today.
    const peopleList = await this.readArray('rd.people');
    const noteMap = await this.getProgressNoteMap();
    const activeUserIds = new Set<string>();
    const activeUserNames = new Map<string, string>();

    for (const notes of Object.values(noteMap)) {
      for (const note of notes) {
        if (typeof note.created_at !== 'string' || !note.created_at.startsWith(targetDate)) continue;
        const actor = isRecord(note.actor) ? note.actor : null;
        if (actor) {
          const id = typeof actor.id === 'string' ? actor.id : '';
          const name = typeof actor.name === 'string' ? actor.name : '';
          if (id) {
            activeUserIds.add(id);
            if (name) activeUserNames.set(id, name);
          }
        }
      }
    }

    // Also generate for every person record (even with no notes — they'll get a summary noting low activity)
    for (const p of peopleList) {
      if (!isRecord(p)) continue;
      const userId = typeof p.user_id === 'string' ? p.user_id : null;
      if (userId) {
        activeUserIds.add(userId);
        if (typeof p.name === 'string') activeUserNames.set(userId, p.name);
      }
    }

    // 预读跨成员共享的全表数据一次，传给每位成员的构造逻辑（避免逐人重读）。
    const shared: RdReportSharedData = {
      categories: await this.readMergedTaskCategories(),
      noteMap,
    };

    // 并发构造各成员日报（每份含一次 AI 汇总）；有限并发避免击穿 AI 限流。
    // 仅构造、不落库——所有写操作集中在末尾一次完成，消除逐人「读改写整表」的写放大与竞态。
    const CONCURRENCY = 4;
    const queue = [...activeUserIds];
    const results: JsonRecord[] = [];
    const runners: Promise<void>[] = [];
    for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
      runners.push(
        (async () => {
          while (queue.length > 0) {
            const userId = queue.shift()!;
            try {
              const report = await this.buildDailyReportRecord(
                {
                  user_id: userId,
                  user_name: activeUserNames.get(userId),
                  date: targetDate,
                  trigger,
                },
                shared,
              );
              results.push(report);
            } catch (err) {
              // Skip individual failures; logged but don't break the loop
              // eslint-disable-next-line no-console
              console.error(`[generateDailyReportsForAll] user=${userId}`, err);
            }
          }
        })(),
      );
    }
    await Promise.all(runners);

    // 末尾一次性合并落库：同一用户同一天只保留新生成的一份。
    const all = (await this.readArray('rd.dailyReports')).filter(isRecord);
    const dailyKey = (r: JsonRecord) => `${String(r.user_id ?? '')}::${String(r.date ?? '')}`;
    const freshKeys = new Set(results.map(dailyKey));
    const deduped = all.filter((r) => !freshKeys.has(dailyKey(r)));
    const next = [...results, ...deduped].slice(0, 1000);
    await this.writeValue('rd.dailyReports', next);
    return { date: targetDate, count: results.length };
  }

  private async buildDailyReportSummary(
    userId: string | null,
    userName: string,
    date: string,
    shared?: RdReportSharedData,
  ) {
    // 1. 归集该成员当日相关任务：主责 + 协作，跨所有产品库聚合，排除已归档。
    //    （旧实现只读主库且只算主责，会漏掉协作任务与产品库任务。）
    // 全员生成时由调用方传入预读数据，避免逐人重读全表（见 RdReportSharedData）。
    const categories = shared?.categories ?? (await this.readMergedTaskCategories());
    const allTasks = this.collectAllCategoryTasks(categories);
    const noteMap = shared?.noteMap ?? (await this.getProgressNoteMap());

    const userKey = userId ? `u:${cleanUserId(userId)}` : '';
    const nameKey = personNameLookupKey(userName);
    const matchesUser = (idVal: unknown, nameVal: unknown): boolean => {
      const uid = cleanUserId(idVal);
      if (userKey && uid && `u:${uid}` === userKey) return true;
      const nk = personNameLookupKey(nameVal);
      return Boolean(nameKey && nk && nk === nameKey);
    };

    // 某任务今日由本人提交的进度记录（升序，末位即最新一条，作为画像）
    const todayNotesForTask = (taskId: string): JsonRecord[] => {
      const notes = noteMap[taskId];
      if (!Array.isArray(notes)) return [];
      return notes
        .filter((note) => {
          if (typeof note.created_at !== 'string' || !note.created_at.startsWith(date)) return false;
          const actor = isRecord(note.actor) ? note.actor : null;
          return Boolean(actor && matchesUser(actor.id, actor.name));
        })
        .sort((a, b) => cleanText(a.created_at).localeCompare(cleanText(b.created_at)));
    };

    type DailyGroup = 'completed_today' | 'progressed' | 'stalled' | 'blocked';
    type DailyTaskItem = {
      task_id: string;
      title: string;
      status: string;
      status_label: string;
      progress: number | null;
      due_date: string | null;
      role: 'owner' | 'collaborator';
      group: DailyGroup;
      today_note_id: string | null;
      today_excerpt: string | null;
      today_progress: number | null;
      today_attachments: number;
      blocked_reason: string | null;
    };

    let totalTasks = 0;
    let asCollaborator = 0;
    let inProgress = 0;
    let completed = 0;
    let blocked = 0;
    let pending = 0;
    let notesCount = 0;
    const items: DailyTaskItem[] = [];

    for (const task of allTasks) {
      if (isArchivedTask(task)) continue;
      const isOwner = matchesUser(
        task.primary_owner_user_id ?? task.owner_user_id,
        task.primary_owner ?? task.owner,
      );
      const collaborators = asArray(task.collaborators).filter(isRecord);
      const isCollaborator = !isOwner && collaborators.some((c) => matchesUser(c.user_id, c.name));
      if (!isOwner && !isCollaborator) continue;

      totalTasks += 1;
      if (!isOwner) asCollaborator += 1;
      const role: 'owner' | 'collaborator' = isOwner ? 'owner' : 'collaborator';

      const status = cleanText(task.status) || 'in_progress';
      if (status === 'in_progress') inProgress += 1;
      else if (status === 'completed') completed += 1;
      else if (status === 'paused_blocked') blocked += 1;
      else if (status === 'pending_assign' || status === 'pending_review') pending += 1;

      const taskId = cleanText(task.task_id);
      const todayNotes = taskId ? todayNotesForTask(taskId) : [];
      notesCount += todayNotes.length;
      const latestNote = todayNotes.length > 0 ? todayNotes[todayNotes.length - 1] : null;
      const hasTodayNote = todayNotes.length > 0;
      const isBlocked = status === 'paused_blocked';
      const isCompleted = status === 'completed';

      // 分组优先级：阻塞 > 今日完成 > 今日有进展 > 停滞无进展。
      // 历史完成（无今日记录）/ 草稿 / 挂起 / 请假 仅计入统计，不进正文。
      let group: DailyGroup | null = null;
      if (isBlocked) {
        group = 'blocked';
      } else if (isCompleted && hasTodayNote) {
        group = 'completed_today';
      } else if (isCompleted) {
        group = null;
      } else if (hasTodayNote) {
        group = 'progressed';
      } else if (status === 'in_progress' || status === 'pending_review' || status === 'pending_assign') {
        group = 'stalled';
      } else {
        group = null;
      }
      if (!group) continue;

      items.push({
        task_id: taskId,
        title: cleanText(task.title) || '未命名任务',
        status,
        status_label: this.taskStatusLabel(task.status),
        progress: typeof task.progress === 'number' ? task.progress : null,
        due_date: cleanText(task.due_date) || null,
        role,
        group,
        today_note_id: latestNote ? cleanText(latestNote.id) || null : null,
        today_excerpt: latestNote ? cleanText(latestNote.text).slice(0, 120) || null : null,
        today_progress: latestNote && typeof latestNote.progress === 'number' ? latestNote.progress : null,
        today_attachments: latestNote && Array.isArray(latestNote.attachments) ? latestNote.attachments.length : 0,
        blocked_reason: isBlocked ? cleanText(task.blocked_reason) || '当前任务存在阻塞' : null,
      });
    }

    const groupRank: Record<DailyGroup, number> = {
      completed_today: 0,
      progressed: 1,
      stalled: 2,
      blocked: 3,
    };
    items.sort((a, b) => {
      if (groupRank[a.group] !== groupRank[b.group]) return groupRank[a.group] - groupRank[b.group];
      if (a.role !== b.role) return a.role === 'owner' ? -1 : 1;
      return a.title.localeCompare(b.title, 'zh-CN');
    });

    const stalled = items.filter((it) => it.group === 'stalled').length;
    const stats = {
      total_tasks: totalTasks,
      in_progress: inProgress,
      completed,
      blocked,
      pending,
      notes_count: notesCount,
      stalled,
      as_collaborator: asCollaborator,
    };

    // 2. 优先调用 AI 模型生成日报正文；失败/未配置时回退到本地按分组拼接版本。
    let summaryText: string;
    const aiResult = await this.rdAiService.summarizeDailyReport({
      userName,
      date,
      stats: {
        totalTasks,
        inProgress,
        completed,
        blocked,
        pending,
        notesCount,
        stalled,
        asCollaborator,
      },
      tasks: items.map((it) => ({
        title: it.title,
        role: it.role === 'owner' ? '主责' : '协作',
        statusLabel: it.status_label,
        group: it.group,
        progress: it.progress,
        dueDate: it.due_date,
        todayExcerpt: it.today_excerpt,
        todayAttachments: it.today_attachments,
        blockedReason: it.blocked_reason,
      })),
    });

    const groupMeta: Array<{ key: DailyGroup; emoji: string; label: string }> = [
      { key: 'completed_today', emoji: '✅', label: '今日完成' },
      { key: 'progressed', emoji: '🟦', label: '今日有进展' },
      { key: 'stalled', emoji: '🔔', label: '停滞·今日无进展' },
      { key: 'blocked', emoji: '⚠️', label: '阻塞·需关注' },
    ];

    if (aiResult) {
      summaryText = `【${userName} · ${date} 工作日报】\n\n${aiResult.text}`;
    } else {
      // 本地兜底：AI 未配置 / 调用失败时按分组拼出可读文本
      const lines: string[] = [];
      lines.push(`【${userName} · ${date} 工作日报】`);
      lines.push('');
      lines.push(
        `📊 任务概况：共 ${totalTasks} 个任务（主责 ${totalTasks - asCollaborator} · 协作 ${asCollaborator}）` +
          `｜进行中 ${inProgress} · 已完成 ${completed} · 阻塞 ${blocked} · 待办 ${pending}`,
      );
      for (const meta of groupMeta) {
        const groupItems = items.filter((it) => it.group === meta.key);
        if (groupItems.length === 0) continue;
        lines.push('');
        lines.push(`${meta.emoji} ${meta.label}（${groupItems.length}）`);
        for (const it of groupItems) {
          const roleTag = it.role === 'collaborator' ? '[协作] ' : '';
          const prog = typeof it.progress === 'number' ? ` · 进度 ${it.progress}%` : '';
          const due = it.due_date ? ` · 截止 ${it.due_date}` : '';
          lines.push(`  • ${roleTag}《${it.title}》（${it.status_label}${prog}${due}）`);
          if (it.group === 'blocked' && it.blocked_reason) {
            lines.push(`    阻塞原因：${it.blocked_reason}`);
          } else if (it.today_excerpt) {
            const att = it.today_attachments > 0 ? `（${it.today_attachments} 个附件）` : '';
            lines.push(`    ${it.today_excerpt}${att}`);
          }
        }
      }
      if (items.length === 0) {
        lines.push('');
        lines.push('📭 今日暂无需要关注的任务动态，请确认任务分配与推进情况。');
      }
      summaryText = lines.join('\n');
    }

    return {
      text: summaryText,
      stats,
      tasks: items,
      note_refs: items
        .filter((it) => it.today_note_id)
        .map((it) => ({
          note_id: it.today_note_id ?? '',
          task_id: it.task_id,
          progress: it.today_progress,
          excerpt: it.today_excerpt ?? '',
          attachments_count: it.today_attachments,
        })),
    };
  }

  // ── Monthly reports（月报，复用日报数据采集，按月份区间切片）────────────────

  async listMonthlyReports(
    filters?: { user_id?: string; month?: string; limit?: number },
    viewer?: { userId?: string; hasFullAccess?: boolean },
  ) {
    const all = await this.readArray('rd.monthlyReports');
    const reports = all.filter(isRecord);
    const limit = Math.max(1, Math.min(500, filters?.limit ?? 100));
    let filtered = reports;

    // Privacy: 非管理者只能看自己的月报
    if (viewer && !viewer.hasFullAccess) {
      const ownId = viewer.userId;
      if (!ownId) return [];
      filtered = filtered.filter((r) => r.user_id === ownId);
    }

    if (filters?.user_id) filtered = filtered.filter((r) => r.user_id === filters.user_id);
    if (filters?.month) filtered = filtered.filter((r) => r.month === filters.month);
    return filtered
      .slice()
      .sort((a, b) => cleanText(b.created_at).localeCompare(cleanText(a.created_at)))
      .slice(0, limit);
  }

  /**
   * 仅构造单份月报记录（含 AI 汇总），不落库。供 createMonthlyReport（写库）与
   * generateMonthlyReportsForAll（并发构造 + 末尾一次性写库）复用。
   */
  private async buildMonthlyReportRecord(
    payload: {
      user_id?: string | null;
      user_name?: string | null;
      month?: string;
      trigger?: 'manual' | 'cron';
    },
    shared?: RdReportSharedData,
  ): Promise<JsonRecord & { user_id: string | null; month: string }> {
    const month = payload.month && /^\d{4}-\d{2}$/.test(payload.month) ? payload.month : monthDateString();
    const userId = (payload.user_id ?? '').trim() || null;
    const userName = (payload.user_name ?? '').trim() || '我';

    const summary = await this.buildMonthlyReportSummary(userId, userName, month, shared);
    return {
      id: `mrep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      user_id: userId,
      user_name: userName,
      month,
      trigger: payload.trigger ?? 'manual',
      summary,
      created_at: new Date().toISOString(),
    };
  }

  async createMonthlyReport(payload: {
    user_id?: string | null;
    user_name?: string | null;
    month?: string;
    trigger?: 'manual' | 'cron';
  }) {
    const report = await this.buildMonthlyReportRecord(payload);
    const { user_id: userId, month } = report;

    const all = await this.readArray('rd.monthlyReports');
    const filtered = all.filter(isRecord);
    // 同一用户同一月份只保留一份
    const deduped = filtered.filter((r) => !(r.user_id === userId && r.month === month));
    const next = [report, ...deduped].slice(0, 1000);
    await this.writeValue('rd.monthlyReports', next);
    return report;
  }

  /** 全员月报：对当月（或指定月）有活动的成员 + 全部人员各生成一份。 */
  async generateMonthlyReportsForAll(month?: string, trigger: 'manual' | 'cron' = 'cron') {
    const targetMonth = month && /^\d{4}-\d{2}$/.test(month) ? month : monthDateString();
    const { start, endExclusive } = monthRange(targetMonth);

    const peopleList = await this.readArray('rd.people');
    const noteMap = await this.getProgressNoteMap();
    const activeUserIds = new Set<string>();
    const activeUserNames = new Map<string, string>();

    for (const notes of Object.values(noteMap)) {
      for (const note of notes) {
        const created = typeof note.created_at === 'string' ? note.created_at : '';
        if (!(created >= start && created < endExclusive)) continue;
        const actor = isRecord(note.actor) ? note.actor : null;
        if (actor) {
          const id = typeof actor.id === 'string' ? actor.id : '';
          const name = typeof actor.name === 'string' ? actor.name : '';
          if (id) {
            activeUserIds.add(id);
            if (name) activeUserNames.set(id, name);
          }
        }
      }
    }

    for (const p of peopleList) {
      if (!isRecord(p)) continue;
      const userId = typeof p.user_id === 'string' ? p.user_id : null;
      if (userId) {
        activeUserIds.add(userId);
        if (typeof p.name === 'string') activeUserNames.set(userId, p.name);
      }
    }

    // 预读跨成员共享的全表数据一次，传给每位成员的构造逻辑（避免逐人重读）。
    const shared: RdReportSharedData = {
      categories: await this.readMergedTaskCategories(),
      noteMap,
    };

    // 并发构造各成员月报（每份含一次 AI 汇总）；有限并发避免击穿 AI 限流。
    // 仅构造、不落库——所有写操作集中在末尾一次完成，消除逐人「读改写整表」的写放大与竞态。
    const CONCURRENCY = 4;
    const queue = [...activeUserIds];
    const results: JsonRecord[] = [];
    const runners: Promise<void>[] = [];
    for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
      runners.push(
        (async () => {
          while (queue.length > 0) {
            const userId = queue.shift()!;
            try {
              const report = await this.buildMonthlyReportRecord(
                {
                  user_id: userId,
                  user_name: activeUserNames.get(userId),
                  month: targetMonth,
                  trigger,
                },
                shared,
              );
              results.push(report);
            } catch (err) {
              // eslint-disable-next-line no-console
              console.error(`[generateMonthlyReportsForAll] user=${userId}`, err);
            }
          }
        })(),
      );
    }
    await Promise.all(runners);

    // 末尾一次性合并落库：同一用户同一月份只保留新生成的一份。
    const all = (await this.readArray('rd.monthlyReports')).filter(isRecord);
    const monthlyKey = (r: JsonRecord) => `${String(r.user_id ?? '')}::${String(r.month ?? '')}`;
    const freshKeys = new Set(results.map(monthlyKey));
    const deduped = all.filter((r) => !freshKeys.has(monthlyKey(r)));
    const next = [...results, ...deduped].slice(0, 1000);
    await this.writeValue('rd.monthlyReports', next);
    return { month: targetMonth, count: results.length };
  }

  /**
   * 归集某成员在指定月份的任务画像（主责 + 协作，跨产品库聚合，排除归档）。
   * 月报与绩效共用：仅纳入「本月有进度记录」或「当前仍处活动态」的任务，
   * 历史完成且本月无活动者不计入月度画像。
   */
  private async collectUserMonthlyTasks(
    userId: string | null,
    userName: string,
    month: string,
    shared?: RdReportSharedData,
  ): Promise<{
    items: MonthlyReportTaskItem[];
    stats: {
      total_tasks: number;
      in_progress: number;
      completed: number;
      blocked: number;
      pending: number;
      notes_count: number;
      stalled: number;
      as_collaborator: number;
      progressed: number;
    };
    metrics: PerformanceMetrics;
  }> {
    const { start, endExclusive } = monthRange(month);
    // 「今天」(UTC+8 业务日历日，与 due_date 的 YYYY-MM-DD 同口径)，用于"逾期"判定下界：
    // 仅当截止日已真正过去(< 今天)才算逾期。否则本月内"尚未到期"的任务会被误判为逾期。
    const todayStr = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    // 全员生成时由调用方传入预读数据，避免逐人重读全表（见 RdReportSharedData）。
    const categories = shared?.categories ?? (await this.readMergedTaskCategories());
    const allTasks = this.collectAllCategoryTasks(categories);
    const noteMap = shared?.noteMap ?? (await this.getProgressNoteMap());

    const userKey = userId ? `u:${cleanUserId(userId)}` : '';
    const nameKey = personNameLookupKey(userName);
    const matchesUser = (idVal: unknown, nameVal: unknown): boolean => {
      const uid = cleanUserId(idVal);
      if (userKey && uid && `u:${uid}` === userKey) return true;
      const nk = personNameLookupKey(nameVal);
      return Boolean(nameKey && nk && nk === nameKey);
    };

    const monthNotesForTask = (taskId: string): JsonRecord[] => {
      const notes = noteMap[taskId];
      if (!Array.isArray(notes)) return [];
      return notes
        .filter((note) => {
          const created = typeof note.created_at === 'string' ? note.created_at : '';
          if (!(created >= start && created < endExclusive)) return false;
          const actor = isRecord(note.actor) ? note.actor : null;
          return Boolean(actor && matchesUser(actor.id, actor.name));
        })
        .sort((a, b) => cleanText(a.created_at).localeCompare(cleanText(b.created_at)));
    };

    let totalTasks = 0;
    let ownerTasks = 0;
    let asCollaborator = 0;
    let inProgress = 0;
    let completed = 0;
    let blocked = 0;
    let pending = 0;
    let stalledCount = 0;
    let progressedCount = 0;
    let notesCount = 0;
    let attachmentsCount = 0;
    let overdueCount = 0;
    const items: MonthlyReportTaskItem[] = [];

    for (const task of allTasks) {
      if (isArchivedTask(task)) continue;
      const isOwner = matchesUser(
        task.primary_owner_user_id ?? task.owner_user_id,
        task.primary_owner ?? task.owner,
      );
      const collaborators = asArray(task.collaborators).filter(isRecord);
      const isCollaborator = !isOwner && collaborators.some((c) => matchesUser(c.user_id, c.name));
      if (!isOwner && !isCollaborator) continue;

      const taskId = cleanText(task.task_id);
      const monthNotes = taskId ? monthNotesForTask(taskId) : [];
      const hasMonthNote = monthNotes.length > 0;
      const status = cleanText(task.status) || 'in_progress';
      const isBlocked = status === 'paused_blocked';
      const isCompleted = status === 'completed';
      const isActiveNow =
        status === 'in_progress' ||
        status === 'paused_blocked' ||
        status === 'pending_review' ||
        status === 'pending_assign' ||
        status === 'paused_leave' ||
        status === 'on_hold' ||
        status === 'draft';

      // 仅纳入「本月有活动」或「当前仍处活动态」的任务。
      if (!hasMonthNote && !isActiveNow) continue;

      // 月度分组（月末状态口径，不依赖状态变更历史）：
      //  completed  本月有活动且当前已完成
      //  blocked    月末仍阻塞
      //  progressed 本月有进度记录、未完成、未阻塞
      //  stalled    本月零进度、未完成、仍处活动态（长期停滞）
      let group: MonthlyReportGroup | null = null;
      if (isCompleted && hasMonthNote) group = 'completed';
      else if (isCompleted) group = null;
      else if (isBlocked) group = 'blocked';
      else if (hasMonthNote) group = 'progressed';
      else group = 'stalled';
      if (!group) continue;

      totalTasks += 1;
      if (isOwner) ownerTasks += 1;
      else asCollaborator += 1;
      if (group === 'completed') completed += 1;
      else if (status === 'in_progress') inProgress += 1;
      else if (status === 'paused_blocked') blocked += 1;
      else if (status === 'pending_assign' || status === 'pending_review') pending += 1;
      if (group === 'stalled') stalledCount += 1;
      if (group === 'progressed') progressedCount += 1;

      const monthAttachments = monthNotes.reduce(
        (sum, note) => sum + (Array.isArray(note.attachments) ? note.attachments.length : 0),
        0,
      );
      notesCount += monthNotes.length;
      attachmentsCount += monthAttachments;

      const dueDate = cleanText(task.due_date) || null;
      // 逾期 = 未完成 且 截止日在报告月末之前(dueDate < endExclusive) 且 截止日已真正过去(dueDate < 今天)。
      // 过去月的报告：endExclusive 已是过去，是更紧的约束，历史口径不变；
      // 当月报告：补上 dueDate < todayStr，避免"本月内尚未到期"的任务被恒判为逾期（原 bug）。
      const overdue = Boolean(!isCompleted && dueDate && dueDate < endExclusive && dueDate < todayStr);
      if (overdue) overdueCount += 1;

      const latestNote = monthNotes.length > 0 ? monthNotes[monthNotes.length - 1] : null;
      items.push({
        task_id: taskId,
        title: cleanText(task.title) || '未命名任务',
        status,
        status_label: this.taskStatusLabel(task.status),
        progress: typeof task.progress === 'number' ? task.progress : null,
        due_date: dueDate,
        role: isOwner ? 'owner' : 'collaborator',
        group,
        month_notes_count: monthNotes.length,
        month_excerpt: latestNote ? cleanText(latestNote.text).slice(0, 140) || null : null,
        month_progress: latestNote && typeof latestNote.progress === 'number' ? latestNote.progress : null,
        month_attachments: monthAttachments,
        blocked_reason: isBlocked ? cleanText(task.blocked_reason) || '当前任务存在阻塞' : null,
        overdue,
      });
    }

    const groupRank: Record<MonthlyReportGroup, number> = {
      completed: 0,
      progressed: 1,
      blocked: 2,
      stalled: 3,
    };
    items.sort((a, b) => {
      if (groupRank[a.group] !== groupRank[b.group]) return groupRank[a.group] - groupRank[b.group];
      if (a.role !== b.role) return a.role === 'owner' ? -1 : 1;
      return a.title.localeCompare(b.title, 'zh-CN');
    });

    const completionBase = completed + inProgress + blocked + pending + stalledCount;
    const completionRate = completionBase > 0 ? Math.round((completed / completionBase) * 100) : 0;

    return {
      items,
      stats: {
        total_tasks: totalTasks,
        in_progress: inProgress,
        completed,
        blocked,
        pending,
        notes_count: notesCount,
        stalled: stalledCount,
        as_collaborator: asCollaborator,
        progressed: progressedCount,
      },
      metrics: {
        total_tasks: totalTasks,
        owner_tasks: ownerTasks,
        collab_tasks: asCollaborator,
        completed,
        in_progress: inProgress,
        blocked,
        stalled: stalledCount,
        pending,
        notes_count: notesCount,
        attachments_count: attachmentsCount,
        overdue_tasks: overdueCount,
        completion_rate: completionRate,
      },
    };
  }

  private async buildMonthlyReportSummary(
    userId: string | null,
    userName: string,
    month: string,
    shared?: RdReportSharedData,
  ) {
    const { items, stats } = await this.collectUserMonthlyTasks(userId, userName, month, shared);
    const { label } = monthRange(month);

    const aiResult = await this.rdAiService.summarizeMonthlyReport({
      userName,
      monthLabel: label,
      stats: {
        totalTasks: stats.total_tasks,
        inProgress: stats.in_progress,
        completed: stats.completed,
        blocked: stats.blocked,
        pending: stats.pending,
        notesCount: stats.notes_count,
        stalled: stats.stalled,
        asCollaborator: stats.as_collaborator,
        progressed: stats.progressed,
      },
      tasks: items.map((it) => ({
        title: it.title,
        role: it.role === 'owner' ? '主责' : '协作',
        statusLabel: it.status_label,
        group: it.group,
        progress: it.progress,
        dueDate: it.due_date,
        monthNotesCount: it.month_notes_count,
        monthExcerpt: it.month_excerpt,
        monthAttachments: it.month_attachments,
        blockedReason: it.blocked_reason,
        overdue: it.overdue,
      })),
    });

    const groupMeta: Array<{ key: MonthlyReportGroup; emoji: string; label: string }> = [
      { key: 'completed', emoji: '✅', label: '本月完成' },
      { key: 'progressed', emoji: '🟦', label: '本月推进' },
      { key: 'blocked', emoji: '⚠️', label: '月末仍阻塞' },
      { key: 'stalled', emoji: '🔔', label: '长期停滞' },
    ];

    let summaryText: string;
    if (aiResult) {
      summaryText = `【${userName} · ${label}工作月报】\n\n${aiResult.text}`;
    } else {
      const lines: string[] = [];
      lines.push(`【${userName} · ${label}工作月报】`);
      lines.push('');
      lines.push(
        `📊 月度概况：本月相关任务 ${stats.total_tasks} 个（主责 ${stats.total_tasks - stats.as_collaborator} · 协作 ${stats.as_collaborator}）` +
          `｜完成 ${stats.completed} · 推进 ${stats.progressed} · 阻塞 ${stats.blocked} · 停滞 ${stats.stalled}｜进度记录 ${stats.notes_count} 条`,
      );
      for (const meta of groupMeta) {
        const groupItems = items.filter((it) => it.group === meta.key);
        if (groupItems.length === 0) continue;
        lines.push('');
        lines.push(`${meta.emoji} ${meta.label}（${groupItems.length}）`);
        for (const it of groupItems) {
          const roleTag = it.role === 'collaborator' ? '[协作] ' : '';
          const prog = typeof it.progress === 'number' ? ` · 进度 ${it.progress}%` : '';
          const due = it.due_date ? ` · 截止 ${it.due_date}` : '';
          lines.push(`  • ${roleTag}《${it.title}》（${it.status_label}${prog}${due}）`);
          if (it.group === 'blocked' && it.blocked_reason) {
            lines.push(`    阻塞原因：${it.blocked_reason}`);
          } else if (it.month_excerpt) {
            const extra = it.month_notes_count > 1 ? `（本月 ${it.month_notes_count} 条记录）` : '';
            lines.push(`    最新进展：${it.month_excerpt}${extra}`);
          }
        }
      }
      if (items.length === 0) {
        lines.push('');
        lines.push('📭 本月暂无可统计的任务动态。');
      }
      summaryText = lines.join('\n');
    }

    return {
      text: summaryText,
      stats,
      tasks: items,
      note_refs: items
        .filter((it) => it.month_notes_count > 0)
        .map((it) => ({
          note_id: '',
          task_id: it.task_id,
          progress: it.month_progress,
          excerpt: it.month_excerpt ?? '',
          attachments_count: it.month_attachments,
        })),
    };
  }

  // ── Performance reviews（月度绩效，AI 生成正式考核结论；评价从宽）──────────────

  async listPerformanceReports(
    filters?: { user_id?: string; month?: string; limit?: number },
    viewer?: { userId?: string; hasFullAccess?: boolean },
  ) {
    const all = await this.readArray('rd.performanceReports');
    const reports = all.filter(isRecord);
    const limit = Math.max(1, Math.min(500, filters?.limit ?? 100));
    let filtered = reports;

    // Privacy: 非管理者只能看自己的绩效
    if (viewer && !viewer.hasFullAccess) {
      const ownId = viewer.userId;
      if (!ownId) return [];
      filtered = filtered.filter((r) => r.user_id === ownId);
    }

    if (filters?.user_id) filtered = filtered.filter((r) => r.user_id === filters.user_id);
    if (filters?.month) filtered = filtered.filter((r) => r.month === filters.month);
    return filtered
      .slice()
      .sort((a, b) => cleanText(b.created_at).localeCompare(cleanText(a.created_at)))
      .slice(0, limit);
  }

  async createPerformanceReport(payload: {
    user_id?: string | null;
    user_name?: string | null;
    month?: string;
    trigger?: 'manual' | 'cron';
  }) {
    const month = payload.month && /^\d{4}-\d{2}$/.test(payload.month) ? payload.month : monthDateString();
    const userId = (payload.user_id ?? '').trim() || null;
    const userName = (payload.user_name ?? '').trim() || '我';

    const summary = await this.buildPerformanceReview(userId, userName, month);

    const all = await this.readArray('rd.performanceReports');
    const filtered = all.filter(isRecord);

    // 重新生成保分：沿用同一 user+month 上已填的自评 / 主管评分，仅刷新指标与 AI 文本。
    const prior = filtered.find((r) => r.user_id === userId && r.month === month);
    const priorSummary = prior && isRecord(prior.summary) ? prior.summary : null;
    const carriedSelf = priorSummary && isRecord(priorSummary.self_assessment) ? priorSummary.self_assessment : null;
    const carriedSupervisor =
      priorSummary && isRecord(priorSummary.supervisor_assessment) ? priorSummary.supervisor_assessment : null;

    const report = {
      id: `perf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      user_id: userId,
      user_name: userName,
      month,
      trigger: payload.trigger ?? 'manual',
      summary: {
        ...summary,
        self_assessment: carriedSelf,
        supervisor_assessment: carriedSupervisor,
      },
      created_at: new Date().toISOString(),
    };

    const deduped = filtered.filter((r) => !(r.user_id === userId && r.month === month));
    const next = [report, ...deduped].slice(0, 1000);
    await this.writeValue('rd.performanceReports', next);

    // 每次生成/重新生成都给该成员（有账号 ID）重发自评通知：报表内容可能已变，需重新确认/自评。
    // notifyPerformanceSelfAssessment 会先把同月旧的自评待办标为已处理再发新的，故不会堆叠重复。
    if (userId) {
      await this.notifyPerformanceSelfAssessment(report).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[createPerformanceReport] notify self-assessment failed', err);
      });
    }
    return report;
  }

  /** 给被考核成员发一条「绩效自评」站内消息（结构化 body，前端据 type 打开自评弹窗）。 */
  private async notifyPerformanceSelfAssessment(report: {
    id: string;
    user_id: string | null;
    user_name: string;
    month: string;
    summary: { period_label?: string };
  }): Promise<void> {
    if (!report.user_id) return;
    const periodLabel = report.summary?.period_label ?? report.month;

    // 先把该成员同月旧的「绩效自评」通知置为已处理，避免重新生成产生重复待办。
    await this.markPerfMessagesHandled(report.user_id, (parsed) => parsed.month === report.month);

    const body = JSON.stringify({
      type: 'perf_self_assessment',
      report_id: report.id,
      month: report.month,
      period_label: periodLabel,
      user_name: report.user_name,
    });
    await this.createMessage({
      // 绩效虽由研发服务发出，但对用户而言是独立模块，归到研发下会误导
      source: 'performance',
      sender: { id: null, name: '系统通知', role: 'system' },
      recipient_id: report.user_id,
      recipient_name: report.user_name,
      subject: `[绩效自评] ${periodLabel}月度绩效已生成，请完成自评`,
      body,
    });
  }

  /** 成员提交本人绩效自评（逐考核项打分 + 说明）。仅本人可提交。 */
  async submitPerformanceSelfAssessment(
    reportId: string,
    payload: { scores?: unknown; comment?: string },
    actor: { userId?: string; userName?: string },
  ) {
    const scores = normalizePerfItemScores(payload.scores);
    const comment = (payload.comment ?? '').trim().slice(0, 2000);

    const all = (await this.readArray('rd.performanceReports')).filter(isRecord);
    const idx = all.findIndex((r) => r.id === reportId);
    if (idx < 0) throw new NotFoundException('绩效报表不存在');
    const report = all[idx];
    if (!actor.userId || report.user_id !== actor.userId) {
      throw new ForbiddenException('只能对本人的绩效进行自评');
    }

    const summary = isRecord(report.summary) ? report.summary : {};
    const selfAssessment = {
      scores,
      comment,
      submitted_at: new Date().toISOString(),
      by_id: actor.userId,
      by_name: actor.userName ?? report.user_name ?? '我',
    };
    const updated = { ...report, summary: { ...summary, self_assessment: selfAssessment } };
    const next = all.slice();
    next[idx] = updated;
    await this.writeValue('rd.performanceReports', next);

    // 自评提交后把相关「绩效自评」通知标为已处理，从待办中移除。
    await this.markPerfSelfAssessmentMessagesHandled(reportId, actor.userId).catch(() => {});
    return updated;
  }

  /** 主管提交对某成员绩效的逐考核项评分（与生成绩效同权限，由 controller 校验）。 */
  async submitPerformanceSupervisorAssessment(
    reportId: string,
    payload: { scores?: unknown; comment?: string; reviewerId?: string | null; reviewerName?: string | null },
  ) {
    const scores = normalizePerfItemScores(payload.scores);
    const comment = (payload.comment ?? '').trim().slice(0, 2000);

    const all = (await this.readArray('rd.performanceReports')).filter(isRecord);
    const idx = all.findIndex((r) => r.id === reportId);
    if (idx < 0) throw new NotFoundException('绩效报表不存在');
    const report = all[idx];

    const summary = isRecord(report.summary) ? report.summary : {};
    const supervisorAssessment = {
      scores,
      comment,
      submitted_at: new Date().toISOString(),
      reviewer_id: payload.reviewerId ?? null,
      reviewer_name: payload.reviewerName ?? '主管',
    };
    const updated = { ...report, summary: { ...summary, supervisor_assessment: supervisorAssessment } };
    const next = all.slice();
    next[idx] = updated;
    await this.writeValue('rd.performanceReports', next);
    return updated;
  }

  /** 把指定绩效报表对应、发给某成员的「绩效自评」通知标记为已处理。 */
  private async markPerfSelfAssessmentMessagesHandled(reportId: string, userId: string): Promise<void> {
    await this.markPerfMessagesHandled(userId, (parsed) => parsed.report_id === reportId, true);
  }

  /**
   * 把某成员未处理的「绩效自评」通知按 body 条件置为已处理。
   * report_id / month 没有单独落列，但 (type + recipientId + handled) 已把候选缩到个位数，
   * 在这个集合里解析 body 判定即可 —— 表化前这里要遍历全部消息逐条 JSON.parse。
   */
  private async markPerfMessagesHandled(
    userId: string,
    matches: (parsed: Record<string, unknown>) => boolean,
    alsoMarkRead = false,
  ): Promise<void> {
    const candidates = await this.prisma.rdMessage.findMany({
      where: { recipientId: userId, type: 'perf_self_assessment', handled: false },
      select: { id: true, body: true },
    });
    const matchedIds = candidates
      .filter((message) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(cleanText(message.body));
        } catch {
          return false;
        }
        return isRecord(parsed) && matches(parsed);
      })
      .map((message) => message.id);
    if (matchedIds.length === 0) return;

    await this.prisma.rdMessage.updateMany({
      where: { id: { in: matchedIds } },
      data: { handled: true, ...(alsoMarkRead ? { read: true } : {}) },
    });
  }

  /** 宽松评分：基线 78，按完成率/活跃度加分，阻塞/逾期仅小幅扣分且封顶，确保评价不过于苛刻。 */
  private computePerformanceScore(metrics: PerformanceMetrics): { score: number; grade: string } {
    let score = 78;
    score += Math.round((metrics.completion_rate / 100) * 12); // 完成率最高 +12
    score += Math.min(8, metrics.notes_count); // 活跃度（进度记录）最高 +8
    score += metrics.completed >= 1 ? 2 : 0; // 有交付 +2
    score -= Math.min(6, metrics.overdue_tasks * 2); // 逾期扣分封顶 -6
    score -= Math.min(4, metrics.blocked * 1); // 阻塞扣分封顶 -4
    score = Math.max(60, Math.min(98, score));
    const grade = score >= 90 ? '优秀' : score >= 80 ? '良好' : score >= 70 ? '合格' : '待改进';
    return { score, grade };
  }

  private async buildPerformanceReview(userId: string | null, userName: string, month: string) {
    const { items, metrics } = await this.collectUserMonthlyTasks(userId, userName, month);
    const { label } = monthRange(month);
    const { score, grade } = this.computePerformanceScore(metrics);

    const aiTasks = items.map((it) => ({
      title: it.title,
      role: (it.role === 'owner' ? '主责' : '协作') as '主责' | '协作',
      statusLabel: it.status_label,
      group: it.group,
      progress: it.progress,
      dueDate: it.due_date,
      monthNotesCount: it.month_notes_count,
      monthExcerpt: it.month_excerpt,
      blockedReason: it.blocked_reason,
      overdue: it.overdue,
    }));

    const kpiTasks = aiTasks.map((t) => ({
      title: t.title,
      role: t.role,
      statusLabel: t.statusLabel,
      group: t.group,
      progress: t.progress,
      monthExcerpt: t.monthExcerpt,
      blockedReason: t.blockedReason,
    }));

    // 绩效正文 + 事项指标(AI 动态归纳考核项目)并行生成；行为指标为固定写死项，由前端渲染、不走 AI。
    const [aiResult, itemKpisAi] = await Promise.all([
      this.rdAiService.assessPerformance({ userName, monthLabel: label, score, grade, metrics, tasks: aiTasks }),
      this.rdAiService.generatePerformanceItemKpis({ userName, monthLabel: label, tasks: kpiTasks }),
    ]);

    const text = aiResult
      ? aiResult.text
      : this.buildLocalPerformanceText(userName, label, score, grade, metrics, items);

    // 事项指标：AI 成功则用其【动态归纳的考核项目 + 权重 + 内容】，否则回退到固定 5 项(两列留空)。
    const item_kpis =
      itemKpisAi && itemKpisAi.length > 0
        ? itemKpisAi
        : PERF_ITEM_KPIS.map((k) => ({ name: k.name, weight: k.weight, business: '', standard: '' }));

    return {
      period: month,
      period_label: label,
      score,
      grade,
      metrics,
      text,
      item_kpis,
      generated_by: aiResult ? ('ai' as const) : ('local' as const),
    };
  }

  /** AI 未配置/失败时的本地兜底：按正式绩效文件分节拼接。 */
  private buildLocalPerformanceText(
    userName: string,
    label: string,
    score: number,
    grade: string,
    metrics: PerformanceMetrics,
    items: MonthlyReportTaskItem[],
  ): string {
    const lines: string[] = [];
    lines.push(`一、考核周期：${label}`);
    lines.push(`二、被考核人：${userName}`);
    lines.push('');
    lines.push('三、工作量与产出');
    lines.push(
      `本月共负责/参与任务 ${metrics.total_tasks} 项（主责 ${metrics.owner_tasks} · 协作 ${metrics.collab_tasks}），` +
        `完成 ${metrics.completed} 项，推进中 ${metrics.in_progress} 项，阻塞 ${metrics.blocked} 项，停滞 ${metrics.stalled} 项；` +
        `累计提交进度记录 ${metrics.notes_count} 条、上传材料 ${metrics.attachments_count} 个，任务完成率约 ${metrics.completion_rate}%。`,
    );
    lines.push('');
    lines.push('四、综合评价');
    lines.push(
      `${userName}本月工作态度积极，能够围绕研发任务持续推进并保持进度透明。` +
        `${metrics.completed >= 1 ? `按期交付 ${metrics.completed} 项任务，` : ''}` +
        `${metrics.overdue_tasks > 0 ? `部分任务进度略有滞后（逾期 ${metrics.overdue_tasks} 项），建议加强排期管理；` : '整体节奏把控良好；'}` +
        `总体表现${grade}，希望继续保持。`,
    );
    lines.push('');
    lines.push('五、主要亮点');
    const done = items.filter((it) => it.group === 'completed').slice(0, 3);
    if (done.length > 0) {
      for (const it of done) lines.push(`· 完成《${it.title}》${it.month_excerpt ? `：${it.month_excerpt}` : ''}`);
    } else {
      lines.push('· 持续推进在研任务，保持稳定产出与进度同步。');
    }
    lines.push('');
    lines.push('六、改进建议');
    if (metrics.blocked > 0 || metrics.stalled > 0) {
      lines.push(`· 关注 ${metrics.blocked} 项阻塞与 ${metrics.stalled} 项停滞任务，及时反馈协调资源、推动闭环。`);
    } else {
      lines.push('· 保持当前推进节奏，可适度提升任务交付的提前量与文档沉淀。');
    }
    lines.push('');
    lines.push(`七、综合评分：${score} 分（${grade}）`);
    return lines.join('\n');
  }


  // ── Internal messages (sender → recipient) ────────────────────────────────

  private async getMessageRecipientIdentity(userId?: string): Promise<MessageRecipientIdentity> {
    const cleanId = cleanUserId(userId);
    if (!cleanId) return { userId: '', nameKey: '', personIds: new Set<string>() };

    const [users, rawPeople] = await Promise.all([
      this.listIdentityUsers(),
      this.readArray('rd.people'),
    ]);
    const user = users.find((item) => item.id === cleanId);
    const nameKey = personNameLookupKey(user?.name);
    const people = this.normalizePeopleRecords(rawPeople, users);
    const personIds = new Set(
      people
        .filter((person) => {
          if (cleanUserId(person.user_id) === cleanId) return true;
          return Boolean(nameKey && personNameLookupKey(person.name) === nameKey);
        })
        .map((person) => cleanText(person.id))
        .filter(Boolean),
    );

    return { userId: cleanId, nameKey, personIds };
  }

  /**
   * 「这条消息发给此人」的 SQL 条件：与原先内存里的 messageMatchesRecipient 同口径
   * （user id / person id / 归一化姓名 三者取并集）。
   * 三个标识全空时返回一个恒假条件——不能返回 {}，那会退化成「匹配全部消息」。
   */
  private messageRecipientWhere(identity: MessageRecipientIdentity): Prisma.RdMessageWhereInput {
    const or: Prisma.RdMessageWhereInput[] = [];
    if (identity.userId) or.push({ recipientId: identity.userId });
    if (identity.personIds.size > 0) or.push({ recipientPersonId: { in: [...identity.personIds] } });
    if (identity.nameKey) or.push({ recipientNameKey: identity.nameKey });
    return or.length > 0 ? { OR: or } : { id: { in: [] } };
  }

  /** 「此人是这条消息的发件人或收件人」——原 messageMatchesParticipant 的 SQL 版。 */
  private messageParticipantWhere(identity: MessageRecipientIdentity): Prisma.RdMessageWhereInput {
    const recipient = this.messageRecipientWhere(identity);
    if (!identity.userId) return recipient;
    return { OR: [{ senderId: identity.userId }, recipient] };
  }

  /** 表行 → 前端既有的 snake_case 契约（rdApi.ts 的 RdMessage）。字段名不能变。 */
  private serializeMessage(row: RdMessageRow): JsonRecord {
    return {
      id: row.id,
      sender_id: row.senderId,
      sender_name: row.senderName,
      sender_role: row.senderRole,
      recipient_id: row.recipientId,
      recipient_person_id: row.recipientPersonId,
      recipient_name: row.recipientName,
      subject: row.subject,
      body: row.body,
      ...(row.meta === null || row.meta === undefined ? {} : { meta: row.meta }),
      source: row.source,
      category: row.category,
      read: row.read,
      handled: row.handled,
      created_at: row.createdAt.toISOString(),
    };
  }

  /**
   * 把 listMessages / countUnreadMessages 共用的可见性条件拼出来。
   * 返回 null 表示「该调用者看不到任何消息」，调用方直接短路。
   */
  private async buildMessageVisibility(
    filters?: { user_id?: string; recipient_id?: string },
    viewer?: { userId?: string; hasFullAccess?: boolean },
  ): Promise<Prisma.RdMessageWhereInput[] | null> {
    const identityCache = new Map<string, Promise<MessageRecipientIdentity>>();
    const resolveIdentity = (userId?: string) => {
      const id = cleanUserId(userId);
      if (!identityCache.has(id)) {
        identityCache.set(id, this.getMessageRecipientIdentity(id));
      }
      return identityCache.get(id)!;
    };

    const conditions: Prisma.RdMessageWhereInput[] = [];

    // Privacy: non-managers can only see messages they sent or received
    if (viewer && !viewer.hasFullAccess) {
      const ownId = viewer.userId;
      if (!ownId) return null;
      conditions.push(this.messageParticipantWhere(await resolveIdentity(ownId)));
    }

    if (filters?.user_id) {
      conditions.push(this.messageParticipantWhere(await resolveIdentity(filters.user_id)));
    }
    if (filters?.recipient_id) {
      conditions.push(this.messageRecipientWhere(await resolveIdentity(filters.recipient_id)));
    }
    return conditions;
  }

  async listMessages(
    filters?: {
      user_id?: string;
      recipient_id?: string;
      limit?: number;
      /** 只要未处理的（顶栏铃铛用）：拉 5 条就是 5 条待办，不必多取再前端筛 */
      handled?: boolean;
      /** 按来源筛（研发/采购/视频…），多选取并集 */
      source?: string[];
      /** 按分类筛（待办/结果/提及/通知），多选取并集 */
      category?: string[];
      /** keyset 游标：取严格早于 (before_created_at, before_id) 的下一页 */
      before_created_at?: string;
      before_id?: string;
    },
    viewer?: { userId?: string; hasFullAccess?: boolean },
  ) {
    const limit = Math.max(1, Math.min(500, filters?.limit ?? 200));
    const conditions = await this.buildMessageVisibility(filters, viewer);
    if (conditions === null) return [];

    if (typeof filters?.handled === 'boolean') {
      conditions.push({ handled: filters.handled });
    }
    // 空数组视为「不筛」，不能下推成 in: [] —— 那会一条都查不出来
    const sources = (filters?.source ?? []).map(cleanText).filter(Boolean);
    if (sources.length > 0) conditions.push({ source: { in: sources } });
    const categories = (filters?.category ?? []).map(cleanText).filter(Boolean);
    if (categories.length > 0) conditions.push({ category: { in: categories } });

    // 游标按 (createdAt, id) 复合比较：同一批扇出通知的 createdAt 完全相同，
    // 只用时间做游标会在批次边界上漏页或重页。
    const beforeAt = filters?.before_created_at ? new Date(filters.before_created_at) : null;
    if (beforeAt && !Number.isNaN(beforeAt.getTime())) {
      const beforeId = cleanText(filters?.before_id);
      conditions.push(
        beforeId
          ? {
              OR: [
                { createdAt: { lt: beforeAt } },
                { createdAt: beforeAt, id: { lt: beforeId } },
              ],
            }
          : { createdAt: { lt: beforeAt } },
      );
    }

    const rows = await this.prisma.rdMessage.findMany({
      where: conditions.length > 0 ? { AND: conditions } : undefined,
      // id 作次序兜底：同一批扇出通知的 createdAt 完全相同，只按时间排序分页会不稳定
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.map((row) => this.serializeMessage(row));
  }

  /**
   * 未读待办数。表化之前顶栏只能全量拉 50 条回前端 filter 算这个数，
   * 既不准（超过 50 条就封顶）又是每用户每分钟一次全量读。
   */
  async countUnreadMessages(
    filters?: { user_id?: string; recipient_id?: string },
    viewer?: { userId?: string; hasFullAccess?: boolean },
  ): Promise<{ unread: number }> {
    const conditions = await this.buildMessageVisibility(filters, viewer);
    if (conditions === null) return { unread: 0 };
    conditions.push({ read: false, handled: false });
    const unread = await this.prisma.rdMessage.count({ where: { AND: conditions } });
    return { unread };
  }

  /** 校验并构造一条待落库的消息（纯函数）：createMessage 与 createMessages 共用同一口径。 */
  private buildMessageRecord(payload: CreateMessagePayload): Prisma.RdMessageCreateManyInput {
    const body = (payload.body ?? '').trim();
    if (!body) throw new BadRequestException('消息内容不能为空');
    if (body.length > 4000) throw new BadRequestException('消息内容过长 (上限 4000 字符)');

    const recipientId = (payload.recipient_id ?? '').trim() || null;
    const recipientPersonId = (payload.recipient_person_id ?? '').trim() || null;
    const recipientName = (payload.recipient_name ?? '').trim() || null;
    if (!recipientId && !recipientPersonId && !recipientName) {
      throw new BadRequestException('请指定接收人');
    }

    // 结构化 body 的 type / task_id 落列，审核类通知才能按索引批量置 handled；
    // 纯文本 body 解析失败即留空，不影响投递。
    let parsedBody: Record<string, unknown> | null = null;
    if (body.startsWith('{')) {
      try {
        const parsed: unknown = JSON.parse(body);
        if (isRecord(parsed)) parsedBody = parsed;
      } catch {
        parsedBody = null;
      }
    }

    return {
      // 沿用历史 msg- 前缀：前端标已读按 id 提交，collectInboxMessagesAsNotifications
      // 也靠这个前缀区分消息与派生通知。随机段用 uuid，批量插入同毫秒也不会撞 id。
      id: `msg-${Date.now()}-${randomUUID().slice(0, 8)}`,
      senderId: payload.sender.id ?? null,
      senderName: payload.sender.name ?? '系统',
      senderRole: payload.sender.role ?? null,
      recipientId,
      recipientPersonId,
      recipientName,
      recipientNameKey: personNameLookupKey(recipientName) || null,
      subject: (payload.subject ?? '').trim() || null,
      body,
      meta: payload.meta ? (payload.meta as Prisma.InputJsonObject) : Prisma.DbNull,
      type: cleanText(parsedBody?.type) || null,
      taskId: cleanText(parsedBody?.task_id) || null,
      // 调用方没自报来源就按当前工作区算——研发服务内部发的通知天然属于所在池
      source: payload.source ?? (currentRdWorkspace() as MessageSource),
      category: messageCategoryOf(cleanText(parsedBody?.type)),
      read: false,
      handled: false,
      createdAt: new Date(),
    };
  }

  /**
   * 待落库记录 → 前端契约。createMany 不回传行，又不值得为回包多查一次库，
   * 因此这里从写入参数还原；字段与 serializeMessage 必须保持一致。
   */
  private serializeMessageInput(row: Prisma.RdMessageCreateManyInput): JsonRecord {
    return {
      id: row.id as string,
      sender_id: row.senderId ?? null,
      sender_name: row.senderName ?? '系统',
      sender_role: row.senderRole ?? null,
      recipient_id: row.recipientId ?? null,
      recipient_person_id: row.recipientPersonId ?? null,
      recipient_name: row.recipientName ?? null,
      subject: row.subject ?? null,
      body: row.body,
      ...(row.meta === undefined || row.meta === Prisma.DbNull ? {} : { meta: row.meta }),
      source: row.source ?? 'rd',
      category: row.category ?? 'notice',
      read: false,
      handled: false,
      created_at: (row.createdAt as Date).toISOString(),
    };
  }

  async createMessage(payload: CreateMessagePayload) {
    const row = await this.prisma.rdMessage.create({ data: this.buildMessageRecord(payload) });
    return this.serializeMessage(row);
  }

  /**
   * 批量投递（扇出通知专用）：一条 INSERT 落 N 行。
   * 表化之前这里是「读整包 → 追加 → 写回」，N 个收件人要把整个 JSON 数组重写 N 遍。
   */
  private async createMessages(payloads: CreateMessagePayload[]): Promise<JsonRecord[]> {
    if (payloads.length === 0) return [];
    const rows = payloads.map((payload) => this.buildMessageRecord(payload));
    await this.prisma.rdMessage.createMany({ data: rows });
    return rows.map((row) => this.serializeMessageInput(row));
  }

  // ── Proposal drafts (AI 立项 草稿) ──────────────────────────────────────

  async listProposalDrafts(viewer?: { userId?: string; hasFullAccess?: boolean }) {
    const all = (await this.readArray('rd.proposalDrafts')).filter(isRecord);
    if (viewer?.hasFullAccess) return all;
    const userId = viewer?.userId;
    if (!userId) return [];
    return all.filter((d) => {
      const author = isRecord(d.author) ? d.author : null;
      return Boolean(author && author.id === userId);
    });
  }

  async saveProposalDraft(payload: {
    draft_id?: string;
    title?: string;
    description?: string;
    comment?: string;
    parent_project_id?: string;
    new_project_name?: string;
    tasks?: unknown[];
    file_names?: string[];
    author: { id?: string | null; name?: string | null; role?: string | null };
  }) {
    const title = (payload.title ?? '').trim() || '未命名立项';
    const now = new Date().toISOString();
    const draft = {
      id: payload.draft_id || `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      description: (payload.description ?? '').trim() || null,
      comment: (payload.comment ?? '').trim() || null,
      parent_project_id: (payload.parent_project_id ?? '').trim() || null,
      new_project_name: (payload.new_project_name ?? '').trim() || null,
      tasks: Array.isArray(payload.tasks) ? payload.tasks : [],
      file_names: Array.isArray(payload.file_names) ? payload.file_names.map((n) => String(n)) : [],
      author: {
        id: payload.author.id ?? null,
        name: payload.author.name ?? '我',
        role: payload.author.role ?? null,
      },
      created_at: now,
      updated_at: now,
    };

    const existing = (await this.readArray('rd.proposalDrafts')).filter(isRecord);
    // Replace by id if exists, otherwise prepend
    const idx = existing.findIndex((d) => d.id === draft.id);
    let next: unknown[];
    if (idx >= 0) {
      // Preserve original created_at
      const original = existing[idx];
      const preserved = { ...draft, created_at: typeof original.created_at === 'string' ? original.created_at : now };
      next = [preserved, ...existing.filter((_, i) => i !== idx)];
    } else {
      next = [draft, ...existing];
    }
    await this.writeValue('rd.proposalDrafts', next.slice(0, 500));
    await this.recordServerAudit({
      action: 'proposal.draft_saved',
      resource: { type: 'proposal', id: draft.id, name: title },
      actor: { id: payload.author.id, name: payload.author.name ?? undefined, role: payload.author.role ?? undefined },
      comment: idx >= 0 ? '更新立项草稿' : '保存立项草稿',
      metadata: { task_count: asArray(payload.tasks).length, file_count: asArray(payload.file_names).length },
    });
    return draft;
  }

  async deleteProposalDraft(draftId: string, viewer?: { userId?: string; hasFullAccess?: boolean }) {
    const existing = (await this.readArray('rd.proposalDrafts')).filter(isRecord);
    const target = existing.find((d) => d.id === draftId);
    if (!target) throw new NotFoundException('草稿不存在');

    // Permission check: only the author or a manager can delete
    if (!viewer?.hasFullAccess) {
      const author = isRecord(target.author) ? target.author : null;
      if (!author || author.id !== viewer?.userId) {
        throw new BadRequestException('无权删除他人草稿');
      }
    }

    await this.writeValue('rd.proposalDrafts', existing.filter((d) => d.id !== draftId));
    return { ok: true };
  }

  async clearAllTaskData(actor?: AuditActorRef) {
    // 消息中心是研发/协同共享的全局数据，绝不能随当前工作区任务一起清空。
    // 先记录当前池全部任务 id，清理任务后只把相应审核待办标记为已处理，历史消息仍保留。
    const removedTaskIds = new Set(
      this.collectAllCategoryTasks(await this.readMergedTaskCategories())
        .map((task) => cleanText(task.task_id))
        .filter(Boolean),
    );
    await Promise.all([
      this.writeValue('rd.taskCategories', []),
      this.writeValue('rd.productTaskCategories', {}),
      this.writeValue('rd.workspace', EMPTY_WORKSPACE),
      this.writeValue('rd.directorDashboard', EMPTY_DIRECTOR_DASHBOARD),
      this.writeValue('rd.taskProgressNotes', {}),
      this.writeValue('rd.dailyReports', []),
      this.writeValue('rd.proposalDrafts', []),
      this.prisma.rdTaskDiscussionThread.deleteMany({
        where: { workspace: currentRdWorkspace() },
      }),
    ]);
    try {
      await this.markReviewRequestMessagesHandledForTasks(removedTaskIds);
    } catch {
      // best-effort：核心任务数据已经清空，不因消息状态刷新失败把成功操作报告为失败。
    }
    // 清空整池任务是破坏性最强的动作，留痕本身不在被清空之列（它在 AuditLog 表）
    await this.recordServerAudit({
      action: 'task.data.cleared',
      resource: { type: 'system', id: `task-data-${currentRdWorkspace()}`, name: '任务池数据' },
      actor: { id: actor?.userId, name: actor?.userName },
      comment: `清空任务池数据（${removedTaskIds.size} 个任务）`,
      metadata: { workspace: currentRdWorkspace(), removed_task_count: removedTaskIds.size },
    });
    return { ok: true };
  }

  private collectAllCategoryTasks(categories: unknown[]): JsonRecord[] {
    const output: JsonRecord[] = [];
    const collectTasks = (tasks: unknown[]) => {
      for (const task of tasks) {
        if (!isRecord(task)) continue;
        output.push(task);
        collectTasks(asArray(task.subtasks));
      }
    };
    for (const category of categories) {
      if (!isRecord(category)) continue;
      for (const child of asArray(category.children)) {
        if (isRecord(child)) collectTasks(asArray(child.tasks));
      }
    }
    return output;
  }

  /**
   * task_id → 当前权威分类树位置。位置在读取时派生，不写回任务对象：
   * - 分组键使用稳定的一级类目 id，类目改名只更新表头；
   * - 同一 BOM 类目在不同产品库复用同一 id，因此会自然聚合到同一张表；
   * - 任务移动后，下次读取会从新的容器位置重新派生，避免 category_path 旧值造成漂移。
   */
  private collectTaskCategoryLocations(categories: unknown[]): Map<string, TaskCategoryLocation> {
    const output = new Map<string, TaskCategoryLocation>();
    // 合并树按「主库 → 其他产品库」排列。一级类目重名/跨库复用 id 时，以首个（主库）
    // 当前名称作为统一表头；没有主库任务也不影响，因为目录本身仍会先被扫描到。
    const canonicalCategoryLabels = new Map<string, string>();
    for (const category of categories) {
      if (!isRecord(category)) continue;
      const categoryId = cleanText(category.id) || 'uncategorized';
      if (!canonicalCategoryLabels.has(categoryId)) {
        canonicalCategoryLabels.set(categoryId, cleanText(category.label) || '未分类');
      }
    }

    const addTasks = (tasks: unknown[], location: TaskCategoryLocation) => {
      for (const task of tasks) {
        if (!isRecord(task)) continue;
        const taskId = cleanText(task.task_id);
        if (taskId && !output.has(taskId)) output.set(taskId, location);
        addTasks(asArray(task.subtasks), location);
      }
    };

    for (const category of categories) {
      if (!isRecord(category)) continue;
      const categoryId = cleanText(category.id) || 'uncategorized';
      const categoryLabel = canonicalCategoryLabels.get(categoryId) ?? (cleanText(category.label) || '未分类');
      for (const child of asArray(category.children)) {
        if (!isRecord(child)) continue;
        addTasks(asArray(child.tasks), {
          categoryId,
          categoryKey: `category:${categoryId}`,
          categoryLabel,
          subProjectId: cleanText(child.id),
          subProjectLabel: cleanText(child.label),
        });
      }
    }
    return output;
  }

  private taskStatusLabel(status: unknown): string {
    switch (status) {
      case 'draft':
        return '草稿';
      case 'in_progress':
        return '进行中';
      case 'pending_review':
        return '待审核';
      case 'paused_leave':
        return '暂停/请假';
      case 'paused_blocked':
        return '协作受阻';
      case 'on_hold':
        return '挂起';
      case 'completed':
        return '已完成';
      case 'pending_assign':
        return '待指派';
      case 'archived':
        return '已归档';
      default:
        return '进行中';
    }
  }

  /**
   * 单任务 AI 小结（纵向视角，协同模块使用）：读任务 + 工作项 + 留痕时间线，
   * 交给 AI 浓缩成几句话；AI 未配置/失败时用本地拼接兜底，接口不失败。
   */
  async generateTaskBrief(
    taskId: string,
    options?: { requesterUserId?: string; requesterName?: string; canViewAny?: boolean },
  ) {
    const id = cleanText(taskId);
    if (!id) throw new BadRequestException('taskId 不能为空');
    const task = await this.findTaskAcrossStores(id);
    if (!task) throw new NotFoundException('任务不存在');

    // 越权防护：小结会把留痕内容交给 AI 汇总并回显，可见性必须与留痕接口同口径——
    // 驾驶舱/管理员级可看全部；仅工作台权限的普通成员只能看自己参与（主责/协作）的任务
    if (options && !options.canViewAny) {
      if (!isTaskParticipant(task, options.requesterUserId, options.requesterName)) {
        throw new ForbiddenException('只能查看自己参与任务的小结');
      }
    }

    const noteMap = await this.getProgressNoteMap();
    const workItems = asArray(task.work_items)
      .filter(isRecord)
      .map((it) => ({
        id: cleanText(it.id),
        title: cleanText(it.title),
        done: it.done === true,
        owner: cleanText(it.owner_name) || null,
      }))
      .filter((it) => it.title);
    const itemTitleById = new Map(workItems.map((it) => [it.id, it.title] as const));
    const notes = asArray(noteMap[id])
      .filter(isRecord)
      .slice(0, 30)
      .map((n) => ({
        actorName: cleanText((n.actor as JsonRecord | undefined)?.name) || '成员',
        createdAt: cleanText(n.created_at),
        text: cleanText(n.text),
        progress: typeof n.progress === 'number' ? n.progress : null,
        workItemTitle: itemTitleById.get(cleanText(n.work_item_id)) ?? null,
        attachments: asArray(n.attachments).length,
      }));

    const blockedSince = cleanText(task.blocked_since);
    const isBlocked = task.status === 'paused_blocked';
    const blockedDays = isBlocked && blockedSince
      ? Math.max(0, Math.floor((Date.now() - new Date(blockedSince).getTime()) / 86_400_000))
      : null;
    const statusLabel = this.taskStatusLabel(task.status);
    const progress = typeof task.progress === 'number' ? task.progress : 0;
    const owner = cleanText(task.primary_owner) || '未指派';
    const title = cleanText(task.title) || '未命名任务';
    const dueDate = cleanText(task.due_date) || null;
    const blockedReason = isBlocked ? cleanText(task.blocked_reason) || '存在阻塞' : null;

    // AI 输出语言跟随请求者界面语言（i18n 用户偏好）：美方成员拿到英文小结，源头即英文比翻译质量高
    const lang = await this.getRequesterLang(options?.requesterUserId);

    const ai = await this.rdAiService.summarizeTaskBrief({
      title,
      statusLabel,
      progress,
      owner,
      dueDate,
      description: cleanText(task.description) || null,
      blockedReason,
      blockedDays,
      workItems: workItems.map(({ title: t, done, owner: o }) => ({ title: t, done, owner: o })),
      notes,
      lang,
    });
    if (ai) {
      return { text: ai.text, model: ai.model, provider: ai.provider, source: 'ai', generated_at: new Date().toISOString() };
    }

    // 本地兜底：AI 未配置/失败时拼一段基础事实小结（同样按请求者语言输出）
    const doneCount = workItems.filter((w) => w.done).length;
    const latest = notes[0];
    const lines =
      lang === 'en'
        ? [
            `"${title}" is currently ${statusLabel} at ${progress}%, owned by ${owner}${dueDate ? `, due ${dueDate}` : ''}.`,
            workItems.length > 0 ? `Work items completed: ${doneCount}/${workItems.length}.` : '',
            latest
              ? `Latest update (${latest.createdAt.slice(0, 10)} by ${latest.actorName}): ${latest.text.slice(0, 80) || 'progress updated'}`
              : 'No progress notes yet.',
            blockedReason ? `⚠️ ${blockedReason}${blockedDays != null ? ` (blocked for ${blockedDays} days)` : ''}.` : '',
          ].filter(Boolean)
        : [
            `《${title}》当前${statusLabel}，进度 ${progress}%，主责 ${owner}${dueDate ? `，截止 ${dueDate}` : ''}。`,
            workItems.length > 0 ? `工作项完成 ${doneCount}/${workItems.length}。` : '',
            latest
              ? `最近进展（${latest.createdAt.slice(0, 10)} ${latest.actorName}）：${latest.text.slice(0, 80) || '更新了任务进度'}`
              : '暂无进展留痕。',
            blockedReason ? `⚠️ ${blockedReason}${blockedDays != null ? `，已阻塞 ${blockedDays} 天` : ''}。` : '',
          ].filter(Boolean);
    return { text: lines.join('\n'), model: 'local', provider: 'local', source: 'local', generated_at: new Date().toISOString() };
  }

  /**
   * childTaskId → 父任务记录。按「结构位置」建索引，不看 parent_task_id 字段——
   * 存量子任务没有该字段，只认字段会把它们当成顶层任务（与前端 RDTaskDetailPage 同口径）。
   */
  private collectSubtaskParents(categories: unknown[]): Map<string, JsonRecord> {
    const parents = new Map<string, JsonRecord>();
    const walk = (tasks: unknown[]) => {
      for (const task of tasks) {
        if (!isRecord(task)) continue;
        const subtasks = asArray(task.subtasks);
        for (const sub of subtasks) {
          if (!isRecord(sub)) continue;
          const id = cleanText(sub.task_id);
          if (id) parents.set(id, task);
        }
        walk(subtasks);
      }
    };
    for (const category of categories) {
      if (!isRecord(category)) continue;
      for (const child of asArray(category.children)) {
        if (isRecord(child)) walk(asArray(child.tasks));
      }
    }
    return parents;
  }

  /** 按权威树位置计算真实深度（根任务为 1），不受个人工作台筛选后节点提升影响。 */
  private collectTaskDepths(categories: unknown[]): Map<string, number> {
    const depths = new Map<string, number>();
    const visited = new Set<string>();
    const walk = (tasks: unknown[], depth: number) => {
      for (const task of tasks) {
        if (!isRecord(task)) continue;
        const id = cleanText(task.task_id);
        if (id) {
          if (visited.has(id)) continue;
          visited.add(id);
          depths.set(id, depth);
        }
        walk(asArray(task.subtasks), Math.min(depth + 1, RD_TASK_TREE_MAX_DEPTH + 1));
      }
    };
    for (const category of categories) {
      if (!isRecord(category)) continue;
      for (const child of asArray(category.children)) {
        if (isRecord(child)) walk(asArray(child.tasks), 1);
      }
    }
    return depths;
  }

  private toWorkspaceTask(
    task: JsonRecord,
    role: 'primary' | 'collaborator',
    collabRole?: string,
    /** 本任务的父任务（本任务是子任务时非空）。由 collectSubtaskParents 按结构位置解析后传入。 */
    parentTask?: JsonRecord,
    treeDepth = 1,
    categoryLocation?: TaskCategoryLocation,
  ) {
    const dueDate = cleanText(task.due_date);
    const subtaskOrigin = cleanText(task.subtask_origin);
    return {
      task_id: cleanText(task.task_id),
      title: cleanText(task.title) || '未命名任务',
      priority: normalizePriority(task.final_priority ?? task.ai_priority),
      progress: typeof task.progress === 'number' ? task.progress : 0,
      created_at: cleanText(task.created_at),
      start_date: cleanText(task.start_date),
      due_date: dueDate,
      status: cleanText(task.status) || 'in_progress',
      status_label: this.taskStatusLabel(task.status),
      submitted_for_review_at: cleanText(task.submitted_for_review_at) || null,
      role,
      tree_depth: treeDepth,
      category_path: cleanText(task.category_path),
      category_id: categoryLocation?.categoryId ?? null,
      category_key: categoryLocation?.categoryKey ?? null,
      category_label: categoryLocation?.categoryLabel ?? null,
      sub_project_id: categoryLocation?.subProjectId ?? null,
      sub_project_label: categoryLocation?.subProjectLabel ?? null,
      owner: cleanText(task.primary_owner ?? task.owner),
      owner_user_id: cleanUserId(task.primary_owner_user_id ?? task.owner_user_id) || null,
      collaborators: asArray(task.collaborators).filter(isRecord).map((collaborator) => ({
        id: cleanText(collaborator.id) || cleanUserId(collaborator.user_id) || cleanText(collaborator.name),
        name: cleanText(collaborator.name),
        user_id: cleanUserId(collaborator.user_id) || null,
        role: cleanText(collaborator.role) || '协作人',
      })).filter((collaborator) => collaborator.name),
      pending_review_type: cleanText(task.pending_review_type) || null,
      pending_collaborators: asArray(task.pending_collaborators).filter(isRecord).map((collaborator) => ({
        id: cleanText(collaborator.id) || cleanUserId(collaborator.user_id) || cleanText(collaborator.name),
        name: cleanText(collaborator.name),
        user_id: cleanUserId(collaborator.user_id) || null,
        role: cleanText(collaborator.role) || '协作人',
      })).filter((collaborator) => collaborator.name),
      pending_collaboration_reason: cleanText(task.pending_collaboration_reason) || null,
      pending_abandon_reason: cleanText(task.pending_abandon_reason) || null,
      pending_abandon_requested_at: cleanText(task.pending_abandon_requested_at) || null,
      collab_role: collabRole,
      on_leave: task.status === 'paused_leave',
      // 阻塞起点（进入 paused_blocked 时由 updateTask 记录），协同工作台显示"已阻塞 N 天"
      blocked_since: cleanText(task.blocked_since) || null,
      ai_pending: task.ai_modified === true,
      attachments: typeof task.attachments === 'number' ? Math.max(0, task.attachments) : 0,
      latest_progress_summary: this.normalizeLatestProgressSummary(task.latest_progress_summary),
      completion_score: this.extractCompletionScoreSummary(task.completion_score),
      // 工作项清单（任务内部轻量拆分）：工作台留痕表单据此提供「关联工作项」选择
      work_items: asArray(task.work_items)
        .filter(isRecord)
        .map((it) => ({
          id: cleanText(it.id),
          title: cleanText(it.title),
          owner_name: cleanText(it.owner_name) || null,
          done: it.done === true,
        }))
        .filter((it) => it.id && it.title),
      // ── 子任务树关系：工作台据此显示身份徽标 / 直接父任务归属 / 直接子任务清单 ──
      // parent_* 一律以结构位置为准（parentTask 由 collectSubtaskParents 解析），不回读字段。
      parent_task_id: parentTask ? cleanText(parentTask.task_id) || null : null,
      parent_title: parentTask ? cleanText(parentTask.title) || null : null,
      // origin 只在确实是子任务时下发；存量子任务无此字段 → null（前端按"中性子任务"渲染）
      subtask_origin: parentTask && (subtaskOrigin === 'attached' || subtaskOrigin === 'created')
        ? subtaskOrigin
        : null,
      subtask_attached_at: parentTask ? cleanText(task.subtask_attached_at) || null : null,
      subtask_attached_by: parentTask ? cleanText(task.subtask_attached_by) || null : null,
      /** 是否带直接子任务——含已归档的；清单本身会过滤归档项。 */
      has_subtasks: asArray(task.subtasks).filter(isRecord).length > 0,
      // 子任务清单（本任务是父任务时非空）。已归档的不下发，与工作台"仅排除已归档"的可见口径一致。
      subtasks: asArray(task.subtasks)
        .filter(isRecord)
        .filter((sub) => !isArchivedTask(sub))
        .map((sub) => {
          const origin = cleanText(sub.subtask_origin);
          return {
            task_id: cleanText(sub.task_id),
            title: cleanText(sub.title) || '未命名任务',
            status: cleanText(sub.status) || 'in_progress',
            status_label: this.taskStatusLabel(sub.status),
            progress: typeof sub.progress === 'number' ? sub.progress : 0,
            owner: cleanText(sub.primary_owner ?? sub.owner),
            owner_user_id: cleanUserId(sub.primary_owner_user_id ?? sub.owner_user_id) || null,
            subtask_origin: origin === 'attached' || origin === 'created' ? origin : null,
          };
        })
        .filter((sub) => sub.task_id),
      description: cleanText(task.description),
      next_action: role === 'primary' ? '推进当前节点并同步最新进展。' : '配合主责人完成协作事项。',
      deliverables: asArray(task.deliverables).map((item) => cleanText(item)).filter(Boolean),
      blockers: task.status === 'paused_blocked'
        ? [cleanText(task.blocked_reason) || '当前任务存在阻塞']
        : [],
      timeline: [
        { label: '创建', time: '已进入研发任务池', state: 'done' },
        { label: '执行', time: '当前', state: task.status === 'completed' ? 'done' : 'current' },
        { label: '完成', time: dueDate || '待确认', state: task.status === 'completed' ? 'done' : 'todo' },
      ],
    };
  }

  async getWorkspace(currentUserId?: string, currentUserName?: string) {
    const value = await this.readValue('rd.workspace');
    const saved = {
      ...EMPTY_WORKSPACE,
      ...asRecord(value, EMPTY_WORKSPACE),
    };

    if (!currentUserId) return saved;

    const [rawCategories, identity, noteMap, scoresRaw] = await Promise.all([
      // 我的工作台「只关注任务」：跨所有产品库聚合该成员的任务（产品仅是展示分区，不切分"我的任务"）。
      this.readMergedTaskCategories(),
      this.getIdentityContext(),
      this.getProgressNoteMap(),
      this.readValue('rd.taskCompletionScores'),
    ]);
    const scoreMap: JsonRecord = isRecord(scoresRaw) ? scoresRaw : {};
    const categories = this.applyProgressAttachmentCounts(rawCategories, noteMap, scoreMap);
    const { people, users } = identity;
    const currentUser = users.find((user) => user.id === currentUserId);
    const currentNameKey = personNameLookupKey(currentUser?.name ?? currentUserName);
    const currentPersonIds = new Set(
      people
        .filter((person) => {
          if (cleanUserId(person.user_id) === currentUserId) return true;
          return Boolean(currentNameKey && personNameLookupKey(person.name) === currentNameKey);
        })
        .map((person) => cleanText(person.id))
        .filter(Boolean),
    );
    // 个人工作台可见任务：含已完成（成员可回看自己完成的任务），仅排除已归档。
    const visibleTasks = this.collectAllCategoryTasks(categories).filter(
      (task) => !isArchivedTask(task),
    );

    const isMineByNameFallback = (task: JsonRecord) => {
      const taskUserId = cleanUserId(task.primary_owner_user_id ?? task.owner_user_id);
      if (taskUserId) return false;
      return Boolean(currentNameKey && personNameLookupKey(task.primary_owner ?? task.owner) === currentNameKey);
    };
    const isPrimary = (task: JsonRecord) =>
      cleanUserId(task.primary_owner_user_id ?? task.owner_user_id) === currentUserId || isMineByNameFallback(task);

    const collaboratorRole = (task: JsonRecord): string | undefined => {
      for (const collaborator of asArray(task.collaborators)) {
        if (!isRecord(collaborator)) continue;
        if (cleanUserId(collaborator.user_id) === currentUserId) {
          return cleanText(collaborator.role) || '协作人';
        }
        if (!cleanUserId(collaborator.user_id) && personNameLookupKey(collaborator.name) === currentNameKey) {
          return cleanText(collaborator.role) || '协作人';
        }
      }
      return undefined;
    };

    // 子任务父子索引：按结构位置解析一次，myTasks/collabTasks 共用
    const subtaskParents = this.collectSubtaskParents(categories);
    const taskDepths = this.collectTaskDepths(categories);
    const taskLocations = this.collectTaskCategoryLocations(categories);
    const parentOf = (task: JsonRecord) => subtaskParents.get(cleanText(task.task_id));
    const depthOf = (task: JsonRecord) => taskDepths.get(cleanText(task.task_id)) ?? 1;
    const locationOf = (task: JsonRecord) => taskLocations.get(cleanText(task.task_id));

    const myTasks = visibleTasks
      .filter(isPrimary)
      .map((task) => this.toWorkspaceTask(task, 'primary', undefined, parentOf(task), depthOf(task), locationOf(task)));
    // 个人工作台按角色分为「主责 / 协助」两个任务集合；主责优先，避免同一任务跨 Tab 重复。
    // 服务端统一投影，确保研发与协同工作区使用相同、不可绕过的成员范围。
    const collabTasks = visibleTasks
      .map((task) => ({ task, role: collaboratorRole(task) }))
      .filter((item) => item.role && !isPrimary(item.task))
      .map((item) => this.toWorkspaceTask(
        item.task,
        'collaborator',
        item.role,
        parentOf(item.task),
        depthOf(item.task),
        locationOf(item.task),
      ));
    const dueTasks = [...myTasks, ...collabTasks]
      .filter((task) => task.status !== 'completed' && task.due_date)
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
      .slice(0, 5);

    // Merge inbox messages addressed to this user into the notifications feed
    const inboxMessages = await this.collectInboxMessagesAsNotifications(currentUserId, currentNameKey, currentPersonIds);
    const savedNotifications: unknown[] = Array.isArray(saved.notifications) ? (saved.notifications as unknown[]) : [];
    const mergedNotifications = [
      ...inboxMessages,
      ...savedNotifications.filter((n): n is JsonRecord => isRecord(n) && !String(n.id ?? '').startsWith('msg-')),
    ];

    return {
      ...saved,
      myTasks,
      collabTasks,
      todayTodos: dueTasks.length || currentRdWorkspace() !== 'us-collab'
        ? dueTasks.map((task) => ({ text: `${task.title} · ${task.due_date}`, task_id: task.task_id }))
        : saved.todayTodos,
      notifications: mergedNotifications,
    };
  }

  /**
   * 研发个人工作台的跨池只读任务投影。
   * 只读取当前登录人在两个池中的主责/协助任务，不授予协同池列表权限，也不混合通知和 AI 建议。
   * 协同任务带 source_workspace，前端操作时跳转到协同详情，所有写入仍走协同工作区原有接口。
   */
  async getCombinedWorkspace(currentUserId?: string, currentUserName?: string) {
    if (currentRdWorkspace() !== 'rd') {
      throw new ForbiddenException('跨工作区个人任务仅在研发个人工作台提供');
    }
    const [research, collaboration] = await Promise.all([
      runInRdWorkspace('rd', () => this.getWorkspace(currentUserId, currentUserName)),
      runInRdWorkspace('us-collab', () => this.getWorkspace(currentUserId, currentUserName)),
    ]);
    const markTasks = (tasks: unknown, workspace: 'rd' | 'us-collab') => asArray(tasks)
      .filter(isRecord)
      .map((task) => ({ ...task, source_workspace: workspace }));
    return {
      ...research,
      myTasks: [
        ...markTasks(research.myTasks, 'rd'),
        ...markTasks(collaboration.myTasks, 'us-collab'),
      ],
      collabTasks: [
        ...markTasks(research.collabTasks, 'rd'),
        ...markTasks(collaboration.collabTasks, 'us-collab'),
      ],
    };
  }

  /** Build notification-shaped entries from messages addressed to this user. */
  private async collectInboxMessagesAsNotifications(
    currentUserId: string,
    currentNameKey: string,
    currentPersonIds = new Set<string>(),
  ): Promise<JsonRecord[]> {
    // 收件人条件与 messageRecipientWhere 同口径，外加「未处理」——已审批/已驳回的不再是待办
    const rows = await this.prisma.rdMessage.findMany({
      where: {
        handled: false,
        ...this.messageRecipientWhere({
          userId: currentUserId,
          nameKey: currentNameKey,
          personIds: currentPersonIds,
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const matched = rows.map((row) => this.serializeMessage(row));

    return matched.map((m) => {
      const senderName = cleanText(m.sender_name) || '系统';
      const subject = cleanText(m.subject);
      const body = cleanText(m.body);
      // Parse JSON body to produce human-readable titles and summaries
      let parsedBody: Record<string, unknown> | null = null;
      try { parsedBody = JSON.parse(body) as Record<string, unknown>; } catch { /* plain text */ }

      const msgType = parsedBody ? String(parsedBody['type'] ?? '') : '';
      const taskTitle = parsedBody ? String(parsedBody['task_title'] ?? '') : '';

      let defaultTitle: string;
      let displayMessage: string;

      if (msgType === 'review_request') {
        const submitterName = String(parsedBody!['submitter_name'] ?? senderName);
        const reviewType = String(parsedBody!['review_type'] ?? 'result');
        const reviewLabel = reviewTypeLabel(reviewType);
        defaultTitle = `系统通知：【待审核·${reviewLabel}】「${taskTitle}」申请${reviewLabel}审核`;
        displayMessage = `${submitterName} 提交了任务「${taskTitle}」的${reviewLabel}审核，请处理。`;
      } else if (msgType === 'review_result') {
        const result = String(parsedBody!['result'] ?? '');
        const reviewerName = String(parsedBody!['reviewer_name'] ?? '管理员');
        const reviewType = String(parsedBody!['review_type'] ?? 'result');
        const isApproved = result === 'approved';
        const isCollaboration = reviewType === 'collaboration';
        defaultTitle = `审核结果·${reviewTypeLabel(reviewType)}：「${taskTitle}」${isApproved ? '已通过' : '被驳回'}`;
        const reason = String(parsedBody!['reason'] ?? '');
        if (isCollaboration) {
          displayMessage = isApproved
            ? `${reviewerName} 已批准任务「${taskTitle}」的协作申请，协作人已生效。`
            : `${reviewerName} 打回了任务「${taskTitle}」的协作申请。${reason ? `原因：${reason}` : ''}`;
        } else if (reviewType === 'due_date') {
          displayMessage = isApproved
            ? `${reviewerName} 已批准任务「${taskTitle}」的截止日期变更，新的截止日期已生效，任务回到进行中。`
            : `${reviewerName} 驳回了任务「${taskTitle}」的截止日期变更。${reason ? `原因：${reason}` : ''}`;
        } else if (reviewType === 'proposal') {
          displayMessage = isApproved
            ? `${reviewerName} 已通过任务「${taskTitle}」的立项申请，任务进入进行中。`
            : `${reviewerName} 打回了任务「${taskTitle}」的立项申请。${reason ? `原因：${reason}` : ''}`;
        } else if (reviewType === 'abandon') {
          displayMessage = isApproved
            ? `${reviewerName} 已通过任务「${taskTitle}」的放弃申请，任务已移除。`
            : `${reviewerName} 驳回了任务「${taskTitle}」的放弃申请，任务继续进行。${reason ? `原因：${reason}` : ''}`;
        } else {
          displayMessage = isApproved
            ? `${reviewerName} 已批准任务「${taskTitle}」，任务已完成。`
            : `${reviewerName} 打回了任务「${taskTitle}」，请修改后重新提交。${reason ? `原因：${reason}` : ''}`;
        }
      } else if (msgType === 'discussion_mention') {
        const actorName = String(parsedBody!['actor_name'] ?? senderName);
        const excerpt = String(parsedBody!['excerpt'] ?? '');
        defaultTitle = `评论提及：${taskTitle}`;
        displayMessage = `${actorName} 在任务《${taskTitle}》的讨论中提到了你：${excerpt}`;
      } else if (msgType === 'perf_self_assessment') {
        const periodLabel = String(parsedBody!['period_label'] ?? '');
        defaultTitle = `绩效自评：${periodLabel}月度绩效已生成，请完成自评`;
        displayMessage = `你的 ${periodLabel} 月度绩效报表已生成，请完成 5 维自评（交付 / 质量 / 协作 / 主动性 / 规范）。`;
      } else if (msgType === 'procurement_review_result') {
        const approved = String(parsedBody!['result'] ?? '') === 'approved';
        const materialName = String(parsedBody!['material_name'] ?? '未命名采购需求');
        const code = String(parsedBody!['procurement_code'] ?? '');
        const reviewerName = String(parsedBody!['reviewer_name'] ?? senderName);
        const reason = String(parsedBody!['reason'] ?? '');
        defaultTitle = approved
          ? `转采购审核通过：${materialName}`
          : `转采购已打回：${materialName}`;
        displayMessage = approved
          ? `${reviewerName} 已通过${code ? `采购需求 ${code}` : '该采购需求'}，请继续采购流程。`
          : `${reviewerName} 已打回${code ? `采购需求 ${code}` : '该采购需求'}并删除采购任务。${reason ? `原因：${reason}` : ''}`;
      } else if (msgType === 'procurement_assignment') {
        const materialName = String(parsedBody!['material_name'] ?? '未命名采购需求');
        const code = String(parsedBody!['procurement_code'] ?? '');
        defaultTitle = `新采购任务已分配：${materialName}`;
        displayMessage = `采购任务${code ? ` ${code}` : ''}已分配给你，请确认接收并继续处理。`;
      } else {
        defaultTitle = subject ? `${senderName}：${subject}` : `${senderName} 给你发来一条消息`;
        displayMessage = body.length > 200 ? `${body.slice(0, 200)}…` : body;
      }

      const relatedTaskId = parsedBody ? cleanText(parsedBody['task_id']) : '';
      return {
        id: String(m.id ?? `msg-${Date.now()}`),
        type: 'message',
        title: (msgType === 'review_request' || msgType === 'review_result') ? defaultTitle : (subject || defaultTitle),
        message: displayMessage,
        related_task_id: relatedTaskId || undefined,
        raw_body: body,
        time: this.formatRelativeTime(String(m.created_at ?? '')),
        sender_id: m.sender_id ?? null,
        sender_name: senderName,
        sender_role: m.sender_role ?? null,
        read: Boolean(m.read),
        handled: Boolean(m.handled),
        created_at: m.created_at ?? null,
      };
    });
  }

  private formatRelativeTime(iso: string): string {
    if (!iso) return '刚刚';
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return iso;
    const diffMs = Date.now() - then;
    if (diffMs < 60_000) return '刚刚';
    if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)} 分钟前`;
    if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)} 小时前`;
    if (diffMs < 30 * 86_400_000) return `${Math.floor(diffMs / 86_400_000)} 天前`;
    return iso.slice(0, 10);
  }

  async saveWorkspace(payload: JsonRecord) {
    return this.writeValue('rd.workspace', {
      ...EMPTY_WORKSPACE,
      ...asRecord(payload, EMPTY_WORKSPACE),
    });
  }

  async getDirectorDashboard() {
    const value = await this.readValue('rd.directorDashboard');
    return {
      ...EMPTY_DIRECTOR_DASHBOARD,
      ...asRecord(value, EMPTY_DIRECTOR_DASHBOARD),
    };
  }

  async saveDirectorDashboard(payload: JsonRecord) {
    return this.writeValue('rd.directorDashboard', {
      ...EMPTY_DIRECTOR_DASHBOARD,
      ...asRecord(payload, EMPTY_DIRECTOR_DASHBOARD),
    });
  }

  private assignmentMatchesPerson(task: JsonRecord, person: JsonRecord): boolean {
    const personUserId = cleanUserId(person.user_id);
    const taskUserId = cleanUserId(task.primary_owner_user_id ?? task.owner_user_id);
    if (personUserId && taskUserId && personUserId === taskUserId) return true;

    const personNameKey = personNameLookupKey(person.name);
    return Boolean(personNameKey && personNameLookupKey(task.primary_owner ?? task.owner) === personNameKey);
  }

  private collaboratorMatchesPerson(collaborator: JsonRecord, person: JsonRecord): boolean {
    const personUserId = cleanUserId(person.user_id);
    const collaboratorUserId = cleanUserId(collaborator.user_id);
    if (personUserId && collaboratorUserId && personUserId === collaboratorUserId) return true;

    const personNameKey = personNameLookupKey(person.name);
    return Boolean(personNameKey && personNameLookupKey(collaborator.name) === personNameKey);
  }

  private async rewritePersonAssignments(before: JsonRecord, after: JsonRecord | null) {
    // 「人员改名/删除」要波及该人名下的全部任务——跨主库 + 所有产品库改写（产品仅是分区）。
    const rewriteTask = (task: JsonRecord, mark: () => void): JsonRecord => {
      let next: JsonRecord = { ...task };

      if (this.assignmentMatchesPerson(task, before)) {
        mark();
        if (after) {
          next = {
            ...next,
            primary_owner: cleanText(after.name) || cleanText(task.primary_owner) || '待指派',
            primary_owner_user_id: cleanUserId(after.user_id) || null,
          };
        } else {
          next = {
            ...next,
            primary_owner: '待指派',
            primary_owner_user_id: null,
            status: task.status === 'completed' || task.status === 'archived' ? task.status : 'pending_assign',
          };
        }
      }

      const collaborators = asArray(task.collaborators)
        .filter(isRecord)
        .map((collaborator) => {
          if (!this.collaboratorMatchesPerson(collaborator, before)) return collaborator;
          mark();
          if (!after) return null;
          return {
            ...collaborator,
            name: cleanText(after.name) || cleanText(collaborator.name),
            user_id: cleanUserId(after.user_id) || null,
          };
        })
        .filter(isRecord);

      return {
        ...next,
        collaborators,
        subtasks: asArray(task.subtasks).filter(isRecord).map((s) => rewriteTask(s, mark)),
      };
    };

    await this.mutateAllStores((categories) => {
      let changed = false;
      const mark = () => { changed = true; };
      const updated = categories.map((category) => ({
        ...category,
        children: asArray(category.children).filter(isRecord).map((child) => ({
          ...child,
          tasks: asArray(child.tasks).filter(isRecord).map((t) => rewriteTask(t, mark)),
        })),
      }));
      return { categories: updated, changed };
    });
  }

  async getPeople() {
    const raw = await this.readArray('rd.people');
    const users = await this.listIdentityUsers();
    const normalized = this.normalizePeopleRecords(raw, users);
    if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
      await this.writeValue('rd.people', normalized);
    }
    return normalized;
  }

  async getPeopleUserOptions() {
    return this.listIdentityUsers();
  }

  async createPerson(payload: JsonRecord, actor?: AuditActorRef) {
    const [people, users] = await Promise.all([this.getPeople(), this.listIdentityUsers()]);
    const nextPerson = this.normalizePeopleRecords([withGeneratedId('rd-person', payload)], users)[0];
    if (!nextPerson) {
      throw new BadRequestException('研发成员数据无效');
    }
    const nextPeople = [nextPerson, ...people.filter((item) => !isRecord(item) || item.id !== nextPerson.id)];
    await this.writeValue('rd.people', nextPeople);
    await this.recordServerAudit({
      action: 'person.created',
      resource: { type: 'person', id: String(nextPerson.id ?? ''), name: cleanText(nextPerson.name) },
      actor: { id: actor?.userId, name: actor?.userName },
      comment: '新增研发成员',
      metadata: { role: cleanText(nextPerson.role), department: cleanText(nextPerson.department) },
    });
    await this.recomputeDirectorDashboard();
    return nextPerson;
  }

  async updatePerson(id: string, payload: JsonRecord, actor?: AuditActorRef) {
    const [people, users] = await Promise.all([this.getPeople(), this.listIdentityUsers()]);
    let found = false;
    let beforePerson: JsonRecord | null = null;
    let afterPerson: JsonRecord | null = null;

    // 防御性：显式校验/规范化 payload 中的 kb_level，避免 normalization 链路意外丢失或回退
    const incomingKbLevelNum = Number(payload?.kb_level);
    const hasExplicitKbLevel = Object.prototype.hasOwnProperty.call(payload ?? {}, 'kb_level')
      && Number.isFinite(incomingKbLevelNum);
    const sanitizedKbLevel = hasExplicitKbLevel
      ? Math.max(0, Math.min(100, Math.round(incomingKbLevelNum)))
      : null;

    const nextPeople = people.map((item) => {
      if (!isRecord(item) || item.id !== id) return item;
      found = true;
      beforePerson = item;
      const merged: JsonRecord = { ...item, ...payload, id };
      // 显式钉死 kb_level/kb_level_scale，确保 normalize 不会走 legacy 兜底回 20
      if (sanitizedKbLevel !== null) {
        merged.kb_level = sanitizedKbLevel;
        merged.kb_level_scale = 'score';
      }
      const normalizedPerson = this.normalizePeopleRecords([merged], users)[0];
      if (!normalizedPerson) return item;
      if (sanitizedKbLevel !== null) {
        normalizedPerson.kb_level = sanitizedKbLevel;
        normalizedPerson.kb_level_scale = 'score';
      }
      afterPerson = normalizedPerson;
      return normalizedPerson;
    });

    if (!found) {
      throw new NotFoundException('研发成员不存在');
    }

    await this.writeValue('rd.people', nextPeople);
    if (beforePerson && afterPerson) {
      await this.rewritePersonAssignments(beforePerson, afterPerson);
      await this.recordServerAudit({
        action: 'person.edited',
        resource: { type: 'person', id, name: cleanText((afterPerson as JsonRecord).name) },
        actor: { id: actor?.userId, name: actor?.userName },
        comment: '修改研发成员',
        changes: this.buildRecordChanges(beforePerson as JsonRecord, afterPerson as JsonRecord, AUDITED_PERSON_FIELDS),
      });
    }
    await this.recomputeDirectorDashboard();
    return nextPeople.find((item) => isRecord(item) && item.id === id);
  }

  async removePerson(id: string, actor?: AuditActorRef) {
    const people = await this.getPeople();
    const beforePerson = people.find((item) => isRecord(item) && item.id === id);
    const nextPeople = people.filter((item) => !isRecord(item) || item.id !== id);
    await this.writeValue('rd.people', nextPeople);
    if (isRecord(beforePerson)) {
      await this.rewritePersonAssignments(beforePerson, null);
      await this.recordServerAudit({
        action: 'person.deleted',
        resource: { type: 'person', id, name: cleanText(beforePerson.name) },
        actor: { id: actor?.userId, name: actor?.userName },
        comment: '删除研发成员',
        metadata: { role: cleanText(beforePerson.role), department: cleanText(beforePerson.department) },
      });
    }
    await this.recomputeDirectorDashboard();
    return { ok: true };
  }

  async getApprovalFlows() {
    return this.readArray('rd.approvalFlows');
  }

  /**
   * 「添加审核人」候选名单：本工作区内持有任一审批相关操作码的用户（超管通行）。
   * 刻意不开放全员——手动加进节点池的人会收到审核通知，若无操作码点审批会被拒，
   * 把候选锁在「真的能审」的范围内才不会造成收到通知却无权处理的死角。
   * codes 由 controller 传入（RD_TASK_MANAGER_PERMISSIONS，与审批授权同源）。
   */
  async getApprovalCandidates(codes: string[]) {
    const workspacePages = (WORKSPACE_PAGE_CODES[currentRdWorkspace()] ?? []).filter((code) =>
      code.startsWith('page:'),
    );
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        department: true,
        role: { select: { name: true, permissions: true } },
      },
    });
    return users
      .filter((user) => {
        const perms = Array.isArray(user.role?.permissions) ? (user.role.permissions as string[]) : [];
        if (perms.includes('*')) return true;
        return (
          codes.some((c) => perms.includes(c)) &&
          workspacePages.some((page) => perms.includes(page))
        );
      })
      .map((user) => ({
        id: user.id,
        name: user.name,
        position: user.role?.name ?? user.department ?? '未分配角色',
        email: user.email,
      }));
  }

  async getApprovalPools(permissionCodes: string[]) {
    const requested = Array.from(
      new Set(permissionCodes.map((code) => code.trim()).filter(Boolean)),
    );
    if (requested.length === 0) return {};

    // 池成员与审核通知收件人（getUsersWithAnyPermission）同口径：操作码 + 当前工作区页面码。
    // 操作码两池共享，只按操作码捞人会把协同角色显示进研发池（反之亦然），
    // 导致「审批流页显示的池」≠「实际收到审核通知的人」。页面码定池，这里补同一过滤；
    // 想让某人只进协同池：给他协同页面码 + 审核操作码、不给研发页面码即可（超管 '*' 两池均显示）。
    const workspacePages = (WORKSPACE_PAGE_CODES[currentRdWorkspace()] ?? []).filter((code) =>
      code.startsWith('page:'),
    );

    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        department: true,
        role: { select: { name: true, permissions: true } },
      },
    });

    const pools = Object.fromEntries(requested.map((code) => [code, [] as unknown[]]));

    users.forEach((user) => {
      const permissions = Array.isArray(user.role?.permissions)
        ? (user.role.permissions as string[])
        : [];
      const inWorkspace =
        permissions.includes('*') || workspacePages.some((page) => permissions.includes(page));
      if (!inWorkspace) return;
      requested.forEach((code) => {
        if (!permissions.includes('*') && !permissions.includes(code)) return;
        pools[code].push({
          id: user.id,
          name: user.name,
          position: user.role?.name ?? user.department ?? '未分配角色',
          email: user.email,
        });
      });
    });

    return pools;
  }

  /**
   * 审批流是整份覆盖保存，服务端拿不到「加了哪个节点、删了哪个节点」这种细粒度语义，
   * 只能记录流程数与节点数的变化——比前端各自上报 flow.node_added/removed 粗，
   * 但胜在绕不过去：直接调接口改流程同样留痕。
   */
  async saveApprovalFlows(payload: unknown[], actor?: AuditActorRef) {
    const before = await this.readArray('rd.approvalFlows');
    const next = asArray(payload);
    const result = await this.writeValue('rd.approvalFlows', next);
    const countNodes = (flows: unknown[]) =>
      flows.reduce<number>((sum, flow) => sum + (isRecord(flow) ? asArray(flow.nodes).length : 0), 0);
    await this.recordServerAudit({
      action: 'flow.saved',
      resource: { type: 'flow', id: 'rd-approval-flows', name: '审批流配置' },
      actor: { id: actor?.userId, name: actor?.userName },
      comment: '保存审批流配置',
      changes: [
        { field: 'flow_count', before: before.length, after: next.length },
        { field: 'node_count', before: countNodes(before), after: countNodes(next) },
      ],
    });
    return result;
  }

  /**
   * 语义留痕已并入 AuditLog 表（module = 工作区名），不再走 SystemSetting KV。
   * 输出结构保持 KV 时代的 JSON 形状：snapshot()、完成度评分等既有调用方无需改动。
   *
   * source <> 'api' 是为了排除全局拦截器写的 HTTP 原始留痕 —— 那份属于统一留痕页，
   * 混进研发快照会让「任务相关留痕」凭空多出一堆看不懂的 POST 记录。
   */
  async getAuditLogs(
    viewer?: { userId?: string; userName?: string; canReadAll: boolean },
    filter?: { resourceType?: string; resourceId?: string },
  ) {
    // 按资源过滤必须下推到查询：留痕现在由服务端随每次变更写入，条数远多于从前，
    // 「取最新 1000 条再由前端筛某个任务」会让稍早的任务时间线整段查不到。
    const resourceType = cleanText(filter?.resourceType);
    const resourceId = cleanText(filter?.resourceId);
    const rows = await this.prisma.auditLog.findMany({
      where: {
        module: currentRdWorkspace(),
        source: { not: 'api' },
        ...(resourceType ? { resource: resourceType } : {}),
        ...(resourceId ? { resourceId } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // 上限保留：不带过滤条件时 snapshot() 会把整段留痕塞进响应，不能无界增长
      take: MAX_AUDIT_LOGS,
    });
    const logs = rows.map((row) => this.auditRowToJson(row));

    // Internal callers (for example completion scoring) intentionally omit a viewer and
    // retain the complete audit stream. Every HTTP read path supplies a viewer.
    if (!viewer || viewer.canReadAll) return logs;

    const viewerId = cleanUserId(viewer.userId);
    const viewerNameKey = personNameLookupKey(viewer.userName);
    if (!viewerId && !viewerNameKey) return [];

    return logs.filter((log) => {
      const actor = isRecord(log.actor) ? log.actor : {};
      const actorId = cleanUserId(actor.id);
      if (actorId) return Boolean(viewerId) && actorId === viewerId;
      return Boolean(viewerNameKey) && personNameLookupKey(actor.name) === viewerNameKey;
    });
  }

  /** AuditLog 行 → KV 时代的留痕 JSON。两侧字段一一对应，改动只在存储层。 */
  private auditRowToJson(row: {
    id: string;
    userId: string | null;
    actorName: string | null;
    action: string;
    resource: string;
    resourceId: string | null;
    resourceName: string | null;
    summary: string | null;
    source: string;
    meta: unknown;
    notes: unknown;
    createdAt: Date;
  }): JsonRecord {
    const meta = isRecord(row.meta) ? row.meta : {};
    return {
      id: row.id,
      timestamp: row.createdAt.toISOString(),
      actor: {
        id: row.userId,
        name: row.actorName ?? '',
        ...(typeof meta.actorRole === 'string' ? { role: meta.actorRole } : {}),
      },
      action: row.action,
      source: row.source,
      resource: { type: row.resource, id: row.resourceId, name: row.resourceName },
      ...(row.summary ? { comment: row.summary } : {}),
      ...(isRecord(meta.metadata) ? { metadata: meta.metadata } : {}),
      ...(Array.isArray(meta.changes) ? { changes: meta.changes } : {}),
      notes: Array.isArray(row.notes) ? row.notes : [],
    };
  }

  // ── 已完成任务 AI 质量评分（持久化）─────────────────────────────────────────

  async getTaskCompletionScore(
    taskId: string,
    viewer: { userId?: string; hasFullAccess: boolean },
  ): Promise<JsonRecord | null> {
    const scores = await this.getTaskCompletionScores([taskId], viewer);
    return scores[taskId] ?? null;
  }

  async getTaskCompletionScores(
    rawTaskIds: string[],
    viewer: { userId?: string; hasFullAccess: boolean },
  ): Promise<Record<string, JsonRecord | null>> {
    const taskIds = Array.from(new Set(rawTaskIds.map((id) => cleanText(id)).filter(Boolean))).slice(0, 60);
    if (taskIds.length === 0) return {};
    const allScores = await this.readValue('rd.taskCompletionScores');
    const map = isRecord(allScores) ? allScores : {};
    const allowedTaskIds = new Set<string>();
    if (viewer.hasFullAccess) {
      for (const taskId of taskIds) allowedTaskIds.add(taskId);
    } else if (viewer.userId) {
      const requested = new Set(taskIds);
      const categories = await this.readMergedTaskCategories();
      for (const task of this.collectAllCategoryTasks(categories)) {
        const taskId = cleanText(task.task_id);
        if (!requested.has(taskId)) continue;
        const participantIds = new Set<string>();
        const ownerId = cleanUserId(task.primary_owner_user_id ?? task.owner_user_id);
        if (ownerId) participantIds.add(ownerId);
        for (const collaborator of asArray(task.collaborators).filter(isRecord)) {
          const collaboratorId = cleanUserId(collaborator.user_id);
          if (collaboratorId) participantIds.add(collaboratorId);
        }
        if (participantIds.has(viewer.userId)) allowedTaskIds.add(taskId);
      }
    }

    const output: Record<string, JsonRecord | null> = {};
    for (const taskId of taskIds) {
      const raw = map[taskId];
      if (!allowedTaskIds.has(taskId) || !isRecord(raw)) {
        output[taskId] = null;
        continue;
      }
      // 一般查询去掉 _debug 字段（含原始 prompt + 响应，仅超管可见）
      const { _debug, ...publicFields } = raw as JsonRecord & { _debug?: unknown };
      void _debug;
      output[taskId] = publicFields;
    }
    return output;
  }

  /**
   * 超管专用：返回完整的评分结果含 _debug 字段（原始 prompt、AI 响应、耗时）。
   * 用于"为什么 AI 给这个分"的透明审查。
   */
  async getTaskCompletionScoreDebug(taskId: string): Promise<JsonRecord | null> {
    const allScores = await this.readValue('rd.taskCompletionScores');
    const map = isRecord(allScores) ? allScores : {};
    const raw = map[taskId];
    if (!isRecord(raw)) return null;
    return raw;
  }

  /**
   * 团队绩效考核聚合（按人）。供生产驾驶舱「团队绩效考核」面板使用。
   *
   * 综合分 = 交付质量 70% + 交付吞吐 20% + AI 工具活跃度 10%
   *   · 交付质量：该成员作为主责人、已被 AI 评分的已完成任务平均分（0~100，直接采用）。
   *   · 交付吞吐：100·c/(c+5)（绝对饱和曲线，不与他人相比，避免「别人做得多就把我比下去」的不公平）。
   *   · AI 工具活跃度：100·m/(m+30)（m=该成员在 MateChat 的发言条数；饱和曲线使刷量边际收益递减，降低可操纵性）。
   * 仅对「至少 1 条已评分完成任务」的成员计算综合分与排名；其余成员只展示完成数 / 对话活跃度，不参与排名。
   * 趋势：按完成时间（completed_at，回退 computed_at）取近 30 天均分 − 前 30 天均分。
   */
  async getPerformanceAssessment(): Promise<JsonRecord> {
    const WINDOW_DAYS = 30;
    const WEIGHTS = { delivery: 0.7, throughput: 0.2, chat: 0.1 };
    const THROUGHPUT_K = 5;
    const CHAT_K = 30;

    const [categories, scoresRaw, people] = await Promise.all([
      this.readMergedTaskCategories(),
      this.readValue('rd.taskCompletionScores'),
      this.getPeople(),
    ]);
    const scoreMap: JsonRecord = isRecord(scoresRaw) ? scoresRaw : {};

    // 收集所有「已完成」任务并归到主责人（评分按 task_id，产品仅是分区）。
    type CompletedEntry = { task_id: string; owner: string; ownerUserId: string };
    const completed: CompletedEntry[] = [];
    const collect = (tasks: unknown[]): void => {
      for (const t of tasks) {
        if (!isRecord(t)) continue;
        if (isCompletedTask(t) && !isArchivedTask(t) && typeof t.task_id === 'string') {
          const owner = cleanText(t.primary_owner ?? t.owner);
          if (!isUnassignedOwner(owner)) {
            completed.push({
              task_id: t.task_id,
              owner,
              ownerUserId: cleanUserId(t.primary_owner_user_id ?? t.owner_user_id),
            });
          }
        }
        if (Array.isArray(t.subtasks)) collect(t.subtasks);
      }
    };
    for (const cat of categories) {
      if (!isRecord(cat)) continue;
      for (const child of asArray(cat.children).filter(isRecord)) {
        collect(asArray(child.tasks));
      }
    }

    // MateChat 发言条数（按用户）：总量 + 近 30 天。失败则降级为 0（绝不阻断考核）。
    const chatByUser = new Map<string, { total: number; recent: number }>();
    try {
      const chatRows = await this.prisma.$queryRawUnsafe<
        Array<{ user_id: string; total_cnt: number | bigint; recent_cnt: number | bigint }>
      >(
        `SELECT c."userId" AS user_id,
                COUNT(m.id)::int AS total_cnt,
                COUNT(m.id) FILTER (WHERE m."createdAt" >= NOW() - INTERVAL '${WINDOW_DAYS} days')::int AS recent_cnt
         FROM "ChatMessage" m
         JOIN "ChatConversation" c ON c.id = m."conversationId"
         WHERE m.role = 'user'
         GROUP BY c."userId"`,
      );
      for (const r of chatRows) {
        const uid = cleanUserId(r.user_id);
        if (!uid) continue;
        chatByUser.set(uid, { total: Number(r.total_cnt) || 0, recent: Number(r.recent_cnt) || 0 });
      }
    } catch (err) {
      this.logger.warn(
        `[getPerformanceAssessment] MateChat 统计查询失败，按 0 计：${(err as Error).message}`,
      );
    }

    type Agg = {
      person_id: string;
      user_id: string | null;
      name: string;
      position: string;
      department: string;
      completed_count: number;
      scores: number[];
      grade_dist: { A: number; B: number; C: number; D: number };
      dim_sum: { timeliness: number; process: number; evidence: number; collaboration: number };
      dim_n: number;
      points: Array<{ at: string; total: number }>;
    };
    const aggMap = new Map<string, Agg>();
    const keyOf = (userId: string, name: string) =>
      userId ? `u:${userId}` : `n:${personNameLookupKey(name)}`;

    for (const p of people) {
      if (!isRecord(p)) continue;
      const userId = cleanUserId(p.user_id);
      const name = cleanText(p.name);
      const key = keyOf(userId, name);
      if (!key || key === 'n:' || aggMap.has(key)) continue;
      aggMap.set(key, {
        person_id:
          typeof p.id === 'string' && p.id
            ? p.id
            : userId
              ? `rd-user-${userId}`
              : `rd-unbound-${personNameLookupKey(name)}`,
        user_id: userId || null,
        name: name || '未命名成员',
        position: cleanText(p.position) || '研发成员',
        department: cleanText(p.department),
        completed_count: 0,
        scores: [],
        grade_dist: { A: 0, B: 0, C: 0, D: 0 },
        dim_sum: { timeliness: 0, process: 0, evidence: 0, collaboration: 0 },
        dim_n: 0,
        points: [],
      });
    }

    const ensureAgg = (userId: string, name: string): Agg | null => {
      const key = keyOf(userId, name);
      if (!key || key === 'n:') return null;
      let agg = aggMap.get(key);
      if (!agg) {
        agg = {
          person_id: userId ? `rd-user-${userId}` : `rd-unbound-${personNameLookupKey(name)}`,
          user_id: userId || null,
          name: name || '未绑定成员',
          position: '研发成员',
          department: '',
          completed_count: 0,
          scores: [],
          grade_dist: { A: 0, B: 0, C: 0, D: 0 },
          dim_sum: { timeliness: 0, process: 0, evidence: 0, collaboration: 0 },
          dim_n: 0,
          points: [],
        };
        aggMap.set(key, agg);
      }
      return agg;
    };

    for (const c of completed) {
      const agg = ensureAgg(c.ownerUserId, c.owner);
      if (!agg) continue;
      agg.completed_count += 1;
      const entry = scoreMap[c.task_id];
      if (!isRecord(entry)) continue;
      const total = typeof entry.total === 'number' ? entry.total : Number(entry.total);
      if (!Number.isFinite(total)) continue;
      agg.scores.push(total);
      if (entry.grade === 'A' || entry.grade === 'B' || entry.grade === 'C' || entry.grade === 'D') {
        agg.grade_dist[entry.grade] += 1;
      }
      const dims = asArray(entry.dimensions).filter(isRecord);
      for (const d of dims) {
        const k = d.key;
        const s = typeof d.score === 'number' ? d.score : Number(d.score);
        if (!Number.isFinite(s)) continue;
        if (k === 'timeliness' || k === 'process' || k === 'evidence' || k === 'collaboration') {
          agg.dim_sum[k] += s;
        }
      }
      if (dims.length > 0) agg.dim_n += 1;
      const at =
        typeof entry.completed_at === 'string' && entry.completed_at
          ? entry.completed_at
          : typeof entry.computed_at === 'string'
            ? entry.computed_at
            : '';
      if (at) agg.points.push({ at, total });
    }

    const now = Date.now();
    const recentFrom = now - WINDOW_DAYS * 86_400_000;
    const prevFrom = now - 2 * WINDOW_DAYS * 86_400_000;
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const avg = (xs: number[]): number | null =>
      xs.length === 0 ? null : round1(xs.reduce((s, x) => s + x, 0) / xs.length);
    const saturate = (x: number, k: number) => (x <= 0 ? 0 : Math.round((100 * x) / (x + k)));

    const rows = Array.from(aggMap.values()).map((agg) => {
      const scoredCount = agg.scores.length;
      const avgScore = avg(agg.scores);
      const chat = agg.user_id
        ? chatByUser.get(agg.user_id) ?? { total: 0, recent: 0 }
        : { total: 0, recent: 0 };
      const throughputScore = saturate(scoredCount, THROUGHPUT_K);
      const chatScore = saturate(chat.total, CHAT_K);
      const composite =
        scoredCount >= 1 && avgScore !== null
          ? Math.round(
              WEIGHTS.delivery * avgScore +
                WEIGHTS.throughput * throughputScore +
                WEIGHTS.chat * chatScore,
            )
          : null;

      const recentScores = agg.points
        .filter((p) => new Date(p.at).getTime() >= recentFrom)
        .map((p) => p.total);
      const prevScores = agg.points
        .filter((p) => {
          const t = new Date(p.at).getTime();
          return t >= prevFrom && t < recentFrom;
        })
        .map((p) => p.total);
      const recentAvg = avg(recentScores);
      const prevAvg = avg(prevScores);
      const trendDelta =
        recentAvg !== null && prevAvg !== null ? round1(recentAvg - prevAvg) : null;

      const series = [...agg.points]
        .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
        .slice(-10)
        .map((p) => ({ at: p.at, total: p.total }));

      const dimensionAvg =
        agg.dim_n > 0
          ? {
              timeliness: round1(agg.dim_sum.timeliness / agg.dim_n),
              process: round1(agg.dim_sum.process / agg.dim_n),
              evidence: round1(agg.dim_sum.evidence / agg.dim_n),
              collaboration: round1(agg.dim_sum.collaboration / agg.dim_n),
            }
          : null;

      return {
        person_id: agg.person_id,
        user_id: agg.user_id,
        name: agg.name,
        position: agg.position,
        department: agg.department,
        completed_count: agg.completed_count,
        scored_count: scoredCount,
        avg_score: avgScore,
        grade_dist: agg.grade_dist,
        dimension_avg: dimensionAvg,
        chat_total: chat.total,
        chat_recent: chat.recent,
        recent_avg: recentAvg,
        prev_avg: prevAvg,
        trend_delta: trendDelta,
        score_series: series,
        delivery_score: avgScore,
        throughput_score: throughputScore,
        chat_score: chatScore,
        composite,
        rank: null as number | null,
      };
    });

    // 排名：仅对有综合分者按综合分降序；其余按完成数 → 对话量降序排在后面。
    const ranked = rows
      .filter((r) => r.composite !== null)
      .sort((a, b) => (b.composite as number) - (a.composite as number));
    ranked.forEach((r, i) => {
      r.rank = i + 1;
    });
    const unranked = rows
      .filter((r) => r.composite === null)
      .sort((a, b) => b.completed_count - a.completed_count || b.chat_total - a.chat_total);
    const orderedRows = [...ranked, ...unranked];

    // 团队层汇总
    const allAvgScores = rows
      .map((r) => r.avg_score)
      .filter((x): x is number => x !== null);
    const sortedAvg = [...allAvgScores].sort((a, b) => a - b);
    const medianScore =
      sortedAvg.length === 0
        ? null
        : sortedAvg.length % 2 === 1
          ? sortedAvg[(sortedAvg.length - 1) / 2]
          : round1((sortedAvg[sortedAvg.length / 2 - 1] + sortedAvg[sortedAvg.length / 2]) / 2);
    const teamGrade = { A: 0, B: 0, C: 0, D: 0 };
    for (const r of rows) {
      teamGrade.A += r.grade_dist.A;
      teamGrade.B += r.grade_dist.B;
      teamGrade.C += r.grade_dist.C;
      teamGrade.D += r.grade_dist.D;
    }
    const compositeVals = ranked.map((r) => r.composite as number);
    const avgComposite = compositeVals.length
      ? Math.round(compositeVals.reduce((s, x) => s + x, 0) / compositeVals.length)
      : null;

    // 团队月度均分（近 6 月）——用未截断的完整评分点，做团队趋势迷你图。
    const monthBuckets = new Map<string, { sum: number; count: number }>();
    for (const agg of aggMap.values()) {
      for (const p of agg.points) {
        const d = new Date(p.at);
        if (Number.isNaN(d.getTime())) continue;
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const b = monthBuckets.get(ym) ?? { sum: 0, count: 0 };
        b.sum += p.total;
        b.count += 1;
        monthBuckets.set(ym, b);
      }
    }
    const scoreMonths = Array.from(monthBuckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6)
      .map(([month, b]) => ({ month, avg: round1(b.sum / b.count), count: b.count }));

    return {
      generated_at: new Date().toISOString(),
      window_days: WINDOW_DAYS,
      weights: WEIGHTS,
      saturation: { throughput_k: THROUGHPUT_K, chat_k: CHAT_K },
      team: {
        ranked_people: ranked.length,
        avg_composite: avgComposite,
        avg_score: avg(allAvgScores),
        median_score: medianScore,
        grade_dist: teamGrade,
        total_completed: rows.reduce((s, r) => s + r.completed_count, 0),
        total_scored: rows.reduce((s, r) => s + r.scored_count, 0),
        chat_total: rows.reduce((s, r) => s + r.chat_total, 0),
        score_months: scoreMonths,
      },
      rows: orderedRows,
      notes: [
        '综合分 = 交付质量 70% + 交付吞吐 20% + AI 工具活跃度 10%。',
        '交付质量：本人作为主责人、已被 AI 评分的已完成任务平均分（0~100）。',
        '交付吞吐：100×c/(c+5)，c=已评分完成任务数；绝对饱和曲线，不与他人相比，避免「别人做得多就把我比下去」。',
        'AI 工具活跃度：100×m/(m+30)，m=本人在 MateChat 的发言条数；饱和曲线使刷量边际收益递减，降低可操纵性。',
        '仅对「至少 1 条已评分完成任务」的成员计算综合分与排名；其余成员只展示完成数与对话活跃度。',
        '趋势：按完成时间取近 30 天均分 − 前 30 天均分；数据不足时留空。',
      ],
    };
  }

  private async collectTaskParticipantUserIds(taskId: string): Promise<Set<string>> {
    const result = new Set<string>();
    const categories = await this.readMergedTaskCategories();
    const walk = (tasks: unknown[]): void => {
      for (const t of tasks) {
        if (!isRecord(t)) continue;
        if (t.task_id === taskId) {
          if (typeof t.primary_owner_user_id === 'string' && t.primary_owner_user_id) {
            result.add(t.primary_owner_user_id);
          }
          for (const c of asArray(t.collaborators).filter(isRecord)) {
            if (typeof c.user_id === 'string' && c.user_id) result.add(c.user_id);
          }
        }
        if (Array.isArray(t.subtasks)) walk(t.subtasks);
      }
    };
    for (const cat of categories) {
      if (!isRecord(cat)) continue;
      for (const child of asArray(cat.children).filter(isRecord)) {
        walk(asArray(child.tasks));
      }
    }
    return result;
  }

  /**
   * 批量为现存已完成任务补跑 AI 评分（一次性 / 升级用）。
   * 默认幂等：已有评分的任务会被跳过；传 force=true 则强制对所有已完成任务重新评分
   * （用于评分标准升级后统一刷新历史分）。返回扫描总数、成功评分数、跳过数、失败数。
   */
  async backfillTaskCompletionScores(
    opts: { force?: boolean } = {},
  ): Promise<{
    total: number;
    scored: number;
    skipped: number;
    failed: number;
    failed_ids: string[];
  }> {
    const categories = await this.readMergedTaskCategories();
    const completedIds: string[] = [];
    const collect = (tasks: unknown[]): void => {
      for (const t of tasks) {
        if (!isRecord(t)) continue;
        if (!isProductionMirrorTask(t) && t.status === 'completed' && typeof t.task_id === 'string') {
          completedIds.push(t.task_id);
        }
        if (Array.isArray(t.subtasks)) collect(t.subtasks);
      }
    };
    for (const cat of categories) {
      if (!isRecord(cat)) continue;
      for (const child of asArray(cat.children).filter(isRecord)) {
        collect(asArray(child.tasks));
      }
    }

    const existing = await this.readValue('rd.taskCompletionScores');
    const existingMap: JsonRecord = isRecord(existing) ? existing : {};
    let scored = 0;
    let skipped = 0;
    let failed = 0;
    const failedIds: string[] = [];

    // 并发 3 个，避免一次性把 AI 上游打爆
    const CONCURRENCY = 3;
    const force = !!opts.force;
    const queue = [...completedIds];
    const runners: Promise<void>[] = [];
    for (let i = 0; i < Math.min(CONCURRENCY, queue.length); i++) {
      runners.push(
        (async () => {
          while (queue.length > 0) {
            const taskId = queue.shift()!;
            if (!force && isRecord(existingMap[taskId])) {
              skipped++;
              continue;
            }
            const before = await this.readValue('rd.taskCompletionScores');
            const beforeMap = isRecord(before) ? before : {};
            const beforeEntry = beforeMap[taskId];
            const beforeAt =
              isRecord(beforeEntry) && typeof beforeEntry.computed_at === 'string'
                ? beforeEntry.computed_at
                : undefined;
            try {
              await this.triggerTaskCompletionScoring(taskId, { force });
              const after = await this.readValue('rd.taskCompletionScores');
              const afterMap = isRecord(after) ? after : {};
              const afterEntry = afterMap[taskId];
              if (!isRecord(afterEntry)) {
                failed++;
                failedIds.push(taskId);
              } else if (force) {
                // 强制模式：computed_at 变化才算真正重算（防止"任务未找到"等未写入的情况误计）
                const afterAt =
                  typeof afterEntry.computed_at === 'string' ? afterEntry.computed_at : undefined;
                if (afterAt && afterAt !== beforeAt) scored++;
                else skipped++;
              } else if (!isRecord(beforeEntry)) {
                scored++;
              } else {
                skipped++;
              }
            } catch {
              failed++;
              failedIds.push(taskId);
            }
          }
        })(),
      );
    }
    await Promise.all(runners);

    return {
      total: completedIds.length,
      scored,
      skipped,
      failed,
      failed_ids: failedIds,
    };
  }

  /** 评分落库串行锁：并发回填时保证对 rd.taskCompletionScores 的「读-改-写」不互相覆盖（进程内）。 */
  private scoreWriteChain: Promise<unknown> = Promise.resolve();
  /** 在串行锁内执行 fn（等前一个写入完成后再开始），返回 fn 的结果；链本身吞掉异常，避免一次失败阻断后续写入。 */
  private runExclusiveScoreWrite<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.scoreWriteChain.then(() => fn());
    this.scoreWriteChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * 触发已完成任务的 AI 评分；默认幂等：已有评分则跳过。仅在主管审核通过将任务标记为 completed 后调用。
   * 传 options.force=true 可强制重算（覆盖已有评分），用于评分标准升级后刷新历史分。
   * 设计为 fire-and-forget；失败仅记录日志，不影响审核主流程。
   */
  async triggerTaskCompletionScoring(
    taskId: string,
    options: { force?: boolean } = {},
  ): Promise<void> {
    try {
      // 预检查（仅用于幂等跳过）：真正落库在下方串行临界区内重新读取最新值，避免并发回填互相覆盖。
      const existing = await this.readValue('rd.taskCompletionScores');
      // 幂等：已有评分则跳过；force=true 时强制重算（用于评分标准升级后刷新历史分）
      if (!options.force && isRecord(existing) && isRecord((existing as JsonRecord)[taskId])) return;

      // 收集任务详情（跨所有产品库定位：评分按 task_id，产品仅是分区）
      const categories = await this.readMergedTaskCategories();
      let foundTask: JsonRecord | null = null;
      const findInTasks = (tasks: unknown[]): void => {
        for (const t of tasks) {
          if (!isRecord(t)) continue;
          if (t.task_id === taskId) {
            foundTask = t;
            return;
          }
          if (Array.isArray(t.subtasks)) findInTasks(t.subtasks);
        }
      };
      for (const cat of categories) {
        if (!isRecord(cat)) continue;
        for (const child of asArray(cat.children).filter(isRecord)) {
          findInTasks(asArray(child.tasks));
          if (foundTask) break;
        }
        if (foundTask) break;
      }
      if (!foundTask) {
        this.logger.warn(`[triggerTaskCompletionScoring] task not found: ${taskId}`);
        return;
      }
      if (isProductionMirrorTask(foundTask)) return;

      const notesMap = await this.getProgressNoteMap();
      const notes = notesMap[taskId] ?? [];
      const allLogs = await this.getAuditLogs();
      const taskLogs = allLogs.filter((log) => {
        const resource = isRecord(log.resource) ? log.resource : null;
        return resource && resource.id === taskId;
      });

      const aiResult = await this.rdAiService.scoreTaskCompletion({
        task: {
          task_id: String((foundTask as JsonRecord).task_id ?? taskId),
          title: String((foundTask as JsonRecord).title ?? ''),
          description: typeof (foundTask as JsonRecord).description === 'string'
            ? ((foundTask as JsonRecord).description as string)
            : undefined,
          category_path: typeof (foundTask as JsonRecord).category_path === 'string'
            ? ((foundTask as JsonRecord).category_path as string)
            : undefined,
          primary_owner: typeof (foundTask as JsonRecord).primary_owner === 'string'
            ? ((foundTask as JsonRecord).primary_owner as string)
            : undefined,
          collaborators: asArray((foundTask as JsonRecord).collaborators)
            .filter(isRecord)
            .map((c) => ({
              name: typeof c.name === 'string' ? c.name : undefined,
              role: typeof c.role === 'string' ? c.role : undefined,
            })),
          final_priority: typeof (foundTask as JsonRecord).final_priority === 'string'
            ? ((foundTask as JsonRecord).final_priority as string)
            : undefined,
          start_date: typeof (foundTask as JsonRecord).start_date === 'string'
            ? ((foundTask as JsonRecord).start_date as string)
            : undefined,
          due_date: typeof (foundTask as JsonRecord).due_date === 'string'
            ? ((foundTask as JsonRecord).due_date as string)
            : undefined,
          updated_at: typeof (foundTask as JsonRecord).updated_at === 'string'
            ? ((foundTask as JsonRecord).updated_at as string)
            : undefined,
          attachments: typeof (foundTask as JsonRecord).attachments === 'number'
            ? ((foundTask as JsonRecord).attachments as number)
            : 0,
        },
        notes: notes.map((n) => ({
          text: typeof n.text === 'string' ? n.text : undefined,
          progress: typeof n.progress === 'number' ? n.progress : undefined,
          created_at: typeof n.created_at === 'string' ? n.created_at : undefined,
          actor: isRecord(n.actor)
            ? {
                name: typeof n.actor.name === 'string' ? n.actor.name : undefined,
                role: typeof n.actor.role === 'string' ? n.actor.role : undefined,
              }
            : undefined,
          attachments: asArray(n.attachments)
            .filter(isRecord)
            .map((a) => ({
              name: typeof a.name === 'string' ? a.name : undefined,
              mime: typeof a.mime === 'string' ? a.mime : undefined,
              size: typeof a.size === 'number' ? a.size : undefined,
              // L1+L2+L3：传入预抽取出的附件文本与来源
              extracted_text: typeof a.extracted_text === 'string' ? a.extracted_text : undefined,
              extracted_source: typeof a.extracted_source === 'string' ? a.extracted_source : undefined,
            })),
        })),
        auditLogs: taskLogs.map((log) => ({
          timestamp: typeof log.timestamp === 'string' ? log.timestamp : undefined,
          action: typeof log.action === 'string' ? log.action : undefined,
          comment: typeof log.comment === 'string' ? log.comment : undefined,
          actor: isRecord(log.actor)
            ? { name: typeof log.actor.name === 'string' ? log.actor.name : undefined }
            : undefined,
        })),
        // L4：从知识库 RAG 召回与本任务相关的参考资料
        ragContext: await this.getCompletionScoringRagContext(
          String((foundTask as JsonRecord).title ?? ''),
          typeof (foundTask as JsonRecord).description === 'string'
            ? ((foundTask as JsonRecord).description as string)
            : '',
          typeof (foundTask as JsonRecord).primary_owner_user_id === 'string'
            ? ((foundTask as JsonRecord).primary_owner_user_id as string)
            : null,
        ).catch(() => []),
      });

      // 串行落库：并发回填（CONCURRENCY>1）时多个 runner 各自耗时数秒算分后回写整块 JSON，若各自基于
      // 「算分前的旧快照」写回会互相覆盖、静默丢分。这里在进程内串行锁中「重新读取最新整块 → 只合并本任务
      // 这一条 → 写回」，保证不丢更新（AI 算分仍并发，临界区只是两次轻量 DB 操作）。
      await this.runExclusiveScoreWrite(async () => {
        const latest = await this.readValue('rd.taskCompletionScores');
        const map: JsonRecord = isRecord(latest) ? { ...latest } : {};
        // 钉死一个稳定的「完成时间」：首次评分时记为当下（评分在审核通过转 completed 的瞬间触发，
        // 故约等于真实完成时间）；之后的强制重算（force）保留原值，使绩效趋势不会因「按新标准重算」
        // 把所有历史分的时间戳塌缩到同一天而失真。
        const prevEntry = isRecord(map[taskId]) ? (map[taskId] as JsonRecord) : null;
        const prevCompletedAt =
          prevEntry && typeof prevEntry.completed_at === 'string' && prevEntry.completed_at
            ? prevEntry.completed_at
            : // 历史分没有 completed_at 时，退回其原始 computed_at（≈ 真实完成时间），
              // 这样「按新标准重算」也不会把旧任务的趋势点塌缩到今天。
              prevEntry && typeof prevEntry.computed_at === 'string' && prevEntry.computed_at
              ? prevEntry.computed_at
              : null;
        const completedAt = prevCompletedAt ?? new Date().toISOString();
        map[taskId] = { ...(aiResult as unknown as JsonRecord), completed_at: completedAt };
        await this.writeValue('rd.taskCompletionScores', map);
      });
      this.logger.log(
        `[triggerTaskCompletionScoring] scored ${taskId}: ${aiResult.total}/100 (${aiResult.grade}) via ${aiResult.provider}/${aiResult.model}`,
      );
    } catch (err) {
      this.logger.warn(
        `[triggerTaskCompletionScoring] failed for ${taskId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * L4：评分前从知识库 RAG 召回与本任务相关的参考资料。
   * 用任务标题 + 描述做 query，限制 5 条以内，绕过权限校验（评分服务端动作）。
   * 返回精简结构，供 prompt 使用。
   */
  private async getCompletionScoringRagContext(
    taskTitle: string,
    description: string,
    ownerUserId: string | null,
  ): Promise<Array<{ source: string; title?: string; content: string; similarity?: number }>> {
    const query = `${taskTitle}\n${description}`.trim().slice(0, 500);
    if (!query) return [];
    try {
      // 服务端动作：用 '*' 权限绕过 KB ACL；如果设置了主责人则用其 userId 以便后续审计追溯
      const userContext = {
        userId: ownerUserId || 'system-completion-scoring',
        permissions: ['*'],
      };
      const resp = await this.ragService.search(query, userContext, { topK: 5, threshold: 0.6 });
      return resp.results.map((r) => ({
        source: String(r.sourceType ?? 'kb'),
        title: typeof r.metadata?.title === 'string' ? r.metadata.title : undefined,
        content: r.content,
        similarity: r.similarity,
      }));
    } catch (err) {
      this.logger.warn(`[getCompletionScoringRagContext] RAG search failed: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * 写一条语义留痕。落 AuditLog 表而非 KV：KV 是「读整份数组 → 改 → 写回」，
   * 并发写天然互相覆盖，且 1000 条上限会静默淘汰早期记录——审计数据不该这么存。
   */
  async createAuditLog(payload: JsonRecord) {
    const actor = isRecord(payload.actor) ? payload.actor : {};
    const resource = isRecord(payload.resource) ? payload.resource : {};
    const actorId = cleanUserId(actor.id);
    // userId 是外键：指向已删除账号会让整条写入失败。宁可丢关联也不能丢留痕，
    // 姓名快照 actorName 保证这类记录仍追溯得到人。
    const actorExists = actorId
      ? await this.prisma.user.findUnique({ where: { id: actorId }, select: { id: true } })
      : null;
    const source = cleanText(payload.source);

    const row = await this.prisma.auditLog.create({
      data: {
        userId: actorExists ? actorId : null,
        actorName: cleanText(actor.name) || null,
        module: currentRdWorkspace(),
        source: source === 'ai' || source === 'system' || source === 'api' ? source : 'web',
        action: cleanText(payload.action) || 'unknown',
        resource: cleanText(resource.type) || 'system',
        resourceId: cleanText(resource.id) || null,
        resourceName: cleanText(resource.name) || null,
        summary: cleanText(payload.comment) || cleanText(payload.summary) || null,
        meta: {
          ...(Array.isArray(payload.changes) ? { changes: payload.changes } : {}),
          ...(isRecord(payload.metadata) ? { metadata: payload.metadata } : {}),
          ...(cleanText(actor.role) ? { actorRole: cleanText(actor.role) } : {}),
        } as Prisma.InputJsonValue,
        notes: [],
      },
    });
    return this.auditRowToJson(row);
  }

  /**
   * 给某条操作留痕追加一条「备注」。备注内嵌在该留痕记录的 notes 数组里，
   * 随留痕一起持久化、一起被 MAX_AUDIT_LOGS 滚动淘汰，做到「跟着留痕走」。
   */
  async addAuditLogNote(logId: string, payload: JsonRecord, actorRef?: AuditActorRef) {
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) throw new BadRequestException('备注内容不能为空');
    if (text.length > 200) throw new BadRequestException('备注内容过长（上限 200 字符）');

    const log = await this.prisma.auditLog.findUnique({ where: { id: logId }, select: { notes: true } });
    if (!log) throw new NotFoundException('操作留痕记录不存在');

    // 备注署名同样只认 JWT 身份，不用请求体里的 actor
    const actor: JsonRecord = { id: actorRef?.userId ?? null, name: actorRef?.userName ?? '' };
    const note: JsonRecord = {
      id: `rd-log-note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      actor,
      created_at: new Date().toISOString(),
    };
    const existing = Array.isArray(log.notes) ? log.notes : [];
    const updated = await this.prisma.auditLog.update({
      where: { id: logId },
      data: { notes: [...existing, note] as Prisma.InputJsonValue },
    });
    return this.auditRowToJson(updated);
  }

  async getAiSettings() {
    const value = await this.readValue('rd.aiSettings');
    return {
      ...this.normalizeAiSettings(value),
      runtime: {
        ocr: {
          provider: 'tencent_ocr',
          ready: await this.ocrService.hasTencentConfig(),
        },
        models: await this.listAiModelRefs(),
      },
    };
  }

  async saveAiSettings(payload: JsonRecord) {
    const previous = this.normalizeAiSettings(await this.readValue('rd.aiSettings'));
    const next = this.normalizeAiSettings({
      ...previous,
      ...payload,
      updated_at: new Date().toISOString(),
    });
    await this.writeValue('rd.aiSettings', next);
    return this.getAiSettings();
  }

  async planFileIngestion(payload: JsonRecord) {
    const settings = this.normalizeAiSettings(await this.readValue('rd.aiSettings'));
    const files = asArray(payload.files).filter(isRecord);

    return {
      policy: settings.file_policy,
      files: files.map((file) => this.buildFileIngestionPlan(file, settings)),
    };
  }

  // ── Knowledge Base ────────────────────────────────────────────────────────
  //
  // 同一套 CRUD 同时服务「研发知识库」与「部门知识库」：
  //   kbId 缺省（undefined）= 研发库，沿用 rd.knowledgeCategories / rd.knowledgeEntries / 'rd/knowledge' OSS 前缀，行为零变化；
  //   kbId = 部门 id（如 'finance'）= 部门库，切到 deptkb.{id}.* 存储键与 deptkb/{id} OSS 前缀。
  // 部门库不接 RAG（一期决策），故 createKnowledgeEntry/updateKnowledgeEntry/deleteKnowledgeEntry 仅在研发库路径同步向量。

  private kbCategoriesKey(kbId?: string): RdStoreKey {
    return kbId ? `deptkb.${kbId}.knowledgeCategories` : 'rd.knowledgeCategories';
  }

  private kbEntriesKey(kbId?: string): RdStoreKey {
    return kbId ? `deptkb.${kbId}.knowledgeEntries` : 'rd.knowledgeEntries';
  }

  /** 部门库默认仅一个「其他」兜底分类；研发库用其专属预置分类树。 */
  private kbDefaultCategories(kbId?: string): unknown[] {
    return kbId ? DEPT_KB_DEFAULT_CATEGORIES : DEFAULT_KB_CATEGORIES;
  }

  /** OSS 对象前缀：研发库 'rd/knowledge'，部门库 'deptkb/{id}'。 */
  buildKbOssPrefix(kbId?: string): string {
    return kbId ? `deptkb/${kbId}` : 'rd/knowledge';
  }

  // ── 部门库成员分值表（仅 LEVEL_FILTERED_DEPT_KB_IDS 内的库启用按人过滤）────────

  private deptKbMemberLevelsKey(kbId: string): RdStoreKey {
    return `deptkb.${kbId}.memberLevels`;
  }

  private normalizeDeptKbMemberLevels(payload: unknown): Array<{ user_id: string; name: string; level: number }> {
    const seen = new Map<string, { user_id: string; name: string; level: number }>();
    for (const item of asArray(payload)) {
      if (!isRecord(item)) continue;
      const userId = cleanText(item.user_id);
      if (!userId) continue;
      // 同一用户多条时保留最后一条
      seen.set(userId, {
        user_id: userId,
        name: cleanText(item.name),
        level: ResearchDevelopmentService.clampLevel(item.level),
      });
    }
    return [...seen.values()];
  }

  /** 成员分值表读取缓存（60s TTL，保存时立即失效）：条目列表/详情是热路径，避免每次请求都整表读库。 */
  private readonly deptKbMemberLevelsCache = new Map<string, { data: Array<{ user_id: string; name: string; level: number }>; freshUntil: number }>();

  /** 读取部门库成员分值表：[{ user_id, name, level(0-100) }]。 */
  async getDeptKbMemberLevels(kbId: string) {
    const cached = this.deptKbMemberLevelsCache.get(kbId);
    if (cached && cached.freshUntil > Date.now()) return cached.data;
    const data = this.normalizeDeptKbMemberLevels(await this.readValue(this.deptKbMemberLevelsKey(kbId)));
    this.deptKbMemberLevelsCache.set(kbId, { data, freshUntil: Date.now() + 60_000 });
    return data;
  }

  /** 全量保存部门库成员分值表（库管理员维护）。 */
  async saveDeptKbMemberLevels(kbId: string, payload: unknown) {
    const normalized = this.normalizeDeptKbMemberLevels(payload);
    await this.writeValue(this.deptKbMemberLevelsKey(kbId), normalized);
    this.deptKbMemberLevelsCache.delete(kbId);
    return normalized;
  }

  /** 部门库 viewer 分值：命中成员表取其分值，未登记按 0（拒绝式默认，仅可见完全公开条目）。 */
  async resolveDeptKbViewerLevel(kbId: string, userId?: string | null): Promise<number> {
    if (!userId) return 0;
    const levels = await this.getDeptKbMemberLevels(kbId);
    const hit = levels.find((item) => item.user_id === userId);
    return hit ? hit.level : 0;
  }

  /** 成员分值配置的候选用户：全部启用中的账号（供库管理员挑选）。 */
  async listDeptKbMemberCandidates() {
    const users = await this.prisma.user.findMany({
      where: { status: { not: 'DISABLED' } },
      select: { id: true, name: true, username: true, department: true },
      orderBy: { name: 'asc' },
    });
    return users.map((u) => ({ id: u.id, name: u.name, username: u.username ?? '', department: u.department ?? '' }));
  }

  private cloneKnowledgeCategories(source: unknown): JsonRecord[] {
    return JSON.parse(JSON.stringify(source)) as JsonRecord[];
  }

  private normalizeKnowledgeCategories(categories: unknown[]): JsonRecord[] {
    const seen = new Set<string>();

    const normalizeNode = (node: unknown, index: number): JsonRecord | null => {
      if (!isRecord(node)) return null;
      const label = cleanText(node.label) || '未命名类目';
      const rawId = cleanText(node.id);
      let id = rawId || `kb-cat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      while (seen.has(id)) {
        id = `${id}-${Math.random().toString(36).slice(2, 5)}`;
      }
      seen.add(id);

      const children = asArray(node.children)
        .map((child, childIndex) => normalizeNode(child, childIndex))
        .filter((child): child is JsonRecord => Boolean(child));

      const normalized: JsonRecord = {
        ...node,
        id,
        label,
        order: Number.isFinite(Number(node.order)) ? Number(node.order) : index + 1,
        children,
      };
      delete normalized.entry_count;
      delete normalized.total_entry_count;
      return normalized;
    };

    return categories
      .map((category, index) => normalizeNode(category, index))
      .filter((category): category is JsonRecord => Boolean(category));
  }

  private async readKnowledgeCategoryRecords(kbId?: string): Promise<JsonRecord[]> {
    const raw = await this.readValue(this.kbCategoriesKey(kbId));
    const source = Array.isArray(raw) && raw.length > 0 ? raw : this.kbDefaultCategories(kbId);
    return this.normalizeKnowledgeCategories(this.cloneKnowledgeCategories(source));
  }

  private async readActiveKnowledgeEntryRecords(kbId?: string): Promise<JsonRecord[]> {
    const raw = await this.readValue(this.kbEntriesKey(kbId));
    const entries: JsonRecord[] = Array.isArray(raw) ? (raw as JsonRecord[]) : [];
    return entries
      .map(ResearchDevelopmentService.normalizeKbEntry)
      .filter((entry) => !entry.archived);
  }

  private stripKnowledgeCategoryComputedFields(categories: JsonRecord[]): JsonRecord[] {
    return categories.map((category) => {
      const next: JsonRecord = { ...category };
      delete next.entry_count;
      delete next.total_entry_count;
      next.children = this.stripKnowledgeCategoryComputedFields(asArray(category.children).filter(isRecord));
      return next;
    });
  }

  private attachKnowledgeCategoryCounts(categories: JsonRecord[], entries: JsonRecord[]): JsonRecord[] {
    const directCounts = new Map<string, number>();
    for (const entry of entries) {
      const categoryId = cleanText(entry.category_id);
      if (!categoryId) continue;
      directCounts.set(categoryId, (directCounts.get(categoryId) ?? 0) + 1);
    }

    const attachCounts = (category: JsonRecord): JsonRecord => {
      const id = cleanText(category.id);
      const children = asArray(category.children).filter(isRecord).map(attachCounts);
      const directCount = directCounts.get(id) ?? 0;
      const childTotal = children.reduce((sum, child) => sum + Number(child.total_entry_count ?? 0), 0);
      return {
        ...category,
        children,
        entry_count: directCount,
        total_entry_count: directCount + childTotal,
      };
    };

    return categories.map(attachCounts);
  }

  private findKnowledgeCategory(
    categories: JsonRecord[],
    id: string,
  ): { category: JsonRecord; siblings: JsonRecord[] } | null {
    for (const category of categories) {
      if (cleanText(category.id) === id) return { category, siblings: categories };
      const children = Array.isArray(category.children) ? (category.children as JsonRecord[]) : [];
      const found = this.findKnowledgeCategory(children, id);
      if (found) return found;
    }
    return null;
  }

  private collectKnowledgeCategoryIds(categories: JsonRecord[]): Set<string> {
    const ids = new Set<string>();
    const walk = (nodes: JsonRecord[]) => {
      for (const node of nodes) {
        const id = cleanText(node.id);
        if (id) ids.add(id);
        walk(asArray(node.children).filter(isRecord));
      }
    };
    walk(categories);
    return ids;
  }

  private collectKnowledgeCategorySubtreeIds(category: JsonRecord): Set<string> {
    const ids = new Set<string>();
    const walk = (node: JsonRecord) => {
      const id = cleanText(node.id);
      if (id) ids.add(id);
      for (const child of asArray(node.children).filter(isRecord)) walk(child);
    };
    walk(category);
    return ids;
  }

  private categoryHasActiveEntries(category: JsonRecord, entries: JsonRecord[]): boolean {
    const ids = this.collectKnowledgeCategorySubtreeIds(category);
    return entries.some((entry) => ids.has(cleanText(entry.category_id)));
  }

  private generateKnowledgeCategoryId(existingIds: Set<string>): string {
    let id = `kb-cat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    while (existingIds.has(id)) {
      id = `kb-cat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    return id;
  }

  private async resolveKnowledgeCategoryId(
    categoryId: unknown,
    options?: { fallbackToOther?: boolean },
    kbId?: string,
  ): Promise<string> {
    const categories = await this.readKnowledgeCategoryRecords(kbId);
    const ids = this.collectKnowledgeCategoryIds(categories);
    const id = cleanText(categoryId);
    if (id && ids.has(id)) return id;
    if (options?.fallbackToOther && ids.has('kb-other')) return 'kb-other';
    throw new BadRequestException('知识库类目不存在');
  }

  async getKnowledgeCategories(kbId?: string) {
    const categories = await this.readKnowledgeCategoryRecords(kbId);
    const entries = await this.readActiveKnowledgeEntryRecords(kbId);
    return this.attachKnowledgeCategoryCounts(categories, entries);
  }

  async saveKnowledgeCategories(categories: unknown[], kbId?: string) {
    const normalized = this.normalizeKnowledgeCategories(categories);
    await this.writeValue(this.kbCategoriesKey(kbId), this.stripKnowledgeCategoryComputedFields(normalized));
    const entries = await this.readActiveKnowledgeEntryRecords(kbId);
    return { ok: true, categories: this.attachKnowledgeCategoryCounts(normalized, entries) };
  }

  async createKnowledgeCategory(payload: { label?: unknown; parent_id?: unknown; icon?: unknown; color?: unknown }, kbId?: string, actor?: AuditActorRef) {
    const label = cleanText(payload.label);
    if (!label) throw new BadRequestException('类目名称不能为空');
    if (label.length > 40) throw new BadRequestException('类目名称不能超过 40 个字符');

    const categories = await this.readKnowledgeCategoryRecords(kbId);
    const parentId = cleanText(payload.parent_id);
    let siblings = categories;

    if (parentId) {
      const parent = this.findKnowledgeCategory(categories, parentId);
      if (!parent) throw new NotFoundException('父级类目不存在');
      const children = Array.isArray(parent.category.children) ? (parent.category.children as JsonRecord[]) : [];
      parent.category.children = children;
      siblings = children;
    }

    if (siblings.some((category) => cleanText(category.label) === label)) {
      throw new BadRequestException('同级类目名称已存在');
    }

    const existingIds = this.collectKnowledgeCategoryIds(categories);
    const category: JsonRecord = {
      id: this.generateKnowledgeCategoryId(existingIds),
      label,
      icon: cleanText(payload.icon) || 'FolderOpen',
      color: cleanText(payload.color) || '#3b82f6',
      order: Math.max(0, ...siblings.map((item) => Number(item.order) || 0)) + 1,
      children: [],
    };

    siblings.push(category);
    await this.writeValue(this.kbCategoriesKey(kbId), this.stripKnowledgeCategoryComputedFields(categories));
    await this.recordKnowledgeAudit('kb.category.created', cleanText(category.id), cleanText(category.label), '新建知识库类目', kbId, actor);
    const entries = await this.readActiveKnowledgeEntryRecords(kbId);
    return { ok: true, category, categories: this.attachKnowledgeCategoryCounts(categories, entries) };
  }

  async updateKnowledgeCategory(
    id: string,
    payload: { label?: unknown; icon?: unknown; color?: unknown },
    kbId?: string,
    actor?: AuditActorRef,
  ) {
    const categoryId = cleanText(id);
    const categories = await this.readKnowledgeCategoryRecords(kbId);
    const found = this.findKnowledgeCategory(categories, categoryId);
    if (!found) throw new NotFoundException('知识库类目不存在');

    const entries = await this.readActiveKnowledgeEntryRecords(kbId);
    if (this.categoryHasActiveEntries(found.category, entries)) {
      throw new BadRequestException('类目下存在文件，无法编辑；请先将文件移动到其他类目');
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'label')) {
      const label = cleanText(payload.label);
      if (!label) throw new BadRequestException('类目名称不能为空');
      if (label.length > 40) throw new BadRequestException('类目名称不能超过 40 个字符');
      if (found.siblings.some((category) => cleanText(category.id) !== categoryId && cleanText(category.label) === label)) {
        throw new BadRequestException('同级类目名称已存在');
      }
      found.category.label = label;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'icon')) {
      found.category.icon = cleanText(payload.icon) || 'FolderOpen';
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'color')) {
      found.category.color = cleanText(payload.color) || '#3b82f6';
    }
    found.category.updated_at = new Date().toISOString();

    await this.writeValue(this.kbCategoriesKey(kbId), this.stripKnowledgeCategoryComputedFields(categories));
    await this.recordKnowledgeAudit('kb.category.edited', categoryId, cleanText(found.category.label), '修改知识库类目', kbId, actor);
    return { ok: true, category: found.category, categories: this.attachKnowledgeCategoryCounts(categories, entries) };
  }

  async deleteKnowledgeCategory(id: string, kbId?: string, actor?: AuditActorRef) {
    const categoryId = cleanText(id);
    if (categoryId === 'kb-other') {
      throw new BadRequestException('默认“其他”类目不能删除');
    }

    const categories = await this.readKnowledgeCategoryRecords(kbId);
    const found = this.findKnowledgeCategory(categories, categoryId);
    if (!found) throw new NotFoundException('知识库类目不存在');

    const entries = await this.readActiveKnowledgeEntryRecords(kbId);
    if (this.categoryHasActiveEntries(found.category, entries)) {
      throw new BadRequestException('类目下存在文件，无法删除；请先将文件移动到其他类目');
    }

    const index = found.siblings.findIndex((category) => cleanText(category.id) === categoryId);
    const removedLabel = cleanText(found.category.label);
    if (index >= 0) found.siblings.splice(index, 1);
    await this.writeValue(this.kbCategoriesKey(kbId), this.stripKnowledgeCategoryComputedFields(categories));
    await this.recordKnowledgeAudit('kb.category.deleted', categoryId, removedLabel, '删除知识库类目', kbId, actor);
    return { ok: true, categories: this.attachKnowledgeCategoryCounts(categories, entries) };
  }

  /** Convert legacy visibility string to numeric 0-100 score (backward compat). */
  private static visibilityToLevel(vis?: unknown): number {
    if (vis === 'restricted') return 50;
    if (vis === 'internal') return 20;
    return 0; // 'public' or unknown → fully public
  }

  /**
   * Clamp a raw permission_level value to 0-100.
   * Legacy values 1-5 (from old Lv system) are preserved as-is (low end of 0-100 scale).
   */
  private static clampLevel(raw?: unknown): number {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
  }

  private static legacyKbLevelToScore(raw?: unknown): number {
    const n = Number(raw);
    if (!Number.isFinite(n)) return 20;
    if (Number.isInteger(n) && n >= 1 && n <= 5) {
      return [0, 25, 50, 75, 100][n - 1] ?? 20;
    }
    return ResearchDevelopmentService.clampLevel(n);
  }

  /** Normalise a single KB entry to always carry a numeric permission_level. */
  private static normalizeKbEntry(e: JsonRecord): JsonRecord {
    const level = typeof e.permission_level === 'number'
      ? ResearchDevelopmentService.clampLevel(e.permission_level)
      : ResearchDevelopmentService.visibilityToLevel(e.visibility);
    return { ...e, permission_level: level };
  }

  /**
   * 计算 viewer 在知识库的「可见权限分值」（0-100），供列表与详情鉴权共用。
   * - 匹配人员用与 getUserKbLevel 一致的规范化方式：cleanUserId(user_id ?? auth_user_id)，
   *   避免严格 === 在空白/类型差异、或人员仅以 auth_user_id 关联时漏配；
   * - 命中后按 kb_level_scale 解析（score=直接分值，legacy=1-5 映射）；
   * - 未命中按最严处理返回 0（读侧「拒绝式默认」，仅放行完全公开 level 0 条目；
   *   与 getUserKbLevel「写/上传」侧默认 20 有意区分）。
   */
  private async resolveViewerKbLevel(viewerUserId?: string | null): Promise<number> {
    if (!viewerUserId) return 0;
    const rawPeople = await this.readArray('rd.people');
    const personRecord = rawPeople
      .filter(isRecord)
      .find((p) => cleanUserId(p.user_id ?? (p as JsonRecord).auth_user_id) === viewerUserId);
    if (!isRecord(personRecord)) return 0;
    return cleanText(personRecord.kb_level_scale) === 'score'
      ? ResearchDevelopmentService.clampLevel(personRecord.kb_level)
      : ResearchDevelopmentService.legacyKbLevelToScore(personRecord.kb_level);
  }

  async getKnowledgeEntries(
    filter?: {
      categoryId?: string;
      keyword?: string;
      source?: string;
      fileType?: string;
      visibility?: string;
      permissionLevel?: number;
    },
    viewer?: { userId?: string; hasFullAccess?: boolean; levelOverride?: number },
    kbId?: string,
  ) {
    const raw = await this.readValue(this.kbEntriesKey(kbId));
    let entries: JsonRecord[] = Array.isArray(raw) ? (raw as JsonRecord[]) : [];
    // Always carry normalised permission_level
    entries = entries.map(ResearchDevelopmentService.normalizeKbEntry);
    entries = entries.filter(e => !e.archived);

    // ── Viewer-level access control ──────────────────────────────────────
    // 「看全部」仅限 KB 管理员（* / rd-kb:manage，由 controller 的 buildKbViewer 判定）；
    // 其余成员一律按本人 kb_level 过滤，确保「个人权限」对所有非 KB 管理员真正生效。
    // levelOverride：部门库按人过滤时由 controller 传入（成员分值表），跳过研发人员池查询。
    if (viewer && !viewer.hasFullAccess) {
      const viewerLevel = typeof viewer.levelOverride === 'number'
        ? viewer.levelOverride
        : await this.resolveViewerKbLevel(viewer.userId);
      entries = entries.filter(e => (e.permission_level as number) <= viewerLevel);
    }

    // ── Filters ───────────────────────────────────────────────────────────
    if (filter?.categoryId) {
      // Support comma-separated list so the frontend can pass parent + all child IDs at once
      const ids = new Set(filter.categoryId.split(',').map((s) => s.trim()).filter(Boolean));
      entries = entries.filter((e) => ids.has(String(e.category_id ?? '')));
    }
    if (filter?.source) entries = entries.filter(e => e.source === filter.source);
    // permissionLevel filter = "show files accessible to a user with this score" (score ≥ file score)
    if (filter?.permissionLevel != null) entries = entries.filter(e => (e.permission_level as number) <= filter.permissionLevel!);
    if (filter?.visibility) entries = entries.filter(e => e.visibility === filter.visibility);
    if (filter?.fileType) {
      // The frontend sends category names ('image','pdf','doc','video','other'), not raw extensions.
      // Map each category to the set of known file extensions it covers.
      const ft = filter.fileType.toLowerCase();
      const EXT_MAP: Record<string, string[]> = {
        image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'],
        pdf: ['pdf'],
        doc: ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'csv'],
        video: ['mp4', 'avi', 'mov', 'webm', 'mkv'],
      };
      if (ft in EXT_MAP) {
        const allowed = new Set(EXT_MAP[ft]);
        entries = entries.filter((e) => allowed.has(String(e.file_type ?? '').toLowerCase()));
      } else if (ft === 'other') {
        const known = new Set(Object.values(EXT_MAP).flat());
        entries = entries.filter((e) => !known.has(String(e.file_type ?? '').toLowerCase()));
      } else {
        // Exact extension match (legacy / future use)
        entries = entries.filter((e) => String(e.file_type ?? '').toLowerCase() === ft);
      }
    }
    if (filter?.keyword) {
      const kw = filter.keyword.toLowerCase();
      entries = entries.filter(e =>
        String(e.title ?? '').toLowerCase().includes(kw) ||
        String(e.description ?? '').toLowerCase().includes(kw) ||
        (Array.isArray(e.tags) && (e.tags as string[]).some(t => t.toLowerCase().includes(kw))) ||
        String(e.source_task_id ?? '').toLowerCase().includes(kw)
      );
    }
    // Sort: newest first — strip data_url from list to avoid returning 50MB+ payloads
    return entries
      .sort((a, b) => {
        const ta = String(a.created_at ?? '');
        const tb = String(b.created_at ?? '');
        return tb > ta ? 1 : tb < ta ? -1 : 0;
      })
      .map(({ data_url, ...rest }) => ({
        ...rest,
        // Expose a lightweight flag so the frontend knows a downloadable file exists
        has_data_file: Boolean(data_url),
        // Same-origin inline-preview proxy URL (bucket forces attachment download on direct OSS URLs)
        ...(typeof rest.oss_url === 'string' && rest.oss_url
          ? { preview_url: this.buildAttachmentPreviewUrl(rest.oss_url) ?? undefined }
          : {}),
      }));
  }

  /** Return a single KB entry including its data_url (used for download). */
  async getKnowledgeEntryById(
    id: string,
    viewer?: { userId?: string; hasFullAccess?: boolean; levelOverride?: number },
    kbId?: string,
  ): Promise<JsonRecord | null> {
    const raw = await this.readValue(this.kbEntriesKey(kbId));
    const entries: JsonRecord[] = Array.isArray(raw) ? (raw as JsonRecord[]) : [];
    const found = entries.find((e) => e.id === id);
    if (!found) return null;
    // 归一化以拿到可靠的 permission_level（部分老条目未显式存分值，靠 visibility 推导）
    const entry = ResearchDevelopmentService.normalizeKbEntry(found);
    // 与列表一致的 kb_level 鉴权：非 KB 管理员不得越权读取高于自身分值的条目，
    // 堵住「详情接口绕过列表过滤」的口子。返回 null → 404，避免泄露条目是否存在。
    if (viewer && !viewer.hasFullAccess) {
      const viewerLevel = typeof viewer.levelOverride === 'number'
        ? viewer.levelOverride
        : await this.resolveViewerKbLevel(viewer.userId);
      if ((entry.permission_level as number) > viewerLevel) return null;
    }
    const previewUrl = typeof entry.oss_url === 'string' && entry.oss_url
      ? this.buildAttachmentPreviewUrl(entry.oss_url)
      : null;
    return previewUrl ? { ...entry, preview_url: previewUrl } : entry;
  }

  async classifyKbFiles(filenames: string[], kbId?: string) {
    const categories = await this.getKnowledgeCategories(kbId) as Array<{
      id: string; label: string; children?: Array<{ id: string; label: string }>
    }>;
    return this.rdAiService.classifyKbFiles({ filenames, categories });
  }

  async cleanupUnregisteredKnowledgeObjects(
    kbId: string | undefined,
    businessType: string,
    files: Array<{ objectKey: string; cleanupExp?: number; cleanupSig?: string }>,
  ) {
    const entriesRaw = await this.readValue(this.kbEntriesKey(kbId));
    const referenced = new Set<string>();
    for (const entry of Array.isArray(entriesRaw) ? entriesRaw : []) {
      if (!isRecord(entry)) continue;
      const key = this.attachmentObjectKey(entry);
      if (key) referenced.add(key);
    }

    let deleted = 0;
    let retained = 0;
    for (const file of (Array.isArray(files) ? files : []).slice(0, 100)) {
      const owned = this.ossService.isKeyUnderBusinessType(file.objectKey, businessType);
      const authorized = this.ossService.verifyCleanupToken(
        file.objectKey,
        Number(file.cleanupExp),
        String(file.cleanupSig ?? ''),
      );
      if (!owned || !authorized || referenced.has(file.objectKey)) {
        retained += 1;
        continue;
      }
      await this.ossService.deleteObject(file.objectKey);
      deleted += 1;
    }
    return { success: true, deleted, retained };
  }

  async createKnowledgeEntry(payload: {
    title: string;
    description?: string;
    category_id: string;
    tags?: string[];
    visibility?: string;
    permission_level?: number;
    source?: string;
    source_task_id?: string;
    /** 任务留痕附件的稳定 id（att-…）：删除/替换附件时按此精确回溯清理条目 */
    source_attachment_id?: string;
    source_task_title?: string;
    file_name?: string;
    file_type?: string;
    file_size?: number;
    data_url?: string;
    oss_url?: string;
    external_url?: string;
    created_by_id?: string;
    created_by_name?: string;
  }, kbId?: string) {
    const raw = await this.readValue(this.kbEntriesKey(kbId));
    const entries: JsonRecord[] = Array.isArray(raw) ? (raw as JsonRecord[]) : [];
    const now = new Date().toISOString();
    const categoryId = await this.resolveKnowledgeCategoryId(payload.category_id, { fallbackToOther: true }, kbId);
    const resolvedLevel = typeof payload.permission_level === 'number'
      ? ResearchDevelopmentService.clampLevel(payload.permission_level)
      : ResearchDevelopmentService.visibilityToLevel(payload.visibility);
    const entry: JsonRecord = {
      id: `kb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title: payload.title,
      description: payload.description ?? '',
      category_id: categoryId,
      tags: payload.tags ?? [],
      permission_level: resolvedLevel,
      visibility: payload.visibility ?? 'internal',
      source: payload.source ?? 'manual',
      source_task_id: payload.source_task_id ?? null,
      source_attachment_id: payload.source_attachment_id ?? null,
      source_task_title: payload.source_task_title ?? null,
      file_name: payload.file_name ?? null,
      file_type: payload.file_type ?? null,
      file_size: payload.file_size ?? null,
      data_url: payload.data_url ?? null,
      oss_url: payload.oss_url ?? null,
      external_url: payload.external_url ?? null,
      view_count: 0,
      download_count: 0,
      created_by_id: payload.created_by_id ?? null,
      created_by_name: payload.created_by_name ?? '系统',
      created_at: now,
      updated_at: now,
      archived: false,
    };
    entries.unshift(entry);
    // Cap at 2000 entries to avoid unbounded growth
    await this.writeValue(this.kbEntriesKey(kbId), entries.slice(0, 2000));
    // RAG 同步（best-effort，不阻塞返回）：研发库与部门/协同库全部入向量索引，部门库带页面码隔离
    void this.syncKbEntryToRag(entry, kbId);
    return entry;
  }

  /**
   * One-shot repair: re-encode garbled Latin-1 filenames back to UTF-8.
   * Safe to run repeatedly — only touches strings that are actually garbled.
   */
  async repairKbFilenameEncoding(): Promise<{ fixed: number; total: number }> {
    const raw = await this.readValue('rd.knowledgeEntries');
    const entries: JsonRecord[] = Array.isArray(raw) ? (raw as JsonRecord[]) : [];
    let fixed = 0;

    const tryFix = (s: unknown): { value: string; changed: boolean } => {
      if (typeof s !== 'string' || !s) return { value: String(s ?? ''), changed: false };
      // ASCII-only strings are never garbled
      if (!/[^\x00-\x7F]/.test(s)) return { value: s, changed: false };
      try {
        const decoded = Buffer.from(s, 'latin1').toString('utf8');
        // If decoding produces replacement chars, original was valid UTF-8 already
        if (decoded.includes('�')) return { value: s, changed: false };
        if (decoded === s) return { value: s, changed: false };
        return { value: decoded, changed: true };
      } catch {
        return { value: s, changed: false };
      }
    };

    const repaired = entries.map(e => {
      const titleFix = tryFix(e.title);
      const fileNameFix = tryFix(e.file_name);
      const descFix = tryFix(e.description);
      if (!titleFix.changed && !fileNameFix.changed && !descFix.changed) return e;
      fixed++;
      return {
        ...e,
        ...(titleFix.changed ? { title: titleFix.value } : {}),
        ...(fileNameFix.changed ? { file_name: fileNameFix.value } : {}),
        ...(descFix.changed ? { description: descFix.value } : {}),
        updated_at: new Date().toISOString(),
      };
    });

    await this.writeValue('rd.knowledgeEntries', repaired);
    return { fixed, total: entries.length };
  }

  async updateKnowledgeEntry(id: string, payload: Partial<{
    title: string; description: string; category_id: string;
    tags: string[]; visibility: string; permission_level: number; archived: boolean;
  }>, kbId?: string, actor?: AuditActorRef, auditAction: 'kb.entry.edited' | 'kb.entry.moved' = 'kb.entry.edited') {
    const raw = await this.readValue(this.kbEntriesKey(kbId));
    const entries: JsonRecord[] = Array.isArray(raw) ? (raw as JsonRecord[]) : [];
    const categoryId = payload.category_id !== undefined
      ? await this.resolveKnowledgeCategoryId(payload.category_id, undefined, kbId)
      : undefined;
    let found = false;
    const updated = entries.map(e => {
      if (e.id !== id) return e;
      found = true;
      const patch: JsonRecord = { ...payload };
      if (categoryId !== undefined) patch.category_id = categoryId;
      // Normalise permission_level if provided; else derive from visibility if changed
      if (typeof patch.permission_level === 'number') {
        patch.permission_level = ResearchDevelopmentService.clampLevel(patch.permission_level);
      } else if (patch.visibility) {
        patch.permission_level = ResearchDevelopmentService.visibilityToLevel(patch.visibility);
      }
      return { ...e, ...patch, updated_at: new Date().toISOString() };
    });
    if (!found) throw new NotFoundException('知识条目不存在');
    await this.writeValue(this.kbEntriesKey(kbId), updated);
    const next = updated.find(e => e.id === id);
    await this.recordKnowledgeAudit(
      auditAction,
      id,
      cleanText(next?.title),
      auditAction === 'kb.entry.moved' ? '移动知识库文件' : '修改知识库文件',
      kbId,
      actor,
      auditAction === 'kb.entry.moved' ? { category_id: cleanText(payload.category_id) } : undefined,
    );
    return next;
  }

  async moveKnowledgeEntry(id: string, categoryId: string, kbId?: string, actor?: AuditActorRef) {
    return this.updateKnowledgeEntry(id, { category_id: categoryId }, kbId, actor, 'kb.entry.moved');
  }

  async deleteKnowledgeEntry(id: string, kbId?: string, actor?: AuditActorRef) {
    const raw = await this.readValue(this.kbEntriesKey(kbId));
    const entries: JsonRecord[] = Array.isArray(raw) ? (raw as JsonRecord[]) : [];
    const removed = entries.find(e => e.id === id);
    const updated = entries.map(e => e.id === id ? { ...e, archived: true, updated_at: new Date().toISOString() } : e);
    await this.writeValue(this.kbEntriesKey(kbId), updated);
    await this.recordKnowledgeAudit('kb.entry.deleted', id, cleanText(removed?.title), '删除知识库文件', kbId, actor);
    // RAG 同步：archived=true 触发 chunk 删除（各库同机制）
    void this.ragService.removeChunksForSource('kb', id).catch((err) => {
      this.logger.warn(`[RAG] removeChunksForSource 失败 (entry=${id}): ${err instanceof Error ? err.message : String(err)}`);
    });
    return { ok: true };
  }

  async incrementKbEntryViewCount(id: string, kbId?: string) {
    const raw = await this.readValue(this.kbEntriesKey(kbId));
    const entries: JsonRecord[] = Array.isArray(raw) ? (raw as JsonRecord[]) : [];
    const updated = entries.map(e => e.id === id ? { ...e, view_count: (Number(e.view_count) || 0) + 1 } : e);
    await this.writeValue(this.kbEntriesKey(kbId), updated);
    return { ok: true };
  }

  /** Auto-ingest attachments from a task progress note into the knowledge base. */
  async ingestProgressNoteAttachments(payload: {
    taskId: string;
    taskTitle?: string;
    categoryPath?: string;
    attachments: Array<{ id: string; name: string; mime: string; size: number; data_url?: string; oss_url?: string }>;
    actorId?: string;
    actorName?: string;
  }) {
    if (!payload.attachments.length) return;
    const categoryId = inferKbCategoryId(payload.categoryPath ?? '');
    const entries = await Promise.all(
      payload.attachments.map(att => {
        const ext = att.name.includes('.') ? att.name.split('.').pop()!.toLowerCase() : '';
        return this.createKnowledgeEntry({
          title: att.name,
          description: `来自任务 ${payload.taskId}${payload.taskTitle ? ` · ${payload.taskTitle}` : ''} 的进度附件`,
          category_id: categoryId,
          tags: [],
          visibility: 'internal',
          source: 'task_attachment',
          source_task_id: payload.taskId,
          source_attachment_id: att.id,
          source_task_title: payload.taskTitle ?? payload.taskId,
          file_name: att.name,
          file_type: ext,
          file_size: att.size,
          oss_url: att.oss_url,
          data_url: att.data_url,
          created_by_id: payload.actorId,
          created_by_name: payload.actorName ?? '系统',
        });
      })
    );
    return entries;
  }

  private async readNormalizedTaskCategories() {
    const raw = await this.readArray('rd.taskCategories');
    const bomNormalized = ensurePocBomTaskCategories(raw);
    const identity = await this.getIdentityContext();
    const normalized = ensureDefaultSubProject(
      this.normalizeCategoriesWithIdentity(
        bomNormalized.filter(isRecord),
        identity.people,
        identity.users,
      ),
    );
    // 读取必须保持纯读。旧实现在 GET 中用旧快照整树写回，会覆盖并发创建/更新的任务。
    // 显式任务或结构变更会在 taskTreeWriteLock 内持久化归一化结果。
    return normalized;
  }

  // ─── 研发数据表（B2：Univer 工作簿快照 · 已去除行级密级）─────────────────────

  /** 空工作簿快照（首次访问 / 存储为空时兜底）。 */
  private static buildEmptyWorkbookSnapshot(): JsonRecord {
    const sheetId = 'sheet-1';
    return {
      id: RD_SHEET_WORKBOOK_ID,
      name: '研发数据表',
      sheetOrder: [sheetId],
      sheets: { [sheetId]: { id: sheetId, name: '数据表1', cellData: {}, rowCount: 60, columnCount: 20, mergeData: [] } },
      styles: {},
      resources: [],
    };
  }

  /**
   * 旧扁平格式（{headers,rows,secrecy_column}[]）→ Univer 快照（仅迁移「值」）：
   * 第 0 行为表头，其后每行一条；密级列保留为普通列（用户可手动删）；
   * 单元格内的图片标记 [图片:..] 剥离为空（旧图不随迁移还原，重新导入原 xlsx 即为高保真版）。
   */
  private static migrateFlatSheetsToSnapshot(arr: unknown[]): JsonRecord {
    const strip = (s: string) => cleanText(s).replace(RD_SHEET_IMAGE_MARK_RE, '').replace(/\s+/g, ' ').trim();
    const sheets: JsonRecord = {};
    const sheetOrder: string[] = [];
    arr.forEach((raw, i) => {
      const rec = isRecord(raw) ? raw : {};
      const headers = asArray(rec.headers).map((h) => cleanText(h));
      const rows = asArray(rec.rows).map((row) => asArray(row).map((c) => strip(cleanText(c))));
      const sheetId = `sheet-${i + 1}`;
      sheetOrder.push(sheetId);
      const cellData: Record<number, Record<number, { v: string }>> = {};
      headers.forEach((h, c) => { if (h) (cellData[0] = cellData[0] || {})[c] = { v: h }; });
      rows.forEach((row, r) => { row.forEach((v, c) => { if (v) (cellData[r + 1] = cellData[r + 1] || {})[c] = { v }; }); });
      sheets[sheetId] = {
        id: sheetId,
        name: cleanText(rec.name) || `数据表${i + 1}`,
        cellData,
        rowCount: Math.max(rows.length + 11, 40),
        columnCount: Math.max(headers.length + 4, 12),
        mergeData: [],
      };
    });
    if (!sheetOrder.length) return ResearchDevelopmentService.buildEmptyWorkbookSnapshot();
    return { id: RD_SHEET_WORKBOOK_ID, name: '研发数据表', sheetOrder, sheets, styles: {}, resources: [] };
  }

  /**
   * 读取研发数据表工作簿快照（page:rd-sheet 只读 / rd-sheet:edit 可编辑，均拿全量；已无行级密级）。
   * 新格式直接返回；旧扁平格式按值迁移成快照（不落库，下次保存才以新格式写回）。
   */
  async getSheetWorkbook(): Promise<{ snapshot: JsonRecord; updated_at: string; updated_by: string | null }> {
    const raw = await this.readValue('rd.sheets');
    if (isRecord(raw) && isRecord((raw as JsonRecord).snapshot)) {
      const rec = raw as JsonRecord;
      return {
        snapshot: rec.snapshot as JsonRecord,
        updated_at: cleanText(rec.updated_at) || new Date().toISOString(),
        updated_by: cleanText(rec.updated_by) || null,
      };
    }
    if (Array.isArray(raw) && raw.length > 0) {
      return { snapshot: ResearchDevelopmentService.migrateFlatSheetsToSnapshot(raw), updated_at: new Date().toISOString(), updated_by: null };
    }
    return { snapshot: ResearchDevelopmentService.buildEmptyWorkbookSnapshot(), updated_at: new Date().toISOString(), updated_by: null };
  }

  /**
   * 保存整簿快照（仅 rd-sheet:edit / 超管，controller 守门）。
   *
   * - 乐观锁：调用方传 baseUpdatedAt（其加载/上次保存时的版本），与当前存储版本不一致且未
   *   显式 force 时抛 409，防止多人编辑时后保存者无声覆盖先保存者。
   * - 历史留档：被覆盖的旧版本自动存入历史（最近 10 版），恢复见 restoreSheetWorkbookVersion。
   */
  async saveSheetWorkbook(
    snapshot: unknown,
    editor?: { id?: string | null; name?: string | null },
    opts?: { baseUpdatedAt?: string | null; force?: boolean },
  ): Promise<{ updated_at: string; updated_by: string | null }> {
    if (!isRecord(snapshot) || !isRecord((snapshot as JsonRecord).sheets)) {
      throw new BadRequestException('工作簿快照格式不正确');
    }
    const prevRaw = await this.readValue('rd.sheets');
    const prev = isRecord(prevRaw) && isRecord((prevRaw as JsonRecord).snapshot) ? (prevRaw as JsonRecord) : null;

    if (prev && opts?.baseUpdatedAt && !opts?.force) {
      const prevAt = cleanText(prev.updated_at);
      if (prevAt && prevAt !== opts.baseUpdatedAt) {
        const who = cleanText(prev.updated_by_name) || cleanText(prev.updated_by) || '他人';
        throw new ConflictException(
          `保存冲突：${who} 已于 ${new Date(prevAt).toLocaleString('zh-CN')} 保存了新版本。`,
        );
      }
    }

    const updated_at = new Date().toISOString();
    const updated_by = cleanText(editor?.id) || null;
    const updated_by_name = cleanText(editor?.name) || null;
    await this.writeValue('rd.sheets', { snapshot, updated_at, updated_by, updated_by_name });

    // 历史留档尽力而为：失败绝不能反过来阻塞保存本身
    if (prev) {
      try {
        await this.pushSheetWorkbookHistory(prev);
      } catch (err) {
        this.logger.warn(`研发数据表历史留档失败（保存本身已成功）: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return { updated_at, updated_by };
  }

  // ─── 研发数据表：历史版本（每次保存自动留档，最近 10 版）──────────────────────

  private static readonly RD_SHEET_HISTORY_KEEP = 10;
  /** 未出仓的大快照（含 base64 图片）不入历史，避免历史表被撑爆；出仓后快照远小于此阈值。 */
  private static readonly RD_SHEET_HISTORY_MAX_BYTES = 20 * 1024 * 1024;

  private sheetHistoryPrefix(): string {
    // 走 resolveRdStoreKey：与主键同一工作区命名空间（默认池 rd.sheets.history.*）
    return `${resolveRdStoreKey('rd.sheets')}.history.`;
  }

  private async pushSheetWorkbookHistory(prev: JsonRecord): Promise<void> {
    const serialized = JSON.stringify(prev);
    if (serialized.length > ResearchDevelopmentService.RD_SHEET_HISTORY_MAX_BYTES) {
      this.logger.warn(`研发数据表历史留档跳过：快照 ${Math.round(serialized.length / 1024 / 1024)}MB 超过上限（请先执行图片出仓）`);
      return;
    }
    const at = cleanText(prev.updated_at) || new Date().toISOString();
    const key = this.sheetHistoryPrefix() + at;
    const value = { ...prev, size_bytes: serialized.length };
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { category: CATEGORY, key, value: value as any, description: 'R&D sheet workbook history' },
      update: { category: CATEGORY, value: value as any },
    });
    // 裁剪：ISO 时间戳按字典序即时间序，倒序保留最近 N 版
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { startsWith: this.sheetHistoryPrefix() } },
      select: { key: true },
      orderBy: { key: 'desc' },
    });
    const excess = rows.slice(ResearchDevelopmentService.RD_SHEET_HISTORY_KEEP).map((r) => r.key);
    if (excess.length > 0) {
      await this.prisma.systemSetting.deleteMany({ where: { key: { in: excess } } });
    }
  }

  async listSheetWorkbookVersions(): Promise<
    Array<{ id: string; updated_at: string; updated_by: string | null; updated_by_name: string | null; size_bytes: number }>
  > {
    const prefix = this.sheetHistoryPrefix();
    // 原生 SQL 只取标量元数据：避免为了几个字段把最多 10 版完整快照（可达数十 MB）拉进内存。
    // prefix 无 LIKE 通配符（无下划线/百分号），按字面前缀匹配。
    const rows = await this.prisma.$queryRaw<
      Array<{ key: string; updated_at: string | null; updated_by: string | null; updated_by_name: string | null; size_bytes: bigint | number | null }>
    >`
      SELECT key,
             value->>'updated_at'      AS updated_at,
             value->>'updated_by'      AS updated_by,
             value->>'updated_by_name' AS updated_by_name,
             (value->>'size_bytes')::bigint AS size_bytes
      FROM "SystemSetting"
      WHERE key LIKE ${prefix + '%'}
      ORDER BY key DESC
      LIMIT ${ResearchDevelopmentService.RD_SHEET_HISTORY_KEEP}
    `;
    return rows.map((row) => {
      const id = row.key.slice(prefix.length);
      return {
        id,
        updated_at: cleanText(row.updated_at) || id,
        updated_by: cleanText(row.updated_by) || null,
        updated_by_name: cleanText(row.updated_by_name) || null,
        size_bytes: row.size_bytes == null ? 0 : Number(row.size_bytes),
      };
    });
  }

  /** 恢复到指定历史版本：当前版本先入历史（可再恢复回来），随后历史快照成为当前版本。 */
  async restoreSheetWorkbookVersion(
    id: string,
    editor?: { id?: string | null; name?: string | null },
  ): Promise<{ updated_at: string; updated_by: string | null }> {
    const cleanId = cleanText(id);
    // 只接受 ISO 时间戳形态的版本 id，防止拼出任意存储键
    if (!/^\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(cleanId)) {
      throw new BadRequestException('版本标识不正确');
    }
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: this.sheetHistoryPrefix() + cleanId },
      select: { value: true },
    });
    const rec = row && isRecord(row.value) ? (row.value as JsonRecord) : null;
    if (!rec || !isRecord(rec.snapshot)) {
      throw new NotFoundException('历史版本不存在或已被清理');
    }
    return this.saveSheetWorkbook(rec.snapshot, editor, { force: true });
  }

  // ─── 研发数据表：图片资产出仓（base64 → OSS，快照瘦身核心）──────────────────────

  private static readonly RD_SHEET_ASSET_BUSINESS = 'rd-sheet-assets';
  /** 资产内容不可变、快照长期引用 → 能力 URL 签 10 年（signPreviewToken 按天对齐保持稳定）。 */
  private static readonly RD_SHEET_ASSET_EXPIRES_SECONDS = 10 * 365 * 24 * 3600;

  /** 数据表资产的同源能力 URL（HMAC 防伪，<img> 可直接加载，无需 Authorization 头）。 */
  buildSheetAssetUrl(objectKey: string): string {
    const cdnUrl = this.ossService.getCdnReadUrl(objectKey, undefined, 'inline');
    if (cdnUrl) return cdnUrl;
    const { exp, sig } = this.ossService.signPreviewToken(
      objectKey,
      ResearchDevelopmentService.RD_SHEET_ASSET_EXPIRES_SECONDS,
    );
    return `/api/research-development/sheet-workbook/assets?key=${encodeURIComponent(objectKey)}&exp=${exp}&sig=${sig}`;
  }

  /** 校验资产 key 落在数据表资产前缀下（防止能力 URL 被用于读取桶内其他对象）。 */
  isSheetAssetKey(objectKey: string): boolean {
    return this.ossService.isKeyUnderBusinessType(objectKey, ResearchDevelopmentService.RD_SHEET_ASSET_BUSINESS);
  }

  /** 资产 MIME 白名单：排除 SVG 等可执行内容——资产 GET 是同源公开端点，SVG 内嵌脚本会构成存储型 XSS。 */
  private static readonly RD_SHEET_ASSET_MIMES = new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/bmp',
  ]);

  /** 上传单张数据表图片资产。OSS 未配置返回 { url: null, reason: 'oss_disabled' }（前端据此停止后续上传）。 */
  async uploadSheetAsset(
    buffer: Buffer,
    originalname: string,
    mimetype?: string,
  ): Promise<{ url: string | null; reason?: string }> {
    if (!ResearchDevelopmentService.RD_SHEET_ASSET_MIMES.has((mimetype ?? '').toLowerCase())) {
      throw new BadRequestException('仅支持 png / jpg / gif / webp / bmp 图片资产');
    }
    if (!this.ossService.isEnabled) return { url: null, reason: 'oss_disabled' };
    const objectKey = await this.ossService.uploadBuffer(
      buffer,
      ResearchDevelopmentService.RD_SHEET_ASSET_BUSINESS,
      originalname,
      mimetype,
    );
    if (!objectKey) return { url: null, reason: 'upload_failed' };
    return { url: this.buildSheetAssetUrl(objectKey) };
  }

  /** 深度收集快照对象树里的 base64 图源持有者（source + imageSourceType 并存的对象）。 */
  private static collectSheetImageHolders(
    node: unknown,
    out: Array<JsonRecord & { source: string; imageSourceType: string }>,
  ): void {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) ResearchDevelopmentService.collectSheetImageHolders(item, out);
      return;
    }
    const rec = node as JsonRecord;
    // 长度阈值/排除 SVG 与前端 rdSheetAssets 一致：微型图标出仓得不偿失；SVG 被资产白名单拒收
    if (
      typeof rec.source === 'string' &&
      rec.source.startsWith('data:image/') &&
      !rec.source.startsWith('data:image/svg') &&
      rec.source.length >= 4096 &&
      typeof rec.imageSourceType === 'string'
    ) {
      out.push(rec as JsonRecord & { source: string; imageSourceType: string });
      return;
    }
    for (const value of Object.values(rec)) ResearchDevelopmentService.collectSheetImageHolders(value, out);
  }

  /**
   * 存量快照图片出仓（管理员一次性操作）：把当前已存储快照里的 base64 图片上传 OSS、
   * 替换为资产 URL 后重新落库。上线后调用一次，旧数据立即瘦身，不必等编辑者重新保存。
   * 单张失败保留 base64（不影响功能），可重复调用直至 failed=0。
   */
  async extractSheetWorkbookAssets(
    editor?: { id?: string | null; name?: string | null },
  ): Promise<{ total: number; converted: number; failed: number; size_before: number; size_after: number }> {
    if (!this.ossService.isEnabled) {
      throw new BadRequestException('OSS 未配置，无法执行图片出仓');
    }
    const current = await this.getSheetWorkbook();
    const snapshot = current.snapshot;
    const sizeBefore = JSON.stringify(snapshot).length;

    const holders: Array<JsonRecord & { source: string; imageSourceType: string }> = [];
    // resources 是 JSON 字符串形态：先解析再收集，替换后回写
    const resources = Array.isArray(snapshot.resources) ? (snapshot.resources as JsonRecord[]) : [];
    const parsedResources: Array<{ holder: JsonRecord; parsed: unknown }> = [];
    for (const res of resources) {
      if (typeof res?.data === 'string' && res.data.includes('data:image/')) {
        try {
          const parsed = JSON.parse(res.data) as unknown;
          ResearchDevelopmentService.collectSheetImageHolders(parsed, holders);
          parsedResources.push({ holder: res, parsed });
        } catch {
          /* 解析失败原样保留 */
        }
      }
    }
    for (const [key, value] of Object.entries(snapshot)) {
      if (key === 'resources') continue;
      ResearchDevelopmentService.collectSheetImageHolders(value, holders);
    }

    if (holders.length === 0) {
      return { total: 0, converted: 0, failed: 0, size_before: sizeBefore, size_after: sizeBefore };
    }

    // 同图去重（内容 sha256）：复制粘贴多处的同一张图只传一份
    const urlBySource = new Map<string, string | null>();
    for (const holder of holders) {
      if (urlBySource.has(holder.source)) continue;
      const commaAt = holder.source.indexOf(',');
      const mime = holder.source.slice(5, holder.source.indexOf(';'));
      const ext = mime.includes('jpeg') ? 'jpg' : mime.includes('gif') ? 'gif' : mime.includes('webp') ? 'webp' : 'png';
      try {
        const buffer = Buffer.from(holder.source.slice(commaAt + 1), 'base64');
        const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
        const { url } = await this.uploadSheetAsset(buffer, `${hash}.${ext}`, mime);
        urlBySource.set(holder.source, url);
      } catch {
        urlBySource.set(holder.source, null);
      }
    }

    let converted = 0;
    let failed = 0;
    for (const url of urlBySource.values()) {
      if (url) converted += 1;
      else failed += 1;
    }
    for (const holder of holders) {
      const url = urlBySource.get(holder.source);
      if (url) {
        holder.source = url;
        holder.imageSourceType = 'URL';
      }
    }
    for (const { holder, parsed } of parsedResources) {
      try {
        holder.data = JSON.stringify(parsed);
      } catch {
        /* 序列化失败原样保留 */
      }
    }

    const sizeAfter = JSON.stringify(snapshot).length;
    if (converted > 0) {
      await this.saveSheetWorkbook(snapshot, editor, { force: true });
    }
    return { total: urlBySource.size, converted, failed, size_before: sizeBefore, size_after: sizeAfter };
  }

  private async readArray(key: RdStoreKey) {
    return asArray(await this.readValue(key));
  }

  private cloneCachedValue<T>(value: T): T {
    if (value === null || value === undefined) return value;
    return JSON.parse(JSON.stringify(value)) as T;
  }

  private getStoreReadCache() {
    this.rdStoreReadCache ??= new Map();
    return this.rdStoreReadCache;
  }

  private getStoreCacheGenerations() {
    this.rdStoreCacheGenerations ??= new Map();
    return this.rdStoreCacheGenerations;
  }

  private storeCacheGeneration(storeKey: string): number {
    return this.getStoreCacheGenerations().get(storeKey) ?? 0;
  }

  private bumpStoreCacheGeneration(storeKey: string): void {
    const generations = this.getStoreCacheGenerations();
    generations.set(storeKey, (generations.get(storeKey) ?? 0) + 1);
  }

  private getTaskResourceCache() {
    this.rdTaskResourceCache ??= new Map();
    return this.rdTaskResourceCache;
  }

  private taskResourceCacheKey(
    resource: string,
    taskIds: string[],
    viewer?: { userId?: string; hasFullAccess?: boolean; canReadAll?: boolean; userName?: string },
  ) {
    const scope = viewer?.hasFullAccess || viewer?.canReadAll
      ? 'all'
      : `user:${cleanText(viewer?.userId)}:${personNameLookupKey(viewer?.userName)}`;
    return `${currentRdWorkspace()}|g:${this.rdTaskResourceCacheGeneration}|${resource}|${scope}|${taskIds.slice().sort().join(',')}`;
  }

  private readTaskResourceCache<T>(key: string): T | undefined {
    const cache = this.getTaskResourceCache();
    const cached = cache.get(key);
    if (!cached) return undefined;
    if (cached.freshUntil <= Date.now()) {
      cache.delete(key);
      return undefined;
    }
    return this.cloneCachedValue(cached.value as T);
  }

  private writeTaskResourceCache<T>(key: string, value: T): T {
    const cache = this.getTaskResourceCache();
    if (cache.size >= 1_000) cache.clear();
    cache.set(key, {
      value: this.cloneCachedValue(value),
      freshUntil: Date.now() + ResearchDevelopmentService.RD_TASK_RESOURCE_CACHE_TTL_MS,
    });
    return value;
  }

  private invalidateCachedStoreValues(keys: RdStoreKey[]) {
    const cache = this.getStoreReadCache();
    for (const key of keys) {
      const storeKey = resolveRdStoreKey(key);
      this.bumpStoreCacheGeneration(storeKey);
      cache.delete(storeKey);
    }
    this.rdTaskResourceCacheGeneration += 1;
    this.getTaskResourceCache().clear();
  }

  // 存储咽喉点：所有 rd.* 键经 resolveRdStoreKey 按当前工作区改写（默认研发池原样，
  // us-collab 协同池改写为 rdws.us-collab.*），实现任务/人员/审批流/AI 策略/留痕的池级隔离。
  private async readValue(key: RdStoreKey) {
    const storeKey = resolveRdStoreKey(key);
    const cache = this.getStoreReadCache();
    const cached = cache.get(storeKey);
    if (cached && cached.freshUntil > Date.now()) {
      return this.cloneCachedValue(cached.value);
    }
    if (cached) cache.delete(storeKey);
    const generation = this.storeCacheGeneration(storeKey);
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: storeKey },
      select: { value: true },
    });
    const value = setting?.value ?? null;
    // 查库期间若发生了写入/事务失效，这份旧快照只能返给本次读取，不得回填覆盖新缓存。
    if (generation === this.storeCacheGeneration(storeKey)) {
      if (cache.size >= 200) cache.clear();
      cache.set(storeKey, {
        value: this.cloneCachedValue(value),
        freshUntil: Date.now() + ResearchDevelopmentService.RD_STORE_READ_CACHE_TTL_MS,
      });
    }
    return this.cloneCachedValue(value);
  }

  /** 构造单个 store 的 upsert 操作（不执行），供 writeValue 与 $transaction 批量原子写复用。 */
  private buildSettingUpsert(key: RdStoreKey, value: unknown) {
    const storeKey = resolveRdStoreKey(key);
    return this.prisma.systemSetting.upsert({
      where: { key: storeKey },
      create: {
        category: CATEGORY,
        key: storeKey,
        value: value as any,
        description: `R&D module data store: ${storeKey}`,
      },
      update: {
        category: CATEGORY,
        value: value as any,
      },
    });
  }

  private async writeValue(key: RdStoreKey, value: unknown) {
    const setting = await this.buildSettingUpsert(key, value);
    const storeKey = resolveRdStoreKey(key);
    this.bumpStoreCacheGeneration(storeKey);
    this.getStoreReadCache().set(storeKey, {
      value: this.cloneCachedValue(setting.value),
      freshUntil: Date.now() + ResearchDevelopmentService.RD_STORE_READ_CACHE_TTL_MS,
    });
    this.rdTaskResourceCacheGeneration += 1;
    this.getTaskResourceCache().clear();
    return this.cloneCachedValue(setting.value);
  }

  private normalizeAiSettings(value: unknown): NormalizedAiSettings {
    const payload = asRecord(value, {});
    const defaults = DEFAULT_AI_SETTINGS;
    const filePolicy = asRecord(payload.file_policy, {});
    const disclosure = asRecord(payload.disclosure, {});
    const defaultPolicy = defaults.file_policy;

    return {
      ...defaults,
      ...payload,
      scenes: this.normalizeAiScenes(payload.scenes),
      file_policy: {
        ...defaultPolicy,
        ...filePolicy,
        rules: this.normalizeFileRules(filePolicy.rules),
      },
      disclosure: {
        ...defaults.disclosure,
        ...disclosure,
      },
    };
  }

  private normalizeAiScenes(value: unknown) {
    const defaultsById = new Map(DEFAULT_AI_SETTINGS.scenes.map((scene) => [scene.id, scene]));
    const incoming = asArray(value).filter(isRecord);
    const incomingById = new Map(
      incoming
        .map((scene) => [String(scene.id ?? '').trim(), scene] as const)
        .filter(([id]) => id),
    );

    const mergedDefaults = DEFAULT_AI_SETTINGS.scenes.map((scene) => ({
      ...scene,
      ...incomingById.get(scene.id),
      id: scene.id,
    }));

    const customScenes = incoming
      .filter((scene) => {
        const id = String(scene.id ?? '').trim();
        return id && !defaultsById.has(id);
      })
      .map((scene) => ({
        id: String(scene.id).trim(),
        name: String(scene.name ?? scene.id).trim(),
        description: String(scene.description ?? '').trim(),
        enabled: scene.enabled !== false,
        model_id: String(scene.model_id ?? '').trim(),
        fallback_model_id: String(scene.fallback_model_id ?? '').trim(),
        prompt_version: String(scene.prompt_version ?? '').trim(),
        confidence_threshold: this.numberInRange(scene.confidence_threshold, 0, 1, 0.8),
        require_human_review: scene.require_human_review !== false,
        show_to_user: scene.show_to_user !== false,
      }));

    return [...mergedDefaults, ...customScenes];
  }

  private normalizeFileRules(value: unknown) {
    const defaultsById = new Map(DEFAULT_AI_SETTINGS.file_policy.rules.map((rule) => [rule.id, rule]));
    const incoming = asArray(value).filter(isRecord);
    const incomingById = new Map(
      incoming
        .map((rule) => [String(rule.id ?? '').trim(), rule] as const)
        .filter(([id]) => id),
    );

    return DEFAULT_AI_SETTINGS.file_policy.rules.map((rule) => ({
      ...rule,
      ...incomingById.get(rule.id),
      id: rule.id,
      extensions: this.stringArray(incomingById.get(rule.id)?.extensions, rule.extensions),
    })).concat(
      incoming
        .filter((rule) => {
          const id = String(rule.id ?? '').trim();
          return id && !defaultsById.has(id);
        })
        .map((rule) => ({
          id: String(rule.id).trim(),
          label: String(rule.label ?? rule.id).trim(),
          extensions: this.stringArray(rule.extensions, []),
          strategy: String(rule.strategy ?? 'text_extract').trim(),
          ai_after_parse: rule.ai_after_parse !== false,
          ocr_fallback: Boolean(rule.ocr_fallback),
          direct_ai: Boolean(rule.direct_ai),
        })),
    );
  }

  private async listAiModelRefs() {
    const configs = await this.prisma.integrationConfig.findMany({
      where: { kind: 'openai' },
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        provider: true,
        model: true,
        isActive: true,
        metadata: true,
      },
    });

    return configs
      .map((config) => {
        const metadata = asRecord(config.metadata, {});
        const usageKind = typeof metadata.usage_kind === 'string' ? metadata.usage_kind : 'auto';
        return {
          id: config.id,
          name: config.name,
          provider: config.provider ?? 'OpenAI',
          model: config.model ?? '',
          enabled: config.isActive,
          is_default_enabled: metadata.is_default_enabled === true,
          usage_kind: usageKind,
        };
      })
      // 图片生成模型不适用于研发 AI 场景（任务提取/进度评估等均为文本任务）
      .filter((item) => {
        if (item.usage_kind === 'image') return false;
        if (item.usage_kind !== 'auto') return true;
        const n = (item.model ?? '').toLowerCase();
        return !(n.includes('gpt-image') || n.includes('image-to-image') || n === 'dall-e-2' || n.startsWith('dall-e-'));
      });
  }

  private buildFileIngestionPlan(file: JsonRecord, settings: NormalizedAiSettings) {
    const filename = String(file.name ?? file.filename ?? '').trim();
    const mimeType = String(file.mime_type ?? file.mimetype ?? '').trim();
    const extension = this.fileExtension(filename);
    const rule = settings.file_policy.rules.find((item) =>
      this.stringArray(item.extensions, []).includes(extension),
    ) ?? {
      id: 'unknown',
      label: '未知文件',
      strategy: 'text_extract_then_ocr',
      extensions: [],
      ai_after_parse: true,
      ocr_fallback: true,
      direct_ai: false,
    };
    const hasTextLayer = Boolean(file.has_text_layer);
    const textLength = typeof file.text_length === 'number' ? file.text_length : 0;
    const isArchive = rule.strategy === 'archive_extract_then_parse';
    const needsOcr =
      rule.strategy === 'ocr_first' ||
      (rule.strategy === 'text_extract_then_ocr' && (!hasTextLayer || textLength < 40));
    const sceneId = needsOcr ? 'ocr_cleanup' : 'file_task_extract';
    const scene = settings.scenes.find((item) => item.id === sceneId) ?? settings.scenes[0];

    return {
      name: filename,
      mime_type: mimeType,
      extension,
      rule_id: rule.id,
      rule_label: rule.label,
      strategy: rule.strategy,
      steps: [
        'file_type_detect',
        isArchive ? 'archive_unpack' : null,
        needsOcr ? 'ocr_extract' : rule.strategy,
        rule.ai_after_parse ? 'ai_structure' : null,
        settings.file_policy.require_confirmation_before_write ? 'human_confirm' : null,
        'write_with_audit',
      ].filter(Boolean),
      requires_ocr: needsOcr,
      requires_ai: Boolean(rule.ai_after_parse),
      direct_ai: Boolean(rule.direct_ai),
      requires_human_review:
        Boolean(scene?.require_human_review) ||
        settings.file_policy.low_confidence_action === 'manual_review',
      ocr_provider: needsOcr ? settings.file_policy.ocr_provider : null,
      ocr_service_key: needsOcr ? settings.file_policy.ocr_service_key : null,
      ai_scene_id: scene?.id ?? 'file_task_extract',
      model_id: scene?.model_id ?? '',
      fallback_model_id: scene?.fallback_model_id ?? '',
      prompt_version: scene?.prompt_version ?? '',
      confidence_threshold: scene?.confidence_threshold ?? 0.8,
    };
  }

  private numberInRange(value: unknown, min: number, max: number, fallback: number) {
    const numeric = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
  }

  private stringArray(value: unknown, fallback: string[]) {
    const items = asArray(value)
      .map((item) => String(item).trim())
      .filter(Boolean);
    return items.length ? items : fallback;
  }

  private fileExtension(filename: string) {
    const index = filename.lastIndexOf('.');
    return index >= 0 ? filename.slice(index + 1).trim().toLowerCase() : '';
  }
}
