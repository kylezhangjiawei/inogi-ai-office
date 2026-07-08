import { BadGatewayException, BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { toFile } from 'openai';

import { PrismaService } from '../../prisma/prisma.service';
import { OcrService } from '../ocr/ocr.service';
import { SecureConfigService } from '../security/secure-config.service';
import { resolveRdStoreKey } from './rd-workspace.context';

const TASK_EXTRACTION_SCHEMA_DESC =
  '{"tasks": [{"title": string, "description"?: string, "owner": string, "due_date": string YYYY-MM-DD, ' +
  '"due_date_original"?: string（原文时间节点的原始短语，例如"今明完成"、"周三"、"会后同步"、"到货当日"；如果原文没写时间则省略）, ' +
  '"priority": "high"|"medium"|"low", "category_path": string, ' +
  '"estimated_days": integer（必填，根据任务复杂度估算，不确定时填5，禁止全部填1）, ' +
  '"owner_reason": string}], "suggested_category"?: string, "suggested_product"?: string, "summary"?: string}';

const QWEN_DOC_MODEL = 'qwen-doc-turbo';
/** qwen-doc-turbo 的 max_tokens 硬上限，超过会被 DashScope 以 400 拒绝（Range of max_tokens should be [1, 32768]） */
const QWEN_DOC_MODEL_MAX_TOKENS = 32_768;
const DEFAULT_QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DEFAULT_TEXT_MODEL = 'gpt-4.1-mini';

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tif', 'tiff']);
const PLAIN_TEXT_EXT = new Set(['txt', 'md', 'csv', 'tsv', 'json', 'xml', 'log']);
const DOC_EXT = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']);

const RD_POC_BOM_CATEGORY_TREE = [
  { label: '电源部分', parts: ['电池', '电池PCB'] },
  { label: '底部结构', parts: ['底座', '底座减震器', '底座进气隔板', '底座过滤棉'] },
  { label: '压缩系统', parts: ['压缩机', '压缩机罩'] },
  { label: '310阀系统', parts: ['310阀组', '310电磁阀'] },
  { label: '风冷系统', parts: ['电风扇'] },
  { label: '储气系统', parts: ['储气罐', '储气罐进气隔板'] },
  { label: '210阀系统', parts: ['210阀组', '210电磁阀'] },
  { label: 'Top结构', parts: ['Top板', '成孔螺丝', '显示屏'] },
  { label: '分子筛系统', parts: ['分子筛转接板', '分子筛', '分子筛衬板', '分子筛隔板', '分子筛筛料', '分子筛弹簧', '分子筛上密封圈', '分子筛下密封圈'] },
  { label: '外观结构', parts: ['外罩', '隔热贴'] },
  { label: '配件系统', parts: ['车充', '快充', '普充'] },
  { label: '气管系统', parts: ['硅胶管', '接头', '卡箍'], reserved: true },
  { label: '线束系统', parts: ['主线束', '电池线', '风扇线', '屏线'], reserved: true },
  { label: '紧固件系统', parts: ['螺丝', '铜柱', '螺母'], reserved: true },
  { label: '密封系统', parts: ['O-ring', '泡棉', '密封胶'], reserved: true },
] as const;

export type RdAiUploadedFile = {
  originalname: string;
  buffer: Buffer;
  mimetype?: string;
};

export type RdAiProductOption = { id: string; name: string };

export type RdAiExtractInput = {
  text?: string;
  file?: RdAiUploadedFile;
  peopleNames?: string[];
  peopleProfiles?: RdAiPersonContext[];
  categoryLabels?: string[];
  proposalTitle?: string;
  products?: RdAiProductOption[];
};

export type RdAiPersonContext = {
  id?: string;
  name: string;
  position?: string;
  department?: string;
  task_count?: number;
  max_tasks?: number;
  on_leave?: boolean;
  blocked_count?: number;
  avg_completion?: number;
  completed_this_month?: number;
  tasks?: string[];
};

export type RdAiTaskDraft = {
  title: string;
  description?: string;
  owner: string;
  owner_reason: string;
  due_date: string;
  /** 原文中的时间节点短语（如 "今明"、"周三"、"会后同步"）。仅用于前端 review 时展示原始上下文，不存数据库。 */
  due_date_original?: string;
  priority: 'high' | 'medium' | 'low';
  category_path: string;
  estimated_days: number;
};

export type RdAiProposalRefineScope = 'all' | 'selected' | 'single';

export type RdAiProposalTaskInput = RdAiTaskDraft & {
  id?: string;
  ai_estimated_days?: number;
  duration_basis?: string;
};

export type RdAiProposalRefineInput = {
  proposalTitle?: string;
  originalInput?: string;
  currentTasks?: RdAiProposalTaskInput[];
  instruction: string;
  peopleNames?: string[];
  peopleProfiles?: RdAiPersonContext[];
  categoryLabels?: string[];
  scope?: RdAiProposalRefineScope;
  selectedTaskIds?: string[];
};

export type RdAiProposalRefineResult = {
  tasks: RdAiProposalTaskInput[];
  change_summary: string[];
  warnings: string[];
  provider: 'openai' | 'qwen' | 'local';
  model: string;
};

export type RdAiExtractResult = {
  tasks: RdAiTaskDraft[];
  suggested_category?: string;
  suggested_product?: string;
  summary?: string;
  provider: 'openai' | 'qwen' | 'local';
  model: string;
  raw_text_length: number;
  source: 'text' | 'file_text' | 'file_ocr' | 'file_doc_model';
};

type RdAiProgressAssessmentResult = {
  progress: number;
  stage: string;
  confidence: number;
  basis: string[];
  recommendation: string;
  provider: 'openai' | 'qwen' | 'local';
  model: string;
  source: 'text' | 'file_text' | 'file_ocr' | 'file_doc_model';
  raw_text_length: number;
  /** AI 判断本次进展归属的工作项 id（任务传入 work_items 时才有；null = 不属于任何工作项/无法判断）。仅作前端预选建议，人工可改。 */
  work_item_id?: string | null;
};

/** 任务的工作项清单（AI 归属判断用）：id + 标题 + 完成态 */
type RdAiWorkItemRef = { id: string; title: string; done?: boolean };

export type RdTaskCompletionScoreDimensionKey =
  | 'timeliness'
  | 'process'
  | 'evidence'
  | 'collaboration';

export type RdTaskCompletionScoreDimension = {
  key: RdTaskCompletionScoreDimensionKey;
  label: string;
  score: number;
  max: number;
  comment: string;
};

export type RdTaskCompletionScoreResult = {
  total: number;
  grade: 'A' | 'B' | 'C' | 'D';
  grade_label: string;
  summary: string;
  dimensions: RdTaskCompletionScoreDimension[];
  highlights: string[];
  improvements: string[];
  provider: 'openai' | 'qwen' | 'local';
  model: string;
  computed_at: string;
  fallback_reason?: string;
  /** 仅超管可见的调试信息（含发给 AI 的原始 prompt 和 AI 原始响应）。前端展示前需做权限校验。 */
  _debug?: {
    system_prompt: string;
    user_message: string;
    raw_response: string;
    request_started_at: string;
    request_finished_at: string;
    duration_ms: number;
  };
};

export type RdTaskCompletionScoreInput = {
  task: {
    task_id: string;
    title: string;
    description?: string;
    category_path?: string;
    primary_owner?: string;
    collaborators?: Array<{ name?: string; role?: string }>;
    final_priority?: string;
    start_date?: string;
    due_date?: string;
    updated_at?: string;
    attachments?: number;
  };
  notes: Array<{
    text?: string;
    progress?: number;
    created_at?: string;
    actor?: { name?: string; role?: string };
    attachments?: Array<{
      name?: string;
      mime?: string;
      size?: number;
      /** L1+L2+L3 抽取出的附件文本（OCR/文档抽取/视觉模型），用于让 AI 评分时"看到"附件内容 */
      extracted_text?: string;
      extracted_source?: string;
    }>;
  }>;
  auditLogs: Array<{
    timestamp?: string;
    action?: string;
    comment?: string;
    actor?: { name?: string };
  }>;
  /** L4：RAG 召回的相似任务/知识库参考资料，用于评分基准锚定 */
  ragContext?: Array<{
    source: string;
    title?: string;
    content: string;
    similarity?: number;
  }>;
};

type AiProvider = 'openai' | 'qwen';

type AiModelRuntimeConfig = {
  provider: AiProvider;
  model: string;
  apiKey: string;
  baseUrl?: string;
};

type RdAiFilePolicyRuntime = {
  ocr_provider: string;
  ocr_service_key: string;
  ocr_confidence_threshold: number;
  low_confidence_action: string;
  allow_vision_fallback: boolean;
  save_original_text: boolean;
  save_ocr_text: boolean;
  save_ai_result: boolean;
  require_confirmation_before_write: boolean;
};

const DEFAULT_FILE_POLICY_RUNTIME: RdAiFilePolicyRuntime = {
  ocr_provider: 'tencent_ocr',
  ocr_service_key: 'accurate_text',
  ocr_confidence_threshold: 0.85,
  low_confidence_action: 'manual_review',
  allow_vision_fallback: false,
  save_original_text: true,
  save_ocr_text: true,
  save_ai_result: true,
  require_confirmation_before_write: true,
};

@Injectable()
export class RdAiService {
  private readonly logger = new Logger(RdAiService.name);
  /** 通用 AI 调用超时（短问答、进度判断等） */
  private readonly timeoutMs: number;
  /** 立项/提取专用超时 — 需要处理大段文本或文档，允许更长时间 */
  private readonly extractTimeoutMs: number;
  /** 任务抽取输出通常是长 JSON，4096 容易被截断。 */
  private readonly extractMaxTokens: number;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly ocrService: OcrService,
    private readonly secureConfigService: SecureConfigService,
  ) {
    this.timeoutMs = Number(this.config.get('OPENAI_TIMEOUT_MS') ?? 120_000);
    // 立项提取场景允许更长等待，可通过 RD_EXTRACT_TIMEOUT_MS 覆盖，默认 5 分钟
    this.extractTimeoutMs = Number(this.config.get('RD_EXTRACT_TIMEOUT_MS') ?? 300_000);
    // 空串/非数字/非正数（如误配 RD_EXTRACT_MAX_TOKENS=）一律回退默认值，避免把 0/NaN 透传给上游
    const configuredMaxTokens = Number(this.config.get('RD_EXTRACT_MAX_TOKENS') ?? 12_000);
    this.extractMaxTokens = Number.isFinite(configuredMaxTokens) && configuredMaxTokens >= 1 ? configuredMaxTokens : 12_000;
  }

  /**
   * Main entry — accepts either a text body or a file upload, returns AI-extracted tasks.
   */
  async extract(input: RdAiExtractInput): Promise<RdAiExtractResult> {
    if (!input.text?.trim() && !input.file) {
      throw new BadRequestException('text 或 file 至少需要提供一项');
    }

    const filePolicy = await this.readFilePolicyRuntime();

    // Route by input type
    if (input.file) {
      const ext = this.extOf(input.file.originalname);

      if (IMAGE_EXT.has(ext)) {
        return this.extractViaOcr(input.file, input, filePolicy);
      }
      if (PLAIN_TEXT_EXT.has(ext)) {
        const text = this.safeUtf8(input.file.buffer);
        return this.extractFromText(text, input, 'file_text', filePolicy);
      }
      if (DOC_EXT.has(ext)) {
        return this.extractViaDocModel(input.file, input, filePolicy);
      }
      // Unknown ext — try as text
      const text = this.safeUtf8(input.file.buffer);
      return this.extractFromText(text, input, 'file_text', filePolicy);
    }

    return this.extractFromText(input.text ?? '', input, 'text', filePolicy);
  }

  async refineProposal(input: RdAiProposalRefineInput): Promise<RdAiProposalRefineResult> {
    const instruction = input.instruction?.trim();
    if (!instruction) {
      throw new BadRequestException('instruction 不能为空');
    }

    const currentTasks = (input.currentTasks ?? [])
      .map((task, index) => this.normalizeProposalTaskInput(task, input, index))
      .filter((task): task is RdAiProposalTaskInput => Boolean(task.title));

    if (currentTasks.length === 0) {
      throw new BadRequestException('currentTasks 至少需要包含一个任务');
    }

    const selectedTaskIds = (input.selectedTaskIds ?? []).map((id) => String(id).trim()).filter(Boolean);
    const scope = input.scope ?? (selectedTaskIds.length > 0 ? 'selected' : 'all');
    if ((scope === 'selected' || scope === 'single') && selectedTaskIds.length === 0) {
      throw new BadRequestException('选择单条或部分任务微调时需要提供 selectedTaskIds');
    }

    const selectedModel = await this.resolveSceneModelConfig('text_task_extract').catch(() => null);
    if (!selectedModel) {
      return {
        tasks: currentTasks,
        change_summary: ['AI 模型未配置，已保留当前立项草稿。'],
        warnings: ['请先在 AI 模型管理中配置可用模型，再使用智能微调。'],
        provider: 'local',
        model: 'local-refine-fallback',
      };
    }

    const { provider, model, apiKey, baseUrl } = selectedModel;
    const client = this.createClient(apiKey, provider, baseUrl, this.extractTimeoutMs);

    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await client.chat.completions.create({
        model,
        messages: this.buildProposalRefineMessages({ ...input, instruction, scope, selectedTaskIds }, currentTasks),
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: this.extractMaxTokens,
        ...(provider === 'qwen' ? ({ enable_thinking: false } as Record<string, unknown>) : {}),
      });
    } catch (error) {
      if (this.isExternalAiTimeout(error)) {
        return {
          tasks: currentTasks,
          change_summary: ['AI 微调服务超时，已保留当前立项草稿。'],
          warnings: ['请稍后重试，或缩小微调范围后再提交。'],
          provider: 'local',
          model: 'local-timeout-fallback',
        };
      }
      throw this.toExternalAiException(error, 'AI 立项微调服务调用失败');
    }

    const content = this.stringifyMessageContent(response.choices[0]?.message?.content) || '{}';
    const parsed = this.parseProposalRefinePayload(content, { ...input, instruction, scope, selectedTaskIds }, currentTasks);
    const result: RdAiProposalRefineResult = {
      tasks: parsed.tasks.length > 0 ? parsed.tasks : currentTasks,
      change_summary: parsed.change_summary.length > 0 ? parsed.change_summary : ['已根据微调要求重新整理立项草稿。'],
      warnings: parsed.warnings,
      provider,
      model,
    };

    await this.recordAiArtifact('proposal_refine', 'text', undefined, await this.readFilePolicyRuntime(), {
      original_text: JSON.stringify({
        proposalTitle: input.proposalTitle,
        instruction,
        scope,
        selectedTaskIds,
        currentTasks,
      }).slice(0, 32000),
      ai_result: result,
      model,
      provider,
    });

    return result;
  }

  // ─── Pipeline implementations ─────────────────────────────────────────────

  private async extractFromText(
    text: string,
    input: RdAiExtractInput,
    source: 'text' | 'file_text',
    filePolicy: RdAiFilePolicyRuntime = DEFAULT_FILE_POLICY_RUNTIME,
  ): Promise<RdAiExtractResult> {
    const trimmed = (text || '').trim();
    if (!trimmed) {
      throw new BadRequestException('未能从输入中提取到任何文本内容');
    }
    const truncated = trimmed.slice(0, 32000);
    const sceneId = source === 'text' ? 'text_task_extract' : 'file_task_extract';
    const selectedModel = await this.resolveSceneModelConfig(sceneId);
    if (!selectedModel) {
      const parsed = this.extractWithLocalParser(truncated, input);
      await this.recordAiArtifact('task_extract', source, input.file?.originalname, filePolicy, {
        original_text: truncated,
        ai_result: parsed,
      });
      return {
        ...parsed,
        provider: 'local',
        model: 'local-text-parser',
        raw_text_length: truncated.length,
        source,
      };
    }

    const { provider, model, apiKey, baseUrl } = selectedModel;
    let resultProvider: AiProvider = provider;
    let resultModel = model;
    // 立项提取可能需要处理较长文本，使用专用超时（默认 5 分钟）
    const client = this.createClient(apiKey, provider, baseUrl, this.extractTimeoutMs);
    const messages = this.buildMessages(truncated, input);

    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await client.chat.completions.create({
        model,
        messages,
        response_format: { type: 'json_object' },
        max_tokens: this.extractMaxTokens,
        ...(provider === 'qwen' ? ({ enable_thinking: false } as Record<string, unknown>) : {}),
      });
    } catch (error) {
      if (this.isExternalAiTimeout(error)) {
        const parsed = this.extractWithLocalParser(truncated, input);
        parsed.summary = 'AI 服务调用超时，已使用本地规则解析。';
        await this.recordAiArtifact('task_extract', source, input.file?.originalname, filePolicy, {
          original_text: truncated,
          ai_result: parsed,
          timeout: true,
          model,
          provider,
        });
        return {
          ...parsed,
          provider: 'local',
          model: 'local-timeout-fallback',
          raw_text_length: truncated.length,
          source,
        };
      }
      throw this.toExternalAiException(error, 'AI 立项文本解析服务调用失败');
    }

    const firstChoice = response.choices[0];
    const firstAiContent = this.stringifyMessageContent(firstChoice?.message?.content) || '{}';
    let content = firstAiContent;
    let parsed = this.parseTasksPayload(content, input);
    const emptyRepairMetadata: Record<string, unknown> = {
      first_ai_response: firstAiContent.slice(0, 8000),
      first_ai_finish_reason: firstChoice?.finish_reason ?? null,
      first_ai_usage: response.usage ?? null,
    };

    if (parsed.tasks.length === 0) {
      const sameModelRepair = await this.retryEmptyTaskExtraction(client, provider, model, truncated, input, 'same_model').catch((error) => {
        this.logger.warn(
          `[extractFromText] empty-result same-model repair failed. source=${source} model=${model} error=${(error as Error).message}`,
        );
        emptyRepairMetadata.same_model_repair_error = (error as Error).message;
        return null;
      });
      emptyRepairMetadata.same_model_repair_attempted = true;
      if (sameModelRepair) {
        emptyRepairMetadata.same_model_repair_response = sameModelRepair.content.slice(0, 8000);
        if (sameModelRepair.parsed.tasks.length > 0) {
          content = sameModelRepair.content;
          parsed = sameModelRepair.parsed;
          emptyRepairMetadata.repaired_by_ai = true;
          emptyRepairMetadata.repair_model = model;
          emptyRepairMetadata.repair_provider = provider;
        }
      }
    }

    if (parsed.tasks.length === 0) {
      const fallbackModel = await this.resolveSceneFallbackModelConfig(sceneId, selectedModel).catch(() => null);
      if (fallbackModel) {
        emptyRepairMetadata.fallback_ai_model = fallbackModel.model;
        emptyRepairMetadata.fallback_ai_provider = fallbackModel.provider;
        const fallbackClient = this.createClient(
          fallbackModel.apiKey,
          fallbackModel.provider,
          fallbackModel.baseUrl,
          this.extractTimeoutMs,
        );
        const fallbackRepair = await this.retryEmptyTaskExtraction(
          fallbackClient,
          fallbackModel.provider,
          fallbackModel.model,
          truncated,
          input,
          'fallback_model',
        ).catch((error) => {
          this.logger.warn(
            `[extractFromText] empty-result fallback-model repair failed. source=${source} model=${fallbackModel.model} error=${(error as Error).message}`,
          );
          emptyRepairMetadata.fallback_ai_error = (error as Error).message;
          return null;
        });
        emptyRepairMetadata.fallback_ai_attempted = true;
        if (fallbackRepair) {
          emptyRepairMetadata.fallback_ai_response = fallbackRepair.content.slice(0, 8000);
          if (fallbackRepair.parsed.tasks.length > 0) {
            content = fallbackRepair.content;
            parsed = fallbackRepair.parsed;
            resultProvider = fallbackModel.provider;
            resultModel = fallbackModel.model;
            emptyRepairMetadata.repaired_by_ai = true;
            emptyRepairMetadata.repair_model = fallbackModel.model;
            emptyRepairMetadata.repair_provider = fallbackModel.provider;
          }
        }
      }
    }

    if (parsed.tasks.length === 0) {
      const fallback = this.extractWithLocalParser(truncated, input);
      if (fallback.tasks.length > 0) {
        fallback.summary = parsed.summary
          ? `${parsed.summary}；AI 未返回任务，已使用本地规则补充。`
          : 'AI 未返回任务，已使用本地规则补充。';
        await this.recordAiArtifact('task_extract', source, input.file?.originalname, filePolicy, {
          original_text: truncated,
          ai_result: fallback,
          ai_empty_result: true,
          model,
          provider,
          ...emptyRepairMetadata,
        });
        this.logger.warn(
          `[extractFromText] AI returned empty tasks, used local fallback. source=${source} model=${model} raw_text_length=${truncated.length}`,
        );
        return {
          ...fallback,
          provider: 'local',
          model: 'local-empty-result-fallback',
          raw_text_length: truncated.length,
          source,
        };
      }
    }
    await this.recordAiArtifact('task_extract', source, input.file?.originalname, filePolicy, {
      original_text: truncated,
      ai_result: parsed,
      model: resultModel,
      provider: resultProvider,
      ...(emptyRepairMetadata.repaired_by_ai ? emptyRepairMetadata : {}),
    });
    return {
      ...parsed,
      provider: resultProvider,
      model: resultModel,
      raw_text_length: truncated.length,
      source,
    };
  }

  private async extractViaOcr(
    file: RdAiUploadedFile,
    input: RdAiExtractInput,
    filePolicy: RdAiFilePolicyRuntime = DEFAULT_FILE_POLICY_RUNTIME,
  ): Promise<RdAiExtractResult> {
    try {
    if (!(await this.ocrService.hasTencentConfig())) {
      throw new BadRequestException('图片解析需要配置腾讯 OCR（请在系统设置 → 集成配置中绑定 tencent_ocr 凭据）');
    }
    const ocrResult = await this.ocrService.recognizeWithTencent(
      { originalname: file.originalname, buffer: file.buffer, mimetype: file.mimetype },
      { documentKind: 'invoice', serviceKey: filePolicy.ocr_service_key },
    );
    const text = ocrResult.text || ocrResult.lines.join('\n');
    const confidence = typeof ocrResult.confidence === 'number' ? ocrResult.confidence : 1;
    if ((!text.trim() || confidence < filePolicy.ocr_confidence_threshold) && filePolicy.allow_vision_fallback) {
      return this.extractViaVisionModel(file, input, filePolicy, `ocr_low_confidence:${confidence}`);
    }
    if (!text.trim()) {
      throw new BadRequestException('OCR 未提取到有效文本');
    }
    const result = await this.extractFromText(text, input, 'file_text', filePolicy);
    await this.recordAiArtifact('task_extract', 'file_ocr', file.originalname, filePolicy, {
      ocr_text: text,
      ai_result: result,
      ocr_confidence: confidence,
      ocr_action: ocrResult.action,
      ocr_service_key: ocrResult.service_key ?? filePolicy.ocr_service_key,
    });
    return { ...result, source: 'file_ocr' };
    } catch (error) {
      if (filePolicy.allow_vision_fallback) {
        const reason = error instanceof Error ? error.message : 'ocr_failed';
        return this.extractViaVisionModel(file, input, filePolicy, reason);
      }
      throw error;
    }
  }

  private async extractViaDocModel(
    file: RdAiUploadedFile,
    input: RdAiExtractInput,
    filePolicy: RdAiFilePolicyRuntime = DEFAULT_FILE_POLICY_RUNTIME,
  ): Promise<RdAiExtractResult> {
    // 优先从数据库已配置模型中查找 qwen-doc-turbo 专用配置，
    // 其次回退到任意可用的 Qwen 配置。
    const docModelConfig = await this.resolveDocModelConfig();
    if (!docModelConfig) {
      throw new BadRequestException(
        'PDF/Word/Excel 解析需要在 AI 模型管理中配置 qwen-doc-turbo 或可用的 Qwen 模型',
      );
    }

    const { apiKey, baseUrl } = docModelConfig;
    // 文档解析（PDF/Word/Excel）可能文件较大，使用立项专用超时；maxRetries=0 关闭自动重试，
    // 保证单次失败在 extractTimeoutMs 内快速返回（走本地兜底），不超出前端 360s 中止窗口。
    const client = this.createClient(apiKey, 'qwen', baseUrl, this.extractTimeoutMs, 0);
    const startedAt = Date.now();

    let uploadedFileId: string | null = null;
    try {
      let response: OpenAI.Chat.Completions.ChatCompletion;
      try {
        const uploadable = await toFile(file.buffer, file.originalname, {
          type: file.mimetype?.trim() || undefined,
        });
        const uploaded = await client.files.create({
          file: uploadable,
          purpose: 'file-extract' as OpenAI.FilePurpose,
        });
        uploadedFileId = uploaded.id;

        const userMessage = this.buildUserMessage('（请从上传的文件中提取所有任务）', input);
        response = await client.chat.completions.create({
          model: QWEN_DOC_MODEL,
          messages: [
            { role: 'system', content: this.buildSystemPrompt(input) },
            { role: 'system', content: `fileid://${uploaded.id}` },
            { role: 'user', content: userMessage },
          ],
          response_format: { type: 'json_object' },
          max_tokens: Math.min(this.extractMaxTokens, QWEN_DOC_MODEL_MAX_TOKENS),
        });
      } catch (error) {
        if (this.isExternalAiTimeout(error)) {
          const parsed = this.extractWithLocalParser(this.safeUtf8(file.buffer).slice(0, 32000), input);
          parsed.summary = 'AI 文件解析超时，已尝试使用本地文本规则解析。';
          await this.recordAiArtifact('task_extract', 'file_doc_model', file.originalname, filePolicy, {
            ai_result: parsed,
            timeout: true,
            model: QWEN_DOC_MODEL,
            provider: 'qwen',
          });
          return {
            ...parsed,
            provider: 'local',
            model: 'local-timeout-fallback',
            raw_text_length: file.buffer.length,
            source: 'file_doc_model',
          };
        }
        throw this.toExternalAiException(error, 'AI 文件解析服务调用失败');
      }

      const content = this.stringifyMessageContent(response.choices[0]?.message?.content) || '{}';
      const parsed = this.parseTasksPayload(content, input);
      await this.recordAiArtifact('task_extract', 'file_doc_model', file.originalname, filePolicy, {
        ai_result: parsed,
        model: QWEN_DOC_MODEL,
        provider: 'qwen',
      });
      this.logger.log(
        `[extractViaDocModel] file=${file.originalname} model=${QWEN_DOC_MODEL} duration=${Date.now() - startedAt}ms tasks=${parsed.tasks.length}`,
      );
      return {
        ...parsed,
        provider: 'qwen',
        model: QWEN_DOC_MODEL,
        raw_text_length: file.buffer.length,
        source: 'file_doc_model',
      };
    } finally {
      if (uploadedFileId) {
        client.files.delete(uploadedFileId).catch(() => {
          // Best-effort cleanup
        });
      }
    }
  }

  /**
   * Resolve API key for qwen-doc-turbo from AI model management only:
   * 1. DB config where model = 'qwen-doc-turbo'
   * 2. Any active Qwen DB config (reuses its key on the doc-turbo endpoint)
   */
  private async resolveDocModelConfig(): Promise<{ apiKey: string; baseUrl?: string } | null> {
    // 1. 精确匹配 qwen-doc-turbo
    const exact = await this.prisma.integrationConfig.findFirst({
      where: { kind: 'openai', isActive: true, model: QWEN_DOC_MODEL },
      orderBy: { updatedAt: 'desc' },
    });
    if (exact) {
      const apiKey = this.decryptSecret(exact.encryptedSecret);
      if (apiKey) {
        const meta = this.parseAiModelMetadata(exact.metadata);
        return { apiKey, baseUrl: meta.base_url || DEFAULT_QWEN_BASE_URL };
      }
    }

    // 2. 任意活跃 Qwen 配置（key 可复用）
    const anyQwen = await this.prisma.integrationConfig.findFirst({
      where: {
        kind: 'openai',
        isActive: true,
        OR: [
          { provider: { contains: 'qwen', mode: 'insensitive' } },
          { provider: { contains: 'tongyi', mode: 'insensitive' } },
          { model: { contains: 'qwen', mode: 'insensitive' } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });
    if (anyQwen) {
      const apiKey = this.decryptSecret(anyQwen.encryptedSecret);
      if (apiKey) {
        const meta = this.parseAiModelMetadata(anyQwen.metadata);
        return { apiKey, baseUrl: meta.base_url || DEFAULT_QWEN_BASE_URL };
      }
    }

    return null;
  }

  // ─── Prompt building ──────────────────────────────────────────────────────

  private async extractViaVisionModel(
    file: RdAiUploadedFile,
    input: RdAiExtractInput,
    filePolicy: RdAiFilePolicyRuntime,
    reason: string,
  ): Promise<RdAiExtractResult> {
    const selectedModel = await this.resolveSceneModelConfig('ocr_cleanup');
    if (!selectedModel) {
      throw new BadRequestException(`OCR 失败且未配置视觉兜底模型：${reason}`);
    }

    const client = this.createClient(selectedModel.apiKey, selectedModel.provider, selectedModel.baseUrl);
    const dataUrl = `data:${file.mimetype?.trim() || 'image/png'};base64,${file.buffer.toString('base64')}`;
    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await client.chat.completions.create({
        model: selectedModel.model,
        messages: [
          { role: 'system', content: this.buildSystemPrompt(input) },
          {
            role: 'user',
            content: [
              { type: 'text', text: this.buildUserMessage(`请直接读取图片内容并抽取研发任务。OCR 兜底原因：${reason}`, input) },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        ...(selectedModel.provider === 'qwen' ? ({ enable_thinking: false } as Record<string, unknown>) : {}),
      } as any);
    } catch (error) {
      if (this.isExternalAiTimeout(error)) {
        const parsed = this.extractWithLocalParser(this.safeUtf8(file.buffer).slice(0, 32000), input);
        parsed.summary = 'AI 图片兜底解析超时，已尝试使用本地文本规则解析。';
        await this.recordAiArtifact('task_extract', 'file_ocr', file.originalname, filePolicy, {
          ai_result: parsed,
          fallback_reason: reason,
          timeout: true,
          fallback_model: selectedModel.model,
          fallback_provider: selectedModel.provider,
        });
        return {
          ...parsed,
          provider: 'local',
          model: 'local-timeout-fallback',
          raw_text_length: file.buffer.length,
          source: 'file_ocr',
        };
      }
      throw this.toExternalAiException(error, 'AI 图片兜底解析服务调用失败');
    }

    const content = response.choices[0]?.message?.content ?? '{}';
    const parsed = this.parseTasksPayload(content, input);
    await this.recordAiArtifact('task_extract', 'file_ocr', file.originalname, filePolicy, {
      ai_result: parsed,
      fallback_reason: reason,
      fallback_model: selectedModel.model,
      fallback_provider: selectedModel.provider,
    });
    return {
      ...parsed,
      provider: selectedModel.provider,
      model: selectedModel.model,
      raw_text_length: file.buffer.length,
      source: 'file_ocr',
    };
  }

  private buildMessages(
    textBody: string,
    input: RdAiExtractInput,
  ): Array<{ role: 'system' | 'user'; content: string }> {
    return [
      { role: 'system', content: this.buildSystemPrompt(input) },
      { role: 'user', content: this.buildUserMessage(textBody, input) },
    ];
  }

  private async retryEmptyTaskExtraction(
    client: OpenAI,
    provider: AiProvider,
    model: string,
    textBody: string,
    input: RdAiExtractInput,
    reason: 'same_model' | 'fallback_model',
  ): Promise<{ content: string; parsed: { tasks: RdAiTaskDraft[]; suggested_category?: string; suggested_product?: string; summary?: string } }> {
    const response = await client.chat.completions.create({
      model,
      messages: this.buildEmptyResultRepairMessages(textBody, input, reason),
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: this.extractMaxTokens,
      ...(provider === 'qwen' ? ({ enable_thinking: false } as Record<string, unknown>) : {}),
    });
    const content = this.stringifyMessageContent(response.choices[0]?.message?.content) || '{}';
    return { content, parsed: this.parseTasksPayload(content, input) };
  }

  private buildEmptyResultRepairMessages(
    textBody: string,
    input: RdAiExtractInput,
    reason: 'same_model' | 'fallback_model',
  ): Array<{ role: 'system' | 'user'; content: string }> {
    return [
      {
        role: 'system',
        content: [
          '你是研发任务抽取修复器。上一轮 AI 返回了空 tasks，但原文可读时这是错误结果。',
          reason === 'fallback_model'
            ? '当前是 fallback 模型修复，请独立重新抽取，不要沿用上一轮空结果。'
            : '当前是同模型二次修复，请严格按规则重新抽取。',
          '必须返回严格 JSON，结构为：',
          TASK_EXTRACTION_SCHEMA_DESC,
          '修复规则：',
          '1) 禁止因为原文是 CSV、Excel 导出、状态表、进度表或已有任务表就返回空 tasks。',
          '2) 如果原文是表格，首行是表头；优先用“任务名称/标题/事项/工作内容/name/title/task”列作为 title，不要把“任务属性/状态/分类”列当 title。',
          '3) 每个有效数据行至少生成 1 条任务；若任务名称为空但备注/当前进度/下一步有内容，用这些内容生成任务。',
          '4) 已有负责人、日期、优先级、分类时优先沿用；日期无法确定再按 estimated_days 推算。',
          '5) 只有原文完全为空、无法读取，或完全不是研发/产品/测试/采购/评审/项目材料时，才允许返回 {"tasks": []}。',
          '6) 对当前这类研发任务表，必须返回非空 tasks。',
        ].join('\n'),
      },
      { role: 'user', content: this.buildUserMessage(textBody, input) },
    ];
  }

  private buildSystemPrompt(input: RdAiExtractInput): string {
    const today = new Date().toISOString().slice(0, 10);
    return [
      '你是一名研发项目经理助手，负责把会议纪要、邮件、工作清单、Excel/CSV/PDF/Word 等内容拆分为可执行的研发任务。',
      `今天日期：${today}`,
      '输出要求：必须返回严格的 JSON，结构为：',
      TASK_EXTRACTION_SCHEMA_DESC,
      '处理顺序：先完整拆分任务，再判定任务分类和任务类型，再估算优先级与工期，最后结合当前人员情况分配负责人。',
      '规则：',
      '1) 一条任务对应一个动作或交付物，标题保持简洁（30 字以内）。',
      '2) 如果原文已有明确的负责人姓名，优先沿用；优先匹配下方"当前人员"。无法匹配或无法判断时填 "待指派"。',
      '3) due_date 必须是 YYYY-MM-DD 格式，结合"今天日期"做中文时间表达换算：',
      '   • 绝对日期："2026/5/30"、"5月30日"、"30号" → 严格转 YYYY-MM-DD（无年份默认今年；日已过则下一个匹配的月份）。',
      '   • 相对日期："今天/即日/立刻/立即" → 今天；"明天" → 今天+1；"后天" → 今天+2；"今明" / "今明两天" / "今明完成" → 今天+1；"近两天" → 今天+1；"三天内" → 今天+3；"一周内" / "本周完成" → 今天+7。',
      '   • 周内日期："本周三/周三" → 推算到本周对应日（若已过则下周）；"下周一" → 下周一。',
      '   • 月级：本月底 → 本月最后一天；下月初 → 下月 1 日。',
      '   • 模糊节点："会后同步" / "采购到货当日" / "样品寄出后" / "随后" 等无法对应到具体日期的，due_date 用今天兜底，必须把原文短语放到 due_date_original，并在 description 末尾补一行"⏰ 节点：{原文}"。',
      '   • 原文完全没写时间时：按 estimated_days 推算（今天 + estimated_days），不必填 due_date_original。',
      '   • due_date_original 字段保留原文中关于时间的完整短语（如"今明测试沟通后寄出调配"），便于人工核对。如果原文写了明确日期（如"6月10日"）也写进去。',
      '4) priority 判定：',
      '   • 默认 medium。',
      '   • 标题/描述含"紧急/卡住/客户投诉/ECN/发布/优先/影响交付/必须/务必"等关键词 → high。',
      '   • due_date 落在「今天 ~ 今天+2 天」之间 → 至少 high。落在「今天+3 ~ 今天+7 天」 → 至少 medium。',
      '   • 明显次要、可延后的任务 → low。',
      '5) estimated_days 必须结合任务复杂度、任务类型和交付物认真估算，不得统一填写固定值：' +
      '发邮件/简单确认/简单跟进=1-2天，常规设计/开发/测试/文档=3-7天，跨模块设计或完整验证闭环=8-20天，复杂系统集成/大型测试项目=21-90天；' +
      '无法判断时默认填5，严禁把所有任务都填1。' +
      '另外：如果原文给了明确的 due_date（如"今天完成/周三/明天交付"），estimated_days 必须与"今天到 due_date 的天数"协调（不超过该跨度，最小为 1）。',
      '6) category_path 用「一级分类 / 二级分类 / 任务类型」格式（例如 "310阀系统 / 310电磁阀 / 测试验证"）。一级分类必须优先从下方"研发分类预设"中选择；二级分类优先选择该大项下最接近的部件。',
      '7) 不要把立项标题、客户名称或临时项目名当作一级分类；只有完全无法匹配预设大项时，才允许创建新的一级分类。',
      '8) 任务类型要从任务内容中判断，例如：需求澄清、方案设计、结构设计、电气设计、软件开发、工艺准备、采购跟进、样件制作、测试验证、问题整改、文档交付、评审确认。',
      '9) 分配负责人时综合：原文负责人、任务分类、任务类型、任务内容关键词、人员岗位/部门、当前任务数、容量上限、阻塞数、请假状态；避免分给请假、明显超载或阻塞过多的人。',
      '10) 若多人都可承担，优先选择当前负载更低且岗位/部门更匹配的人；高优先级任务优先给容量充足的人。',
      '11) owner_reason 必须简短说明分配依据（如"原文指定"、"结构设计任务且当前负载较低"、"测试验证任务匹配测试岗位"）。',
      '12) 必须提取原文中的所有任务，不要遗漏；不要添加与原文目标无关的任务。',
      '13) suggested_category 返回本次立项最主要的一级分类名称，优先从研发分类预设中选择。',
      '14) 如果原文是表格/列表（含 OCR 提取的表格、Markdown 表格、Excel 粘贴文本、Word 表格），每一行/项作为一个任务。列头按以下别名映射到字段：',
      '   • title ← "事项 / 任务 / 工作内容 / 主题 / item / task"。',
      '   • description ← "核心要求 / 详细说明 / 描述 / 备注 / 要点 / 完成标准 / details / remark"。',
      '   • owner ← "责任人 / 负责人 / 接手人 / 主责 / 主办 / owner / assignee"。',
      '   • due_date ← "时间节点 / 截止 / 完成时间 / 期限 / 交付时间 / deadline / due"。',
      '   • priority ← "优先级 / priority"。',
      '   忽略列头识别失败的列；表头不要作为任务行。',
      '15) 只要原文内容不为空且属于研发、产品、测试、结构、电气、软件、采购、文档、评审等工作材料，tasks 至少返回 1 条。',
      '16) 若原文是立项背景、需求说明、问题描述、客户反馈、改进目标或方案说明，而不是明确任务清单，必须把目标转成必需执行动作；这不是编造任务。owner_reason 中说明"根据立项材料推导"。',
      '17) 只有在原文为空、无法读取，或内容完全不是研发工作材料时，才允许返回 {"tasks": []}，并在 summary 中说明无法提取的具体原因。',
    ].join('\n');
  }

  private buildUserMessage(textBody: string, input: RdAiExtractInput): string {
    const people = this.normalizePeopleContexts(input);
    const categories = this.normalizeCategoryLabels(input.categoryLabels ?? []);
    const products = this.normalizeProductOptions(input.products ?? []);
    const lines: string[] = [];
    if (input.proposalTitle) {
      lines.push(`立项标题：${input.proposalTitle}`);
    }
    if (products.length > 0) {
      lines.push('可选产品线（suggested_product 必须从下列 id 中选一个，整份立项归属同一个产品；只有原文明确提到某产品名/型号时才选非默认项，否则返回默认项）：');
      products.forEach((p, index) => {
        lines.push(`${index + 1}. id=${p.id}｜名称=${p.name}${index === 0 ? '（默认）' : ''}`);
      });
    }
    lines.push(`当前系统已有一级分类：${categories.length > 0 ? categories.join('、') : '（无）'}`);
    lines.push('研发分类预设（AI 必须优先往最可能的大项和部件里归类）：');
    this.formatBomCategoryTreeForPrompt().forEach((line) => lines.push(line));
    lines.push('分类要求：优先选择上述大项；二级分类优先选择该大项下的部件；若部件不确定，选择最接近的大项并把二级分类写为"待确认"。');
    lines.push('当前人员（用于负责人自动分配）：');
    if (people.length === 0) {
      lines.push('- （无）');
    } else {
      people.slice(0, 80).forEach((person) => {
        lines.push(`- ${this.formatPersonForPrompt(person)}`);
      });
    }
    lines.push('');
    lines.push('===== 原文内容 START =====');
    lines.push(textBody);
    lines.push('===== 原文内容 END =====');
    lines.push('');
    lines.push('请按上述处理顺序提取全部任务，完成分类、优先级、工期估算和负责人分配后输出 JSON。');
    lines.push('重要：如果原文内容可读且与研发工作有关，禁止返回空 tasks；至少拆出 1 条可执行任务。');
    return lines.join('\n');
  }

  private normalizeCategoryLabels(rawLabels: string[]): string[] {
    const labels = new Set<string>();
    for (const raw of rawLabels) {
      const label = String(raw).trim();
      if (label) labels.add(label);
    }
    for (const system of RD_POC_BOM_CATEGORY_TREE) labels.add(system.label);
    return Array.from(labels);
  }

  private normalizeProductOptions(raw: RdAiProductOption[]): RdAiProductOption[] {
    const byId = new Map<string, RdAiProductOption>();
    for (const item of raw) {
      const id = typeof item?.id === 'string' ? item.id.trim() : '';
      const name = typeof item?.name === 'string' ? item.name.trim() : '';
      if (id && name && !byId.has(id)) byId.set(id, { id, name });
    }
    return Array.from(byId.values());
  }

  /** 把模型返回的 suggested_product 校验回已知产品 id；无法匹配时返回 undefined（前端回退主产品）。 */
  private normalizeSuggestedProduct(
    raw: string,
    products: RdAiProductOption[],
  ): string | undefined {
    const value = raw.trim();
    if (!value || products.length === 0) return undefined;
    const byId = products.find((p) => p.id === value);
    if (byId) return byId.id;
    const lower = value.toLowerCase();
    const byName = products.find(
      (p) => p.name.toLowerCase() === lower || p.name.includes(value) || value.includes(p.name),
    );
    return byName?.id;
  }

  private formatBomCategoryTreeForPrompt(): string[] {
    return RD_POC_BOM_CATEGORY_TREE.map((system, index) => {
      const suffix = 'reserved' in system && system.reserved ? '（预留）' : '';
      return `${index + 1}. ${system.label}${suffix}：${system.parts.join('、')}`;
    });
  }

  private normalizePeopleContexts(input: RdAiExtractInput): RdAiPersonContext[] {
    const byName = new Map<string, RdAiPersonContext>();
    for (const rawPerson of input.peopleProfiles ?? []) {
      if (!rawPerson || typeof rawPerson.name !== 'string') continue;
      const name = rawPerson.name.trim();
      if (!name) continue;
      byName.set(name, {
        id: typeof rawPerson.id === 'string' ? rawPerson.id : undefined,
        name,
        position: this.cleanOptionalText(rawPerson.position),
        department: this.cleanOptionalText(rawPerson.department),
        task_count: this.cleanOptionalNumber(rawPerson.task_count),
        max_tasks: this.cleanOptionalNumber(rawPerson.max_tasks),
        on_leave: Boolean(rawPerson.on_leave),
        blocked_count: this.cleanOptionalNumber(rawPerson.blocked_count),
        avg_completion: this.cleanOptionalNumber(rawPerson.avg_completion),
        completed_this_month: this.cleanOptionalNumber(rawPerson.completed_this_month),
        tasks: Array.isArray(rawPerson.tasks)
          ? rawPerson.tasks.map((task) => String(task).trim()).filter(Boolean).slice(0, 6)
          : undefined,
      });
    }

    for (const rawName of input.peopleNames ?? []) {
      const name = String(rawName).trim();
      if (name && !byName.has(name)) byName.set(name, { name });
    }
    return Array.from(byName.values());
  }

  private getAvailablePeopleNames(input: RdAiExtractInput): string[] {
    return this.normalizePeopleContexts(input).map((person) => person.name);
  }

  private formatPersonForPrompt(person: RdAiPersonContext): string {
    const parts = [person.name];
    if (person.position) parts.push(`岗位:${person.position}`);
    if (person.department) parts.push(`部门:${person.department}`);
    if (typeof person.task_count === 'number' || typeof person.max_tasks === 'number') {
      const current = typeof person.task_count === 'number' ? person.task_count : 0;
      const max = typeof person.max_tasks === 'number' && person.max_tasks > 0 ? person.max_tasks : undefined;
      parts.push(`当前负载:${max ? `${current}/${max}` : current}`);
    }
    if (typeof person.blocked_count === 'number') parts.push(`阻塞:${person.blocked_count}`);
    if (typeof person.avg_completion === 'number') parts.push(`平均完成:${person.avg_completion}%`);
    if (typeof person.completed_this_month === 'number') parts.push(`本月完成:${person.completed_this_month}`);
    if (person.on_leave) parts.push('状态:请假');
    if (person.tasks?.length) parts.push(`在手任务:${person.tasks.join('；')}`);
    return parts.join('，');
  }

  private cleanOptionalText(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
  }

  private cleanOptionalNumber(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }

  private normalizeProposalTaskInput(
    task: unknown,
    input: RdAiProposalRefineInput,
    index: number,
  ): RdAiProposalTaskInput {
    const record = this.asRecord(task, {});
    const fallbackDue = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const id = String(record.id ?? `task-${index + 1}`).trim() || `task-${index + 1}`;
    const title = String(record.title ?? '').trim() || `未命名任务 ${index + 1}`;
    const description = String(record.description ?? '').trim();
    const peopleList = this.getAvailablePeopleNames(input);
    const rawOwner = String(record.owner ?? '').trim() || '待指派';
    const owner = this.matchOwner(rawOwner, peopleList) ?? rawOwner;
    const dueRaw = String(record.due_date ?? '').trim();
    const dueDate = /^\d{4}-\d{1,2}-\d{1,2}$/.test(dueRaw) ? this.padDate(dueRaw) : fallbackDue;
    const dueOriginalRaw = String(record.due_date_original ?? '').trim();
    const dueOriginal = dueOriginalRaw && dueOriginalRaw.length <= 60 ? dueOriginalRaw : undefined;
    const estimatedDays = this.clampInt(record.estimated_days, 1, 365, 5);
    const aiEstimatedRaw = Number(record.ai_estimated_days);
    const aiEstimatedDays = Number.isFinite(aiEstimatedRaw)
      ? Math.max(1, Math.min(365, Math.round(aiEstimatedRaw)))
      : undefined;
    const categoryPath = this.normalizeAiCategoryPath(
      String(record.category_path ?? '').trim(),
      [title, description, input.proposalTitle].filter(Boolean).join(' '),
    );

    return {
      id,
      title,
      description: description || undefined,
      owner,
      owner_reason:
        String(record.owner_reason ?? '').trim() ||
        (owner === '待指派' ? 'AI 微调后仍未匹配到责任人' : '由 AI 微调建议分配'),
      due_date: dueDate,
      due_date_original: dueOriginal,
      priority: this.normalizePriority(record.priority),
      category_path: categoryPath,
      estimated_days: estimatedDays,
      ai_estimated_days: aiEstimatedDays,
      duration_basis: String(record.duration_basis ?? '').trim() || '由 AI 微调估算',
    };
  }

  private buildProposalRefineMessages(
    input: RdAiProposalRefineInput,
    currentTasks: RdAiProposalTaskInput[],
  ): Array<{ role: 'system' | 'user'; content: string }> {
    const selectedTaskIds = (input.selectedTaskIds ?? []).map((id) => String(id).trim()).filter(Boolean);
    const people = this.normalizePeopleContexts(input);
    const peopleText = people.length > 0
      ? people.map((person, index) => `${index + 1}. ${this.formatPersonForPrompt(person)}`).join('\n')
      : '暂无人员上下文，请只在当前 owner 中做保守调整。';
    const categoryText = this.formatBomCategoryTreeForPrompt().join('\n');
    const categoryLabels = this.normalizeCategoryLabels(input.categoryLabels ?? []).join('、');

    return [
      {
        role: 'system',
        content: [
          '你是研发立项草稿微调助手。用户已经得到一版 AI 立项结果，现在希望按新的偏好继续打磨。',
          '你只能围绕当前草稿做最小必要修改，不要改动无关任务，不要引入和用户指令无关的新任务。',
          '必须返回严格 JSON，结构为：',
          '{"tasks":[{"id":string,"title":string,"description"?:string,"owner":string,"owner_reason":string,"due_date":"YYYY-MM-DD","due_date_original"?:string,"priority":"high|medium|low","category_path":string,"estimated_days":integer,"ai_estimated_days"?:integer,"duration_basis":string}],"change_summary":string[],"warnings":string[]}',
          '规则：',
          '1) 现有任务必须保留原 id；只有用户明确要求新增或拆分任务时才允许新增 id。',
          '2) scope=selected 或 scope=single 时，只能修改 selectedTaskIds 中的任务；未选任务要原样返回。',
          '3) 如果用户要求删除、合并或拆分任务，可以调整 tasks 数量，但必须在 change_summary 中说明。',
          '4) due_date 必须是 YYYY-MM-DD；priority 只能是 high、medium、low；estimated_days 必须是 1-365 的整数。如果用户在指令中提到"今天/明天/周三/会后"等中文时间，参照立项 prompt 的换算规则转成具体日期，并把原文短语写入 due_date_original。',
          '5) owner 优先匹配当前人员上下文；无法判断时使用“待指派”，并在 owner_reason 说明原因。',
          '6) category_path 优先使用当前分类树或现有 category_path，格式保持“系统 / 部件 / 类型”。',
          '7) 输出文案保持中文，change_summary 写给业务用户看，warnings 只放真正需要人工注意的风险。',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `立项标题：${input.proposalTitle || '未命名立项'}`,
          `微调范围：${input.scope ?? 'all'}`,
          `选中任务 ID：${selectedTaskIds.length > 0 ? selectedTaskIds.join(', ') : '无'}`,
          '',
          '===== 用户微调要求 =====',
          input.instruction,
          '',
          '===== 当前任务草稿 JSON =====',
          JSON.stringify(currentTasks, null, 2),
          '',
          '===== 人员上下文 =====',
          peopleText,
          '',
          '===== 可用分类 =====',
          categoryText,
          categoryLabels ? `补充分类标签：${categoryLabels}` : '',
          '',
          '===== 原始立项输入摘要 =====',
          input.originalInput?.trim() ? input.originalInput.trim().slice(0, 6000) : '无',
          '',
          '请返回完整 tasks 数组和微调说明 JSON。',
        ].filter(Boolean).join('\n'),
      },
    ];
  }

  private extractWithLocalParser(
    text: string,
    input: RdAiExtractInput,
  ): { tasks: RdAiTaskDraft[]; suggested_category?: string; summary?: string } {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return { tasks: [] };

    const defaultDue = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const delimiter = this.detectDelimiter(lines[0]);
    const rows = lines.map((line) => this.parseDelimitedLine(line, delimiter));
    const header = rows[0]?.map((cell) => cell.toLowerCase().replace(/\s/g, '')) ?? [];
    const availablePeople = this.getAvailablePeopleNames(input);
    const titleIndex = this.findTaskTitleColumn(header);
    const ownerIndex = this.findColumn(header, ['owner', 'assignee', '负责人', '责任人', '执行人', '人员']);
    const dueIndex = this.findColumn(header, ['date', 'due', 'deadline', '截止', '日期', '时间', '期限']);
    const priorityIndex = this.findColumn(header, ['priority', '优先级', '优先', '重要']);
    const descIndex = this.findColumn(header, ['description', 'desc', 'remark', 'note', '描述', '说明', '备注', '内容']);
    const categoryIndex = this.findColumn(header, ['category', 'module', 'project', '分类', '类别', '模块', '项目']);
    const hasUsefulHeader = titleIndex >= 0 || ownerIndex >= 0 || dueIndex >= 0 || priorityIndex >= 0;

    const tasks: RdAiTaskDraft[] = [];
    if (hasUsefulHeader) {
      const resolvedTitleIndex = titleIndex >= 0 ? titleIndex : 0;
      for (const row of rows.slice(1)) {
        const title = String(row[resolvedTitleIndex] ?? '').trim();
        if (!title) continue;
        const owner = String(ownerIndex >= 0 ? row[ownerIndex] : '').trim() || '待指派';
        const due = this.normalizeDueDate(String(dueIndex >= 0 ? row[dueIndex] : '').trim()) || defaultDue;
        const category = String(categoryIndex >= 0 ? row[categoryIndex] : '').trim();
        const description = String(descIndex >= 0 ? row[descIndex] : '').trim();
        tasks.push({
          title,
          description: description || undefined,
          owner: this.matchOwner(owner, availablePeople) ?? owner,
          owner_reason: owner === '待指派' ? '本地解析未识别到负责人' : `本地解析识别到负责人：${owner}`,
          due_date: due,
          priority: this.normalizePriority(priorityIndex >= 0 ? row[priorityIndex] : undefined),
          category_path: category || this.inferBomCategoryPath([title, description, input.proposalTitle].filter(Boolean).join(' ')),
          estimated_days: 5,
        });
      }
    } else {
      lines.slice(0, 50).forEach((line) => {
        const title = line.replace(/^[-*•\d.\s]+/, '').trim();
        if (!title) return;
        tasks.push({
          title,
          owner: '待指派',
          owner_reason: '本地解析未识别到负责人',
          due_date: defaultDue,
          priority: this.normalizePriority(title),
          category_path: this.inferBomCategoryPath([title, input.proposalTitle].filter(Boolean).join(' ')),
          estimated_days: 5,
        });
      });
    }

    return {
      tasks,
      suggested_category: input.proposalTitle,
      summary: 'AI 未配置，已使用本地规则解析。',
    };
  }

  private detectDelimiter(line: string): string {
    if (line.includes('\t')) return '\t';
    const commaCount = line.split(',').length;
    const semicolonCount = line.split(';').length;
    return commaCount >= semicolonCount ? ',' : ';';
  }

  private parseDelimitedLine(line: string, delimiter: string): string[] {
    if (delimiter !== ',') return line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, ''));
    const result: string[] = [];
    let current = '';
    let inQuote = false;
    for (const char of line) {
      if (char === '"') {
        inQuote = !inQuote;
      } else if (char === ',' && !inQuote) {
        result.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim().replace(/^"|"$/g, ''));
    return result;
  }

  private findTaskTitleColumn(header: string[]): number {
    const strongCandidates = [
      '任务名称',
      '任务名',
      '工作内容',
      '任务内容',
      '事项名称',
      '标题',
      'title',
      'taskname',
      'task_name',
      'name',
    ];
    const strong = header.findIndex((cell) => strongCandidates.some((candidate) => cell.includes(candidate)));
    if (strong >= 0) return strong;

    const weak = this.findColumn(header, ['task', '任务', '事项', '工作']);
    const nonTitleHeaders = ['任务属性', '状态', '优先级', '负责人', '开始日期', '结束日期', '分类', '备注', '父任务'];
    if (weak >= 0 && !nonTitleHeaders.some((candidate) => header[weak]?.includes(candidate))) {
      return weak;
    }
    return header.findIndex((cell) => !nonTitleHeaders.some((candidate) => cell.includes(candidate)));
  }

  private findColumn(header: string[], candidates: string[]): number {
    return header.findIndex((cell) => candidates.some((candidate) => cell.includes(candidate)));
  }

  private normalizeDueDate(value: string): string {
    if (!value) return '';
    const normalized = value.replace(/[./]/g, '-');
    const full = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (full) return `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`;
    const monthDay = normalized.match(/^(\d{1,2})-(\d{1,2})$/);
    if (monthDay) return `${new Date().getFullYear()}-${monthDay[1].padStart(2, '0')}-${monthDay[2].padStart(2, '0')}`;
    return '';
  }

  private inferBomCategoryPath(text: string): string {
    const normalized = this.normalizeBomMatchText(text);
    const defaultType = this.inferTaskType(text);
    for (const system of RD_POC_BOM_CATEGORY_TREE) {
      const systemHit = normalized.includes(this.normalizeBomMatchText(system.label));
      const matchedPart = system.parts.find((part) => normalized.includes(this.normalizeBomMatchText(part)));
      if (systemHit || matchedPart) {
        return `${system.label} / ${matchedPart ?? '待确认'} / ${defaultType}`;
      }
    }
    return `待定 / 待确认 / ${defaultType}`;
  }

  private normalizeAiCategoryPath(rawPath: string, fallbackText: string): string {
    const parts = rawPath
      .split(/[\/／>＞]/)
      .map((part) => part.trim())
      .filter(Boolean);
    const rawText = [rawPath, fallbackText].filter(Boolean).join(' ');
    const normalized = this.normalizeBomMatchText(rawText);
    const taskType = parts[2] || this.inferTaskType(fallbackText);

    for (const system of RD_POC_BOM_CATEGORY_TREE) {
      const systemHit = parts[0] ? this.normalizeBomMatchText(parts[0]) === this.normalizeBomMatchText(system.label) : false;
      const textHit = normalized.includes(this.normalizeBomMatchText(system.label));
      const matchedPart =
        system.parts.find((part) => parts.some((segment) => this.normalizeBomMatchText(segment) === this.normalizeBomMatchText(part))) ??
        system.parts.find((part) => normalized.includes(this.normalizeBomMatchText(part)));

      if (systemHit || textHit || matchedPart) {
        return `${system.label} / ${matchedPart ?? parts[1] ?? '待确认'} / ${taskType}`;
      }
    }

    return rawPath || `待定 / 待确认 / ${taskType}`;
  }

  private normalizeSuggestedCategory(rawCategory: string, tasks: RdAiTaskDraft[]): string | undefined {
    const direct = RD_POC_BOM_CATEGORY_TREE.find(
      (system) => this.normalizeBomMatchText(system.label) === this.normalizeBomMatchText(rawCategory),
    );
    if (direct) return direct.label;

    const counts = new Map<string, number>();
    for (const task of tasks) {
      const first = this.firstCategorySegment(task.category_path);
      if (!first) continue;
      const preset = RD_POC_BOM_CATEGORY_TREE.find(
        (system) => this.normalizeBomMatchText(system.label) === this.normalizeBomMatchText(first),
      );
      if (preset) counts.set(preset.label, (counts.get(preset.label) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? undefined;
  }

  private firstCategorySegment(categoryPath: string): string {
    return categoryPath
      .split(/[\/／>＞]/)
      .map((segment) => segment.trim())
      .filter(Boolean)[0] ?? '';
  }

  private inferTaskType(text: string): string {
    if (/测试|验证|试验|标定|检测|实验/.test(text)) return '测试验证';
    if (/工艺|夹具|制程|装配|治具|生产/.test(text)) return '工艺准备';
    if (/结构|外观|底座|外罩|密封|减震/.test(text)) return '结构设计';
    if (/电路|pcb|线束|电池|风扇|显示屏/.test(text)) return '电气设计';
    if (/软件|固件|程序|脚本|算法/.test(text)) return '软件开发';
    if (/采购|供应商|物料|bom|BOM/.test(text)) return '采购跟进';
    if (/报告|文档|规格书|资料|归档/.test(text)) return '文档交付';
    if (/评审|确认|会签/.test(text)) return '评审确认';
    return '研发任务';
  }

  private normalizeBomMatchText(value: string): string {
    return value.replace(/\s+/g, '').toLowerCase();
  }

  // ─── Response parsing ─────────────────────────────────────────────────────

  private parseTasksPayload(
    rawJson: string,
    input: RdAiExtractInput,
  ): { tasks: RdAiTaskDraft[]; suggested_category?: string; suggested_product?: string; summary?: string } {
    let parsedPayload: unknown = {};
    try {
      parsedPayload = this.parseJsonLikePayload(rawJson);
    } catch (err) {
      this.logger.warn(`[parseTasksPayload] JSON parse failed: ${(err as Error).message}; raw="${rawJson.slice(0, 200)}"`);
      return { tasks: [] };
    }
    const obj = this.asRecord(parsedPayload, {});

    const today = new Date();
    const defaultDue = new Date(today.getTime() + 14 * 86400000).toISOString().slice(0, 10);
    const peopleList = this.getAvailablePeopleNames(input);

    const rawTasks = this.extractRawTaskArray(parsedPayload);

    const tasks: RdAiTaskDraft[] = rawTasks
      .map((t): RdAiTaskDraft | null => {
        if (!t || typeof t !== 'object') return null;
        const r = t as Record<string, unknown>;
        const title = String(r.title ?? '').trim();
        if (!title) return null;

        const rawOwner = String(r.owner ?? '').trim() || '待指派';
        const owner = this.matchOwner(rawOwner, peopleList) ?? rawOwner;
        const priority = this.normalizePriority(r.priority);
        const dueRaw = String(r.due_date ?? '').trim();
        const due_date = /^\d{4}-\d{1,2}-\d{1,2}$/.test(dueRaw) ? this.padDate(dueRaw) : defaultDue;
        // 原文时间节点：AI 把"今明/周三/会后"这类原始短语回填到这里，供前端 review 展示
        const dueOriginalRaw = String(r.due_date_original ?? '').trim();
        const due_date_original = dueOriginalRaw && dueOriginalRaw.length <= 60 ? dueOriginalRaw : undefined;
        // AI 若返回 0 或非法值，视为未作答，用 fallback=5；合法值范围 1-90
        const rawDays = Number(r.estimated_days);
        const estimated_days = Number.isFinite(rawDays) && rawDays >= 1
          ? Math.min(90, Math.round(rawDays))
          : 5;

        return {
          title,
          description: r.description ? String(r.description).trim() || undefined : undefined,
          owner,
          owner_reason: String(r.owner_reason ?? '').trim() || (owner === '待指派' ? 'AI 未匹配到负责人' : '由 AI 解析分配'),
          due_date_original,
          due_date,
          priority,
          category_path: this.normalizeAiCategoryPath(
            String(r.category_path ?? '').trim(),
            [title, String(r.description ?? ''), input.proposalTitle].filter(Boolean).join(' '),
          ),
          estimated_days,
        };
      })
      .filter((x): x is RdAiTaskDraft => x !== null);

    const suggested_category = this.normalizeSuggestedCategory(
      typeof obj.suggested_category === 'string' ? obj.suggested_category.trim() : '',
      tasks,
    );
    const suggested_product = this.normalizeSuggestedProduct(
      typeof obj.suggested_product === 'string' ? obj.suggested_product : '',
      this.normalizeProductOptions(input.products ?? []),
    );
    const summary = typeof obj.summary === 'string' ? obj.summary.trim() || undefined : undefined;

    return { tasks, suggested_category, suggested_product, summary };
  }

  private parseProposalRefinePayload(
    rawJson: string,
    input: RdAiProposalRefineInput,
    fallbackTasks: RdAiProposalTaskInput[],
  ): { tasks: RdAiProposalTaskInput[]; change_summary: string[]; warnings: string[] } {
    let parsedPayload: unknown = {};
    try {
      parsedPayload = this.parseJsonLikePayload(rawJson);
    } catch (err) {
      this.logger.warn(`[parseProposalRefinePayload] JSON parse failed: ${(err as Error).message}; raw="${rawJson.slice(0, 200)}"`);
      return {
        tasks: fallbackTasks,
        change_summary: [],
        warnings: ['AI 微调结果解析失败，已保留当前立项草稿。'],
      };
    }

    const obj = this.asRecord(parsedPayload, {});
    const rawTasks = this.extractRawTaskArray(parsedPayload);
    const normalizedTasks = rawTasks
      .map((task, index) => this.normalizeProposalTaskInput(task, input, index))
      .filter((task): task is RdAiProposalTaskInput => Boolean(task.title));

    const selectedIds = new Set((input.selectedTaskIds ?? []).map((id) => String(id).trim()).filter(Boolean));
    const fallbackIds = new Set(fallbackTasks.map((task) => task.id).filter(Boolean) as string[]);
    const shouldProtectUnselected = input.scope === 'selected' || input.scope === 'single';

    let tasks = normalizedTasks;
    if (shouldProtectUnselected && selectedIds.size > 0) {
      const returnedById = new Map(normalizedTasks.map((task) => [task.id, task]));
      const additions = normalizedTasks.filter((task) => !task.id || !fallbackIds.has(task.id));
      tasks = fallbackTasks.map((task) => {
        const id = task.id ?? '';
        if (!selectedIds.has(id)) return task;
        return returnedById.get(id) ?? task;
      });
      if (additions.length > 0) {
        tasks = [...tasks, ...additions];
      }
    }

    return {
      tasks,
      change_summary: this.stringArrayFromPayload(obj.change_summary ?? obj.changes ?? obj.summary),
      warnings: this.stringArrayFromPayload(obj.warnings ?? obj.warning),
    };
  }

  private stringArrayFromPayload(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 8);
    }
    if (typeof value === 'string' && value.trim()) {
      return [value.trim()];
    }
    return [];
  }

  private parseJsonLikePayload(rawJson: string): unknown {
    const trimmed = (rawJson ?? '').trim();
    if (!trimmed) return {};

    const candidates = new Set<string>();
    const cleanedFence = trimmed.startsWith('```')
      ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
      : trimmed;
    candidates.add(cleanedFence);

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) candidates.add(fenced[1].trim());

    const objectJson = this.extractBalancedJson(cleanedFence, '{', '}');
    if (objectJson) candidates.add(objectJson);
    const arrayJson = this.extractBalancedJson(cleanedFence, '[', ']');
    if (arrayJson) candidates.add(arrayJson);

    let lastError: unknown = null;
    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Unable to parse JSON payload');
  }

  private extractBalancedJson(text: string, openChar: '{' | '[', closeChar: '}' | ']'): string | null {
    const start = text.indexOf(openChar);
    if (start < 0) return null;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === '\\') {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }
      if (char === '"') {
        inString = true;
      } else if (char === openChar) {
        depth += 1;
      } else if (char === closeChar) {
        depth -= 1;
        if (depth === 0) return text.slice(start, index + 1);
      }
    }
    return null;
  }

  private extractRawTaskArray(parsedPayload: unknown): unknown[] {
    if (Array.isArray(parsedPayload)) return parsedPayload;
    const root = this.asRecord(parsedPayload, {});
    const keys = ['tasks', 'task_list', 'items', 'data', 'result', 'results', '任务', '任务列表', '研发任务'];
    for (const key of keys) {
      const value = root[key];
      if (Array.isArray(value)) return value;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const nested = this.extractRawTaskArray(value);
        if (nested.length > 0) return nested;
      }
    }
    return [];
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private matchOwner(raw: string, people: string[]): string | null {
    if (!raw || raw === '待指派') return null;
    const trimmed = raw.trim();
    // 1. Exact
    const exact = people.find((p) => p === trimmed);
    if (exact) return exact;
    // 2. Substring (handles "刘致远(研发管理员)" vs "刘致远")
    const fuzzy = people.find((p) => trimmed.includes(p) || p.includes(trimmed));
    if (fuzzy) return fuzzy;
    // 3. 昵称匹配：「小X」/「老X」/「X姐」/「X哥」→ 唯一姓为 X 的人员
    const nicknameMatch = trimmed.match(/^(?:小|老|大)?([一-龥])(?:姐|哥|总)?$/);
    if (nicknameMatch) {
      const surname = nicknameMatch[1];
      const candidates = people.filter((p) => {
        const baseName = p.replace(/[(（].*$/, '').trim(); // 去掉括号注释
        return baseName.startsWith(surname);
      });
      if (candidates.length === 1) return candidates[0]; // 仅当唯一时匹配，避免歧义
    }
    return null;
  }

  private normalizePriority(value: unknown): 'high' | 'medium' | 'low' {
    const s = String(value ?? '').toLowerCase();
    if (s === 'high' || /高|紧急|urgent|p0|p1/.test(s)) return 'high';
    if (s === 'low' || /低|p3/.test(s)) return 'low';
    return 'medium';
  }

  private clampInt(value: unknown, min: number, max: number, fallback: number): number {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  private padDate(raw: string): string {
    const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return raw;
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }

  private extOf(name: string): string {
    const i = name.lastIndexOf('.');
    return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
  }

  private safeUtf8(buffer: Buffer): string {
    try {
      return buffer.toString('utf8');
    } catch {
      return '';
    }
  }

  private async resolveSceneModelConfig(sceneId: string): Promise<AiModelRuntimeConfig | null> {
    const scenes = await this.readAiScenes();
    const scene = scenes.find((item) => item.id === sceneId && item.enabled !== false);
    const primaryModelId = scene?.model_id ?? '';
    const fallbackModelId = scene?.fallback_model_id ?? '';

    const fromPrimary = primaryModelId ? await this.resolveConfiguredModel(primaryModelId) : null;
    if (fromPrimary) return fromPrimary;

    const fromFallback = fallbackModelId ? await this.resolveConfiguredModel(fallbackModelId) : null;
    if (fromFallback) return fromFallback;

    return this.resolveDefaultConfiguredModel();
  }

  private async resolveSceneFallbackModelConfig(
    sceneId: string,
    primary: AiModelRuntimeConfig,
  ): Promise<AiModelRuntimeConfig | null> {
    const scenes = await this.readAiScenes();
    const scene = scenes.find((item) => item.id === sceneId && item.enabled !== false);
    const fallbackModelId = scene?.fallback_model_id ?? '';
    if (!fallbackModelId) return null;
    const fallback = await this.resolveConfiguredModel(fallbackModelId);
    if (!fallback || this.isSameRuntimeModel(primary, fallback)) return null;
    return fallback;
  }

  private isSameRuntimeModel(left: AiModelRuntimeConfig, right: AiModelRuntimeConfig): boolean {
    return left.provider === right.provider && left.model === right.model && (left.baseUrl ?? '') === (right.baseUrl ?? '');
  }

  private async readAiScenes(): Promise<Array<{ id: string; enabled: boolean; model_id: string; fallback_model_id: string }>> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: resolveRdStoreKey('rd.aiSettings') },
      select: { value: true },
    });
    const value = this.asRecord(setting?.value, {});
    const scenes = Array.isArray(value.scenes) ? value.scenes : [];
    return scenes
      .filter((scene): scene is Record<string, unknown> => Boolean(scene) && typeof scene === 'object' && !Array.isArray(scene))
      .map((scene) => ({
        id: String(scene.id ?? '').trim(),
        enabled: scene.enabled !== false,
        model_id: String(scene.model_id ?? '').trim(),
        fallback_model_id: String(scene.fallback_model_id ?? '').trim(),
      }))
      .filter((scene) => scene.id);
  }

  private async resolveConfiguredModel(modelId: string): Promise<AiModelRuntimeConfig | null> {
    const config = await this.prisma.integrationConfig.findFirst({
      where: {
        kind: 'openai',
        isActive: true,
        OR: [{ id: modelId }, { model: modelId }],
      },
      orderBy: { updatedAt: 'desc' },
    });
    return config ? this.toRuntimeModelConfig(config) : null;
  }

  /**
   * 按模型名判断是否为对话（chat）模型。用于默认兜底时排除图像/向量/语音/重排等
   * 无法处理 chat.completions 的模型——否则未绑定模型的场景会掉到这类模型上必然失败。
   */
  private isChatCapableModel(name: string | null | undefined): boolean {
    return !/image|embedding|whisper|tts|audio|rerank|vision|ocr|moderation/i.test(name ?? '');
  }

  private async resolveDefaultConfiguredModel(): Promise<AiModelRuntimeConfig | null> {
    const configs = await this.prisma.integrationConfig.findMany({
      where: { kind: 'openai', isActive: true },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
    });
    // 只在对话模型里挑默认兜底：先取标记为默认启用者，否则取最近更新的一个。
    // 排除图像/向量等模型，避免未配置场景回退到 gpt-image-2 之类导致 chat 调用失败。
    const chatConfigs = configs.filter((config) => this.isChatCapableModel(config.model));
    const pool = chatConfigs.length > 0 ? chatConfigs : configs;
    const selected =
      pool.find((config) => this.parseAiModelMetadata(config.metadata).is_default_enabled) ??
      pool[0] ??
      null;
    return selected ? this.toRuntimeModelConfig(selected) : null;
  }

  private toRuntimeModelConfig(config: {
    provider: string | null;
    model: string | null;
    encryptedSecret: string;
    metadata: unknown;
  }): AiModelRuntimeConfig | null {
    const model = config.model?.trim();
    if (!model) return null;
    const apiKey = this.decryptSecret(config.encryptedSecret);
    if (!apiKey) return null;
    const metadata = this.parseAiModelMetadata(config.metadata);
    const provider = this.normalizeProvider(config.provider, model);
    return {
      provider,
      model,
      apiKey,
      baseUrl: metadata.base_url || this.defaultBaseUrlForProvider(provider),
    };
  }

  private parseAiModelMetadata(value: unknown) {
    const metadata = this.asRecord(value, {});
    return {
      base_url: typeof metadata.base_url === 'string' ? metadata.base_url.trim().replace(/\/$/, '') : '',
      is_default_enabled: metadata.is_default_enabled === true,
    };
  }

  private decryptSecret(value: string) {
    try {
      return this.secureConfigService.decryptFromStorage(value);
    } catch {
      return '';
    }
  }

  private normalizeProvider(provider: string | null | undefined, model: string): AiProvider {
    return /qwen|tongyi|dashscope|通义|阿里/i.test(`${provider ?? ''} ${model}`) ? 'qwen' : 'openai';
  }

  private asRecord(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : fallback;
  }

  private stringifyMessageContent(content: unknown): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === 'string') return part;
          const record = this.asRecord(part, {});
          return typeof record.text === 'string' ? record.text : '';
        })
        .filter(Boolean)
        .join('\n');
    }
    return content == null ? '' : String(content);
  }

  // ─── Progress assessment from evidence file ──────────────────────────────

  private async readFilePolicyRuntime(): Promise<RdAiFilePolicyRuntime> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: resolveRdStoreKey('rd.aiSettings') },
      select: { value: true },
    });
    const value = this.asRecord(setting?.value, {});
    const rawPolicy = this.asRecord(value.file_policy, {});
    return {
      ...DEFAULT_FILE_POLICY_RUNTIME,
      ocr_provider: String(rawPolicy.ocr_provider ?? DEFAULT_FILE_POLICY_RUNTIME.ocr_provider).trim() || DEFAULT_FILE_POLICY_RUNTIME.ocr_provider,
      ocr_service_key: String(rawPolicy.ocr_service_key ?? DEFAULT_FILE_POLICY_RUNTIME.ocr_service_key).trim() || DEFAULT_FILE_POLICY_RUNTIME.ocr_service_key,
      ocr_confidence_threshold: this.clampNumber(
        rawPolicy.ocr_confidence_threshold,
        0,
        1,
        DEFAULT_FILE_POLICY_RUNTIME.ocr_confidence_threshold,
      ),
      low_confidence_action: String(rawPolicy.low_confidence_action ?? DEFAULT_FILE_POLICY_RUNTIME.low_confidence_action).trim() || DEFAULT_FILE_POLICY_RUNTIME.low_confidence_action,
      allow_vision_fallback: rawPolicy.allow_vision_fallback === true,
      save_original_text: rawPolicy.save_original_text !== false,
      save_ocr_text: rawPolicy.save_ocr_text !== false,
      save_ai_result: rawPolicy.save_ai_result !== false,
      require_confirmation_before_write: rawPolicy.require_confirmation_before_write !== false,
    };
  }

  private clampNumber(value: unknown, min: number, max: number, fallback: number): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
  }

  private async recordAiArtifact(
    kind: string,
    source: string,
    filename: string | undefined,
    filePolicy: RdAiFilePolicyRuntime,
    payload: { original_text?: string; ocr_text?: string; ai_result?: unknown; [key: string]: unknown },
  ) {
    if (!filePolicy.save_original_text && !filePolicy.save_ocr_text && !filePolicy.save_ai_result) return;
    const metadata = Object.fromEntries(
      Object.entries(payload).filter(([key]) => !['original_text', 'ocr_text', 'ai_result'].includes(key)),
    );
    const artifact = {
      id: `rd-ai-artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      source,
      filename: filename ?? null,
      created_at: new Date().toISOString(),
      metadata,
      original_text: filePolicy.save_original_text ? payload.original_text ?? null : null,
      ocr_text: filePolicy.save_ocr_text ? payload.ocr_text ?? null : null,
      ai_result: filePolicy.save_ai_result ? payload.ai_result ?? null : null,
    };
    const artifactsKey = resolveRdStoreKey('rd.aiArtifacts');
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: artifactsKey },
      select: { value: true },
    });
    const existing = Array.isArray(setting?.value)
      ? setting.value.filter((item) => item && typeof item === 'object')
      : [];
    await this.prisma.systemSetting.upsert({
      where: { key: artifactsKey },
      create: {
        category: 'research-development',
        key: artifactsKey,
        value: [artifact] as any,
        description: 'R&D AI parsing artifacts',
      },
      update: {
        category: 'research-development',
        value: [artifact, ...existing].slice(0, 300) as any,
      },
    });
  }

  async assessProgress(input: {
    files?: RdAiUploadedFile[];
    text?: string;
    task: {
      task_id: string;
      title: string;
      description?: string;
      category_path?: string;
      current_progress?: number;
      current_status?: string;
      work_items?: RdAiWorkItemRef[];
    };
  }): Promise<RdAiProgressAssessmentResult> {
    const files = input.files ?? [];
    const userText = (input.text ?? '').trim();
    if (files.length === 0 && !userText) {
      throw new BadRequestException('files 或 text 至少需要提供一项');
    }

    const filePolicy = await this.readFilePolicyRuntime();

    // 单文件 + 无用户文本 + 图片：保留原 OCR / Vision 兜底路径，结果更稳
    if (files.length === 1 && !userText && IMAGE_EXT.has(this.extOf(files[0].originalname))) {
      return this.assessProgressFromImageFile(files[0], input, filePolicy);
    }

    // 统一抽取每个文件的 evidence 文本，再与用户文本拼合，最后走文本判断
    const segments: Array<{ label: string; text: string; source: 'text' | 'file_text' | 'file_ocr' | 'file_doc_model' | 'error' }> = [];
    let totalRawLength = userText.length;

    if (userText) {
      segments.push({ label: '用户进展说明', text: userText.slice(0, 16000), source: 'text' });
    }

    for (const file of files) {
      try {
        const extracted = await this.extractEvidenceFromFile(file, filePolicy);
        totalRawLength += file.buffer.length;
        if (extracted.text.trim()) {
          segments.push({ label: file.originalname, text: extracted.text, source: extracted.source });
        } else {
          segments.push({ label: file.originalname, text: '（文件未抽取到可读内容）', source: 'error' });
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : '文件解析失败';
        this.logger.warn(`[assessProgress] file=${file.originalname} extract failed: ${message}`);
        segments.push({ label: file.originalname, text: `（解析失败：${message}）`, source: 'error' });
      }
    }

    // 选择主 source：优先级 doc_model > ocr > file_text > text
    const sources = segments.map((s) => s.source);
    const source: 'text' | 'file_text' | 'file_ocr' | 'file_doc_model' = sources.includes('file_doc_model')
      ? 'file_doc_model'
      : sources.includes('file_ocr')
        ? 'file_ocr'
        : sources.includes('file_text')
          ? 'file_text'
          : 'text';

    const combinedEvidence = segments
      .map((s) => `===== ${s.label}（${s.source}）=====\n${s.text}`)
      .join('\n\n')
      .slice(0, 32000);

    const systemPrompt = this.buildProgressSystemPrompt((input.task.work_items?.length ?? 0) > 0);
    const userMessage = this.buildProgressUserMessage(combinedEvidence, input);

    // Text path — AI 模型管理优先（scene → default），不从 .env 读取模型 key。
    const selectedModel = await this.resolveSceneModelConfig('progress_summary').catch(() => null);
    const apiKey = selectedModel?.apiKey ?? null;
    const provider: AiProvider = selectedModel?.provider ?? 'openai';
    const model = selectedModel?.model ?? DEFAULT_TEXT_MODEL;
    const baseUrl = selectedModel?.baseUrl;
    const primaryFilename = files[0]?.originalname;

    if (!apiKey) {
      return {
        progress: Math.max(0, input.task.current_progress ?? 0),
        stage: '资料已上传，AI 未配置，无法自动判断',
        confidence: 40,
        basis: ['未在 AI 模型管理中配置可用模型', '当前仅记录文件元信息'],
        recommendation: '请在 AI 模型管理中配置可用模型，或人工选择进度节点。',
        provider: 'local',
        model: 'local-progress-fallback',
        source,
        raw_text_length: totalRawLength,
      };
    }

    const client = this.createClient(apiKey, provider, baseUrl);
    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        response_format: { type: 'json_object' },
        ...(provider === 'qwen' ? ({ enable_thinking: false } as Record<string, unknown>) : {}),
      });
    } catch (error) {
      if (this.isExternalAiTimeout(error)) {
        const parsed = this.buildTimeoutProgressFallback(input.task, source, totalRawLength);
        await this.recordAiArtifact('progress_assessment', source, primaryFilename, filePolicy, {
          combined_evidence: combinedEvidence,
          ai_result: parsed,
          timeout: true,
          model,
          provider,
          file_count: files.length,
        });
        return parsed;
      }
      throw this.toExternalAiException(error, 'AI 进度判断服务调用失败');
    }
    const content = response.choices[0]?.message?.content ?? '{}';
    const parsed = this.parseProgressPayload(content, input.task);
    await this.recordAiArtifact('progress_assessment', source, primaryFilename, filePolicy, {
      combined_evidence: combinedEvidence,
      ai_result: parsed,
      model,
      provider,
      file_count: files.length,
    });
    return { ...parsed, provider, model, source, raw_text_length: totalRawLength };
  }

  /** 从单个文件抽取可读文本（图片走 OCR，文档走 Qwen doc-turbo 抽取，文本直接读）。 */
  private async extractEvidenceFromFile(
    file: RdAiUploadedFile,
    filePolicy: RdAiFilePolicyRuntime,
  ): Promise<{ text: string; source: 'file_text' | 'file_ocr' | 'file_doc_model' }> {
    const ext = this.extOf(file.originalname);

    if (IMAGE_EXT.has(ext)) {
      const tencentReady = await this.ocrService.hasTencentConfig();
      if (!tencentReady) {
        throw new BadRequestException(
          `图片 ${file.originalname} 识别需要配置腾讯 OCR（请在系统设置 → 集成配置中绑定 tencent_ocr 凭据）`,
        );
      }
      const ocr = await this.ocrService.recognizeWithTencent(
        { originalname: file.originalname, buffer: file.buffer, mimetype: file.mimetype },
        { documentKind: 'invoice', serviceKey: filePolicy.ocr_service_key },
      );
      return { text: (ocr.text || ocr.lines.join('\n')).slice(0, 16000), source: 'file_ocr' };
    }

    if (PLAIN_TEXT_EXT.has(ext)) {
      return { text: this.safeUtf8(file.buffer).slice(0, 16000), source: 'file_text' };
    }

    if (DOC_EXT.has(ext)) {
      const docCfg = await this.resolveDocModelConfig();
      if (!docCfg) {
        throw new BadRequestException(
          `PDF/Word/Excel ${file.originalname} 需要在 AI 模型管理中配置 qwen-doc-turbo 或可用的 Qwen 模型`,
        );
      }
      // maxRetries=0：关闭 SDK 自动重试，避免长超时叠加重试击穿前端 360s 中止窗口
      const docClient = this.createClient(docCfg.apiKey, 'qwen', docCfg.baseUrl, this.extractTimeoutMs, 0);
      const uploadable = await toFile(file.buffer, file.originalname, {
        type: file.mimetype?.trim() || undefined,
      });
      let uploaded: OpenAI.Files.FileObject;
      try {
        uploaded = await docClient.files.create({
          file: uploadable,
          purpose: 'file-extract' as OpenAI.FilePurpose,
        });
      } catch (error) {
        throw this.toExternalAiException(error, `AI 文件上传失败（${file.originalname}）`);
      }
      try {
        const response = await docClient.chat.completions.create({
          model: QWEN_DOC_MODEL,
          messages: [
            {
              role: 'system',
              content:
                '你是一名研发任务文档摘要助手。请提取下面这份文件中与"任务进度判断"相关的关键内容（如阶段、产出、测试数据、评审结论、待办或风险），用中文要点列出，800 字以内，不要输出 JSON。',
            },
            { role: 'system', content: `fileid://${uploaded.id}` },
            { role: 'user', content: `请提取与任务进度判断相关的关键内容。文件名：${file.originalname}` },
          ],
        });
        const extracted = (response.choices[0]?.message?.content ?? '').trim();
        return { text: extracted.slice(0, 16000), source: 'file_doc_model' };
      } catch (error) {
        throw this.toExternalAiException(error, `AI 文件解析失败（${file.originalname}）`);
      } finally {
        docClient.files.delete(uploaded.id).catch(() => { /* best-effort */ });
      }
    }

    // 未知扩展名按文本读
    return { text: this.safeUtf8(file.buffer).slice(0, 16000), source: 'file_text' };
  }

  /** 单图片 + 无文本的快速路径：保留 OCR 失败时的 vision 兜底。 */
  private async assessProgressFromImageFile(
    file: RdAiUploadedFile,
    input: {
      task: { task_id: string; title: string; description?: string; category_path?: string; current_progress?: number; current_status?: string; work_items?: RdAiWorkItemRef[] };
    },
    filePolicy: RdAiFilePolicyRuntime,
  ): Promise<RdAiProgressAssessmentResult> {
    const tencentReady = await this.ocrService.hasTencentConfig();
    if (!tencentReady && filePolicy.allow_vision_fallback) {
      return this.assessProgressViaVision(file, input, filePolicy, 'ocr_not_configured');
    }
    if (!tencentReady) {
      throw new BadRequestException('图片识别需要配置腾讯 OCR（请在系统设置 → 集成配置中绑定 tencent_ocr 凭据）');
    }
    const ocr = await this.ocrService.recognizeWithTencent(
      { originalname: file.originalname, buffer: file.buffer, mimetype: file.mimetype },
      { documentKind: 'invoice', serviceKey: filePolicy.ocr_service_key },
    );
    const confidence = typeof ocr.confidence === 'number' ? ocr.confidence : 1;
    const evidenceText = (ocr.text || ocr.lines.join('\n')).slice(0, 24000);
    if ((!evidenceText.trim() || confidence < filePolicy.ocr_confidence_threshold) && filePolicy.allow_vision_fallback) {
      return this.assessProgressViaVision(file, input, filePolicy, `ocr_low_confidence:${confidence}`);
    }

    const systemPrompt = this.buildProgressSystemPrompt((input.task.work_items?.length ?? 0) > 0);
    const userMessage = this.buildProgressUserMessage(evidenceText, input);

    const selectedModel = await this.resolveSceneModelConfig('progress_summary').catch(() => null);
    const apiKey = selectedModel?.apiKey ?? null;
    const provider: AiProvider = selectedModel?.provider ?? 'openai';
    const model = selectedModel?.model ?? DEFAULT_TEXT_MODEL;
    const baseUrl = selectedModel?.baseUrl;

    if (!apiKey) {
      return {
        progress: Math.max(0, input.task.current_progress ?? 0),
        stage: '资料已上传，AI 未配置，无法自动判断',
        confidence: 40,
        basis: ['未在 AI 模型管理中配置可用模型', '当前仅记录文件元信息'],
        recommendation: '请在 AI 模型管理中配置可用模型，或人工选择进度节点。',
        provider: 'local',
        model: 'local-progress-fallback',
        source: 'file_ocr',
        raw_text_length: evidenceText.length,
      };
    }

    const client = this.createClient(apiKey, provider, baseUrl);
    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        response_format: { type: 'json_object' },
        ...(provider === 'qwen' ? ({ enable_thinking: false } as Record<string, unknown>) : {}),
      });
    } catch (error) {
      if (this.isExternalAiTimeout(error)) {
        const parsed = this.buildTimeoutProgressFallback(input.task, 'file_ocr', evidenceText.length);
        await this.recordAiArtifact('progress_assessment', 'file_ocr', file.originalname, filePolicy, {
          ocr_text: evidenceText,
          ai_result: parsed,
          timeout: true,
          model,
          provider,
        });
        return parsed;
      }
      throw this.toExternalAiException(error, 'AI 进度判断服务调用失败');
    }
    const content = response.choices[0]?.message?.content ?? '{}';
    const parsed = this.parseProgressPayload(content, input.task);
    await this.recordAiArtifact('progress_assessment', 'file_ocr', file.originalname, filePolicy, {
      ocr_text: evidenceText,
      ai_result: parsed,
      model,
      provider,
    });
    return { ...parsed, provider, model, source: 'file_ocr', raw_text_length: evidenceText.length };
  }

  private async assessProgressViaVision(
    file: RdAiUploadedFile,
    input: {
      task: { title: string; description?: string; category_path?: string; current_progress?: number; current_status?: string; work_items?: RdAiWorkItemRef[] };
    },
    filePolicy: RdAiFilePolicyRuntime,
    reason: string,
  ): Promise<RdAiProgressAssessmentResult> {
    const selectedModel = await this.resolveSceneModelConfig('ocr_cleanup').catch(() => null);
    if (!selectedModel) {
      throw new BadRequestException(`OCR 失败且未配置视觉兜底模型：${reason}`);
    }

    const client = this.createClient(selectedModel.apiKey, selectedModel.provider, selectedModel.baseUrl);
    const dataUrl = `data:${file.mimetype?.trim() || 'image/png'};base64,${file.buffer.toString('base64')}`;
    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await client.chat.completions.create({
        model: selectedModel.model,
        messages: [
          { role: 'system', content: this.buildProgressSystemPrompt((input.task.work_items?.length ?? 0) > 0) },
          {
            role: 'user',
            content: [
              { type: 'text', text: this.buildProgressUserMessage(`请直接读取图片证据并判断进度。OCR 兜底原因：${reason}`, input) },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        response_format: { type: 'json_object' },
        ...(selectedModel.provider === 'qwen' ? ({ enable_thinking: false } as Record<string, unknown>) : {}),
      } as any);
    } catch (error) {
      if (this.isExternalAiTimeout(error)) {
        const parsed = this.buildTimeoutProgressFallback(input.task, 'file_ocr', file.buffer.length);
        await this.recordAiArtifact('progress_assessment', 'file_ocr', file.originalname, filePolicy, {
          ai_result: parsed,
          fallback_reason: reason,
          timeout: true,
          fallback_model: selectedModel.model,
          fallback_provider: selectedModel.provider,
        });
        return parsed;
      }
      throw this.toExternalAiException(error, 'AI 进度图片兜底解析服务调用失败');
    }

    const content = response.choices[0]?.message?.content ?? '{}';
    const parsed = this.parseProgressPayload(content, input.task);
    await this.recordAiArtifact('progress_assessment', 'file_ocr', file.originalname, filePolicy, {
      ai_result: parsed,
      fallback_reason: reason,
      fallback_model: selectedModel.model,
      fallback_provider: selectedModel.provider,
    });
    return {
      ...parsed,
      provider: selectedModel.provider,
      model: selectedModel.model,
      source: 'file_ocr',
      raw_text_length: file.buffer.length,
    };
  }

  private buildProgressSystemPrompt(hasWorkItems = false): string {
    return [
      '你是一名研发项目经理助手。用户会上传一份"任务进度依据"文件（方案、测试记录、实验数据、评审纪要、邮件等）或粘贴文字，',
      '请结合任务标题、描述和当前进度，判断这份依据能把任务推进到哪个阶段。',
      '',
      '阶段定义（progress 数值范围参考）：',
      '- 未开始 (0)：没有任何实质性产出',
      '- 方案 (20-40)：完成方案、计划、规格、需求澄清等输入类资料',
      '- 验证 (45-75)：已开始测试/打样/试产/调试，产出测试数据或实验记录',
      '- 待评审 (80-95)：成果已收敛，等待评审/审批/发布 (ECN/规范)',
      '- 完成 (100)：评审通过、闭环交付',
      '',
      '必须返回严格 JSON，结构：',
      hasWorkItems
        ? '{"progress": integer 0-100, "stage": string, "confidence": integer 0-100, "basis": [string,...], "recommendation": string, "work_item_id": string|null}'
        : '{"progress": integer 0-100, "stage": string, "confidence": integer 0-100, "basis": [string,...], "recommendation": string}',
      '',
      '规则：',
      '1) progress 是最终绝对进度，不是相对增量；不要把当前进度与本次判断相加，也不要因为当前进度较高而自动取更大值。依据不足或无关时返回当前进度；依据表明回退时可返回更低进度。',
      '2) basis 给出 2-4 条简短证据（参考文件中的关键内容，如"含 EMC 测试报告"、"完成 BOM 变更说明"）。',
      '3) stage 用一句话描述当前所处阶段及理由（不超过 25 字）。',
      '4) confidence 反映你对推断的把握，依据越具体越高。',
      '5) recommendation 给出下一步建议动作，30 字以内。',
      '6) 如果依据与任务无关，progress 不变，stage 写"依据与任务匹配度低"，confidence 低于 50。',
      ...(hasWorkItems
        ? [
            '7) 任务信息中列出了「工作项清单」（任务内部的小块拆分，各有 id）。请判断本次依据主要在讲哪个工作项：明确对应某一项时返回其 id；内容跨多项或属于任务整体时返回 null。不要编造清单之外的 id。',
          ]
        : []),
    ].join('\n');
  }

  private buildProgressUserMessage(
    evidenceText: string,
    input: {
      task: { title: string; description?: string; category_path?: string; current_progress?: number; current_status?: string; work_items?: RdAiWorkItemRef[] };
    },
  ): string {
    const lines: string[] = [];
    lines.push('===== 任务信息 =====');
    lines.push(`标题：${input.task.title}`);
    if (input.task.description) lines.push(`描述：${input.task.description}`);
    if (input.task.category_path) lines.push(`分类：${input.task.category_path}`);
    lines.push(`当前进度：${input.task.current_progress ?? 0}%`);
    if (input.task.current_status) lines.push(`当前状态：${input.task.current_status}`);
    const workItems = input.task.work_items ?? [];
    if (workItems.length > 0) {
      lines.push('');
      lines.push('===== 工作项清单（判断本次依据归属哪一项，返回其 id；不确定返回 null）=====');
      for (const it of workItems) {
        lines.push(`- id: ${it.id} | 标题: ${it.title}${it.done ? '（已完成）' : ''}`);
      }
    }
    lines.push('');
    lines.push('===== 依据内容 =====');
    lines.push(evidenceText || '（请直接根据上传文件分析）');
    lines.push('');
    lines.push('请输出 JSON。');
    return lines.join('\n');
  }

  private parseProgressPayload(
    rawJson: string,
    task: { current_progress?: number; work_items?: RdAiWorkItemRef[] },
  ): { progress: number; stage: string; confidence: number; basis: string[]; recommendation: string; work_item_id: string | null } {
    let obj: Record<string, unknown> = {};
    try {
      const cleaned = (rawJson || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
      obj = JSON.parse(cleaned);
    } catch (err) {
      this.logger.warn(`[parseProgressPayload] JSON parse failed: ${(err as Error).message}`);
    }
    const currentProgress = Math.max(0, Math.min(100, Math.round(task.current_progress ?? 0)));
    const rawProgress = Number(obj.progress);
    const progress = Number.isFinite(rawProgress)
      ? Math.max(0, Math.min(100, Math.round(rawProgress)))
      : currentProgress;
    const stage = typeof obj.stage === 'string' && obj.stage.trim() ? obj.stage.trim() : '资料已上传，待 AI 进一步分析';
    const rawConfidence = Number(obj.confidence);
    const confidence = Number.isFinite(rawConfidence) ? Math.max(0, Math.min(100, Math.round(rawConfidence))) : 60;
    const basis = Array.isArray(obj.basis)
      ? obj.basis.map((b) => String(b).trim()).filter(Boolean).slice(0, 6)
      : [];
    const recommendation = typeof obj.recommendation === 'string' && obj.recommendation.trim()
      ? obj.recommendation.trim()
      : '建议人工核对依据并确认进度。';
    // 工作项归属建议：只接受清单内的 id（防模型编造），无清单/不匹配一律 null
    const validItemIds = new Set((task.work_items ?? []).map((it) => it.id));
    const rawWorkItemId = typeof obj.work_item_id === 'string' ? obj.work_item_id.trim() : '';
    const work_item_id = rawWorkItemId && validItemIds.has(rawWorkItemId) ? rawWorkItemId : null;
    return { progress, stage, confidence, basis, recommendation, work_item_id };
  }

  private defaultBaseUrlForProvider(provider: AiProvider): string | undefined {
    return provider === 'qwen' ? DEFAULT_QWEN_BASE_URL : undefined;
  }

  private createClient(
    apiKey: string,
    provider: AiProvider,
    configuredBaseUrl?: string,
    timeoutOverride?: number,
    maxRetriesOverride?: number,
  ): OpenAI {
    const baseURL = configuredBaseUrl ?? this.defaultBaseUrlForProvider(provider);
    return new OpenAI({
      apiKey,
      timeout: timeoutOverride ?? this.timeoutMs,
      // 默认 SDK maxRetries=2，叠加单次超时会让总耗时翻几倍。文件抽取等长超时调用须显式传 0，
      // 否则重试会超出前端 360s 中止窗口，导致"卡住后超时"且后端兜底来不及返回。
      ...(maxRetriesOverride !== undefined ? { maxRetries: maxRetriesOverride } : {}),
      ...(baseURL ? { baseURL } : {}),
    });
  }

  private isExternalAiTimeout(error: unknown): boolean {
    const record = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
    const name = error instanceof Error ? error.name : String(record.name ?? '');
    const message = error instanceof Error ? error.message : String(record.message ?? record.error ?? '');
    const code = String(record.code ?? record.type ?? '').toLowerCase();
    const status = Number(record.status ?? record.statusCode);
    const text = `${name} ${message}`.toLowerCase();
    return (
      text.includes('timeout') ||
      text.includes('timed out') ||
      text.includes('abort') ||
      code.includes('timeout') ||
      code === 'etimedout' ||
      status === 408 ||
      status === 504
    );
  }

  private buildTimeoutProgressFallback(
    task: { current_progress?: number },
    source: 'text' | 'file_text' | 'file_ocr' | 'file_doc_model',
    rawTextLength: number,
  ): RdAiProgressAssessmentResult {
    const progress = Math.max(0, Math.min(100, Math.round(task.current_progress ?? 0)));
    return {
      progress,
      stage: 'AI 服务超时，保持当前进度',
      confidence: 35,
      basis: ['AI 服务在限定时间内未返回结果', '已保留用户提交的进展材料，未自动提高进度'],
      recommendation: '稍后重试或人工确认进度节点。',
      provider: 'local',
      model: 'local-timeout-fallback',
      source,
      raw_text_length: rawTextLength,
    };
  }

  private toExternalAiException(error: unknown, context: string): HttpException {
    if (error instanceof HttpException) return error;
    const message = this.extractExternalAiErrorMessage(error);
    this.logger.warn(`[${context}] ${message}`);
    return new BadGatewayException(`${context}：${message}`);
  }

  private extractExternalAiErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
      return error.message.trim().replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer [redacted]').slice(0, 500);
    }
    if (error && typeof error === 'object') {
      const record = error as Record<string, unknown>;
      const maybeMessage = record.message ?? record.error ?? record.code;
      if (maybeMessage) return String(maybeMessage).slice(0, 500);
    }
    return '第三方 AI 服务返回异常，请检查模型、API Key、Base URL、文件大小和网络连通性';
  }

  // ─── KB file classification ───────────────────────────────────────────────

  /**
   * Classify a list of filenames into KB categories.
   * Uses rule-based scoring first; calls AI for low-confidence files.
   */
  async classifyKbFiles(params: {
    filenames: string[];
    categories: Array<{ id: string; label: string; children?: Array<{ id: string; label: string }> }>;
  }): Promise<Array<{ filename: string; category_id: string | null; confidence: number; method: 'rule' | 'ai' | 'none' }>> {
    const { filenames, categories } = params;
    if (filenames.length === 0) return [];

    const flatCats = this.flattenKbCategories(categories);
    if (flatCats.length === 0) {
      return filenames.map((f) => ({ filename: f, category_id: null, confidence: 0, method: 'none' as const }));
    }

    // Step 1: rule-based
    const results: Array<{ filename: string; category_id: string | null; confidence: number; method: 'rule' | 'ai' | 'none' }> =
      filenames.map((filename) => ({ filename, ...this.ruleBasedKbClassify(filename, flatCats) }));

    // Step 2: AI for low-confidence items (confidence < 0.45)
    const needsAi = results.filter((r) => r.confidence < 0.45);
    if (needsAi.length > 0) {
      try {
        const aiSuggestions = await this.aiKbClassify(
          needsAi.map((r) => r.filename),
          flatCats,
        );
        for (const ai of aiSuggestions) {
          const r = results.find((x) => x.filename === ai.filename);
          if (r && ai.confidence > r.confidence) {
            r.category_id = ai.category_id;
            r.confidence = ai.confidence;
            r.method = 'ai';
          }
        }
      } catch (err) {
        this.logger.warn(`KB AI classify failed, rule-based only: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return results;
  }

  private flattenKbCategories(
    categories: Array<{ id: string; label: string; children?: Array<{ id: string; label: string }> }>,
  ): Array<{ id: string; label: string }> {
    const result: Array<{ id: string; label: string }> = [];
    for (const cat of categories) {
      result.push({ id: cat.id, label: cat.label });
      for (const child of cat.children ?? []) {
        result.push({ id: child.id, label: child.label });
      }
    }
    return result;
  }

  private ruleBasedKbClassify(
    filename: string,
    cats: Array<{ id: string; label: string }>,
  ): { category_id: string | null; confidence: number; method: 'rule' } {
    const base = filename.replace(/\.[^.]+$/, '').toLowerCase();
    const ext = (filename.split('.').pop() ?? '').toLowerCase();

    // Extension → thematic keywords
    const EXT_KEYWORDS: Record<string, string[]> = {
      pdf:  ['文档', '说明', '规范', '报告', '手册', '设计'],
      doc:  ['文档', '说明', '规范', '报告', '手册'],
      docx: ['文档', '说明', '规范', '报告', '手册'],
      xls:  ['数据', '统计', '表格', '报表'],
      xlsx: ['数据', '统计', '表格', '报表'],
      ppt:  ['演示', '汇报', '方案', '设计'],
      pptx: ['演示', '汇报', '方案', '设计'],
      png:  ['图片', '截图', '设计', 'UI'],
      jpg:  ['图片', '截图', '照片'],
      jpeg: ['图片', '截图', '照片'],
      gif:  ['图片', '动图'],
      svg:  ['图片', '设计', 'UI'],
      mp4:  ['视频', '演示', '录制'],
      avi:  ['视频', '录制'],
      mov:  ['视频', '录制'],
      md:   ['文档', '说明', '规范', 'readme'],
      txt:  ['文档', '说明', '日志'],
      json: ['数据', '配置', '接口', 'API'],
      yaml: ['配置', '运维', '部署'],
      yml:  ['配置', '运维', '部署'],
      zip:  ['资源', '附件', '归档'],
      rar:  ['资源', '附件', '归档'],
    };

    // Filename patterns → thematic keywords
    const NAME_PATTERNS: Array<{ re: RegExp; hints: string[] }> = [
      { re: /需求|prd|brd|requirement|spec|产品规格/i,          hints: ['需求', '产品', '功能'] },
      { re: /架构|arch|design|设计|blueprint|方案|solution/i,   hints: ['架构', '设计', '方案'] },
      { re: /api|接口|swagger|openapi|endpoint|rest/i,          hints: ['API', '接口', '开发', '技术'] },
      { re: /测试|test|qa|bug|issue|defect|case/i,              hints: ['测试', 'QA'] },
      { re: /部署|deploy|运维|devops|ci|cd|pipeline|k8s/i,      hints: ['运维', '部署', '基础设施'] },
      { re: /安全|security|auth|权限|加密|encrypt/i,             hints: ['安全', '权限'] },
      { re: /数据库|database|db|sql|schema|migration/i,         hints: ['数据', '数据库', '后端'] },
      { re: /ui|ux|原型|prototype|wireframe|figma|mockup|界面/i, hints: ['UI', 'UX', '设计', '原型'] },
      { re: /报告|report|汇报|总结|summary|review|周报|月报/i,   hints: ['报告', '总结', '文档'] },
      { re: /培训|training|教程|tutorial|guide|手册|onboard/i,  hints: ['培训', '文档', '手册'] },
      { re: /流程|process|workflow|业务|bpmn/i,                  hints: ['流程', '业务', '规范'] },
      { re: /算法|algorithm|model|模型|ai|ml|nlp|deep/i,        hints: ['算法', 'AI', '技术'] },
      { re: /readme|changelog|license|contributing/i,           hints: ['文档', '开源', '说明'] },
    ];

    const hints: string[] = [...(EXT_KEYWORDS[ext] ?? [])];
    for (const { re, hints: h } of NAME_PATTERNS) {
      if (re.test(base)) hints.push(...h);
    }

    if (hints.length === 0) return { category_id: null, confidence: 0, method: 'rule' };

    // Score each category: count hint tokens that appear in the label (or vice-versa)
    let best: { id: string; score: number } | null = null;
    for (const cat of cats) {
      const label = cat.label.toLowerCase();
      let score = 0;
      for (const hint of hints) {
        const h = hint.toLowerCase();
        if (label.includes(h) || h.includes(label)) score += 1;
      }
      if (score > 0 && (!best || score > best.score)) {
        best = { id: cat.id, score };
      }
    }

    if (!best) return { category_id: null, confidence: 0, method: 'rule' };

    // Normalise confidence: cap at 0.88 to leave room for AI to potentially override
    const confidence = Math.min(best.score / Math.max(hints.length * 0.5, 1), 0.88);
    return { category_id: best.id, confidence, method: 'rule' };
  }

  private async aiKbClassify(
    filenames: string[],
    cats: Array<{ id: string; label: string }>,
  ): Promise<Array<{ filename: string; category_id: string | null; confidence: number; method: 'ai' }>> {
    const selectedModel = await this.resolveSceneModelConfig('file_task_extract').catch(() => null)
      ?? await this.resolveDefaultConfiguredModel().catch(() => null)
      ?? null;

    if (!selectedModel) {
      return filenames.map((f) => ({ filename: f, category_id: null, confidence: 0, method: 'ai' as const }));
    }

    const catList = cats.map((c) => `  {"id":"${c.id}","label":"${c.label}"}`).join(',\n');
    const fileList = filenames.map((f, i) => `${i + 1}. ${f}`).join('\n');

    const prompt =
      `你是一个文件分类助手。根据文件名，将每个文件分配到最合适的知识库分类。\n\n` +
      `可用分类（JSON 数组）：\n[\n${catList}\n]\n\n` +
      `需要分类的文件：\n${fileList}\n\n` +
      `请仅返回 JSON，格式：{"results":[{"filename":"...","category_id":"...","confidence":0.0-1.0}]}\n` +
      `无法判断时 category_id 为 null，confidence 为 0。`;

    const client = this.createClient(selectedModel.apiKey, selectedModel.provider, selectedModel.baseUrl);

    let raw = '';
    try {
      const response = await client.chat.completions.create({
        model: selectedModel.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        max_tokens: 800,
        ...(selectedModel.provider === 'qwen' ? ({ enable_thinking: false } as Record<string, unknown>) : {}),
      });
      raw = response.choices[0]?.message?.content ?? '';
    } catch {
      return filenames.map((f) => ({ filename: f, category_id: null, confidence: 0, method: 'ai' as const }));
    }

    let parsed: { results?: unknown[] } = {};
    try {
      const match = raw.match(/\{[\s\S]*\}/);
      if (match) parsed = JSON.parse(match[0]) as typeof parsed;
    } catch {
      return filenames.map((f) => ({ filename: f, category_id: null, confidence: 0, method: 'ai' as const }));
    }

    const rows = Array.isArray(parsed.results) ? parsed.results : [];
    return filenames.map((filename) => {
      const row = (rows as Array<{ filename?: string; category_id?: string; confidence?: number }>)
        .find((r) => r.filename === filename);
      if (!row) return { filename, category_id: null, confidence: 0, method: 'ai' as const };
      const validCat = cats.find((c) => c.id === row.category_id);
      return {
        filename,
        category_id: validCat ? (row.category_id ?? null) : null,
        confidence: Math.min(Math.max(Number(row.confidence ?? 0), 0), 1),
        method: 'ai' as const,
      };
    });
  }

  // ── 日报智能汇总 ─────────────────────────────────────────────────────────
  // 输入当日活动数据，返回 LLM 生成的中文日报正文。
  // AI 未配置 / 调用失败时返回 null，由调用方回退到本地拼接版本。
  async summarizeDailyReport(input: {
    userName: string;
    date: string;
    stats: {
      totalTasks: number;
      inProgress: number;
      completed: number;
      blocked: number;
      pending: number;
      notesCount: number;
      stalled?: number;
      asCollaborator?: number;
    };
    tasks: Array<{
      title: string;
      role: '主责' | '协作';
      statusLabel: string;
      group: 'completed_today' | 'progressed' | 'stalled' | 'blocked';
      progress?: number | null;
      dueDate?: string | null;
      todayExcerpt?: string | null;
      todayAttachments?: number;
      blockedReason?: string | null;
    }>;
  }): Promise<{ text: string; model: string; provider: AiProvider } | null> {
    const selectedModel = await this.resolveSceneModelConfig('daily_report_summary').catch(() => null);
    if (!selectedModel?.apiKey) return null;

    const provider: AiProvider = selectedModel.provider;
    const model = selectedModel.model;
    const baseUrl = selectedModel.baseUrl;

    const { userName, date, stats, tasks } = input;
    const systemPrompt =
      '你是一名研发主管的智能助理，负责把某成员当日的全部任务动态汇总成精炼、可读的中文日报。' +
      '要求：(1) 全文不超过 350 字；(2) 使用「📊 任务概况 / ✍️ 今日推进 / ⚠️ 需关注 / 🎯 下一步建议」四段式结构；' +
      '(3) 覆盖该成员当日所有相关任务（含其协作的任务），而不仅仅是有进度记录的任务；' +
      '(4) 客观描述事实，不要编造未提供的信息；(5) 数据为 0 的段落允许省略；' +
      '(6)「需关注」段优先点名「阻塞」与「停滞·今日无进展」的任务；' +
      '(7) 结尾给出 1 句具体的下一步行动建议（如有阻塞优先提该项）。';

    const groupLabels: Record<string, string> = {
      completed_today: '今日完成',
      progressed: '今日有进展',
      stalled: '停滞·今日无进展',
      blocked: '阻塞·需关注',
    };
    const groupOrder = ['completed_today', 'progressed', 'stalled', 'blocked'];

    const tasksBlock = tasks.length === 0
      ? '今日无需要关注的任务动态。'
      : groupOrder
          .map((groupKey) => {
            const groupItems = tasks.filter((t) => t.group === groupKey);
            if (groupItems.length === 0) return '';
            const header = `【${groupLabels[groupKey]}】（${groupItems.length}）`;
            const lines = groupItems.map((t) => {
              const roleTag = t.role === '协作' ? '[协作] ' : '';
              const progress = typeof t.progress === 'number' ? ` 进度${t.progress}%` : '';
              const due = t.dueDate ? ` 截止${t.dueDate}` : '';
              const att = (t.todayAttachments ?? 0) > 0 ? ` ·${t.todayAttachments}附件` : '';
              const detail = t.group === 'blocked' && t.blockedReason
                ? ` — 阻塞原因：${t.blockedReason}`
                : t.todayExcerpt
                  ? ` — ${t.todayExcerpt.trim().slice(0, 120)}`
                  : '';
              return `  · ${roleTag}《${t.title}》(${t.statusLabel}${progress}${due}${att})${detail}`;
            });
            return [header, ...lines].join('\n');
          })
          .filter(Boolean)
          .join('\n');

    const overviewParts = [
      `总任务 ${stats.totalTasks}`,
      `主责 ${stats.totalTasks - (stats.asCollaborator ?? 0)}`,
      `协作 ${stats.asCollaborator ?? 0}`,
      `进行中 ${stats.inProgress}`,
      `已完成 ${stats.completed}`,
      `阻塞 ${stats.blocked}`,
      `停滞 ${stats.stalled ?? 0}`,
      `待办 ${stats.pending}`,
    ];

    const userMessage = [
      `用户：${userName}`,
      `日期：${date}`,
      '',
      '【任务概况】',
      overviewParts.join(' · '),
      '',
      '【当日任务动态（按分组）】',
      tasksBlock,
    ].join('\n');

    const client = this.createClient(selectedModel.apiKey, provider, baseUrl);
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        ...(provider === 'qwen' ? ({ enable_thinking: false } as Record<string, unknown>) : {}),
      });
      const text = (response.choices[0]?.message?.content ?? '').trim();
      if (!text) return null;
      return { text, model, provider };
    } catch (error) {
      // AI 失败不阻塞日报生成，记录后让调用方走本地兜底
      // eslint-disable-next-line no-console
      console.warn('[summarizeDailyReport] AI call failed:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * 月报智能汇总：把某成员当月的全部任务画像汇总成主题化、可读的中文月报。
   * 复用 daily_report_summary 的模型解析与 qwen 分支；未配置/失败返回 null 让调用方走本地兜底。
   */
  async summarizeMonthlyReport(input: {
    userName: string;
    monthLabel: string;
    stats: {
      totalTasks: number;
      inProgress: number;
      completed: number;
      blocked: number;
      pending: number;
      notesCount: number;
      stalled?: number;
      asCollaborator?: number;
      progressed?: number;
    };
    tasks: Array<{
      title: string;
      role: '主责' | '协作';
      statusLabel: string;
      group: 'completed' | 'progressed' | 'stalled' | 'blocked';
      progress?: number | null;
      dueDate?: string | null;
      monthNotesCount?: number;
      monthExcerpt?: string | null;
      monthAttachments?: number;
      blockedReason?: string | null;
      overdue?: boolean;
    }>;
  }): Promise<{ text: string; model: string; provider: AiProvider } | null> {
    const selectedModel = await this.resolveSceneModelConfig('monthly_report_summary').catch(() => null);
    if (!selectedModel?.apiKey) return null;

    const provider: AiProvider = selectedModel.provider;
    const model = selectedModel.model;
    const baseUrl = selectedModel.baseUrl;

    const { userName, monthLabel, stats, tasks } = input;
    const systemPrompt =
      '你是一名研发主管的智能助理，负责把某成员当月的全部任务动态汇总成结构化、可读的中文月报。' +
      '要求：(1) 全文 500~800 字；(2) 采用「📊 月度概况 / 🏆 关键成果 / 🚧 阻塞与停滞 / 📈 趋势与节奏 / 🎯 下月计划」五段式结构；' +
      '(3)「关键成果」要提炼主题与里程碑，而非把任务逐条罗列；(4) 客观描述事实，不要编造未提供的信息；' +
      '(5) 数据为 0 的段落允许省略；(6)「阻塞与停滞」段优先点名风险任务并给出协调建议；' +
      '(7) 结尾在「下月计划」给出 2~3 条具体、可执行的建议。';

    const groupLabels: Record<string, string> = {
      completed: '本月完成',
      progressed: '本月推进',
      blocked: '月末仍阻塞',
      stalled: '长期停滞',
    };
    const groupOrder = ['completed', 'progressed', 'blocked', 'stalled'];

    const tasksBlock =
      tasks.length === 0
        ? '本月无可统计的任务动态。'
        : groupOrder
            .map((groupKey) => {
              const groupItems = tasks.filter((t) => t.group === groupKey);
              if (groupItems.length === 0) return '';
              const header = `【${groupLabels[groupKey]}】（${groupItems.length}）`;
              const lines = groupItems.map((t) => {
                const roleTag = t.role === '协作' ? '[协作] ' : '';
                const progress = typeof t.progress === 'number' ? ` 进度${t.progress}%` : '';
                const due = t.dueDate ? ` 截止${t.dueDate}` : '';
                const overdue = t.overdue ? ' ·已逾期' : '';
                const noteCount = (t.monthNotesCount ?? 0) > 0 ? ` ·本月${t.monthNotesCount}条记录` : '';
                const detail =
                  t.group === 'blocked' && t.blockedReason
                    ? ` — 阻塞原因：${t.blockedReason}`
                    : t.monthExcerpt
                      ? ` — ${t.monthExcerpt.trim().slice(0, 140)}`
                      : '';
                return `  · ${roleTag}《${t.title}》(${t.statusLabel}${progress}${due}${overdue}${noteCount})${detail}`;
              });
              return [header, ...lines].join('\n');
            })
            .filter(Boolean)
            .join('\n');

    const overviewParts = [
      `相关任务 ${stats.totalTasks}`,
      `主责 ${stats.totalTasks - (stats.asCollaborator ?? 0)}`,
      `协作 ${stats.asCollaborator ?? 0}`,
      `完成 ${stats.completed}`,
      `推进 ${stats.progressed ?? 0}`,
      `进行中 ${stats.inProgress}`,
      `阻塞 ${stats.blocked}`,
      `停滞 ${stats.stalled ?? 0}`,
      `待办 ${stats.pending}`,
      `进度记录 ${stats.notesCount} 条`,
    ];

    const userMessage = [
      `用户：${userName}`,
      `月份：${monthLabel}`,
      '',
      '【月度概况】',
      overviewParts.join(' · '),
      '',
      '【当月任务动态（按分组）】',
      tasksBlock,
    ].join('\n');

    const client = this.createClient(selectedModel.apiKey, provider, baseUrl);
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        ...(provider === 'qwen' ? ({ enable_thinking: false } as Record<string, unknown>) : {}),
      });
      const text = (response.choices[0]?.message?.content ?? '').trim();
      if (!text) return null;
      return { text, model, provider };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[summarizeMonthlyReport] AI call failed:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * 月度绩效评估：基于客观指标 + 任务画像生成一份正式、宽容的中文绩效考核结论。
   * 评分与评级由后端计算后传入，AI 不得自行改动；未配置/失败返回 null 让调用方走本地兜底。
   */
  async assessPerformance(input: {
    userName: string;
    monthLabel: string;
    score: number;
    grade: string;
    metrics: {
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
    tasks: Array<{
      title: string;
      role: '主责' | '协作';
      statusLabel: string;
      group: 'completed' | 'progressed' | 'stalled' | 'blocked';
      progress?: number | null;
      dueDate?: string | null;
      monthNotesCount?: number;
      monthExcerpt?: string | null;
      blockedReason?: string | null;
      overdue?: boolean;
    }>;
  }): Promise<{ text: string; model: string; provider: AiProvider } | null> {
    const selectedModel = await this.resolveSceneModelConfig('performance_review').catch(() => null);
    if (!selectedModel?.apiKey) return null;

    const provider: AiProvider = selectedModel.provider;
    const model = selectedModel.model;
    const baseUrl = selectedModel.baseUrl;

    const { userName, monthLabel, score, grade, metrics, tasks } = input;
    const systemPrompt =
      '你是一名研发主管，正在为团队成员撰写正式的月度绩效考核结论。' +
      '评价取向：以鼓励和发展为主，宽容而不苛刻——充分肯定投入与产出，用建设性、正面的语气提出改进项，避免负面定性与情绪化措辞。' +
      '请输出一份正式的中文绩效评价正文，严格采用如下分节（用「一、二、三、四、五、六、七」中文序号开头，分节之间空一行）：' +
      '一、考核周期；二、被考核人；三、工作量与产出（结合给定客观指标如实描述）；四、综合评价（积极、肯定为主）；' +
      '五、主要亮点（结合本月完成的任务，列 2~4 条）；六、改进建议（建设性、1~3 条）；' +
      '七、综合评分（直接采用给定的分数与评级，不要自行改动数值）。' +
      '全文 500~800 字，措辞正式、得体，适合作为正式绩效文件归档。直接输出正文，不要额外解释。';

    const groupLabels: Record<string, string> = {
      completed: '本月完成',
      progressed: '本月推进',
      blocked: '月末仍阻塞',
      stalled: '长期停滞',
    };
    const groupOrder = ['completed', 'progressed', 'blocked', 'stalled'];
    const tasksBlock =
      tasks.length === 0
        ? '本月无可统计的任务动态。'
        : groupOrder
            .map((groupKey) => {
              const groupItems = tasks.filter((t) => t.group === groupKey);
              if (groupItems.length === 0) return '';
              const header = `【${groupLabels[groupKey]}】（${groupItems.length}）`;
              const lines = groupItems.map((t) => {
                const roleTag = t.role === '协作' ? '[协作] ' : '';
                const progress = typeof t.progress === 'number' ? ` 进度${t.progress}%` : '';
                const detail =
                  t.group === 'blocked' && t.blockedReason
                    ? ` — 阻塞：${t.blockedReason}`
                    : t.monthExcerpt
                      ? ` — ${t.monthExcerpt.trim().slice(0, 120)}`
                      : '';
                return `  · ${roleTag}《${t.title}》(${t.statusLabel}${progress})${detail}`;
              });
              return [header, ...lines].join('\n');
            })
            .filter(Boolean)
            .join('\n');

    const metricsBlock = [
      `任务总数 ${metrics.total_tasks}（主责 ${metrics.owner_tasks} · 协作 ${metrics.collab_tasks}）`,
      `本月完成 ${metrics.completed}`,
      `推进中 ${metrics.in_progress}`,
      `阻塞 ${metrics.blocked}`,
      `停滞 ${metrics.stalled}`,
      `逾期 ${metrics.overdue_tasks}`,
      `任务完成率 ${metrics.completion_rate}%`,
      `进度记录 ${metrics.notes_count} 条`,
      `上传材料 ${metrics.attachments_count} 个`,
    ].join(' · ');

    const userMessage = [
      `被考核人：${userName}`,
      `考核周期：${monthLabel}`,
      `综合评分（请直接采用）：${score} 分`,
      `评级（请直接采用）：${grade}`,
      '',
      '【客观指标】',
      metricsBlock,
      '',
      '【本月任务明细（按分组）】',
      tasksBlock,
    ].join('\n');

    const client = this.createClient(selectedModel.apiKey, provider, baseUrl);
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        ...(provider === 'qwen' ? ({ enable_thinking: false } as Record<string, unknown>) : {}),
      });
      const text = (response.choices[0]?.message?.content ?? '').trim();
      if (!text) return null;
      return { text, model, provider };
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[assessPerformance] AI call failed:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * 为绩效考核表逐项填写「具体业务事项」「评价标准」。支持两类：
   * - category='item'（事项指标）：把本月任务归入各考核项目并概括；
   * - category='behavior'（行为指标）：结合本月任务描述该成员如何体现某项行为素质，
   *   可携带 hintItem/hintStandard 作为默认释义与评分规则的锚点。
   * 结果与入参 items 对齐返回；AI 未配置/失败/解析异常时返回 null，由调用方回退。
   */
  async assessKpiItems(input: {
    userName: string;
    monthLabel: string;
    position?: string | null;
    category: 'item' | 'behavior';
    items: Array<{ name: string; weight: string; hintItem?: string; hintStandard?: string }>;
    tasks: Array<{
      title: string;
      role: '主责' | '协作';
      statusLabel: string;
      group: 'completed' | 'progressed' | 'stalled' | 'blocked';
      progress?: number | null;
      monthExcerpt?: string | null;
      blockedReason?: string | null;
    }>;
  }): Promise<Array<{ name: string; business: string; standard: string }> | null> {
    const selectedModel = await this.resolveSceneModelConfig('performance_review').catch(() => null);
    if (!selectedModel?.apiKey) return null;
    if (input.items.length === 0) return null;

    const provider: AiProvider = selectedModel.provider;
    const model = selectedModel.model;
    const baseUrl = selectedModel.baseUrl;

    const { userName, monthLabel, position, category, items, tasks } = input;
    const groupLabels: Record<string, string> = {
      completed: '本月完成',
      progressed: '本月推进',
      blocked: '月末仍阻塞',
      stalled: '长期停滞',
    };
    const tasksBlock =
      tasks.length === 0
        ? '本月无可统计的任务动态。'
        : tasks
            .map((t) => {
              const roleTag = t.role === '协作' ? '[协作] ' : '';
              const progress = typeof t.progress === 'number' ? ` 进度${t.progress}%` : '';
              const detail =
                t.group === 'blocked' && t.blockedReason
                  ? ` — 阻塞：${t.blockedReason}`
                  : t.monthExcerpt
                    ? ` — ${t.monthExcerpt.trim().slice(0, 220)}`
                    : '';
              return `· ${roleTag}《${t.title}》(${groupLabels[t.group] ?? t.statusLabel}${progress})${detail}`;
            })
            .join('\n');

    // 行为指标携带默认释义/评分规则作为锚点，事项指标仅列名称与权重。
    const itemsList = items
      .map((it, i) => {
        const hint = [
          it.hintItem ? `释义：${it.hintItem}` : '',
          it.hintStandard ? `参考评价标准：${it.hintStandard.replace(/\n/g, ' ')}` : '',
        ]
          .filter(Boolean)
          .join('；');
        return `${i + 1}. ${it.name}（权重${it.weight}）${hint ? ` —— ${hint}` : ''}`;
      })
      .join('\n');
    const systemPrompt =
      category === 'behavior'
        ? '你是一名研发主管，正在填写团队成员《月度绩效考核表》的「行为指标」部分。' +
          '针对给定的每一项行为素质（含释义），结合该成员本月的真实任务，产出两段正式的中文：' +
          'business=「具体业务事项」——结合本月真实任务，具体说明其如何体现该项行为素质（80~150字）；' +
          '要落到具体事情：点名相关任务/项目名称、其中的关键动作与承担的责任，并尽量给出可量化细节（数量、进度、结果、时间节点）；' +
          '语气保持客观中性：只陈述事实与进度状态，不做「严重不足 / 执行力差 / 缺乏担当」等主观贬义定性，也不作情绪化评判或拔高褒扬；' +
          '严禁只写空泛套话（如「工作认真、积极主动」），必须有可核对的事实支撑；若确无明显体现，再依释义客观概述；' +
          'standard=「评价标准」——该项行为的评价标准（20~50字，正式；若给定「参考评价标准」含明确评分规则如频率对应分数，必须完整保留该规则原文）。' +
          '严格只输出 JSON 数组，元素形如 {"name":"行为项原文","business":"...","standard":"..."}，' +
          'name 必须与给定行为项完全一致、数量一致、顺序一致，不要输出 JSON 以外的任何文字或代码块标记。'
        : '你是一名研发主管，正在填写团队成员《月度绩效考核表》的「事项指标」部分。' +
          '针对给定的每个考核项目，结合该成员本月的真实任务，产出正式的中文：' +
          'business=「具体业务事项」——用【概括、汇总性的书面语言】提炼该成员本月在该考核项目下的工作，整理成编号分条列表' +
          '（格式「1.……\n2.……」，条目之间用真实换行符 \\n 分隔，一般 2~5 条）；' +
          '核心要求：按主题/类别归纳，把多个相关任务【合并成一条进行总结陈述】，而不是把每个任务机械地逐条罗列、也不要对每条重复相同句式（如反复写"处于停滞状态"）；' +
          '每条用一句概括性的话说明"围绕某方向做了哪类工作、取得什么结果"，可点名 1~2 个代表性任务/项目/版本作为例证并带关键量化细节；' +
          '参考写法（示范这种"归并总结"的风格，勿照抄内容）：「1.围绕压缩机散热与微压性能开展多项测试验证，完成9A18/9A19版本软件功能确认及电子流量计对比测试（偏差超1.5L，判定方案不可用）；2.完成双铝膜、储气罐螺丝等多份ECN的编写与发布，保证变更受控。」；' +
          '语气客观中性、正式：只陈述事实与整体进展（如"完成/推进中/多项待启动或停滞"），不做「严重不足 / 执行力差 / 滞后严重 / 有待加强 / 不足 / 薄弱」等任何褒贬评价定性，也不拔高褒扬（评价交由打分栏），避免机械枯燥的流水账；' +
          '若确无相关任务，写「本月无相关任务记录」（此时可不分条）；' +
          'standard=「评价标准」——该考核项目可衡量的评价标准（20~50字，正式、通用，如按期交付、质量达标、闭环率等）。' +
          '严格只输出 JSON 数组，元素形如 {"name":"考核项目原文","business":"...","standard":"..."}，' +
          'name 必须与给定考核项目完全一致、数量一致、顺序一致，不要输出 JSON 以外的任何文字或代码块标记。';
    const userMessage = [
      `被考核人：${userName}`,
      position ? `岗位：${position}` : '',
      `考核周期：${monthLabel}`,
      '',
      category === 'behavior' ? '【行为指标（需逐项填写）】' : '【考核项目（需逐项填写）】',
      itemsList,
      '',
      '【本月任务明细】',
      tasksBlock,
    ]
      .filter(Boolean)
      .join('\n');

    const client = this.createClient(selectedModel.apiKey, provider, baseUrl);
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        ...(provider === 'qwen' ? ({ enable_thinking: false } as Record<string, unknown>) : {}),
      });
      const raw = (response.choices[0]?.message?.content ?? '').trim();
      if (!raw) return null;
      // 容错：剥离可能的 ```json 代码块围栏，再截取首个 [...] 数组片段解析。
      const stripped = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      const start = stripped.indexOf('[');
      const end = stripped.lastIndexOf(']');
      if (start < 0 || end <= start) return null;
      const parsed: unknown = JSON.parse(stripped.slice(start, end + 1));
      if (!Array.isArray(parsed)) return null;
      const byName = new Map<string, { business: string; standard: string }>();
      for (const el of parsed) {
        if (!el || typeof el !== 'object') continue;
        const rec = el as Record<string, unknown>;
        const name = typeof rec.name === 'string' ? rec.name.trim() : '';
        if (!name) continue;
        byName.set(name, {
          business: typeof rec.business === 'string' ? rec.business.trim().slice(0, 200) : '',
          standard: typeof rec.standard === 'string' ? rec.standard.trim().slice(0, 200) : '',
        });
      }
      // 以入参 items 为准对齐输出，保证名称/顺序/数量与考核表一致。
      return items.map((it) => ({
        name: it.name,
        business: byName.get(it.name)?.business ?? '',
        standard: byName.get(it.name)?.standard ?? '',
      }));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[assessKpiItems] AI call failed:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * 事项指标（80分）——由 AI 根据本月真实任务【动态归纳考核项目(title)】并逐项填写。
   * 返回 4~6 条 {name(考核项目), weight(整数,合计=80), business(编号分条汇总), standard}；
   * 权重合计会在此校正为 80。AI 未配置/失败/解析异常时返回 null，由调用方回退到固定项。
   */
  async generatePerformanceItemKpis(input: {
    userName: string;
    monthLabel: string;
    position?: string | null;
    tasks: Array<{
      title: string;
      role: '主责' | '协作';
      statusLabel: string;
      group: 'completed' | 'progressed' | 'stalled' | 'blocked';
      progress?: number | null;
      monthExcerpt?: string | null;
      blockedReason?: string | null;
    }>;
  }): Promise<Array<{ name: string; weight: string; business: string; standard: string }> | null> {
    const selectedModel = await this.resolveSceneModelConfig('performance_review').catch(() => null);
    if (!selectedModel?.apiKey) return null;
    if (input.tasks.length === 0) return null; // 无任务则回退固定项（避免 AI 凭空编造考核项目）

    const provider: AiProvider = selectedModel.provider;
    const { userName, monthLabel, position, tasks } = input;
    const groupLabels: Record<string, string> = {
      completed: '本月完成',
      progressed: '本月推进',
      blocked: '月末仍阻塞',
      stalled: '长期停滞',
    };
    const tasksBlock = tasks
      .map((t) => {
        const roleTag = t.role === '协作' ? '[协作] ' : '';
        const progress = typeof t.progress === 'number' ? ` 进度${t.progress}%` : '';
        const detail =
          t.group === 'blocked' && t.blockedReason
            ? ` — 阻塞：${t.blockedReason}`
            : t.monthExcerpt
              ? ` — ${t.monthExcerpt.trim().slice(0, 220)}`
              : '';
        return `· ${roleTag}《${t.title}》(${groupLabels[t.group] ?? t.statusLabel}${progress})${detail}`;
      })
      .join('\n');

    const systemPrompt =
      '你是一名研发主管，正在填写团队成员《月度绩效考核表》的「一、事项指标（80分）」部分。' +
      '请根据该成员本月的真实任务，把工作【归纳为若干核心工作类别】作为"考核项目"，并逐项填写。要求：' +
      '1) 归纳出 4~6 个考核项目，name 要概括、专业、贴合其本月实际工作（示例风格如「产品测试与参数验证」「工装设计、3D打印与结构验证」「异常问题分析与改善验证」「ECN文件管理与技术文档输出」「研发协同、供应商对接与项目推进」「团队支持与领导交办事项」——按实际工作命名，不要照抄这些示例）；' +
      '2) weight=分值权重，为正整数，按各类工作的重要性与工作量分配，且【所有项 weight 之和必须正好等于 80】；' +
      '3) business=具体业务事项：用概括、汇总性的书面语言，整理成编号分条列表（格式「1.……\n2.……」，用真实换行符 \\n 分隔，一般 4~7 条，内容要充实丰富）；' +
      '要尽量把该类别下本月涉及的相关任务都归纳覆盖进来，勿遗漏主要工作、也不要过度合并成一两条；' +
      '每条不只写"做了什么"，还要写清楚：具体对象（点名任务/项目/版本/文件/物料等）、关键动作、以及产出或结果/进展状态，可带量化细节（数量、版本号、指标、偏差值等），使每条信息饱满、可核对；' +
      '语气客观中性、只陈述事实与进展状态，不做「严重不足/执行力差/有待加强」等褒贬评价定性，也不拔高，但避免每条都干巴巴的一句话，力求内容具体、有信息量；' +
      '4) standard=评价标准：该类工作可衡量的评价标准（20~50字，正式、通用）。' +
      '严格只输出 JSON 数组，元素形如 {"name":"考核项目","weight":30,"business":"1.…\\n2.…","standard":"…"}，4~6 个元素，不要输出 JSON 以外的任何文字或代码块标记。';
    const userMessage = [
      `被考核人：${userName}`,
      position ? `岗位：${position}` : '',
      `考核周期：${monthLabel}`,
      '',
      '【本月任务明细】',
      tasksBlock,
    ]
      .filter(Boolean)
      .join('\n');

    const client = this.createClient(selectedModel.apiKey, provider, selectedModel.baseUrl);
    try {
      const response = await client.chat.completions.create({
        model: selectedModel.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        ...(provider === 'qwen' ? ({ enable_thinking: false } as Record<string, unknown>) : {}),
      });
      const raw = (response.choices[0]?.message?.content ?? '').trim();
      if (!raw) return null;
      const stripped = raw.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
      const start = stripped.indexOf('[');
      const end = stripped.lastIndexOf(']');
      if (start < 0 || end <= start) return null;
      const parsed: unknown = JSON.parse(stripped.slice(start, end + 1));
      if (!Array.isArray(parsed)) return null;

      const rows = parsed
        .filter((el): el is Record<string, unknown> => Boolean(el) && typeof el === 'object' && !Array.isArray(el))
        .map((rec) => ({
          name: typeof rec.name === 'string' ? rec.name.trim().slice(0, 40) : '',
          weight: Math.max(0, Math.round(Number(rec.weight))) || 0,
          business: typeof rec.business === 'string' ? rec.business.trim().slice(0, 700) : '',
          standard: typeof rec.standard === 'string' ? rec.standard.trim().slice(0, 200) : '',
        }))
        .filter((r) => r.name)
        .slice(0, 6);
      if (rows.length < 2) return null; // 项目太少视为无效，回退固定项

      // 校正权重合计=80：把差额并入权重最大的一项，保证考核表分值自洽。
      const sum = rows.reduce((acc, r) => acc + r.weight, 0);
      if (sum !== 80 && rows.length > 0) {
        let maxIdx = 0;
        for (let i = 1; i < rows.length; i++) if (rows[i].weight > rows[maxIdx].weight) maxIdx = i;
        rows[maxIdx].weight = Math.max(1, rows[maxIdx].weight + (80 - sum));
      }
      return rows.map((r) => ({ ...r, weight: String(r.weight) }));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[generatePerformanceItemKpis] AI call failed:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  /**
   * 任务合并时重写合并后的任务描述：综合目标任务与被合并任务的描述，去重、条理化，输出一段正文。
   * 复用 progress_summary 场景模型；未配置/失败返回 null，由调用方拼接兜底。
   */
  async mergeTaskDescriptions(input: {
    targetTitle: string;
    targetDescription: string;
    sourceTitle: string;
    sourceDescription: string;
  }): Promise<string | null> {
    const selectedModel = await this.resolveSceneModelConfig('progress_summary').catch(() => null);
    if (!selectedModel?.apiKey) return null;
    const provider: AiProvider = selectedModel.provider;
    const client = this.createClient(selectedModel.apiKey, provider, selectedModel.baseUrl);
    const systemPrompt =
      '你在把两条研发任务合并为一条。请综合二者的任务描述，输出一段【合并后的任务描述】：' +
      '保留两边的关键目标、范围与要点，去除重复，条理清晰、客观简洁（150字以内）。只输出描述正文，不要任何前后缀或解释。';
    const userMessage = [
      `【目标任务（保留）】${input.targetTitle}`,
      input.targetDescription || '（无描述）',
      '',
      `【被合并任务】${input.sourceTitle}`,
      input.sourceDescription || '（无描述）',
    ].join('\n');
    try {
      const response = await client.chat.completions.create({
        model: selectedModel.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        ...(provider === 'qwen' ? ({ enable_thinking: false } as Record<string, unknown>) : {}),
      });
      const text = (response.choices[0]?.message?.content ?? '').trim();
      return text || null;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[mergeTaskDescriptions] AI call failed:', error instanceof Error ? error.message : error);
      return null;
    }
  }

  // ── 附件内容抽取（L1+L2+L3：OCR + 文档抽取 + 视觉模型兜底）─────────────────

  /**
   * 统一附件文本抽取入口。按文件类型分发：
   * - 纯文本（txt/md/csv/json/...）：直接 utf8 读
   * - 图片（png/jpg/...）：腾讯 OCR（GeneralAccurateOCR）→ 文字 < 5 字时 fallback Qwen-VL 视觉描述
   * - 文档（pdf/doc/docx/xls/xlsx/ppt/pptx）：腾讯 ExtractDocBasic → 失败/无文字 fallback Qwen doc-turbo
   * - 其它：跳过
   *
   * 设计为 best-effort：内部任何外部 API 失败都吞掉返回 source: "failed"，由调用方决定是否记录。
   * 返回的 text 已做长度截断（最大 8000 字符），避免后续 prompt 过大。
   */
  async extractAttachmentText(file: RdAiUploadedFile): Promise<{
    text: string;
    source: 'ocr' | 'vision' | 'doc_extract' | 'doc_model' | 'text' | 'failed' | 'skipped';
  }> {
    const MAX_CHARS = 8000;
    const ext = this.extOf(file.originalname);

    // 1. 纯文本类
    if (PLAIN_TEXT_EXT.has(ext)) {
      const text = this.safeUtf8(file.buffer).trim().slice(0, MAX_CHARS);
      return { text, source: text ? 'text' : 'failed' };
    }

    // 2. 图片：OCR 优先，文字过少时 fallback vision
    if (IMAGE_EXT.has(ext)) {
      let ocrText = '';
      if (await this.ocrService.hasTencentConfig().catch(() => false)) {
        try {
          const ocr = await this.ocrService.recognizeWithTencent(
            { originalname: file.originalname, buffer: file.buffer, mimetype: file.mimetype },
            { documentKind: 'invoice', serviceKey: 'accurate_text' },
          );
          ocrText = (ocr.text || ocr.lines.join('\n') || '').trim();
        } catch (err) {
          this.logger.warn(
            `[extractAttachmentText] OCR failed (${file.originalname}): ${(err as Error).message}`,
          );
        }
      }
      if (ocrText.length >= 5) return { text: ocrText.slice(0, MAX_CHARS), source: 'ocr' };
      // OCR 没拿到有效文字 → vision 兜底（描述图片内容，常用于图表/电路图）
      const visionText = await this.describeImageViaVision(file).catch((err) => {
        this.logger.warn(
          `[extractAttachmentText] vision fallback failed (${file.originalname}): ${(err as Error).message}`,
        );
        return '';
      });
      if (visionText) return { text: visionText.slice(0, MAX_CHARS), source: 'vision' };
      return { text: '', source: 'failed' };
    }

    // 3. 文档：腾讯 ExtractDocBasic 先试（用户已购，便宜），失败 fallback Qwen doc-turbo
    if (DOC_EXT.has(ext)) {
      let docText = '';
      if (await this.ocrService.hasTencentConfig().catch(() => false)) {
        try {
          const ocr = await this.ocrService.recognizeWithTencent(
            { originalname: file.originalname, buffer: file.buffer, mimetype: file.mimetype },
            { documentKind: 'invoice', serviceKey: 'document_extract' },
          );
          docText = (ocr.text || ocr.lines.join('\n') || '').trim();
        } catch (err) {
          this.logger.warn(
            `[extractAttachmentText] ExtractDocBasic failed (${file.originalname}): ${(err as Error).message}`,
          );
        }
      }
      if (docText.length >= 10) return { text: docText.slice(0, MAX_CHARS), source: 'doc_extract' };
      // 腾讯不可用 / 抽取内容过少 → fallback Qwen doc-turbo
      const qwenText = await this.extractDocumentTextViaQwen(file).catch((err) => {
        this.logger.warn(
          `[extractAttachmentText] Qwen doc-turbo fallback failed (${file.originalname}): ${(err as Error).message}`,
        );
        return '';
      });
      if (qwenText) return { text: qwenText.slice(0, MAX_CHARS), source: 'doc_model' };
      return { text: '', source: 'failed' };
    }

    return { text: '', source: 'skipped' };
  }

  /** L3：让 Qwen-VL 描述图片内容（用于 OCR 拿不到文字的图表/电路图/UI 截图等） */
  private async describeImageViaVision(file: RdAiUploadedFile): Promise<string> {
    const visionModel = await this.resolveSceneModelConfig('image_understanding').catch(() => null);
    if (!visionModel?.apiKey) return '';
    const client = this.createClient(visionModel.apiKey, visionModel.provider, visionModel.baseUrl);
    const mime = file.mimetype?.trim() || 'image/png';
    const dataUri = `data:${mime};base64,${file.buffer.toString('base64')}`;
    try {
      const response = await client.chat.completions.create({
        model: visionModel.model,
        messages: [
          {
            role: 'system',
            content:
              '你是图像内容解读助手。请用 200 字以内的中文，客观、具体地描述图片中的关键信息：' +
              '是图表/示意图就描述结构和数据要点；是 UI 截图就描述展示了什么界面与关键文本；是照片就描述场景。不要发挥、不要议论。',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: '请描述这张图片的关键内容。' },
              { type: 'image_url', image_url: { url: dataUri } as { url: string } },
            ] as unknown as string,
          },
        ],
      });
      return (response.choices[0]?.message?.content ?? '').trim();
    } catch (err) {
      this.logger.warn(`[describeImageViaVision] failed: ${(err as Error).message}`);
      return '';
    }
  }

  /** L2 fallback：用 Qwen doc-turbo 抽取 PDF/Word/Excel 全文（不做立项解析，只要原文） */
  private async extractDocumentTextViaQwen(file: RdAiUploadedFile): Promise<string> {
    const docCfg = await this.resolveDocModelConfig();
    if (!docCfg) return '';
    const client = this.createClient(docCfg.apiKey, 'qwen', docCfg.baseUrl, this.extractTimeoutMs);
    try {
      const uploadable = await toFile(file.buffer, file.originalname, {
        type: file.mimetype?.trim() || undefined,
      });
      const uploaded = await client.files.create({
        file: uploadable,
        purpose: 'file-extract' as OpenAI.FilePurpose,
      });
      const response = await client.chat.completions.create({
        model: QWEN_DOC_MODEL,
        messages: [
          {
            role: 'system',
            content:
              '你是文档内容抽取器。请从上传的文档中提取关键文字内容（标题、章节、表格关键行、结论等），' +
              '用 1500 字以内的中文输出。不要解读、不要总结你的工作，直接给原文要点。',
          },
          { role: 'system', content: `fileid://${uploaded.id}` },
          { role: 'user', content: '请抽取该文档的关键文本内容。' },
        ],
      });
      return (response.choices[0]?.message?.content ?? '').trim();
    } catch (err) {
      this.logger.warn(`[extractDocumentTextViaQwen] failed: ${(err as Error).message}`);
      return '';
    }
  }

  // ── 已完成任务质量评分 ───────────────────────────────────────────────────────

  async scoreTaskCompletion(input: RdTaskCompletionScoreInput): Promise<RdTaskCompletionScoreResult> {
    const systemPrompt = this.buildCompletionScoreSystemPrompt();
    const userMessage = this.buildCompletionScoreUserMessage(input);

    const selectedModel = await this.resolveSceneModelConfig('progress_summary').catch(() => null);
    const apiKey = selectedModel?.apiKey ?? null;
    const provider: AiProvider = selectedModel?.provider ?? 'openai';
    const model = selectedModel?.model ?? DEFAULT_TEXT_MODEL;
    const baseUrl = selectedModel?.baseUrl;

    if (!apiKey) {
      return this.buildFallbackCompletionScore(input, 'ai_not_configured');
    }

    const startedAt = new Date();
    try {
      const client = this.createClient(apiKey, provider, baseUrl);
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        response_format: { type: 'json_object' },
        ...(provider === 'qwen' ? ({ enable_thinking: false } as Record<string, unknown>) : {}),
      });
      const finishedAt = new Date();
      const content = response.choices[0]?.message?.content ?? '{}';
      const parsed = this.parseCompletionScorePayload(content);
      return {
        ...parsed,
        provider,
        model,
        computed_at: finishedAt.toISOString(),
        _debug: {
          system_prompt: systemPrompt,
          user_message: userMessage,
          raw_response: content,
          request_started_at: startedAt.toISOString(),
          request_finished_at: finishedAt.toISOString(),
          duration_ms: finishedAt.getTime() - startedAt.getTime(),
        },
      };
    } catch (error) {
      const finishedAt = new Date();
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[scoreTaskCompletion] AI call failed: ${message}`);
      const fallback = this.buildFallbackCompletionScore(input, `ai_error:${message.slice(0, 80)}`);
      return {
        ...fallback,
        _debug: {
          system_prompt: systemPrompt,
          user_message: userMessage,
          raw_response: `[ERROR] ${message}`,
          request_started_at: startedAt.toISOString(),
          request_finished_at: finishedAt.toISOString(),
          duration_ms: finishedAt.getTime() - startedAt.getTime(),
        },
      };
    }
  }

  private buildCompletionScoreSystemPrompt(): string {
    return [
      '你是一名经验丰富的研发项目主管，负责对刚完成的研发任务进行复盘评分。',
      '你的目标是从多个维度客观评估任务的"完成质量"，帮助团队识别优秀实践与改进空间。',
      '评分必须严格基于提供的事实数据，不臆测、不打感情分。',
      '',
      '【评分基调 — 必须遵守】',
      '一个"按要求正常完成"的任务应落在合格~良好区间（约 60-82 分）；只有确有执行问题的任务才给低分。',
      '研发工作中以下做法是常见且合理的，本身不是缺陷，不得因此结构性压低分数，只在确实影响了结果时才酌情扣分：',
      '  · 未填写截止日期；· 单人独立完成；· 以截图 / 代码提交 / 链接（而非正式文档）作为交付记录；· 留痕简短但能说清工作。',
      '请把"满分前提"理解为"做得很好"，而不是"做到完美无可挑剔"。',
      '',
      '评分维度（每项满分 25，总分 100）：',
      '',
      '1. 时效性 (timeliness, 0-25)',
      '   - 是否按时/提前完成、逾期程度',
      '   - 提前 / 按时完成 = 22-25；轻微逾期但有合理记录 = 16-21；明显逾期且无任何说明才降到 10 分以下',
      '   - 无截止日期时按中性 18 分起评（不因未设期限而扣分），仅在留痕显示明显拖延时下调',
      '',
      '2. 过程透明度 (process, 0-25)',
      '   - 进度留痕的频率、阶段覆盖度、文字详尽程度',
      '   - 是否能从留痕中看出"做了什么 / 遇到什么 / 下一步是什么"',
      '   - 阶段清晰且有判断/复盘 = 21-25；能说清工作内容的正常留痕 = 16-20；',
      '     简短但有效的记录 = 13-16（不要因为不是长篇就压到很低）；完全零留痕才 ≤8 分',
      '',
      '3. 交付证据 (evidence, 0-25)',
      '   - 是否有可佐证任务完成、且与任务相关的产出',
      '   - 截图 / 代码提交 / 链接 / 文档都算有效证据；正式测试/评审/方案文档是加分项，而非及格线',
      '   - 佐证充分且可追溯（命名清晰的报告/数据等）= 21-25；有与任务相关的有效佐证 = 16-20；',
      '     仅有少量或弱相关佐证 = 11-15；完全无任何可佐证内容才 ≤8 分',
      '',
      '4. 协作与风险管理 (collaboration, 0-25)',
      '   - 是否识别并妥善处理了阻塞/风险（看操作历史中的阻塞标记、留痕中的风险描述）',
      '   - 独立完成是常态，按中性 17-20 起评，绝不因"没有协作人"而扣分',
      '   - 有良好协作记录、或妥善化解了风险/阻塞 = 21-25',
      '   - 仅在"明显需要协作却未协作"或"存在阻塞却放任不处理"时，才降到 12 分以下',
      '   - 高优先级任务可对风险管理要求略高',
      '',
      '输出严格 JSON，禁止任何额外文字或 markdown 包装：',
      '{',
      '  "total": integer 0-100,',
      '  "grade": "A" | "B" | "C" | "D",',
      '  "summary": string,              // 一句话总体评价, 40 字内',
      '  "dimensions": [',
      '    {',
      '      "key": "timeliness" | "process" | "evidence" | "collaboration",',
      '      "label": string,            // 中文标签',
      '      "score": integer 0-25,',
      '      "max": 25,',
      '      "comment": string           // 该维度评分依据, 30 字内',
      '    }',
      '    // 必须 4 个，顺序固定: timeliness → process → evidence → collaboration',
      '  ],',
      '  "highlights": [string, ...],    // 1-3 条值得表扬之处, 每条 25 字内; 无可圈可点处则给空数组',
      '  "improvements": [string, ...]   // 1-3 条改进建议, 每条 25 字内; 任务做得很好时也至少给 1 条',
      '}',
      '',
      '等级映射：≥85→A 优秀；70-84→B 良好；55-69→C 合格；<55→D 需改进',
      'total 必须等于 4 个 dimension.score 之和，不要单独算。',
      '',
      '如果输入数据严重缺失（如完全无留痕、无操作记录），仍要给出评分，',
      '但 summary 中需注明"数据不足，评分仅供参考"。',
    ].join('\n');
  }

  private buildCompletionScoreUserMessage(input: RdTaskCompletionScoreInput): string {
    const { task, notes, auditLogs, ragContext } = input;
    const lines: string[] = [];
    lines.push('===== 任务基础信息 =====');
    lines.push(`任务 ID：${task.task_id}`);
    lines.push(`标题：${task.title}`);
    lines.push(`描述：${task.description?.trim() || '（无）'}`);
    if (task.category_path) lines.push(`分类路径：${task.category_path}`);
    lines.push(`主责人：${task.primary_owner || '（未指派）'}`);
    const collaboratorNames = (task.collaborators ?? [])
      .map((c) => c.name)
      .filter((name): name is string => Boolean(name && name.trim()));
    lines.push(`协作人：${collaboratorNames.length > 0 ? collaboratorNames.join('、') : '无'}`);
    lines.push(`优先级：${task.final_priority || 'medium'}`);
    lines.push(`开始日期：${task.start_date || '未设'}`);
    lines.push(`截止日期：${task.due_date || '未设'}`);
    const completionTime = this.pickLatestNoteTime(notes) ?? task.updated_at ?? '（未知）';
    lines.push(`实际完成时间：${completionTime}`);
    lines.push(`任务附件数（任务本身挂载）：${task.attachments ?? 0}`);
    lines.push('');

    lines.push(`===== 进度时间线（共 ${notes.length} 条留痕，含附件 AI 抽取内容）=====`);
    if (notes.length === 0) {
      lines.push('⚠️ 此任务无任何进度留痕记录');
    } else {
      const sortedNotes = [...notes].sort((a, b) =>
        String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')),
      );
      sortedNotes.slice(0, 30).forEach((note, idx) => {
        const actorLabel = note.actor?.name
          ? `${note.actor.name}${note.actor.role ? `（${note.actor.role}）` : ''}`
          : '（未知）';
        lines.push(`[第 ${idx + 1} 条] ${note.created_at ?? '（无时间）'} · ${actorLabel}`);
        if (typeof note.progress === 'number') {
          lines.push(`  进度更新至：${note.progress}%`);
        }
        const text = (note.text ?? '').trim().replace(/\s+/g, ' ').slice(0, 300);
        if (text) lines.push(`  内容：${text}`);
        const atts = note.attachments ?? [];
        if (atts.length > 0) {
          lines.push(`  附件 ${atts.length} 个：`);
          atts.slice(0, 5).forEach((att, ai) => {
            const name = att.name ?? '未知文件';
            const extracted = (att.extracted_text ?? '').trim();
            if (extracted) {
              // 截断 + 单行化，避免单个附件占满 prompt
              const compressed = extracted.replace(/\s+/g, ' ').slice(0, 600);
              lines.push(`    ${ai + 1}) ${name} [${att.extracted_source ?? 'ai'}]：${compressed}`);
            } else {
              lines.push(`    ${ai + 1}) ${name} [未抽取到内容]`);
            }
          });
        }
      });
    }
    lines.push('');

    lines.push(`===== 关键操作历史（最近 ${Math.min(auditLogs.length, 20)} 条） =====`);
    if (auditLogs.length === 0) {
      lines.push('（无操作记录）');
    } else {
      const sortedLogs = [...auditLogs]
        .sort((a, b) => String(a.timestamp ?? '').localeCompare(String(b.timestamp ?? '')))
        .slice(-20);
      for (const log of sortedLogs) {
        const actor = log.actor?.name ?? '未知';
        const action = log.action ?? '（未知操作）';
        const comment = log.comment ? ` · ${log.comment.slice(0, 80)}` : '';
        lines.push(`- ${log.timestamp ?? '（无时间）'} · ${actor} · ${action}${comment}`);
      }
    }
    lines.push('');

    if (ragContext && ragContext.length > 0) {
      lines.push(`===== 评分参考资料（来自知识库 RAG 召回的 ${ragContext.length} 条相关条目）=====`);
      lines.push('以下内容是与本任务相关的历史经验/规范/同类任务记录，可作为评分基准锚定参考：');
      ragContext.slice(0, 5).forEach((ref, idx) => {
        const title = ref.title ? ` · ${ref.title}` : '';
        const sim = typeof ref.similarity === 'number' ? ` (相似度 ${(ref.similarity * 100).toFixed(0)}%)` : '';
        const content = ref.content.replace(/\s+/g, ' ').slice(0, 400);
        lines.push(`[${idx + 1}] ${ref.source}${title}${sim}`);
        lines.push(`    ${content}`);
      });
      lines.push('');
    }

    lines.push('请基于以上事实（含附件抽取内容与参考资料）评分并输出 JSON。');
    return lines.join('\n');
  }

  private pickLatestNoteTime(notes: RdTaskCompletionScoreInput['notes']): string | null {
    let latest: string | null = null;
    for (const note of notes) {
      const t = note.created_at;
      if (t && (!latest || t > latest)) latest = t;
    }
    return latest;
  }

  private parseCompletionScorePayload(
    rawJson: string,
  ): Omit<RdTaskCompletionScoreResult, 'provider' | 'model' | 'computed_at'> {
    let obj: Record<string, unknown> = {};
    try {
      const cleaned = (rawJson || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
      obj = JSON.parse(cleaned);
    } catch (err) {
      this.logger.warn(`[parseCompletionScorePayload] JSON parse failed: ${(err as Error).message}`);
    }
    const dimsRaw = Array.isArray(obj.dimensions) ? obj.dimensions : [];
    const fixedKeys: RdTaskCompletionScoreDimensionKey[] = [
      'timeliness',
      'process',
      'evidence',
      'collaboration',
    ];
    const fixedLabels: Record<RdTaskCompletionScoreDimensionKey, string> = {
      timeliness: '时效性',
      process: '过程透明度',
      evidence: '交付证据',
      collaboration: '协作与风险管理',
    };
    const dimensions: RdTaskCompletionScoreDimension[] = fixedKeys.map((key, idx) => {
      const found =
        (dimsRaw.find(
          (d) => typeof d === 'object' && d !== null && (d as Record<string, unknown>).key === key,
        ) as Record<string, unknown> | undefined) ?? (dimsRaw[idx] as Record<string, unknown> | undefined);
      const score = Math.max(0, Math.min(25, Math.round(Number(found?.score) || 0)));
      const comment = typeof found?.comment === 'string' && found.comment.trim() ? found.comment.trim() : '—';
      return { key, label: fixedLabels[key], score, max: 25, comment };
    });
    const computedTotal = dimensions.reduce((sum, d) => sum + d.score, 0);
    // 以维度分之和为准（防止 AI 算错总分）
    const total = Math.max(0, Math.min(100, computedTotal));
    const grade: RdTaskCompletionScoreResult['grade'] =
      total >= 85 ? 'A' : total >= 70 ? 'B' : total >= 55 ? 'C' : 'D';
    const gradeLabelMap: Record<RdTaskCompletionScoreResult['grade'], string> = {
      A: '优秀',
      B: '良好',
      C: '合格',
      D: '需改进',
    };
    const summary =
      typeof obj.summary === 'string' && obj.summary.trim()
        ? obj.summary.trim().slice(0, 80)
        : '已完成，详情见各维度评分。';
    const highlights = Array.isArray(obj.highlights)
      ? obj.highlights
          .map((s) => String(s ?? '').trim())
          .filter(Boolean)
          .slice(0, 3)
      : [];
    const improvements = Array.isArray(obj.improvements)
      ? obj.improvements
          .map((s) => String(s ?? '').trim())
          .filter(Boolean)
          .slice(0, 3)
      : [];
    return {
      total,
      grade,
      grade_label: gradeLabelMap[grade],
      summary,
      dimensions,
      highlights,
      improvements,
    };
  }

  private buildFallbackCompletionScore(
    input: RdTaskCompletionScoreInput,
    reason: string,
  ): RdTaskCompletionScoreResult {
    // AI 未配置或调用失败时的兜底：用简单规则给一个保守分数，并标注原因。
    const { task, notes } = input;
    const completionTime = this.pickLatestNoteTime(notes) ?? task.updated_at ?? null;
    const dueDate = task.due_date;
    // 中性基准：未设截止日期不扣分（18 起评），与 AI 评分口径一致
    let timeliness = 18;
    let timelinessComment = '无截止日期，按中性分';
    if (dueDate && completionTime) {
      const dayDiff = Math.floor(
        (new Date(completionTime).getTime() - new Date(dueDate).getTime()) / 86_400_000,
      );
      if (!Number.isNaN(dayDiff)) {
        if (dayDiff <= 0) {
          timeliness = dayDiff < 0 ? 25 : 23;
          timelinessComment = dayDiff < 0 ? `提前 ${-dayDiff} 天完成` : '按时完成';
        } else if (dayDiff <= 3) {
          timeliness = 18;
          timelinessComment = `逾期 ${dayDiff} 天`;
        } else if (dayDiff <= 7) {
          timeliness = 12;
          timelinessComment = `逾期 ${dayDiff} 天`;
        } else {
          timeliness = 6;
          timelinessComment = `严重逾期 ${dayDiff} 天`;
        }
      }
    }
    const noteCount = notes.length;
    // 有留痕即给合格分；只有完全零留痕才低分
    const process =
      noteCount >= 5 ? 20 : noteCount >= 3 ? 16 : noteCount >= 1 ? 13 : 6;
    const attCount =
      notes.reduce((sum, n) => sum + (n.attachments?.length ?? 0), 0) + (task.attachments ?? 0);
    // 截图 / 代码 / 文档等任意佐证都算有效证据
    const evidence = attCount >= 3 ? 20 : attCount >= 1 ? 15 : 6;
    const collabCount = task.collaborators?.length ?? 0;
    // 独立完成是常态，按中性 16 起评，不因无协作人而扣分
    const collaboration = collabCount >= 2 ? 20 : collabCount === 1 ? 18 : 16;
    const dimensions: RdTaskCompletionScoreDimension[] = [
      { key: 'timeliness', label: '时效性', score: timeliness, max: 25, comment: timelinessComment },
      { key: 'process', label: '过程透明度', score: process, max: 25, comment: `${noteCount} 条进度记录` },
      { key: 'evidence', label: '交付证据', score: evidence, max: 25, comment: `${attCount} 个附件` },
      {
        key: 'collaboration',
        label: '协作与风险管理',
        score: collaboration,
        max: 25,
        comment: collabCount > 0 ? `${collabCount} 位协作人` : '独立完成',
      },
    ];
    const total = dimensions.reduce((sum, d) => sum + d.score, 0);
    const grade: RdTaskCompletionScoreResult['grade'] =
      total >= 85 ? 'A' : total >= 70 ? 'B' : total >= 55 ? 'C' : 'D';
    const gradeLabelMap: Record<RdTaskCompletionScoreResult['grade'], string> = {
      A: '优秀',
      B: '良好',
      C: '合格',
      D: '需改进',
    };
    return {
      total,
      grade,
      grade_label: gradeLabelMap[grade],
      summary: 'AI 评分不可用，使用规则估算，仅供参考。',
      dimensions,
      highlights: [],
      improvements: ['配置 AI 模型可获得更准确的复盘评分'],
      provider: 'local',
      model: 'local-completion-fallback',
      computed_at: new Date().toISOString(),
      fallback_reason: reason,
    };
  }
}
