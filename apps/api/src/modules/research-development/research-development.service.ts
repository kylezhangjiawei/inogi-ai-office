import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { OcrService } from '../ocr/ocr.service';

type JsonRecord = Record<string, unknown>;
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
  | 'rd.aiSettings';

const CATEGORY = 'research-development';
const MAX_AUDIT_LOGS = 1000;

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
      id: 'task_breakdown',
      name: '任务拆解',
      description: '把需求拆成子任务、协作人、交付物和里程碑',
      enabled: true,
      model_id: '',
      fallback_model_id: '',
      prompt_version: 'rd-task-breakdown-v1',
      confidence_threshold: 0.8,
      require_human_review: true,
      show_to_user: true,
    },
    {
      id: 'priority_duration',
      name: '优先级与工期建议',
      description: '评估优先级、预计工期和延期风险',
      enabled: true,
      model_id: '',
      fallback_model_id: '',
      prompt_version: 'rd-priority-duration-v1',
      confidence_threshold: 0.78,
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
      id: 'risk_detection',
      name: '风险识别',
      description: '识别阻塞、延期、缺失资料和跨部门依赖',
      enabled: true,
      model_id: '',
      fallback_model_id: '',
      prompt_version: 'rd-risk-detection-v1',
      confidence_threshold: 0.8,
      require_human_review: true,
      show_to_user: true,
    },
    {
      id: 'audit_summary',
      name: '留痕摘要',
      description: '为关键操作生成可审计的摘要和变更说明',
      enabled: true,
      model_id: '',
      fallback_model_id: '',
      prompt_version: 'rd-audit-summary-v1',
      confidence_threshold: 0.8,
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

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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

@Injectable()
export class ResearchDevelopmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ocrService: OcrService,
  ) {}

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
    return this.readArray('rd.taskCategories');
  }

  async saveTaskCategories(payload: unknown[]) {
    return this.writeValue('rd.taskCategories', asArray(payload));
  }

  async getWorkspace() {
    const value = await this.readValue('rd.workspace');
    return {
      ...EMPTY_WORKSPACE,
      ...asRecord(value, EMPTY_WORKSPACE),
    };
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

  async getPeople() {
    return this.readArray('rd.people');
  }

  async createPerson(payload: JsonRecord) {
    const people = await this.getPeople();
    const nextPerson = withGeneratedId('rd-person', payload);
    const nextPeople = [nextPerson, ...people.filter((item) => !isRecord(item) || item.id !== nextPerson.id)];
    await this.writeValue('rd.people', nextPeople);
    return nextPerson;
  }

  async updatePerson(id: string, payload: JsonRecord) {
    const people = await this.getPeople();
    let found = false;
    const nextPeople = people.map((item) => {
      if (!isRecord(item) || item.id !== id) return item;
      found = true;
      return { ...item, ...payload, id };
    });

    if (!found) {
      throw new NotFoundException('研发成员不存在');
    }

    await this.writeValue('rd.people', nextPeople);
    return nextPeople.find((item) => isRecord(item) && item.id === id);
  }

  async removePerson(id: string) {
    const people = await this.getPeople();
    const nextPeople = people.filter((item) => !isRecord(item) || item.id !== id);
    await this.writeValue('rd.people', nextPeople);
    return { ok: true };
  }

  async getApprovalFlows() {
    return this.readArray('rd.approvalFlows');
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
      timestamp:
        typeof payload.timestamp === 'string' && payload.timestamp
          ? payload.timestamp
          : new Date().toISOString(),
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
          ready: this.ocrService.hasTencentConfig(),
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

    return configs.map((config) => {
      const metadata = asRecord(config.metadata, {});
      return {
        id: config.id,
        name: config.name,
        provider: config.provider ?? 'OpenAI',
        model: config.model ?? '',
        enabled: config.isActive,
        is_default_enabled: metadata.is_default_enabled === true,
      };
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
