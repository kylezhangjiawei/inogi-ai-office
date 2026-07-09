import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { OcrService } from '../ocr/ocr.service';
import { OssService } from '../oss/oss.service';
import { RagService } from '../rag/rag.service';
import { DEPT_KB_DEFAULT_CATEGORIES } from './dept-knowledge.constants';
import { RdAiService } from './rd-ai.service';
import { WORKSPACE_PAGE_CODES, currentRdWorkspace, resolveRdStoreKey } from './rd-workspace.context';

type JsonRecord = Record<string, unknown>;
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
  | 'rd.dailyReports'
  | 'rd.monthlyReports'
  | 'rd.performanceReports'
  | 'rd.messages'
  | 'rd.proposalDrafts'
  | 'rd.products'
  | 'rd.productTaskCategories'
  | 'rd.knowledgeCategories'
  | 'rd.knowledgeEntries'
  | 'rd.taskCompletionScores'
  | 'rd.sheets'
  // 部门知识库：复用知识库 CRUD，按 kbId 切换存储键（缺省 kbId = 研发库走上面的 rd.* 键）
  | `deptkb.${string}.knowledgeCategories`
  | `deptkb.${string}.knowledgeEntries`
  // 部门库成员分值表（仅分值过滤启用的库使用，见 LEVEL_FILTERED_DEPT_KB_IDS）
  | `deptkb.${string}.memberLevels`;

const CATEGORY = 'research-development';
const MAX_AUDIT_LOGS = 1000;
const DEFAULT_BOM_TASK_TYPE = '研发任务';
// 主产品（便携式制氧机）：其任务分类树存于 rd.taskCategories；其余产品存于 rd.productTaskCategories[productId]。
// 与前端 MAIN_PRODUCT_ID 保持一致，是跨产品移动任务时判断「写哪个 store」的唯一依据。
const RD_MAIN_PRODUCT_ID = 'prod-portable-o2';
const PROGRESS_NOTE_MAX_FILES = 10;
const PROGRESS_NOTE_MAX_FILE_BYTES = 25 * 1024 * 1024;
const PROGRESS_NOTE_MAX_TOTAL_BYTES = 50 * 1024 * 1024;

// ─── 研发数据表（B2：Univer 工作簿快照 · 已去除行级密级）─────────────────────
// rd.sheets 存「单个 Univer 工作簿快照」：{ snapshot, updated_at, updated_by }。
// 图片以 base64 内嵌在快照（SHEET_DRAWING_PLUGIN 资源）里，无需 OSS；不再做行级密级裁剪，
// 拥有 page:rd-sheet 即可只读查看，拥有 rd-sheet:edit 方可编辑保存。
// 旧格式（{headers,rows,secrecy_column}[] 扁平数组）在读取时按「值」无损迁移成快照。
const RD_SHEET_WORKBOOK_ID = 'rd-sheet-workbook';
const RD_SHEET_IMAGE_MARK_RE = /\[图片:[^\[\]\s]+\]/g;

// ─── 审核类型「单一事实源」───────────────────────────────────────────────
// 四种审核类型的标签、通过后目标状态、审计动作集中在此定义，前后端各处只引用、
// 不再各写各的，避免不同类型的文案/流程互相污染（立项被记成成果、成果被当协作等）。
type ReviewType = 'proposal' | 'result' | 'collaboration' | 'due_date' | 'abandon' | 'merge';
const REVIEW_TYPES: ReviewType[] = ['proposal', 'result', 'collaboration', 'due_date', 'abandon', 'merge'];
/** 中文标签，用于通知标题、留痕、类型 badge 等所有展示处。 */
const REVIEW_TYPE_LABEL: Record<ReviewType, string> = {
  proposal: '立项',
  result: '成果',
  collaboration: '协作变更',
  due_date: '截止日期变更',
  abandon: '放弃任务',
  merge: '任务合并',
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

function cloneCategoryShell(category: JsonRecord): JsonRecord {
  return {
    ...category,
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

function findBomTarget(task: JsonRecord, sourceCategory: JsonRecord, sourceChild: JsonRecord, categories: JsonRecord[]) {
  const segments = splitCategoryPath(task.category_path);
  const sourceCategoryLabel = String(sourceCategory.label ?? '');
  const sourceChildLabel = String(sourceChild.label ?? '');
  const systemByKey = new Map(RD_POC_BOM_CATEGORIES.map((system) => [normalizeBomKey(system.label), system]));
  const candidateSystemKeys = [
    normalizeBomKey(segments[0]),
    normalizeBomKey(sourceCategoryLabel),
  ].filter(Boolean);
  const system = candidateSystemKeys.map((key) => systemByKey.get(key)).find(Boolean);
  if (!system) return null;

  const partByKey = new Map(
    system.parts.map((part, index) => [normalizeBomKey(part), { label: part, id: bomChildId(system.id, index) }] as const),
  );
  const candidatePartKeys = [
    normalizeBomKey(segments[1]),
    normalizeBomKey(sourceChildLabel),
    ...segments.map(normalizeBomKey),
  ].filter(Boolean);
  const knownPart = candidatePartKeys.map((key) => partByKey.get(key)).find(Boolean);
  const partLabel = knownPart?.label ?? segments[1] ?? sourceChildLabel ?? '待分类';
  const category = findCategoryByLabel(categories, system.label);
  if (!category) return null;
  const child = ensureChild(category, partLabel, knownPart?.id);
  return { category, child, systemLabel: system.label, partLabel };
}

function ensurePocBomTaskCategories(rawCategories: unknown[]): JsonRecord[] {
  const rawRecords = asArray(rawCategories).filter(isRecord);
  const normalized: JsonRecord[] = RD_POC_BOM_CATEGORIES.map((system) => {
    const existing = rawRecords.find((category) => {
      return category.id === system.id || normalizeBomKey(category.label) === normalizeBomKey(system.label);
    });
    const existingChildren = asArray(existing?.children).filter(isRecord);
    return {
      ...(existing ?? {}),
      id: system.id,
      label: (existing && typeof existing.label === 'string' && existing.label.trim()) ? existing.label : system.label,
      children: system.parts.map((part, index) => {
        const childId = bomChildId(system.id, index);
        const existingChild = existingChildren.find((c) => c.id === childId) ?? findChildByLabel(existingChildren, part);
        return {
          ...(existingChild ?? {}),
          id: childId,
          label: (existingChild && typeof existingChild.label === 'string' && existingChild.label.trim()) ? existingChild.label : part,
          tasks: [],
        };
      }),
    };
  });

  const customCategories = new Map<string, JsonRecord>();
  for (const category of rawRecords) {
    const isBomCategory = RD_POC_BOM_CATEGORIES.some((system) => {
      return category.id === system.id || normalizeBomKey(category.label) === normalizeBomKey(system.label);
    });
    if (isBomCategory) continue;
    const shell = cloneCategoryShell(category);
    customCategories.set(String(shell.id), shell);
    normalized.push(shell);
  }

  for (const sourceCategory of rawRecords) {
    let sourceShell =
      customCategories.get(String(sourceCategory.id ?? '')) ??
      normalized.find((category) => {
        return category.id === sourceCategory.id || normalizeBomKey(category.label) === normalizeBomKey(sourceCategory.label);
      });
    for (const { child: sourceChild, task } of collectCategoryTasks(sourceCategory)) {
      const bomTarget = findBomTarget(task, sourceCategory, sourceChild, normalized);
      if (bomTarget) {
        const tasks = asArray(bomTarget.child.tasks);
        bomTarget.child.tasks = [
          normalizeTaskShape(task, bomTarget.systemLabel, bomTarget.partLabel),
          ...tasks,
        ];
        continue;
      }

      if (!sourceShell) {
        sourceShell = cloneCategoryShell(sourceCategory);
        customCategories.set(String(sourceShell.id), sourceShell);
        normalized.push(sourceShell);
      }
      const targetChild = ensureChild(sourceShell, String(sourceChild.label ?? '未命名子项'), String(sourceChild.id ?? ''));
      targetChild.tasks = [
        normalizeTaskShape(task, String(sourceShell.label ?? '未命名分类'), String(targetChild.label ?? '未命名子项')),
        ...asArray(targetChild.tasks),
      ];
    }
  }

  return normalized;
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
  private readonly logger = new Logger(ResearchDevelopmentService.name);

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
  async backfillAllKbToRag(): Promise<{ total: number; succeeded: number; failed: number; failedIds: string[] }> {
    const raw = await this.readValue('rd.knowledgeEntries');
    const entries: JsonRecord[] = Array.isArray(raw) ? (raw as JsonRecord[]) : [];
    const active = entries.filter((e) => !e.archived);
    let succeeded = 0;
    let failed = 0;
    const failedIds: string[] = [];
    for (const entry of active) {
      try {
        await this.syncKbEntryToRag(entry);
        succeeded += 1;
      } catch (err) {
        failed += 1;
        failedIds.push(String(entry.id ?? ''));
        this.logger.warn(
          `[RAG backfill] 失败 entry=${String(entry.id)}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { total: active.length, succeeded, failed, failedIds };
  }

  private async syncKbEntryToRag(entry: JsonRecord): Promise<void> {
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

      await this.ragService.syncDocument({
        sourceType: 'kb',
        sourceId: id,
        title,
        text,
        metadata: {
          title,
          permission_level: permissionLevel,
          category_id: String(entry.category_id ?? '') || undefined,
          author_id: String(entry.created_by_id ?? '') || undefined,
          author_name: String(entry.created_by_name ?? '') || undefined,
          url: `/rd-knowledge-base?entry=${encodeURIComponent(id)}`,
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
        department: cleanText(person.department) || user?.department || '',
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

  async snapshot() {
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
      this.getAuditLogs(),
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

  async getTaskCategories() {
    const [categories, noteMap, scoresRaw] = await Promise.all([
      this.readNormalizedTaskCategories(),
      this.getProgressNoteMap(),
      this.readValue('rd.taskCompletionScores'),
    ]);
    const scoreMap: JsonRecord = isRecord(scoresRaw) ? scoresRaw : {};
    return this.applyProgressAttachmentCounts(categories, noteMap, scoreMap);
  }

  /**
   * 主库 + 所有产品库合并后的分类树（前端格式，含附件数 / 完成评分）。
   * 与个人工作台 getWorkspace 同源（均走 readMergedTaskCategories），用于研发驾驶舱「概览」
   * 的人员任务跨产品聚合——「任务是任务，产品是产品」：一个人的任务是其在所有产品库任务的并集，
   * 不被「当前产品库」切分，故概览头像负载与个人工作台口径一致。
   */
  async getMergedTaskCategories() {
    const [categories, noteMap, scoresRaw] = await Promise.all([
      this.readMergedTaskCategories(),
      this.getProgressNoteMap(),
      this.readValue('rd.taskCompletionScores'),
    ]);
    const scoreMap: JsonRecord = isRecord(scoresRaw) ? scoresRaw : {};
    return this.applyProgressAttachmentCounts(categories, noteMap, scoreMap);
  }

  async saveTaskCategories(payload: unknown[]) {
    const normalized = ensurePocBomTaskCategories(payload);
    // 整树 PUT 与锁内单任务读改写互斥，避免旧快照整体覆盖刚落库的任务更新（仅 controller 调用，无锁内重入）
    const saved = await this.withTaskTreeLock(() => this.writeValue('rd.taskCategories', normalized));
    await this.recomputeDirectorDashboard();
    return saved;
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
    const store = await this.readProductCategoryStore();
    if (Array.isArray(store[productId]) && (store[productId] as unknown[]).length > 0) {
      return ensurePocBomTaskCategories(store[productId] as unknown[]);
    }
    const seed = ensurePocBomTaskCategories([]);
    await this.saveProductCategoryStore({ ...store, [productId]: seed });
    return seed;
  }

  /** 保存指定产品的研发分类树 */
  async saveProductTaskCategoriesForProduct(productId: string, categories: unknown[]): Promise<{ ok: boolean }> {
    const store = await this.readProductCategoryStore();
    const normalized = ensurePocBomTaskCategories(categories);
    await this.saveProductCategoryStore({ ...store, [productId]: normalized });
    return { ok: true };
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
    const targetSubId = cleanText(target?.subId);
    if (!targetProductId || !targetCategoryId || !targetSubId) {
      throw new BadRequestException('移动目标不完整（缺少产品 / 系统 / 子项）');
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
      productTrees.set(pid, ensurePocBomTaskCategories(asArray(raw)));
    }
    // 目标产品若尚未在 store（首次承接任务），按空 BOM 种入工作副本。
    if (targetProductId !== RD_MAIN_PRODUCT_ID && !productTrees.has(targetProductId)) {
      productTrees.set(targetProductId, ensurePocBomTaskCategories([]));
    }

    const targetTree = targetProductId === RD_MAIN_PRODUCT_ID ? mainTree : productTrees.get(targetProductId)!;
    const targetCategory = targetTree.find(
      (c): c is JsonRecord => isRecord(c) && cleanText(c.id) === targetCategoryId,
    );
    if (!targetCategory) throw new BadRequestException('目标系统不存在');
    const targetChild = asArray(targetCategory.children)
      .filter(isRecord)
      .find((ch) => cleanText(ch.id) === targetSubId);
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

    // 部分 id 未在任何顶层任务中命中（多为子任务 id 或已不存在的 id）。
    // 旧逻辑会静默丢弃这些 id、只移动命中的部分，导致「提示成功实则少移」的数据静默丢失。
    // 这里改为明确报错。移动选择 UI 仅会传入顶层任务 id，正常流程不会触发；
    // 仅用于防御直连 API / 脏数据。此处尚未写库（仅改了内存工作副本），抛错即安全回滚。
    if (collected.size < ids.length) {
      const missing = ids.filter((id) => !collected.has(id));
      throw new BadRequestException(
        `部分任务无法移动（可能是子任务或已不存在）：${missing.join('、')}`,
      );
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
    if (writeOps.length > 0) await this.prisma.$transaction(writeOps);

    await this.recomputeDirectorDashboard();

    return {
      ok: true,
      movedCount: collected.size,
      categories: await this.getTaskCategories(),
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
    return this.getProductTaskCategories(pid);
  }

  /** 写回指定产品的分类树（主产品→主库；其余→对应产品库）。 */
  private async writeTaskCategoriesForProduct(productId: string, categories: unknown[]): Promise<void> {
    const pid = cleanText(productId);
    if (!pid || pid === RD_MAIN_PRODUCT_ID) {
      await this.writeValue('rd.taskCategories', categories);
      return;
    }
    await this.saveProductTaskCategoriesForProduct(pid, categories);
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

  async createTask(payload: JsonRecord) {
    // 建任务同为「读树→插入→写回」，纳入任务树写锁防并发互相覆盖
    return this.withTaskTreeLock(() => this.createTaskUnlocked(payload));
  }

  private async createTaskUnlocked(payload: JsonRecord) {
    const productId = cleanText(payload.product_id) || RD_MAIN_PRODUCT_ID;
    const [categories, identity] = await Promise.all([
      this.readTaskCategoriesForProduct(productId),
      this.getIdentityContext(),
    ]);
    const { category_id, sub_project_id, product_id: _productId, ...taskData } = payload;
    void _productId;
    const categoryId = typeof category_id === 'string' ? category_id.trim() : '';
    const requestedSubProjectId = typeof sub_project_id === 'string' ? sub_project_id.trim() : '';

    if (!categoryId) {
      throw new BadRequestException('请选择任务所属分类');
    }

    const newTask = this.normalizeTaskIdentity(
      withGeneratedId('rd-task', {
        ...taskData,
        task_id:
          typeof taskData.task_id === 'string' && taskData.task_id.trim()
            ? taskData.task_id.trim()
            : generateTaskId(),
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
    return newTask;
  }

  async updateTask(
    taskId: string,
    patch: JsonRecord,
    options?: { requesterUserId?: string; requesterName?: string; canEditAny?: boolean },
  ) {
    // Strip private notification-metadata fields before persisting
    const {
      task_id: _protected,
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
          found = true;
          originalTask = { ...t };

          // 越权防护（与 moveTasks 同口径）：仅持页面权限 page:rd-my-workspace 的普通成员
          // 只能修改"自己负责"的任务（主责人或协作人），且不得审批(_review_action)或移交(primary_owner)
          // ——审批/移交是研发主管/审核人专属。管理员级权限(canEditAny)完全跳过，行为不变。
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

    return { ok: true, task_id: taskId };
  }

  private async getUsersWithAnyPermission(codes: string[]): Promise<Array<{ id: string; name: string }>> {
    // 收件人须同时具备：指定操作码之一 + 当前工作区的页面码（超管 '*' 通行）。
    // 操作码跨池共享（协同角色同样持有 rd-task:edit 等），只按操作码捞人会把
    // 研发池的审核通知发给协同角色用户——rd.messages 是全局消息流（用户级过滤、
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

  private async notifyAdminsOfPendingReview(task: JsonRecord, patch: JsonRecord): Promise<void> {
    try {
      const reviewType = String(patch.pending_review_type ?? task.pending_review_type ?? 'result');
      const admins = await this.getUsersWithAnyPermission(['rd-task:edit', 'rd-task:reassign']);
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
      for (const admin of admins) {
        await this.createMessage({
          sender: { id: null, name: '系统通知', role: 'system' },
          recipient_id: admin.id,
          subject,
          body,
        });
      }
    } catch {
      // best-effort
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
    } catch {
      // best-effort
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

        await this.createMessage({
          sender: { id: null, name: '系统通知', role: 'system' },
          recipient_id: recipientId || null,
          recipient_person_id: recipientPersonId || null,
          recipient_name: recipientName || null,
          subject,
          body,
        });
      }
    } catch {
      // best-effort
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
        await this.createMessage({
          sender: { id: null, name: '系统通知', role: 'system' },
          recipient_id: recipientId || null,
          recipient_person_id: recipientPersonId || null,
          recipient_name: recipientName || null,
          subject,
          body,
        });
      }
    } catch {
      // best-effort
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
    } catch {
      // best-effort
    }
  }

  private async markReviewRequestMessagesHandled(taskId: string, reviewType: string): Promise<void> {
    const all = (await this.readArray('rd.messages')).filter(isRecord);
    let changed = false;
    const next = all.map((message) => {
      const body = cleanText(message.body);
      if (!body) return message;

      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(body) as Record<string, unknown>;
      } catch {
        return message;
      }

      const sameTask =
        parsed.type === 'review_request' &&
        cleanText(parsed.task_id) === taskId &&
        (!reviewType || cleanText(parsed.review_type || 'result') === reviewType);
      if (!sameTask) return message;

      changed = true;
      return { ...message, handled: true, read: true };
    });

    if (changed) {
      await this.writeValue('rd.messages', next);
    }
  }

  async patchMessage(
    messageId: string,
    patch: { read?: boolean; handled?: boolean },
    viewer: { userId?: string; hasFullAccess?: boolean },
  ) {
    const all = (await this.readArray('rd.messages')).filter(isRecord);
    const idx = all.findIndex((m) => m.id === messageId);
    if (idx === -1) throw new NotFoundException('消息不存在');
    const msg = all[idx];
    if (!viewer.hasFullAccess && viewer.userId !== msg.recipient_id && viewer.userId !== msg.sender_id) {
      // Name-based fallback: system messages may carry only a recipient name, or a stale linked user_id.
      if (msg.recipient_name && viewer.userId) {
        const users = await this.listIdentityUsers();
        const caller = users.find((u) => u.id === viewer.userId);
        if (!caller || personNameLookupKey(caller.name) !== personNameLookupKey(String(msg.recipient_name))) {
          throw new BadRequestException('无权修改此消息');
        }
      } else {
        throw new BadRequestException('无权修改此消息');
      }
    }
    all[idx] = { ...msg, ...patch };
    await this.writeValue('rd.messages', all);
    return all[idx];
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

  async deleteTask(taskId: string, actor?: { userId?: string; userName?: string }) {
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

    function deleteFromTasks(tasks: unknown[]): unknown[] {
      const filtered = tasks.filter((t) => {
        if (isRecord(t) && t.task_id === taskId) { found = true; removedTask = t; collectIds(t); return false; }
        return true;
      });
      return filtered.map((t) => {
        if (!isRecord(t) || !Array.isArray(t.subtasks)) return t;
        return { ...t, subtasks: deleteFromTasks(t.subtasks) };
      });
    }

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
    // 连带清理：删除任务（含子任务）后，把它们关联的"待审核"通知标记为已处理，
    // 避免管理员收件箱残留指向已删任务的孤儿待审核卡片（清理立项脏数据时常见）。
    for (const removedId of removedTaskIds) {
      try {
        await this.markReviewRequestMessagesHandled(removedId, '');
      } catch {
        // best-effort：任务已删除成功，通知清理失败不应阻断本次删除
      }
    }
    // 通知被删任务的负责人与协作人（best-effort，失败不阻断删除）。
    if (removedTask) {
      await this.notifyTaskDeleted(removedTask, actor?.userName?.trim() || '管理员', cleanUserId(actor?.userId)).catch(
        () => {},
      );
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
      for (const rcp of recipients) {
        const nameKey = personNameLookupKey(rcp.name);
        const key = rcp.user_id ? `u:${rcp.user_id}` : rcp.person_id ? `p:${rcp.person_id}` : nameKey ? `n:${nameKey}` : '';
        if (!key) continue;
        if (actorUserId && rcp.user_id === actorUserId) continue; // 不通知操作者本人
        if (seen.has(key)) continue;
        seen.add(key);
        await this.createMessage({
          sender: { id: null, name: '系统通知', role: 'system' },
          recipient_id: rcp.user_id || null,
          recipient_person_id: rcp.person_id || null,
          recipient_name: rcp.name || null,
          subject,
          body,
        });
      }
    } catch {
      // best-effort
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
      for (const rcp of recipients) {
        const nameKey = personNameLookupKey(rcp.name);
        const key = rcp.user_id ? `u:${rcp.user_id}` : rcp.person_id ? `p:${rcp.person_id}` : nameKey ? `n:${nameKey}` : '';
        if (!key || seen.has(key)) continue;
        seen.add(key);
        await this.createMessage({
          sender: { id: null, name: '系统通知', role: 'system' },
          recipient_id: rcp.user_id || null,
          recipient_person_id: rcp.person_id || null,
          recipient_name: rcp.name || null,
          subject,
          body,
        });
      }
    } catch {
      // best-effort
    }
  }

  async recomputeDashboard() {
    await this.recomputeDirectorDashboard();
    return { ok: true };
  }

  private async recomputeDirectorDashboard(): Promise<void> {
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

  /** Build a same-origin inline-preview proxy URL for an OSS-backed attachment, deriving the objectKey from its signed oss_url. */
  private buildAttachmentPreviewUrl(ossUrl: string): string | null {
    try {
      const objectKey = decodeURIComponent(new URL(ossUrl).pathname).replace(/^\/+/, '');
      if (!objectKey) return null;
      const { exp, sig } = this.ossService.signPreviewToken(objectKey, 24 * 3600);
      const params = new URLSearchParams({ key: objectKey, exp: String(exp), sig });
      return `/api/research-development/oss-preview?${params.toString()}`;
    } catch {
      return null;
    }
  }

  /** 图片附件缩略图的 OSS 实时处理参数：等比缩到 480px + webp 压缩，网格缩略位不再加载原图。 */
  private static readonly ATTACHMENT_THUMB_PROCESS = 'image/resize,m_lfit,w_480/format,webp/quality,q_80';
  /** 缩略图签名 URL 记忆化（24h 复用同一 URL，保证浏览器缓存可命中；签名 TTL 48h 留余量）。 */
  private readonly attachmentThumbCache = new Map<string, { url: string; freshUntil: number }>();

  /** 为图片附件生成稳定的缩略图签名 URL（非图片 / OSS 未启用 / 解析失败返回 null）。 */
  private buildAttachmentThumbUrl(ossUrl: string, mime: unknown): string | null {
    if (typeof mime !== 'string' || !mime.startsWith('image/')) return null;
    try {
      const objectKey = decodeURIComponent(new URL(ossUrl).pathname).replace(/^\/+/, '');
      if (!objectKey) return null;
      const cached = this.attachmentThumbCache.get(objectKey);
      const now = Date.now();
      if (cached && cached.freshUntil > now) return cached.url;
      const url = this.ossService.getSignedUrl(objectKey, 48 * 3600, ResearchDevelopmentService.ATTACHMENT_THUMB_PROCESS);
      if (!url) return null;
      // 上限防泄漏：长期运行进程只保留活跃工作集，超限整体清空（重建成本仅为一次签名）
      if (this.attachmentThumbCache.size >= 5000) this.attachmentThumbCache.clear();
      this.attachmentThumbCache.set(objectKey, { url, freshUntil: now + 24 * 3600 * 1000 });
      return url;
    } catch {
      return null;
    }
  }

  /** Decorate progress-note attachments with `preview_url` (same-origin inline proxy) so the client can iframe-preview OSS files. */
  private decorateNotesWithPreview(notes: JsonRecord[]): JsonRecord[] {
    if (!Array.isArray(notes)) return notes;
    return notes.map((note) => {
      const attachments = isRecord(note) ? note.attachments : null;
      if (!Array.isArray(attachments)) return note;
      const decorated = attachments.map((att) => {
        if (!isRecord(att) || typeof att.oss_url !== 'string' || !att.oss_url) return att;
        const previewUrl = this.buildAttachmentPreviewUrl(att.oss_url);
        const thumbUrl = this.buildAttachmentThumbUrl(att.oss_url, att.mime);
        return {
          ...att,
          ...(previewUrl ? { preview_url: previewUrl } : {}),
          ...(thumbUrl ? { thumb_url: thumbUrl } : {}),
        };
      });
      return { ...note, attachments: decorated };
    });
  }

  async getTaskProgressNotes(
    taskId: string,
    viewer?: { userId?: string; hasFullAccess?: boolean; canReadAll?: boolean; userName?: string },
  ) {
    const map = await this.getProgressNoteMap();
    const notes = map[taskId] ?? [];
    if (viewer?.hasFullAccess || viewer?.canReadAll) return this.decorateNotesWithPreview(notes);
    const userId = viewer?.userId;
    const userName = viewer?.userName;
    if (!userId && !userName) return [];
    // 参与人（主责人或协作人）可查看该任务的「全部」进展留痕——否则协作人/主管在审核时写下的
    // 进展对本人不可见，造成同一条任务进展线被割裂。仅作用于「单任务读取」，不改动
    // listAllTaskProgressNotes（日报/看板聚合仍按「仅本人撰写」口径，避免放大聚合可见范围）。
    const task = await this.findTaskAcrossStores(taskId);
    if (task && isTaskParticipant(task, userId, userName)) {
      return this.decorateNotesWithPreview(notes);
    }
    // 非参与人（且非管理员）退化为「仅本人撰写」。
    if (!userId) return [];
    return this.decorateNotesWithPreview(notes.filter((note) => {
      const actor = isRecord(note.actor) ? note.actor : null;
      return Boolean(actor && actor.id === userId);
    }));
  }

  async listAllTaskProgressNotes(viewer?: { userId?: string; hasFullAccess?: boolean; canReadAll?: boolean }) {
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

  async createTaskProgressNote(payload: {
    taskId: string;
    text: string;
    progress?: number;
    actor?: { id?: string; name?: string; role?: string };
    files: Array<{ originalname: string; mimetype?: string; size?: number; buffer: Buffer }>;
    requesterUserId?: string;
    requesterName?: string;
    canEditAny?: boolean;
    /** 可选：关联到任务的哪个工作项（任务内部轻量拆分，不校验存在性——工作项可被改名/删除，留痕保留原关联） */
    workItemId?: string;
  }) {
    const taskId = (payload.taskId ?? '').trim();
    if (!taskId) throw new BadRequestException('taskId 不能为空');

    // 越权防护：进展留痕会带附件入知识库并参与 AI 评分，必须防止向他人任务注入内容。
    // 非管理员（仅 page:rd-my-workspace）只能为"自己负责"的任务（主责人或协作人）添加进展；
    // 管理员级权限(canEditAny)跳过，行为不变。用可信的 req.user 身份校验，不信任前端传入的 actor.name。
    if (!payload.canEditAny) {
      const task = await this.findTaskAcrossStores(taskId);
      if (!task) throw new NotFoundException('任务不存在');
      if (!isTaskParticipant(task, payload.requesterUserId, payload.requesterName)) {
        throw new ForbiddenException('只能为自己负责的任务添加进展');
      }
    }

    const text = (payload.text ?? '').trim();
    const files = Array.isArray(payload.files) ? payload.files : [];

    if (!text && files.length === 0) {
      throw new BadRequestException('进展说明或附件至少需要提供一项');
    }

    if (files.length > PROGRESS_NOTE_MAX_FILES) {
      throw new BadRequestException(`附件最多 ${PROGRESS_NOTE_MAX_FILES} 个`);
    }
    const oversized = files.find((f) => (f.size ?? f.buffer.length) > PROGRESS_NOTE_MAX_FILE_BYTES);
    if (oversized) {
      throw new BadRequestException(`附件 ${oversized.originalname} 超过单文件 25MB 限制`);
    }
    const totalSize = files.reduce((sum, file) => sum + (file.size ?? file.buffer.length), 0);
    if (totalSize > PROGRESS_NOTE_MAX_TOTAL_BYTES) {
      throw new BadRequestException('附件总大小超过 50MB 限制');
    }

    // 保留 buffer 引用，附件保存后用于异步 AI 抽取
    const attachmentsWithBuffers = await Promise.all(files.map(async (f, i) => {
      // 同一批附件在同一同步 tick 生成，Date.now() 相同 —— 加索引 i 杜绝 id 撞车（否则前端按 id 作 key 可能错渲染）。
      const id = `att-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`;
      const objectKey = await this.ossService.uploadBuffer(
        f.buffer,
        'rd/progress-notes',
        f.originalname,
        f.mimetype,
      );
      const ossUrl = objectKey ? this.ossService.getSignedUrl(objectKey, 30 * 24 * 3600) : null;
      const attachment = {
        id,
        name: f.originalname,
        mime: f.mimetype ?? 'application/octet-stream',
        size: f.size ?? f.buffer.length,
        // 优先使用 OSS 签名 URL，OSS 未配置时降级存 base64
        ...(ossUrl
          ? { oss_url: ossUrl }
          : { data_url: `data:${f.mimetype ?? 'application/octet-stream'};base64,${f.buffer.toString('base64')}` }
        ),
      };
      return { attachment, buffer: f.buffer, mimetype: f.mimetype, originalname: f.originalname };
    }));
    const attachments = attachmentsWithBuffers.map((a) => a.attachment);

    const note = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      task_id: taskId,
      text,
      progress: typeof payload.progress === 'number' ? Math.max(0, Math.min(100, Math.round(payload.progress))) : undefined,
      ...(payload.workItemId ? { work_item_id: payload.workItemId } : {}),
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
    const maxItems = Math.max(1, Math.min(200, opts.maxItems ?? 50));
    const map = await this.getProgressNoteMap();

    // 收集所有待处理的附件（带 taskId / noteId / attachment 引用）
    type PendingItem = { taskId: string; noteId: string; attachment: JsonRecord };
    const pending: PendingItem[] = [];
    for (const [taskId, notes] of Object.entries(map)) {
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
    items: Array<{ attachment: JsonRecord; buffer: Buffer; mimetype?: string; originalname: string }>,
  ): Promise<void> {
    for (const item of items) {
      try {
        const result = await this.rdAiService.extractAttachmentText({
          originalname: item.originalname,
          mimetype: item.mimetype,
          buffer: item.buffer,
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
    if (!taskId || delta <= 0) return;
    let found = false;

    const updateInTasks = (tasks: unknown[]): unknown[] =>
      tasks.map((task) => {
        if (!isRecord(task)) return task;
        if (task.task_id === taskId) {
          found = true;
          const current = typeof task.attachments === 'number' ? task.attachments : 0;
          return { ...task, attachments: current + delta };
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
  ): JsonRecord[] {
    const attachmentCounts = new Map<string, number>();
    const latestNotes = new Map<string, JsonRecord>();
    // 每个任务的图片附件 URL（按留痕时间倒序、去重、上限 6 张），供移动端卡片做封面缩略图。
    const coverImages = new Map<string, string[]>();
    for (const [taskId, notes] of Object.entries(noteMap)) {
      const count = notes.reduce((sum, note) => {
        return sum + (Array.isArray(note.attachments) ? note.attachments.length : 0);
      }, 0);
      attachmentCounts.set(taskId, count);
      const ordered = notes
        .slice()
        .sort((a, b) => cleanText(b.created_at).localeCompare(cleanText(a.created_at)));
      if (ordered[0]) latestNotes.set(taskId, ordered[0]);
      const urls: string[] = [];
      for (const note of ordered) {
        if (!Array.isArray(note.attachments)) continue;
        for (const att of note.attachments) {
          if (!isRecord(att)) continue;
          const mime = typeof att.mime === 'string' ? att.mime : '';
          const ossUrl = typeof att.oss_url === 'string' ? att.oss_url : '';
          if (mime.startsWith('image/') && ossUrl && !urls.includes(ossUrl)) urls.push(ossUrl);
        }
      }
      if (urls.length) coverImages.set(taskId, urls.slice(0, 6));
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
          completion_score: _completionScore,
          ...taskRest
        } = task;
        return {
          ...taskRest,
          attachments: Math.max(existing, progressAttachmentCount),
          ...(latestProgressSummary ? { latest_progress_summary: latestProgressSummary } : {}),
          ...(lastActivityAt ? { last_activity_at: lastActivityAt } : {}),
          ...(taskCovers && taskCovers.length ? { cover_images: taskCovers } : {}),
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
    const existing = (await this.readArray('rd.messages')).filter(isRecord);
    let superseded = false;
    const cleaned = existing.map((m) => {
      if (m.recipient_id !== report.user_id || m.handled === true) return m;
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof m.body === 'string' ? m.body : '');
      } catch {
        return m;
      }
      if (isRecord(parsed) && parsed.type === 'perf_self_assessment' && parsed.month === report.month) {
        superseded = true;
        return { ...m, handled: true };
      }
      return m;
    });
    if (superseded) await this.writeValue('rd.messages', cleaned);

    const body = JSON.stringify({
      type: 'perf_self_assessment',
      report_id: report.id,
      month: report.month,
      period_label: periodLabel,
      user_name: report.user_name,
    });
    await this.createMessage({
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
    const all = (await this.readArray('rd.messages')).filter(isRecord);
    let changed = false;
    const next = all.map((m) => {
      if (m.recipient_id !== userId || m.handled === true) return m;
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof m.body === 'string' ? m.body : '');
      } catch {
        return m;
      }
      if (isRecord(parsed) && parsed.type === 'perf_self_assessment' && parsed.report_id === reportId) {
        changed = true;
        return { ...m, handled: true, read: true };
      }
      return m;
    });
    if (changed) await this.writeValue('rd.messages', next);
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

  private messageMatchesRecipient(message: JsonRecord, identity: MessageRecipientIdentity): boolean {
    const recipientId = cleanUserId(message.recipient_id);
    if (recipientId && recipientId === identity.userId) return true;

    const recipientPersonId = cleanText(message.recipient_person_id);
    if (recipientPersonId && identity.personIds.has(recipientPersonId)) return true;

    if (identity.nameKey) {
      const recipientNameKey = personNameLookupKey(message.recipient_name);
      if (recipientNameKey && recipientNameKey === identity.nameKey) return true;
    }

    return false;
  }

  private messageMatchesParticipant(message: JsonRecord, identity: MessageRecipientIdentity): boolean {
    return cleanUserId(message.sender_id) === identity.userId || this.messageMatchesRecipient(message, identity);
  }

  async listMessages(
    filters?: { user_id?: string; recipient_id?: string; limit?: number },
    viewer?: { userId?: string; hasFullAccess?: boolean },
  ) {
    const all = (await this.readArray('rd.messages')).filter(isRecord);
    const limit = Math.max(1, Math.min(500, filters?.limit ?? 200));
    let filtered = all;
    const identityCache = new Map<string, Promise<MessageRecipientIdentity>>();
    const resolveIdentity = (userId?: string) => {
      const id = cleanUserId(userId);
      if (!identityCache.has(id)) {
        identityCache.set(id, this.getMessageRecipientIdentity(id));
      }
      return identityCache.get(id)!;
    };

    // Privacy: non-managers can only see messages they sent or received
    if (viewer && !viewer.hasFullAccess) {
      const ownId = viewer.userId;
      if (!ownId) return [];
      const ownIdentity = await resolveIdentity(ownId);
      filtered = filtered.filter((m) => this.messageMatchesParticipant(m, ownIdentity));
    }

    if (filters?.user_id) {
      const userIdentity = await resolveIdentity(filters.user_id);
      filtered = filtered.filter((m) => this.messageMatchesParticipant(m, userIdentity));
    }
    if (filters?.recipient_id) {
      const recipientIdentity = await resolveIdentity(filters.recipient_id);
      filtered = filtered.filter((m) => this.messageMatchesRecipient(m, recipientIdentity));
    }
    return filtered
      .slice()
      .sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')))
      .slice(0, limit);
  }

  async createMessage(payload: {
    sender: { id?: string | null; name?: string | null; role?: string | null };
    recipient_id?: string | null;
    recipient_person_id?: string | null;
    recipient_name?: string | null;
    subject?: string | null;
    body: string;
  }) {
    const body = (payload.body ?? '').trim();
    if (!body) throw new BadRequestException('消息内容不能为空');
    if (body.length > 4000) throw new BadRequestException('消息内容过长 (上限 4000 字符)');

    const recipientId = (payload.recipient_id ?? '').trim() || null;
    const recipientPersonId = (payload.recipient_person_id ?? '').trim() || null;
    const recipientName = (payload.recipient_name ?? '').trim() || null;
    if (!recipientId && !recipientPersonId && !recipientName) {
      throw new BadRequestException('请指定接收人');
    }

    const message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sender_id: payload.sender.id ?? null,
      sender_name: payload.sender.name ?? '系统',
      sender_role: payload.sender.role ?? null,
      recipient_id: recipientId,
      recipient_person_id: recipientPersonId,
      recipient_name: recipientName,
      subject: (payload.subject ?? '').trim() || null,
      body,
      read: false,
      created_at: new Date().toISOString(),
    };

    const existing = (await this.readArray('rd.messages')).filter(isRecord);
    await this.writeValue('rd.messages', [message, ...existing].slice(0, 5000));
    return message;
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

  async clearAllTaskData() {
    await Promise.all([
      this.writeValue('rd.taskCategories', []),
      this.writeValue('rd.productTaskCategories', {}),
      this.writeValue('rd.workspace', EMPTY_WORKSPACE),
      this.writeValue('rd.directorDashboard', EMPTY_DIRECTOR_DASHBOARD),
      this.writeValue('rd.taskProgressNotes', {}),
      this.writeValue('rd.dailyReports', []),
      this.writeValue('rd.messages', []),
      this.writeValue('rd.proposalDrafts', []),
    ]);
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
    });
    if (ai) {
      return { text: ai.text, model: ai.model, provider: ai.provider, source: 'ai', generated_at: new Date().toISOString() };
    }

    // 本地兜底：AI 未配置/失败时拼一段基础事实小结
    const doneCount = workItems.filter((w) => w.done).length;
    const latest = notes[0];
    const lines = [
      `《${title}》当前${statusLabel}，进度 ${progress}%，主责 ${owner}${dueDate ? `，截止 ${dueDate}` : ''}。`,
      workItems.length > 0 ? `工作项完成 ${doneCount}/${workItems.length}。` : '',
      latest
        ? `最近进展（${latest.createdAt.slice(0, 10)} ${latest.actorName}）：${latest.text.slice(0, 80) || '更新了任务进度'}`
        : '暂无进展留痕。',
      blockedReason ? `⚠️ ${blockedReason}${blockedDays != null ? `，已阻塞 ${blockedDays} 天` : ''}。` : '',
    ].filter(Boolean);
    return { text: lines.join('\n'), model: 'local', provider: 'local', source: 'local', generated_at: new Date().toISOString() };
  }

  private toWorkspaceTask(task: JsonRecord, role: 'primary' | 'collaborator', collabRole?: string) {
    const dueDate = cleanText(task.due_date);
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
      category_path: cleanText(task.category_path),
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
      latest_progress_summary: this.normalizeLatestProgressSummary(task.latest_progress_summary),
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

    const [rawCategories, identity, noteMap] = await Promise.all([
      // 我的工作台「只关注任务」：跨所有产品库聚合该成员的任务（产品仅是展示分区，不切分"我的任务"）。
      this.readMergedTaskCategories(),
      this.getIdentityContext(),
      this.getProgressNoteMap(),
    ]);
    const categories = this.applyProgressAttachmentCounts(rawCategories, noteMap);
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

    const myTasks = visibleTasks
      .filter(isPrimary)
      .map((task) => this.toWorkspaceTask(task, 'primary'));
    const collabTasks = visibleTasks
      .map((task) => ({ task, role: collaboratorRole(task) }))
      .filter((item) => item.role && !isPrimary(item.task))
      .map((item) => this.toWorkspaceTask(item.task, 'collaborator', item.role));
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
      todayTodos: dueTasks.length
        ? dueTasks.map((task) => ({ text: `${task.title} · ${task.due_date}`, task_id: task.task_id }))
        : saved.todayTodos,
      notifications: mergedNotifications,
    };
  }

  /** Build notification-shaped entries from messages addressed to this user. */
  private async collectInboxMessagesAsNotifications(
    currentUserId: string,
    currentNameKey: string,
    currentPersonIds = new Set<string>(),
  ): Promise<JsonRecord[]> {
    const messages = (await this.readArray('rd.messages')).filter(isRecord);
    const matched = messages.filter((m) => {
      // Exclude messages that have already been fully handled (approved/rejected)
      if (Boolean(m.handled)) return false;
      const recipientId = cleanUserId(m.recipient_id);
      if (recipientId && recipientId === currentUserId) return true;
      const recipientPersonId = cleanText(m.recipient_person_id);
      if (recipientPersonId && currentPersonIds.has(recipientPersonId)) return true;
      const nameKey = personNameLookupKey(m.recipient_name);
      if (nameKey && nameKey === currentNameKey) return true;
      return false;
    });

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
      } else if (msgType === 'perf_self_assessment') {
        const periodLabel = String(parsedBody!['period_label'] ?? '');
        defaultTitle = `绩效自评：${periodLabel}月度绩效已生成，请完成自评`;
        displayMessage = `你的 ${periodLabel} 月度绩效报表已生成，请完成 5 维自评（交付 / 质量 / 协作 / 主动性 / 规范）。`;
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

  async createPerson(payload: JsonRecord) {
    const [people, users] = await Promise.all([this.getPeople(), this.listIdentityUsers()]);
    const nextPerson = this.normalizePeopleRecords([withGeneratedId('rd-person', payload)], users)[0];
    if (!nextPerson) {
      throw new BadRequestException('研发成员数据无效');
    }
    const nextPeople = [nextPerson, ...people.filter((item) => !isRecord(item) || item.id !== nextPerson.id)];
    await this.writeValue('rd.people', nextPeople);
    await this.recomputeDirectorDashboard();
    return nextPerson;
  }

  async updatePerson(id: string, payload: JsonRecord) {
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
    }
    await this.recomputeDirectorDashboard();
    return nextPeople.find((item) => isRecord(item) && item.id === id);
  }

  async removePerson(id: string) {
    const people = await this.getPeople();
    const beforePerson = people.find((item) => isRecord(item) && item.id === id);
    const nextPeople = people.filter((item) => !isRecord(item) || item.id !== id);
    await this.writeValue('rd.people', nextPeople);
    if (isRecord(beforePerson)) {
      await this.rewritePersonAssignments(beforePerson, null);
    }
    await this.recomputeDirectorDashboard();
    return { ok: true };
  }

  async getApprovalFlows() {
    return this.readArray('rd.approvalFlows');
  }

  async getApprovalPools(permissionCodes: string[]) {
    const requested = Array.from(
      new Set(permissionCodes.map((code) => code.trim()).filter(Boolean)),
    );
    if (requested.length === 0) return {};

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

  async saveApprovalFlows(payload: unknown[]) {
    return this.writeValue('rd.approvalFlows', asArray(payload));
  }

  async getAuditLogs() {
    const logs = await this.readArray('rd.auditLogs');
    return logs
      .filter(isRecord)
      .sort((a, b) => String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? '')));
  }

  // ── 已完成任务 AI 质量评分（持久化）─────────────────────────────────────────

  async getTaskCompletionScore(
    taskId: string,
    viewer: { userId?: string; hasFullAccess: boolean },
  ): Promise<JsonRecord | null> {
    const allScores = await this.readValue('rd.taskCompletionScores');
    const map = isRecord(allScores) ? allScores : {};
    const raw = map[taskId];
    if (!isRecord(raw)) return null;

    // 可见性：主责人 / 协作人 / 拥有 hasFullAccess（管理员）可见
    let allowed = false;
    if (viewer.hasFullAccess) {
      allowed = true;
    } else if (viewer.userId) {
      const taskOwners = await this.collectTaskParticipantUserIds(taskId);
      if (taskOwners.has(viewer.userId)) allowed = true;
    }
    if (!allowed) return null;

    // 一般查询去掉 _debug 字段（含原始 prompt + 响应，仅超管可见）
    const { _debug, ...publicFields } = raw as JsonRecord & { _debug?: unknown };
    void _debug;
    return publicFields;
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
   * 团队绩效考核聚合（按人）。供研发主管驾驶舱「团队绩效考核」面板使用。
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
        if (t.status === 'completed' && typeof t.task_id === 'string') {
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

  async createAuditLog(payload: JsonRecord) {
    const currentLogs = await this.getAuditLogs();
    const nextLog = {
      ...withGeneratedId('rd-log', payload),
      timestamp: new Date().toISOString(),
    };
    await this.writeValue('rd.auditLogs', [nextLog, ...currentLogs].slice(0, MAX_AUDIT_LOGS));
    return nextLog;
  }

  async clearAuditLogs() {
    await this.writeValue('rd.auditLogs', []);
    return { ok: true };
  }

  /**
   * 给某条操作留痕追加一条「备注」。备注内嵌在该留痕记录的 notes 数组里，
   * 随留痕一起持久化、一起被 MAX_AUDIT_LOGS 滚动淘汰，做到「跟着留痕走」。
   */
  async addAuditLogNote(logId: string, payload: JsonRecord) {
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) throw new BadRequestException('备注内容不能为空');
    if (text.length > 200) throw new BadRequestException('备注内容过长（上限 200 字符）');

    const logs = await this.readArray('rd.auditLogs');
    const idx = logs.findIndex((log) => isRecord(log) && log.id === logId);
    if (idx === -1) throw new NotFoundException('操作留痕记录不存在');

    const log = logs[idx] as JsonRecord;
    const actor = isRecord(payload.actor) ? payload.actor : {};
    const note: JsonRecord = {
      id: `rd-log-note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      actor,
      created_at: new Date().toISOString(),
    };
    const existing = Array.isArray(log.notes) ? log.notes : [];
    const updated: JsonRecord = { ...log, notes: [...existing, note] };
    logs[idx] = updated;
    await this.writeValue('rd.auditLogs', logs);
    return updated;
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

  async createKnowledgeCategory(payload: { label?: unknown; parent_id?: unknown; icon?: unknown; color?: unknown }, kbId?: string) {
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
    const entries = await this.readActiveKnowledgeEntryRecords(kbId);
    return { ok: true, category, categories: this.attachKnowledgeCategoryCounts(categories, entries) };
  }

  async updateKnowledgeCategory(
    id: string,
    payload: { label?: unknown; icon?: unknown; color?: unknown },
    kbId?: string,
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
    return { ok: true, category: found.category, categories: this.attachKnowledgeCategoryCounts(categories, entries) };
  }

  async deleteKnowledgeCategory(id: string, kbId?: string) {
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
    if (index >= 0) found.siblings.splice(index, 1);
    await this.writeValue(this.kbCategoriesKey(kbId), this.stripKnowledgeCategoryComputedFields(categories));
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

  async createKnowledgeEntry(payload: {
    title: string;
    description?: string;
    category_id: string;
    tags?: string[];
    visibility?: string;
    permission_level?: number;
    source?: string;
    source_task_id?: string;
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
    // RAG 同步（best-effort，不阻塞返回）；部门库一期不接 RAG，仅研发库同步向量
    if (!kbId) void this.syncKbEntryToRag(entry);
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
  }>, kbId?: string) {
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
    // RAG 同步：内容变更需要重新 embedding；部门库不接 RAG
    if (next && !kbId) void this.syncKbEntryToRag(next);
    return next;
  }

  async moveKnowledgeEntry(id: string, categoryId: string, kbId?: string) {
    return this.updateKnowledgeEntry(id, { category_id: categoryId }, kbId);
  }

  async deleteKnowledgeEntry(id: string, kbId?: string) {
    const raw = await this.readValue(this.kbEntriesKey(kbId));
    const entries: JsonRecord[] = Array.isArray(raw) ? (raw as JsonRecord[]) : [];
    const updated = entries.map(e => e.id === id ? { ...e, archived: true, updated_at: new Date().toISOString() } : e);
    await this.writeValue(this.kbEntriesKey(kbId), updated);
    // RAG 同步：archived=true 触发 chunk 删除；部门库不接 RAG
    if (!kbId) {
      void this.ragService.removeChunksForSource('kb', id).catch((err) => {
        this.logger.warn(`[RAG] removeChunksForSource 失败 (entry=${id}): ${err instanceof Error ? err.message : String(err)}`);
      });
    }
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
    const normalized = this.normalizeCategoriesWithIdentity(
      bomNormalized.filter(isRecord),
      identity.people,
      identity.users,
    );
    if (JSON.stringify(raw) !== JSON.stringify(normalized)) {
      await this.writeValue('rd.taskCategories', normalized);
    }
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

  /** 保存整簿快照（仅 rd-sheet:edit / 超管，controller 守门）。 */
  async saveSheetWorkbook(snapshot: unknown, editorId?: string | null): Promise<{ snapshot: JsonRecord; updated_at: string; updated_by: string | null }> {
    if (!isRecord(snapshot) || !isRecord((snapshot as JsonRecord).sheets)) {
      throw new BadRequestException('工作簿快照格式不正确');
    }
    const updated_at = new Date().toISOString();
    const updated_by = cleanText(editorId) || null;
    await this.writeValue('rd.sheets', { snapshot, updated_at, updated_by });
    return { snapshot: snapshot as JsonRecord, updated_at, updated_by };
  }

  private async readArray(key: RdStoreKey) {
    return asArray(await this.readValue(key));
  }

  // 存储咽喉点：所有 rd.* 键经 resolveRdStoreKey 按当前工作区改写（默认研发池原样，
  // us-collab 协同池改写为 rdws.us-collab.*），实现任务/人员/审批流/AI 策略/留痕的池级隔离。
  private async readValue(key: RdStoreKey) {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: resolveRdStoreKey(key) },
      select: { value: true },
    });
    return setting?.value ?? null;
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
    return setting.value;
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
