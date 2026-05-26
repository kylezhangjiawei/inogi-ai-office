import { BadGatewayException, BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { toFile } from 'openai';

import { PrismaService } from '../../prisma/prisma.service';
import { OcrService } from '../ocr/ocr.service';
import { SecureConfigService } from '../security/secure-config.service';

const TASK_EXTRACTION_SCHEMA_DESC =
  '{"tasks": [{"title": string, "description"?: string, "owner": string, "due_date": string YYYY-MM-DD, ' +
  '"priority": "high"|"medium"|"low", "category_path": string, ' +
  '"estimated_days": integer（必填，根据任务复杂度估算，不确定时填5，禁止全部填1）, ' +
  '"owner_reason": string}], "suggested_category"?: string, "summary"?: string}';

const QWEN_DOC_MODEL = 'qwen-doc-turbo';
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

export type RdAiExtractInput = {
  text?: string;
  file?: RdAiUploadedFile;
  peopleNames?: string[];
  peopleProfiles?: RdAiPersonContext[];
  categoryLabels?: string[];
  proposalTitle?: string;
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
    this.extractMaxTokens = Number(this.config.get('RD_EXTRACT_MAX_TOKENS') ?? 12_000);
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
    if (!this.ocrService.hasTencentConfig()) {
      throw new BadRequestException('图片解析需要配置腾讯 OCR (TENCENTCLOUD_SECRET_ID / SECRET_KEY)');
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
    // 文档解析（PDF/Word/Excel）可能文件较大，使用立项专用超时
    const client = this.createClient(apiKey, 'qwen', baseUrl, this.extractTimeoutMs);
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
          max_tokens: this.extractMaxTokens,
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
  ): Promise<{ content: string; parsed: { tasks: RdAiTaskDraft[]; suggested_category?: string; summary?: string } }> {
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
      '3) due_date 必须是 YYYY-MM-DD 格式；如果原文有日期，用原文日期；否则按 estimated_days 推算到今天之后的日期。',
      '4) priority 默认 medium；标题/描述出现"紧急/卡住/客户/ECN/发布/优先/影响交付"等关键词时设为 high；明显次要的设为 low。',
      '5) estimated_days 必须结合任务复杂度、任务类型和交付物认真估算，不得统一填写固定值：' +
      '发邮件/简单确认/简单跟进=1-2天，常规设计/开发/测试/文档=3-7天，跨模块设计或完整验证闭环=8-20天，复杂系统集成/大型测试项目=21-90天；' +
      '无法判断时默认填5，严禁把所有任务都填1。',
      '6) category_path 用「一级分类 / 二级分类 / 任务类型」格式（例如 "310阀系统 / 310电磁阀 / 测试验证"）。一级分类必须优先从下方"研发分类预设"中选择；二级分类优先选择该大项下最接近的部件。',
      '7) 不要把立项标题、客户名称或临时项目名当作一级分类；只有完全无法匹配预设大项时，才允许创建新的一级分类。',
      '8) 任务类型要从任务内容中判断，例如：需求澄清、方案设计、结构设计、电气设计、软件开发、工艺准备、采购跟进、样件制作、测试验证、问题整改、文档交付、评审确认。',
      '9) 分配负责人时综合：原文负责人、任务分类、任务类型、任务内容关键词、人员岗位/部门、当前任务数、容量上限、阻塞数、请假状态；避免分给请假、明显超载或阻塞过多的人。',
      '10) 若多人都可承担，优先选择当前负载更低且岗位/部门更匹配的人；高优先级任务优先给容量充足的人。',
      '11) owner_reason 必须简短说明分配依据（如"原文指定"、"结构设计任务且当前负载较低"、"测试验证任务匹配测试岗位"）。',
      '12) 必须提取原文中的所有任务，不要遗漏；不要添加与原文目标无关的任务。',
      '13) suggested_category 返回本次立项最主要的一级分类名称，优先从研发分类预设中选择。',
      '14) 如果原文是表格/列表，每一行/项作为一个任务；如果是叙述文本，按可执行动作切分。',
      '15) 只要原文内容不为空且属于研发、产品、测试、结构、电气、软件、采购、文档、评审等工作材料，tasks 至少返回 1 条。',
      '16) 若原文是立项背景、需求说明、问题描述、客户反馈、改进目标或方案说明，而不是明确任务清单，必须把目标转成必需执行动作；这不是编造任务。owner_reason 中说明"根据立项材料推导"。',
      '17) 只有在原文为空、无法读取，或内容完全不是研发工作材料时，才允许返回 {"tasks": []}，并在 summary 中说明无法提取的具体原因。',
    ].join('\n');
  }

  private buildUserMessage(textBody: string, input: RdAiExtractInput): string {
    const people = this.normalizePeopleContexts(input);
    const categories = this.normalizeCategoryLabels(input.categoryLabels ?? []);
    const lines: string[] = [];
    if (input.proposalTitle) {
      lines.push(`立项标题：${input.proposalTitle}`);
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
          '{"tasks":[{"id":string,"title":string,"description"?:string,"owner":string,"owner_reason":string,"due_date":"YYYY-MM-DD","priority":"high|medium|low","category_path":string,"estimated_days":integer,"ai_estimated_days"?:integer,"duration_basis":string}],"change_summary":string[],"warnings":string[]}',
          '规则：',
          '1) 现有任务必须保留原 id；只有用户明确要求新增或拆分任务时才允许新增 id。',
          '2) scope=selected 或 scope=single 时，只能修改 selectedTaskIds 中的任务；未选任务要原样返回。',
          '3) 如果用户要求删除、合并或拆分任务，可以调整 tasks 数量，但必须在 change_summary 中说明。',
          '4) due_date 必须是 YYYY-MM-DD；priority 只能是 high、medium、low；estimated_days 必须是 1-365 的整数。',
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
  ): { tasks: RdAiTaskDraft[]; suggested_category?: string; summary?: string } {
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
    const summary = typeof obj.summary === 'string' ? obj.summary.trim() || undefined : undefined;

    return { tasks, suggested_category, summary };
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
    // Exact
    const exact = people.find((p) => p === raw);
    if (exact) return exact;
    // Fuzzy: substring match in either direction (handles names like "刘致远(研发管理员)")
    const fuzzy = people.find((p) => raw.includes(p) || p.includes(raw));
    return fuzzy ?? null;
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
      where: { key: 'rd.aiSettings' },
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

  private async resolveDefaultConfiguredModel(): Promise<AiModelRuntimeConfig | null> {
    const configs = await this.prisma.integrationConfig.findMany({
      where: { kind: 'openai', isActive: true },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
    });
    const selected =
      configs.find((config) => this.parseAiModelMetadata(config.metadata).is_default_enabled) ??
      configs[0] ??
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
      where: { key: 'rd.aiSettings' },
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
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'rd.aiArtifacts' },
      select: { value: true },
    });
    const existing = Array.isArray(setting?.value)
      ? setting.value.filter((item) => item && typeof item === 'object')
      : [];
    await this.prisma.systemSetting.upsert({
      where: { key: 'rd.aiArtifacts' },
      create: {
        category: 'research-development',
        key: 'rd.aiArtifacts',
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
    file?: RdAiUploadedFile;
    text?: string;
    task: {
      task_id: string;
      title: string;
      description?: string;
      category_path?: string;
      current_progress?: number;
      current_status?: string;
    };
  }): Promise<RdAiProgressAssessmentResult> {
    if (!input.file && !input.text?.trim()) {
      throw new BadRequestException('file 或 text 至少需要提供一项');
    }

    const filePolicy = await this.readFilePolicyRuntime();
    let evidenceText = '';
    let source: 'text' | 'file_text' | 'file_ocr' | 'file_doc_model' = 'text';
    let docFileId: string | null = null;
    let docClient: OpenAI | null = null;

    if (input.file) {
      const ext = this.extOf(input.file.originalname);
      if (IMAGE_EXT.has(ext)) {
        if (!this.ocrService.hasTencentConfig() && filePolicy.allow_vision_fallback) {
          return this.assessProgressViaVision(input.file, input, filePolicy, 'ocr_not_configured');
        }
        if (!this.ocrService.hasTencentConfig()) {
          throw new BadRequestException('图片识别需要配置腾讯 OCR (TENCENTCLOUD_SECRET_ID / SECRET_KEY)');
        }
        const ocr = await this.ocrService.recognizeWithTencent(
          { originalname: input.file.originalname, buffer: input.file.buffer, mimetype: input.file.mimetype },
          { documentKind: 'invoice', serviceKey: filePolicy.ocr_service_key },
        );
        const confidence = typeof ocr.confidence === 'number' ? ocr.confidence : 1;
        evidenceText = (ocr.text || ocr.lines.join('\n')).slice(0, 24000);
        if ((!evidenceText.trim() || confidence < filePolicy.ocr_confidence_threshold) && filePolicy.allow_vision_fallback) {
          return this.assessProgressViaVision(input.file, input, filePolicy, `ocr_low_confidence:${confidence}`);
        }
        source = 'file_ocr';
      } else if (PLAIN_TEXT_EXT.has(ext)) {
        evidenceText = this.safeUtf8(input.file.buffer).slice(0, 24000);
        source = 'file_text';
      } else if (DOC_EXT.has(ext)) {
        // Upload to Qwen doc model — assessment call below will reference fileid://
        // 优先读 AI 模型管理配置，不从 .env 读取模型 key。
        const docCfg = await this.resolveDocModelConfig();
        if (!docCfg) {
          throw new BadRequestException(
            'PDF/Word/Excel 识别需要在 AI 模型管理中配置 qwen-doc-turbo 或可用的 Qwen 模型',
          );
        }
        docClient = this.createClient(docCfg.apiKey, 'qwen', docCfg.baseUrl, this.extractTimeoutMs);
        const uploadable = await toFile(input.file.buffer, input.file.originalname, {
          type: input.file.mimetype?.trim() || undefined,
        });
        let uploaded: OpenAI.Files.FileObject;
        try {
          uploaded = await docClient.files.create({
            file: uploadable,
            purpose: 'file-extract' as OpenAI.FilePurpose,
          });
        } catch (error) {
          if (this.isExternalAiTimeout(error)) {
            const parsed = this.buildTimeoutProgressFallback(input.task, 'file_doc_model', input.file.buffer.length);
            await this.recordAiArtifact('progress_assessment', 'file_doc_model', input.file.originalname, filePolicy, {
              ai_result: parsed,
              timeout: true,
              model: QWEN_DOC_MODEL,
              provider: 'qwen',
            });
            return parsed;
          }
          throw this.toExternalAiException(error, 'AI 进度文件上传服务调用失败');
        }
        docFileId = uploaded.id;
        source = 'file_doc_model';
      } else {
        // Unknown — try as text
        evidenceText = this.safeUtf8(input.file.buffer).slice(0, 24000);
        source = 'file_text';
      }
    } else {
      evidenceText = (input.text ?? '').slice(0, 24000);
      source = 'text';
    }

    const systemPrompt = this.buildProgressSystemPrompt();
    const userMessage = this.buildProgressUserMessage(evidenceText, input);

    try {
      if (source === 'file_doc_model' && docClient && docFileId) {
        let response: OpenAI.Chat.Completions.ChatCompletion;
        try {
          response = await docClient.chat.completions.create({
            model: QWEN_DOC_MODEL,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'system', content: `fileid://${docFileId}` },
              { role: 'user', content: userMessage },
            ],
            response_format: { type: 'json_object' },
          });
        } catch (error) {
          if (this.isExternalAiTimeout(error)) {
            const parsed = this.buildTimeoutProgressFallback(input.task, 'file_doc_model', input.file?.buffer.length ?? 0);
            await this.recordAiArtifact('progress_assessment', 'file_doc_model', input.file?.originalname, filePolicy, {
              ai_result: parsed,
              timeout: true,
              model: QWEN_DOC_MODEL,
              provider: 'qwen',
            });
            return parsed;
          }
          throw this.toExternalAiException(error, 'AI 进度文件解析服务调用失败');
        }
        const content = response.choices[0]?.message?.content ?? '{}';
        const parsed = this.parseProgressPayload(content, input.task);
        await this.recordAiArtifact('progress_assessment', 'file_doc_model', input.file?.originalname, filePolicy, {
          ai_result: parsed,
          model: QWEN_DOC_MODEL,
          provider: 'qwen',
        });
        return { ...parsed, provider: 'qwen', model: QWEN_DOC_MODEL, source, raw_text_length: input.file?.buffer.length ?? 0 };
      }

      // Text path — AI 模型管理优先（scene → default），不从 .env 读取模型 key。
      const selectedModel = await this.resolveSceneModelConfig('progress_summary').catch(() => null);
      const apiKey = selectedModel?.apiKey ?? null;
      const provider: AiProvider = selectedModel?.provider ?? 'openai';
      const model = selectedModel?.model ?? DEFAULT_TEXT_MODEL;
      const baseUrl = selectedModel?.baseUrl;

      if (!apiKey) {
        // AI 模型管理中未配置任何可用模型
        return {
          progress: Math.max(0, input.task.current_progress ?? 0),
          stage: '资料已上传，AI 未配置，无法自动判断',
          confidence: 40,
          basis: ['未在 AI 模型管理中配置可用模型', '当前仅记录文件元信息'],
          recommendation: '请在 AI 模型管理中配置可用模型，或人工选择进度节点。',
          provider: 'local',
          model: 'local-progress-fallback',
          source,
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
          const parsed = this.buildTimeoutProgressFallback(input.task, source, evidenceText.length);
          await this.recordAiArtifact('progress_assessment', source, input.file?.originalname, filePolicy, {
            original_text: source === 'text' || source === 'file_text' ? evidenceText : undefined,
            ocr_text: source === 'file_ocr' ? evidenceText : undefined,
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
      await this.recordAiArtifact('progress_assessment', source, input.file?.originalname, filePolicy, {
        original_text: source === 'text' || source === 'file_text' ? evidenceText : undefined,
        ocr_text: source === 'file_ocr' ? evidenceText : undefined,
        ai_result: parsed,
        model,
        provider,
      });
      return { ...parsed, provider, model, source, raw_text_length: evidenceText.length };
    } finally {
      if (docClient && docFileId) {
        docClient.files.delete(docFileId).catch(() => { /* best-effort */ });
      }
    }
  }

  private async assessProgressViaVision(
    file: RdAiUploadedFile,
    input: {
      task: { title: string; description?: string; category_path?: string; current_progress?: number; current_status?: string };
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
          { role: 'system', content: this.buildProgressSystemPrompt() },
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

  private buildProgressSystemPrompt(): string {
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
      '{"progress": integer 0-100, "stage": string, "confidence": integer 0-100, "basis": [string,...], "recommendation": string}',
      '',
      '规则：',
      '1) progress 是最终绝对进度，不是相对增量；不要把当前进度与本次判断相加，也不要因为当前进度较高而自动取更大值。依据不足或无关时返回当前进度；依据表明回退时可返回更低进度。',
      '2) basis 给出 2-4 条简短证据（参考文件中的关键内容，如"含 EMC 测试报告"、"完成 BOM 变更说明"）。',
      '3) stage 用一句话描述当前所处阶段及理由（不超过 25 字）。',
      '4) confidence 反映你对推断的把握，依据越具体越高。',
      '5) recommendation 给出下一步建议动作，30 字以内。',
      '6) 如果依据与任务无关，progress 不变，stage 写"依据与任务匹配度低"，confidence 低于 50。',
    ].join('\n');
  }

  private buildProgressUserMessage(
    evidenceText: string,
    input: {
      task: { title: string; description?: string; category_path?: string; current_progress?: number; current_status?: string };
    },
  ): string {
    const lines: string[] = [];
    lines.push('===== 任务信息 =====');
    lines.push(`标题：${input.task.title}`);
    if (input.task.description) lines.push(`描述：${input.task.description}`);
    if (input.task.category_path) lines.push(`分类：${input.task.category_path}`);
    lines.push(`当前进度：${input.task.current_progress ?? 0}%`);
    if (input.task.current_status) lines.push(`当前状态：${input.task.current_status}`);
    lines.push('');
    lines.push('===== 依据内容 =====');
    lines.push(evidenceText || '（请直接根据上传文件分析）');
    lines.push('');
    lines.push('请输出 JSON。');
    return lines.join('\n');
  }

  private parseProgressPayload(
    rawJson: string,
    task: { current_progress?: number },
  ): { progress: number; stage: string; confidence: number; basis: string[]; recommendation: string } {
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
    return { progress, stage, confidence, basis, recommendation };
  }

  private defaultBaseUrlForProvider(provider: AiProvider): string | undefined {
    return provider === 'qwen' ? DEFAULT_QWEN_BASE_URL : undefined;
  }

  private createClient(apiKey: string, provider: AiProvider, configuredBaseUrl?: string, timeoutOverride?: number): OpenAI {
    const baseURL = configuredBaseUrl ?? this.defaultBaseUrlForProvider(provider);
    return new OpenAI({
      apiKey,
      timeout: timeoutOverride ?? this.timeoutMs,
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
}
