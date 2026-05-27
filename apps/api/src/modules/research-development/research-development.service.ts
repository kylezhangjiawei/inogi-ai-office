import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { OcrService } from '../ocr/ocr.service';
import { OssService } from '../oss/oss.service';
import { RdAiService } from './rd-ai.service';

type JsonRecord = Record<string, unknown>;
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
  | 'rd.messages'
  | 'rd.proposalDrafts'
  | 'rd.products'
  | 'rd.productTaskCategories'
  | 'rd.knowledgeCategories'
  | 'rd.knowledgeEntries';

const CATEGORY = 'research-development';
const MAX_AUDIT_LOGS = 1000;
const DEFAULT_BOM_TASK_TYPE = '研发任务';
const PROGRESS_NOTE_MAX_FILES = 5;
const PROGRESS_NOTE_MAX_FILE_BYTES = 25 * 1024 * 1024;
const PROGRESS_NOTE_MAX_TOTAL_BYTES = 50 * 1024 * 1024;

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

function isUnassignedOwner(value: unknown): boolean {
  const text = cleanText(value);
  return !text || UNASSIGNED_OWNER_PATTERN.test(text);
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly ocrService: OcrService,
    private readonly ossService: OssService,
    private readonly rdAiService: RdAiService,
  ) {}

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
    const [categories, noteMap] = await Promise.all([
      this.readNormalizedTaskCategories(),
      this.getProgressNoteMap(),
    ]);
    return this.applyProgressAttachmentCounts(categories, noteMap);
  }

  async saveTaskCategories(payload: unknown[]) {
    const normalized = ensurePocBomTaskCategories(payload);
    const saved = await this.writeValue('rd.taskCategories', normalized);
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

  private async readProductCategoryStore(): Promise<Record<string, unknown>> {
    const raw = await this.readValue('rd.productTaskCategories');
    return isRecord(raw) ? (raw as Record<string, unknown>) : {};
  }

  private async saveProductCategoryStore(store: Record<string, unknown>) {
    await this.writeValue('rd.productTaskCategories', store);
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
    const [categories, identity] = await Promise.all([
      this.readNormalizedTaskCategories(),
      this.getIdentityContext(),
    ]);
    const { category_id, sub_project_id, ...taskData } = payload;
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
        collaborators: Array.isArray(taskData.collaborators) ? taskData.collaborators : [],
        subtasks: [],
        updated_at: new Date().toISOString(),
      }),
      identity.people,
      identity.users,
    );

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
    await this.writeValue('rd.taskCategories', updated);
    await this.recomputeDirectorDashboard();
    return newTask;
  }

  async updateTask(taskId: string, patch: JsonRecord) {
    // Strip private notification-metadata fields before persisting
    const {
      task_id: _protected,
      _review_action,
      _reviewer_name,
      _reject_reason,
      ...persistPatch
    } = patch as JsonRecord & {
      _review_action?: string;
      _reviewer_name?: string;
      _reject_reason?: string;
    };
    void _protected;

    // When _review_action is provided but no explicit status is in the patch,
    // auto-derive the new task status so the downstream notification fires correctly.
    // approve: result-review → completed; collaboration-review → in_progress
    // reject:  always → in_progress (task sent back for revision)
    let resolvedPatch: JsonRecord = persistPatch;

    const [categories, identity] = await Promise.all([
      this.readNormalizedTaskCategories(),
      this.getIdentityContext(),
    ]);
    let found = false;
    let originalTask: JsonRecord | null = null;

    const updateInTasks = (tasks: unknown[]): unknown[] => {
      return tasks.map((t) => {
        if (!isRecord(t)) return t;
        if (t.task_id === taskId) {
          found = true;
          originalTask = { ...t };

          // Resolve review actions now that we have the original task.
          if (_review_action) {
            const reviewType = String((t as JsonRecord).pending_review_type ?? 'result');
            const actionPatch: JsonRecord = { ...persistPatch };

            if (!Object.prototype.hasOwnProperty.call(persistPatch, 'status')) {
              actionPatch.status =
                _review_action === 'approve'
                  ? reviewType === 'result' ? 'completed' : 'in_progress'
                  : 'in_progress';
            }

            actionPatch.pending_review_type = null;

            if (reviewType === 'collaboration') {
              actionPatch.pending_collaborators = [];
              actionPatch.pending_collaboration_reason = null;
              actionPatch.pending_collaboration_requested_at = null;
              if (_review_action === 'approve') {
                actionPatch.collaborators = asArray((t as JsonRecord).pending_collaborators).filter(isRecord);
              }
            }

            resolvedPatch = actionPatch;
          }

          const ownerNameChanged = Object.prototype.hasOwnProperty.call(resolvedPatch, 'primary_owner');
          const ownerUserIdProvided = Object.prototype.hasOwnProperty.call(resolvedPatch, 'primary_owner_user_id');
          const identityPatch =
            ownerNameChanged && !ownerUserIdProvided
              ? { ...resolvedPatch, primary_owner_user_id: null }
              : resolvedPatch;
          const merged = { ...t, ...identityPatch, task_id: taskId, updated_at: new Date().toISOString() };
          return this.normalizeTaskIdentity(merged, identity.people, identity.users);
        }
        if (Array.isArray(t.subtasks)) {
          return { ...t, subtasks: updateInTasks(t.subtasks) };
        }
        return t;
      });
    };

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

    if (!found) throw new NotFoundException('任务不存在');
    await this.writeValue('rd.taskCategories', updated);
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
      }
    }

    return { ok: true, task_id: taskId };
  }

  private async getUsersWithAnyPermission(codes: string[]): Promise<Array<{ id: string; name: string }>> {
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, name: true, role: { select: { permissions: true } } },
    });
    return users
      .filter((u) => {
        const perms = Array.isArray(u.role?.permissions) ? (u.role!.permissions as string[]) : [];
        return perms.includes('*') || codes.some((c) => perms.includes(c));
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
        note: String(patch.pending_collaboration_reason ?? task.pending_collaboration_reason ?? ''),
        pending_collaborators: patch.pending_collaborators ?? task.pending_collaborators ?? [],
        current_progress: typeof task.progress === 'number' ? task.progress : 0,
      });
      const typeLabel = reviewType === 'collaboration' ? '协作变更' : '结果';
      const subject = `[待审核] 「${task.title}」申请${typeLabel}审核`;
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
      const isCollaboration = reviewType === 'collaboration';
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
      const subject = isCollaboration
        ? `[审核结果] 「${taskTitle}」协作申请${isApproved ? '已通过' : '被打回'}`
        : `[审核结果] 「${taskTitle}」${isApproved ? '已通过审核' : '被打回，请修改后重新提交'}`;
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

  async deleteTask(taskId: string) {
    const categories = await this.readNormalizedTaskCategories();
    let found = false;

    function deleteFromTasks(tasks: unknown[]): unknown[] {
      const filtered = tasks.filter((t) => {
        if (isRecord(t) && t.task_id === taskId) { found = true; return false; }
        return true;
      });
      return filtered.map((t) => {
        if (!isRecord(t) || !Array.isArray(t.subtasks)) return t;
        return { ...t, subtasks: deleteFromTasks(t.subtasks) };
      });
    }

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

    if (!found) throw new NotFoundException('任务不存在');
    await this.writeValue('rd.taskCategories', updated);
    await this.recomputeDirectorDashboard();
    return { ok: true };
  }

  async recomputeDashboard() {
    await this.recomputeDirectorDashboard();
    return { ok: true };
  }

  private async recomputeDirectorDashboard(): Promise<void> {
    const [categories, people, users] = await Promise.all([
      this.readNormalizedTaskCategories(),
      this.getPeople(),
      this.listIdentityUsers(),
    ]);

    // Flatten all tasks from the category tree
    const allTasks: JsonRecord[] = [];
    function collectTasksInto(tasks: unknown[], output: JsonRecord[]) {
      for (const t of tasks) {
        if (!isRecord(t)) continue;
        output.push(t);
        if (Array.isArray(t.subtasks)) collectTasksInto(t.subtasks, output);
      }
    }
    function collectTasks(tasks: unknown[]) {
      collectTasksInto(tasks, allTasks);
    }
    for (const cat of categories) {
      if (!isRecord(cat)) continue;
      for (const child of asArray(cat.children)) {
        if (!isRecord(child)) continue;
        collectTasks(asArray(child.tasks));
      }
    }

    // Category progress — one entry per top-level category, including subtasks.
    const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#06b6d4'];
    let colorIdx = 0;
    const categoryProgress = categories.filter(isRecord).map((cat) => {
      const catTasks: JsonRecord[] = [];
      for (const child of asArray(cat.children)) {
        if (!isRecord(child)) continue;
        collectTasksInto(asArray(child.tasks), catTasks);
      }
      const visibleTasks = catTasks.filter((t) => !isArchivedTask(t));
      const total = visibleTasks.length;
      return {
        id: String(cat.id ?? ''),
        label: String(cat.label ?? ''),
        total,
        completed: visibleTasks.filter((t) => t.status === 'completed').length,
        in_progress: visibleTasks.filter((t) => t.status === 'in_progress').length,
        blocked: visibleTasks.filter((t) => t.status === 'paused_blocked').length,
        color: COLORS[colorIdx++ % COLORS.length],
      };
    });

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

  async getTaskProgressNotes(taskId: string, viewer?: { userId?: string; hasFullAccess?: boolean }) {
    const map = await this.getProgressNoteMap();
    const notes = map[taskId] ?? [];
    if (viewer?.hasFullAccess) return notes;
    // Non-managers can only see notes they themselves authored
    const userId = viewer?.userId;
    if (!userId) return [];
    return notes.filter((note) => {
      const actor = isRecord(note.actor) ? note.actor : null;
      return Boolean(actor && actor.id === userId);
    });
  }

  async listAllTaskProgressNotes(viewer?: { userId?: string; hasFullAccess?: boolean }) {
    const map = await this.getProgressNoteMap();
    if (viewer?.hasFullAccess) return map;
    const userId = viewer?.userId;
    if (!userId) return {};
    const filtered: Record<string, JsonRecord[]> = {};
    for (const [taskId, notes] of Object.entries(map)) {
      const own = notes.filter((note) => {
        const actor = isRecord(note.actor) ? note.actor : null;
        return Boolean(actor && actor.id === userId);
      });
      if (own.length > 0) filtered[taskId] = own;
    }
    return filtered;
  }

  async createTaskProgressNote(payload: {
    taskId: string;
    text: string;
    progress?: number;
    actor?: { id?: string; name?: string; role?: string };
    files: Array<{ originalname: string; mimetype?: string; size?: number; buffer: Buffer }>;
  }) {
    const taskId = (payload.taskId ?? '').trim();
    if (!taskId) throw new BadRequestException('taskId 不能为空');

    const text = (payload.text ?? '').trim();
    const files = Array.isArray(payload.files) ? payload.files : [];

    if (files.length > 0 && !text) {
      throw new BadRequestException('上传附件时进展说明文本不能为空');
    }
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

    const attachments = await Promise.all(files.map(async (f) => {
      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const objectKey = await this.ossService.uploadBuffer(
        f.buffer,
        'rd/progress-notes',
        f.originalname,
        f.mimetype,
      );
      const ossUrl = objectKey ? this.ossService.getSignedUrl(objectKey, 30 * 24 * 3600) : null;
      return {
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
    }));

    const note = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      task_id: taskId,
      text,
      progress: typeof payload.progress === 'number' ? Math.max(0, Math.min(100, Math.round(payload.progress))) : undefined,
      attachments,
      actor: {
        id: payload.actor?.id ?? null,
        name: payload.actor?.name ?? '我',
        role: payload.actor?.role ?? '研发成员',
      },
      created_at: new Date().toISOString(),
    };

    const map = await this.getProgressNoteMap();
    const existing = Array.isArray(map[taskId]) ? map[taskId] : [];
    map[taskId] = [note, ...existing].slice(0, 100);
    await this.writeValue('rd.taskProgressNotes', map);
    await this.incrementTaskAttachmentCount(taskId, attachments.length);

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

    return note;
  }

  private async incrementTaskAttachmentCount(taskId: string, delta: number): Promise<void> {
    if (!taskId || delta <= 0) return;
    const categories = await this.readNormalizedTaskCategories();
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

    if (!found) return;
    await this.writeValue('rd.taskCategories', updated);
    await this.recomputeDirectorDashboard();
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

  private applyProgressAttachmentCounts(
    categories: JsonRecord[],
    noteMap: Record<string, JsonRecord[]>,
  ): JsonRecord[] {
    const attachmentCounts = new Map<string, number>();
    const latestNotes = new Map<string, JsonRecord>();
    for (const [taskId, notes] of Object.entries(noteMap)) {
      const count = notes.reduce((sum, note) => {
        return sum + (Array.isArray(note.attachments) ? note.attachments.length : 0);
      }, 0);
      attachmentCounts.set(taskId, count);
      const latest = notes
        .slice()
        .sort((a, b) => cleanText(b.created_at).localeCompare(cleanText(a.created_at)))[0];
      if (latest) latestNotes.set(taskId, latest);
    }

    const updateTasks = (tasks: unknown[]): unknown[] =>
      tasks.map((task) => {
        if (!isRecord(task)) return task;
        const progressAttachmentCount = attachmentCounts.get(String(task.task_id ?? '')) ?? 0;
        const existing = typeof task.attachments === 'number' ? task.attachments : 0;
        const latestProgressSummary = this.normalizeLatestProgressSummary(latestNotes.get(String(task.task_id ?? '')));
        const { latest_progress_summary: _latestProgressSummary, ...taskWithoutLatestSummary } = task;
        return {
          ...taskWithoutLatestSummary,
          attachments: Math.max(existing, progressAttachmentCount),
          ...(latestProgressSummary ? { latest_progress_summary: latestProgressSummary } : {}),
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

  async createDailyReport(payload: {
    user_id?: string | null;
    user_name?: string | null;
    date?: string;
    trigger?: 'manual' | 'cron';
  }) {
    const date = payload.date && /^\d{4}-\d{2}-\d{2}$/.test(payload.date) ? payload.date : todayDateString();
    const userId = (payload.user_id ?? '').trim() || null;
    const userName = (payload.user_name ?? '').trim() || '我';

    // Collect today's activity for this user from progress notes + task changes
    const summary = await this.buildDailyReportSummary(userId, userName, date);
    const report = {
      id: `rep-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      user_id: userId,
      user_name: userName,
      date,
      trigger: payload.trigger ?? 'manual',
      summary,
      created_at: new Date().toISOString(),
    };

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
  async generateDailyReportsForAll(date?: string) {
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

    const results: JsonRecord[] = [];
    for (const userId of activeUserIds) {
      try {
        const report = await this.createDailyReport({
          user_id: userId,
          user_name: activeUserNames.get(userId),
          date: targetDate,
          trigger: 'cron',
        });
        results.push(report);
      } catch (err) {
        // Skip individual failures; logged but don't break the loop
        // eslint-disable-next-line no-console
        console.error(`[generateDailyReportsForAll] user=${userId}`, err);
      }
    }
    return { date: targetDate, count: results.length };
  }

  private async buildDailyReportSummary(userId: string | null, userName: string, date: string) {
    // 1. Tasks assigned to this user
    const categories = await this.readArray('rd.taskCategories');
    const allTasks = this.collectAllCategoryTasks(categories);
    const myTasks = allTasks.filter((task) => {
      const owner = String(task.primary_owner ?? task.owner ?? '').trim();
      const ownerUserId = typeof task.primary_owner_user_id === 'string' ? task.primary_owner_user_id : '';
      if (userId && ownerUserId === userId) return true;
      return owner === userName;
    });

    // 2. Progress notes authored today by this user
    const noteMap = await this.getProgressNoteMap();
    const todayNotes: JsonRecord[] = [];
    for (const notes of Object.values(noteMap)) {
      for (const note of notes) {
        if (typeof note.created_at !== 'string' || !note.created_at.startsWith(date)) continue;
        const actor = isRecord(note.actor) ? note.actor : null;
        const matchById = userId && actor && actor.id === userId;
        const matchByName = !userId && actor && actor.name === userName;
        if (matchById || matchByName) todayNotes.push(note);
      }
    }

    // 3. Status breakdown
    const inProgress = myTasks.filter((t) => t.status === 'in_progress').length;
    const completed = myTasks.filter((t) => t.status === 'completed').length;
    const blocked = myTasks.filter((t) => t.status === 'paused_blocked').length;
    const pending = myTasks.filter((t) => t.status === 'pending_assign' || t.status === 'pending_review').length;

    // 4. 优先调用 AI 模型生成日报正文；失败/未配置时回退到本地拼接版本。
    const stats = {
      total_tasks: myTasks.length,
      in_progress: inProgress,
      completed,
      blocked,
      pending,
      notes_count: todayNotes.length,
    };

    const sortedNotes = todayNotes
      .slice()
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

    const noteSummaries = sortedNotes.map((note) => ({
      taskTitle: this.lookupTaskTitle(allTasks, String(note.task_id ?? '')) || undefined,
      progress: typeof note.progress === 'number' ? note.progress : null,
      excerpt: String(note.text ?? '').trim().slice(0, 200),
      attachmentsCount: Array.isArray(note.attachments) ? note.attachments.length : 0,
    }));

    let summaryText: string;
    const aiResult = await this.rdAiService.summarizeDailyReport({
      userName,
      date,
      stats: {
        totalTasks: stats.total_tasks,
        inProgress,
        completed,
        blocked,
        pending,
        notesCount: stats.notes_count,
      },
      notes: noteSummaries,
    });

    if (aiResult) {
      summaryText = `【${userName} · ${date} 工作日报】\n\n${aiResult.text}`;
    } else {
      // 本地兜底：AI 未配置 / 调用失败时拼出可读文本
      const lines: string[] = [];
      lines.push(`【${userName} · ${date} 工作日报】`);
      lines.push('');
      lines.push(`📊 任务概况：共 ${myTasks.length} 个任务（进行中 ${inProgress} · 已完成 ${completed} · 阻塞 ${blocked} · 待办 ${pending}）`);
      lines.push('');
      if (sortedNotes.length > 0) {
        lines.push(`✍️ 今日提交了 ${sortedNotes.length} 条进度记录：`);
        for (const note of sortedNotes) {
          const text = String(note.text ?? '').trim().slice(0, 200);
          const progress = typeof note.progress === 'number' ? `${note.progress}%` : '—';
          const titleHint = this.lookupTaskTitle(allTasks, String(note.task_id ?? ''));
          const att = Array.isArray(note.attachments) ? note.attachments.length : 0;
          lines.push(`  • ${titleHint ? `《${titleHint}》` : note.task_id}（进度 ${progress}${att > 0 ? ` · ${att} 个附件` : ''}）`);
          if (text) lines.push(`    ${text}`);
        }
      } else {
        lines.push('✍️ 今日未提交进度记录。');
      }
      lines.push('');
      if (blocked > 0 && sortedNotes.length === 0) {
        lines.push(`⚠️ 注意：当前有 ${blocked} 个任务处于阻塞状态，且今日未提交任何进度记录，请关注推进情况。`);
      } else if (blocked > 0) {
        lines.push(`⚠️ 注意：当前有 ${blocked} 个任务处于阻塞状态，需要支援。`);
      } else if (completed > 0 && sortedNotes.length > 0) {
        lines.push(`✅ 今日推进顺利，已完成 ${completed} 个任务，并提交了进度记录。`);
      } else if (completed > 0) {
        lines.push(`✅ 已完成 ${completed} 个任务，但今日未提交进度记录，建议补充说明。`);
      } else if (inProgress > 0 && sortedNotes.length === 0) {
        lines.push(`🔔 今日有 ${inProgress} 个任务进行中，但未提交任何进度记录，请及时更新进展。`);
      } else if (inProgress > 0) {
        lines.push('🟦 今日推进正常，请保持节奏。');
      } else if (pending > 0) {
        lines.push(`📋 当前有 ${pending} 个任务待处理，尚未开始执行，请关注任务启动情况。`);
      } else {
        lines.push('📭 当前暂无任务，请确认任务分配情况。');
      }
      summaryText = lines.join('\n');
    }

    return {
      text: summaryText,
      stats,
      note_refs: sortedNotes.map((note) => ({
        note_id: String(note.id ?? ''),
        task_id: String(note.task_id ?? ''),
        progress: typeof note.progress === 'number' ? note.progress : null,
        excerpt: String(note.text ?? '').slice(0, 100),
        attachments_count: Array.isArray(note.attachments) ? note.attachments.length : 0,
      })),
    };
  }

  private lookupTaskTitle(tasks: JsonRecord[], taskId: string): string {
    if (!taskId) return '';
    const found = tasks.find((t) => t.task_id === taskId);
    return found ? String(found.title ?? '') : '';
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

  private toWorkspaceTask(task: JsonRecord, role: 'primary' | 'collaborator', collabRole?: string) {
    const dueDate = cleanText(task.due_date);
    return {
      task_id: cleanText(task.task_id),
      title: cleanText(task.title) || '未命名任务',
      priority: normalizePriority(task.final_priority ?? task.ai_priority),
      progress: typeof task.progress === 'number' ? task.progress : 0,
      due_date: dueDate,
      status: cleanText(task.status) || 'in_progress',
      status_label: this.taskStatusLabel(task.status),
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
      collab_role: collabRole,
      on_leave: task.status === 'paused_leave',
      ai_pending: task.ai_modified === true,
      latest_progress_summary: this.normalizeLatestProgressSummary(task.latest_progress_summary),
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
      this.readNormalizedTaskCategories(),
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
    const activeTasks = this.collectAllCategoryTasks(categories).filter(
      (task) => !isArchivedTask(task) && !isCompletedTask(task),
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

    const myTasks = activeTasks
      .filter(isPrimary)
      .map((task) => this.toWorkspaceTask(task, 'primary'));
    const collabTasks = activeTasks
      .map((task) => ({ task, role: collaboratorRole(task) }))
      .filter((item) => item.role && !isPrimary(item.task))
      .map((item) => this.toWorkspaceTask(item.task, 'collaborator', item.role));
    const dueTasks = [...myTasks, ...collabTasks]
      .filter((task) => task.due_date)
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
        const reviewLabel = reviewType === 'collaboration' ? '协作变更' : '结果';
        defaultTitle = `系统通知：【待审核】「${taskTitle}」申请${reviewLabel}审核`;
        displayMessage = `${submitterName} 提交了任务「${taskTitle}」的${reviewLabel}审核，请处理。`;
      } else if (msgType === 'review_result') {
        const result = String(parsedBody!['result'] ?? '');
        const reviewerName = String(parsedBody!['reviewer_name'] ?? '管理员');
        const reviewType = String(parsedBody!['review_type'] ?? 'result');
        const isApproved = result === 'approved';
        const isCollaboration = reviewType === 'collaboration';
        defaultTitle = isCollaboration
          ? `协作审核：「${taskTitle}」${isApproved ? '已通过' : '被打回'}`
          : `审核结果：「${taskTitle}」${isApproved ? '已通过审核 ✓' : '被打回，需修改'}`;
        const reason = String(parsedBody!['reason'] ?? '');
        if (isCollaboration) {
          displayMessage = isApproved
            ? `${reviewerName} 已批准任务「${taskTitle}」的协作申请，协作人已生效。`
            : `${reviewerName} 打回了任务「${taskTitle}」的协作申请。${reason ? `原因：${reason}` : ''}`;
        } else {
          displayMessage = isApproved
            ? `${reviewerName} 已批准任务「${taskTitle}」，任务已完成。`
            : `${reviewerName} 打回了任务「${taskTitle}」，请修改后重新提交。${reason ? `原因：${reason}` : ''}`;
        }
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
    const rawCategories = await this.readArray('rd.taskCategories');
    const categories = ensurePocBomTaskCategories(rawCategories);
    let changed = false;

    const rewriteTask = (task: JsonRecord): JsonRecord => {
      let next: JsonRecord = { ...task };

      if (this.assignmentMatchesPerson(task, before)) {
        changed = true;
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
          changed = true;
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
        subtasks: asArray(task.subtasks).filter(isRecord).map(rewriteTask),
      };
    };

    const updated = categories.map((category) => ({
      ...category,
      children: asArray(category.children).filter(isRecord).map((child) => ({
        ...child,
        tasks: asArray(child.tasks).filter(isRecord).map(rewriteTask),
      })),
    }));

    if (changed || JSON.stringify(rawCategories) !== JSON.stringify(updated)) {
      await this.writeValue('rd.taskCategories', updated);
    }
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
    const nextPeople = people.map((item) => {
      if (!isRecord(item) || item.id !== id) return item;
      found = true;
      beforePerson = item;
      const normalizedPerson = this.normalizePeopleRecords([{ ...item, ...payload, id }], users)[0];
      if (!normalizedPerson) return item;
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

  private async readKnowledgeCategoryRecords(): Promise<JsonRecord[]> {
    const raw = await this.readValue('rd.knowledgeCategories');
    const source = Array.isArray(raw) && raw.length > 0 ? raw : DEFAULT_KB_CATEGORIES;
    return this.normalizeKnowledgeCategories(this.cloneKnowledgeCategories(source));
  }

  private async readActiveKnowledgeEntryRecords(): Promise<JsonRecord[]> {
    const raw = await this.readValue('rd.knowledgeEntries');
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
  ): Promise<string> {
    const categories = await this.readKnowledgeCategoryRecords();
    const ids = this.collectKnowledgeCategoryIds(categories);
    const id = cleanText(categoryId);
    if (id && ids.has(id)) return id;
    if (options?.fallbackToOther && ids.has('kb-other')) return 'kb-other';
    throw new BadRequestException('知识库类目不存在');
  }

  async getKnowledgeCategories() {
    const categories = await this.readKnowledgeCategoryRecords();
    const entries = await this.readActiveKnowledgeEntryRecords();
    return this.attachKnowledgeCategoryCounts(categories, entries);
  }

  async saveKnowledgeCategories(categories: unknown[]) {
    const normalized = this.normalizeKnowledgeCategories(categories);
    await this.writeValue('rd.knowledgeCategories', this.stripKnowledgeCategoryComputedFields(normalized));
    const entries = await this.readActiveKnowledgeEntryRecords();
    return { ok: true, categories: this.attachKnowledgeCategoryCounts(normalized, entries) };
  }

  async createKnowledgeCategory(payload: { label?: unknown; parent_id?: unknown; icon?: unknown; color?: unknown }) {
    const label = cleanText(payload.label);
    if (!label) throw new BadRequestException('类目名称不能为空');
    if (label.length > 40) throw new BadRequestException('类目名称不能超过 40 个字符');

    const categories = await this.readKnowledgeCategoryRecords();
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
    await this.writeValue('rd.knowledgeCategories', this.stripKnowledgeCategoryComputedFields(categories));
    const entries = await this.readActiveKnowledgeEntryRecords();
    return { ok: true, category, categories: this.attachKnowledgeCategoryCounts(categories, entries) };
  }

  async updateKnowledgeCategory(
    id: string,
    payload: { label?: unknown; icon?: unknown; color?: unknown },
  ) {
    const categoryId = cleanText(id);
    const categories = await this.readKnowledgeCategoryRecords();
    const found = this.findKnowledgeCategory(categories, categoryId);
    if (!found) throw new NotFoundException('知识库类目不存在');

    const entries = await this.readActiveKnowledgeEntryRecords();
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

    await this.writeValue('rd.knowledgeCategories', this.stripKnowledgeCategoryComputedFields(categories));
    return { ok: true, category: found.category, categories: this.attachKnowledgeCategoryCounts(categories, entries) };
  }

  async deleteKnowledgeCategory(id: string) {
    const categoryId = cleanText(id);
    if (categoryId === 'kb-other') {
      throw new BadRequestException('默认“其他”类目不能删除');
    }

    const categories = await this.readKnowledgeCategoryRecords();
    const found = this.findKnowledgeCategory(categories, categoryId);
    if (!found) throw new NotFoundException('知识库类目不存在');

    const entries = await this.readActiveKnowledgeEntryRecords();
    if (this.categoryHasActiveEntries(found.category, entries)) {
      throw new BadRequestException('类目下存在文件，无法删除；请先将文件移动到其他类目');
    }

    const index = found.siblings.findIndex((category) => cleanText(category.id) === categoryId);
    if (index >= 0) found.siblings.splice(index, 1);
    await this.writeValue('rd.knowledgeCategories', this.stripKnowledgeCategoryComputedFields(categories));
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

  async getKnowledgeEntries(
    filter?: {
      categoryId?: string;
      keyword?: string;
      source?: string;
      fileType?: string;
      visibility?: string;
      permissionLevel?: number;
    },
    viewer?: { userId?: string; hasFullAccess?: boolean },
  ) {
    const raw = await this.readValue('rd.knowledgeEntries');
    let entries: JsonRecord[] = Array.isArray(raw) ? (raw as JsonRecord[]) : [];
    // Always carry normalised permission_level
    entries = entries.map(ResearchDevelopmentService.normalizeKbEntry);
    entries = entries.filter(e => !e.archived);

    // ── Viewer-level access control ──────────────────────────────────────
    if (viewer && !viewer.hasFullAccess) {
      // Find the person linked to this viewer to get their kb_level
      const rawPeople = await this.readArray('rd.people');
      const personRecord = rawPeople.filter(isRecord).find(p => p.user_id === viewer.userId);
      const viewerLevel: number = isRecord(personRecord)
        ? cleanText(personRecord.kb_level_scale) === 'score'
          ? ResearchDevelopmentService.clampLevel(personRecord.kb_level)
          : ResearchDevelopmentService.legacyKbLevelToScore(personRecord.kb_level)
        : 0;
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
      }));
  }

  /** Return a single KB entry including its data_url (used for download). */
  async getKnowledgeEntryById(id: string): Promise<JsonRecord | null> {
    const raw = await this.readValue('rd.knowledgeEntries');
    const entries: JsonRecord[] = Array.isArray(raw) ? (raw as JsonRecord[]) : [];
    return entries.find((e) => e.id === id) ?? null;
  }

  async classifyKbFiles(filenames: string[]) {
    const categories = await this.getKnowledgeCategories() as Array<{
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
  }) {
    const raw = await this.readValue('rd.knowledgeEntries');
    const entries: JsonRecord[] = Array.isArray(raw) ? (raw as JsonRecord[]) : [];
    const now = new Date().toISOString();
    const categoryId = await this.resolveKnowledgeCategoryId(payload.category_id, { fallbackToOther: true });
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
    await this.writeValue('rd.knowledgeEntries', entries.slice(0, 2000));
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
  }>) {
    const raw = await this.readValue('rd.knowledgeEntries');
    const entries: JsonRecord[] = Array.isArray(raw) ? (raw as JsonRecord[]) : [];
    const categoryId = payload.category_id !== undefined
      ? await this.resolveKnowledgeCategoryId(payload.category_id)
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
    await this.writeValue('rd.knowledgeEntries', updated);
    return updated.find(e => e.id === id);
  }

  async moveKnowledgeEntry(id: string, categoryId: string) {
    return this.updateKnowledgeEntry(id, { category_id: categoryId });
  }

  async deleteKnowledgeEntry(id: string) {
    const raw = await this.readValue('rd.knowledgeEntries');
    const entries: JsonRecord[] = Array.isArray(raw) ? (raw as JsonRecord[]) : [];
    const updated = entries.map(e => e.id === id ? { ...e, archived: true, updated_at: new Date().toISOString() } : e);
    await this.writeValue('rd.knowledgeEntries', updated);
    return { ok: true };
  }

  async incrementKbEntryViewCount(id: string) {
    const raw = await this.readValue('rd.knowledgeEntries');
    const entries: JsonRecord[] = Array.isArray(raw) ? (raw as JsonRecord[]) : [];
    const updated = entries.map(e => e.id === id ? { ...e, view_count: (Number(e.view_count) || 0) + 1 } : e);
    await this.writeValue('rd.knowledgeEntries', updated);
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

  private async readArray(key: RdStoreKey) {
    return asArray(await this.readValue(key));
  }

  private async readValue(key: RdStoreKey) {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key },
      select: { value: true },
    });
    return setting?.value ?? null;
  }

  private async writeValue(key: RdStoreKey, value: unknown) {
    const setting = await this.prisma.systemSetting.upsert({
      where: { key },
      create: {
        category: CATEGORY,
        key,
        value: value as any,
        description: `R&D module data store: ${key}`,
      },
      update: {
        category: CATEGORY,
        value: value as any,
      },
    });
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
