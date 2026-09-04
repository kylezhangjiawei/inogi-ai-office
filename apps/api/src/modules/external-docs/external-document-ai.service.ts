import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';
import type { AiGatewayRouteMeta, AiGatewayTarget } from '../ai-gateway/ai-gateway.types';
import { OcrService } from '../ocr/ocr.service';
import { SecureConfigService } from '../security/secure-config.service';

export type ExternalDifference = {
  id: string;
  type: 'modified' | 'added' | 'removed' | 'format';
  risk: 'high' | 'medium' | 'low';
  location: string;
  title: string;
  before: string;
  after: string;
  confidence: number;
  reviewed: boolean;
  source: string;
};

type DiffCandidate = Pick<ExternalDifference, 'id' | 'type' | 'location' | 'before' | 'after' | 'source'>;
type AiRuntimeConfig = {
  targets: AiGatewayTarget[];
  timeoutMs?: number;
  model: string;
  provider: string;
  /** 选模来源（route/fallback），透传给网关落库，让「路由是否生效」可观测 */
  routeMeta: AiGatewayRouteMeta;
};

type DiffOperation = { kind: 'equal' | 'removed' | 'added'; text: string };

const MAX_AI_HUNKS = 160;
const MAX_HUNK_TEXT = 1800;
const DEFAULT_QWEN_JSON_MAX_TOKENS = 16_000;

/**
 * 差异分类分批送模型。一次把上百个 hunk 塞进单个请求会撑爆 60s 超时——实测扫描件
 * 比对产生 82 个 hunk 时整体失败、退化成兜底。拆批后单请求可控，且某一批失败只影响
 * 该批（未分类的差异按确定性规则兜底），不会整份结果丢失。
 */
const AI_CLASSIFY_BATCH_SIZE = 25;
const AI_CLASSIFY_CONCURRENCY = 2;

@Injectable()
export class ExternalDocumentAiService {
  private readonly logger = new Logger(ExternalDocumentAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly secureConfig: SecureConfigService,
    private readonly ocrService: OcrService,
    private readonly aiGateway: AiGatewayService,
  ) {}

  async integrationStatus() {
    const [ai, ocr] = await Promise.all([
      this.resolveRuntimeConfig().catch(() => null),
      this.ocrService.getMaskedTencentConfig(),
    ]);
    return {
      ai: {
        configured: Boolean(ai),
        provider: ai?.provider ?? null,
        model: ai?.model ?? null,
      },
      ocr: {
        configured: Boolean(ocr.enabled && ocr.has_secret_key && ocr.secret_id),
        provider: 'tencent_ocr',
        source: ocr.source,
      },
    };
  }

  async analyze(input: {
    baselineText: string;
    candidateText: string;
    baselineProvider: string;
    candidateProvider: string;
    baselineVersion: string;
    candidateVersion: string;
    notes?: string;
  }) {
    const candidates = this.buildDiffCandidates(
      input.baselineText,
      input.candidateText,
      `${input.baselineProvider} → ${input.candidateProvider}`,
    );
    let runtime: AiRuntimeConfig | null = null;
    let fallbackWarning = '';
    try {
      runtime = await this.resolveRuntimeConfig();
    } catch (error) {
      this.logger.warn(`AI 模型不可用，资料比对使用确定性降级: ${(error as Error).message}`);
      fallbackWarning = 'AI 模型当前不可用，本次结果由确定性文本比对生成';
    }

    if (candidates.length === 0) {
      return {
        summary: `${input.candidateVersion} 与 ${input.baselineVersion} 的可提取文字内容一致，未发现文本差异。仍建议人工核对图片、颜色和版式。`,
        differences: [] as ExternalDifference[],
        model: runtime?.model ?? 'deterministic-diff-v1',
        provider: `${runtime?.provider ?? 'local-diff'}:deterministic`,
        generationMode: 'fallback' as const,
        warning: '未检测到可提取文字差异，本次摘要由确定性规则生成',
      };
    }

    const aiCandidates = candidates.slice(0, MAX_AI_HUNKS);
    let parsed: {
      summary?: unknown;
      differences?: Array<Record<string, unknown>>;
    } = {};
    let aiSucceeded = false;
    if (runtime) {
      const classified = await this.classifyInBatches(runtime, input, aiCandidates, candidates.length);
      const missing = aiCandidates.filter((item) => !classified.has(item.id));
      if (classified.size > 0) {
        parsed = { differences: [...classified.values()] };
        // 全部分类成功才算 AI 模式；部分成功时未分类的那些走确定性兜底，
        // 结果仍然可用，只是标题和风险等级是规则生成的。
        aiSucceeded = missing.length === 0;
        if (!aiSucceeded) {
          fallbackWarning = `AI 已分类 ${classified.size}/${aiCandidates.length} 条差异，其余由确定性规则补齐`;
        }
      } else {
        fallbackWarning = 'AI 差异分类调用失败，本次结果由确定性文本比对生成';
      }
      if (classified.size > 0) {
        const aiSummary = await this.summarizeDifferences(runtime, input, [...classified.values()]);
        if (aiSummary) parsed.summary = aiSummary;
      }
    }
    const aiById = new Map(
      (Array.isArray(parsed.differences) ? parsed.differences : [])
        .filter((item) => typeof item?.id === 'string')
        .map((item) => [String(item.id), item]),
    );

    const differences = candidates.map((candidate) => {
      const classified = aiById.get(candidate.id);
      return {
        ...candidate,
        type: this.differenceType(classified?.type, candidate.type),
        risk: classified ? this.differenceRisk(classified.risk) : this.localDifferenceRisk(candidate),
        title: this.textValue(classified?.title) || this.defaultTitle(candidate),
        location: this.textValue(classified?.location) || candidate.location,
        confidence: classified ? this.confidenceValue(classified.confidence) : 80,
        reviewed: false,
      } satisfies ExternalDifference;
    });

    const fallback = this.fallbackSummary(input.baselineVersion, input.candidateVersion, differences);
    const summary = this.textValue(parsed.summary) || (aiSucceeded
      ? fallback
      : `AI 分类暂时不可用，已使用确定性文本比对生成结果。${fallback}`);
    return {
      summary,
      differences,
      model: runtime?.model ?? 'deterministic-diff-v1',
      provider: aiSucceeded ? runtime!.provider : `${runtime?.provider ?? 'local-diff'}:fallback`,
      generationMode: aiSucceeded ? 'ai' as const : 'fallback' as const,
      warning: aiSucceeded ? undefined : fallbackWarning || '本次结果由确定性文本比对生成',
    };
  }

  async regenerateSummary(input: {
    baselineVersion: string;
    candidateVersion: string;
    differences: ExternalDifference[];
  }) {
    let runtime: AiRuntimeConfig | null = null;
    try {
      runtime = await this.resolveRuntimeConfig();
      const raw = await this.callJson(runtime, [
        {
          role: 'system',
          content:
            '你是企业受控资料归档助手。根据已识别差异及人工复核状态生成一段简体中文归档摘要。' +
            '必须包含版本范围、差异总数、风险重点、已复核数量和归档建议。只输出 JSON：{"summary":string}。',
        },
        {
          role: 'user',
          content: JSON.stringify({
            baseline_version: input.baselineVersion,
            candidate_version: input.candidateVersion,
            differences: input.differences.map(({ id, type, risk, title, before, after, reviewed }) => ({
              id,
              type,
              risk,
              title,
              before,
              after,
              reviewed,
            })),
          }),
        },
      ]);
      const parsed = this.parseJson(raw) as { summary?: unknown };
      const summary = this.textValue(parsed.summary);
      if (!summary) throw new BadRequestException('AI 未返回有效的归档摘要');
      return {
        summary,
        model: runtime.model,
        provider: runtime.provider,
        generationMode: 'ai' as const,
        warning: undefined,
      };
    } catch (error) {
      this.logger.warn(`AI 摘要生成失败，使用确定性摘要: ${(error as Error).message}`);
      const summary = this.fallbackArchiveSummary(input.baselineVersion, input.candidateVersion, input.differences);
      return {
        summary,
        model: runtime?.model ?? 'deterministic-diff-v1',
        provider: `${runtime?.provider ?? 'local-diff'}:fallback`,
        generationMode: 'fallback' as const,
        warning: 'AI 摘要生成失败，已改用确定性规则生成',
      };
    }
  }

  private buildDiffCandidates(before: string, after: string, source: string): DiffCandidate[] {
    const beforeLines = this.lines(before);
    const afterLines = this.lines(after);
    const operations = beforeLines.length * afterLines.length <= 2_500_000
      ? this.lcsOperations(beforeLines, afterLines)
      : this.greedyOperations(beforeLines, afterLines);

    const candidates: DiffCandidate[] = [];
    let beforeLine = 1;
    let afterLine = 1;
    let index = 0;
    while (index < operations.length) {
      const operation = operations[index];
      if (operation.kind === 'equal') {
        beforeLine += 1;
        afterLine += 1;
        index += 1;
        continue;
      }
      const beforeStart = beforeLine;
      const afterStart = afterLine;
      const removed: string[] = [];
      const added: string[] = [];
      while (index < operations.length && operations[index].kind !== 'equal') {
        const item = operations[index];
        if (item.kind === 'removed') {
          removed.push(item.text);
          beforeLine += 1;
        } else {
          added.push(item.text);
          afterLine += 1;
        }
        index += 1;
      }
      const type = removed.length && added.length ? 'modified' : removed.length ? 'removed' : 'added';
      const number = candidates.length + 1;
      candidates.push({
        id: `DIFF-${String(number).padStart(3, '0')}`,
        type,
        location: removed.length && added.length
          ? `基准第 ${beforeStart} 行 / 新版第 ${afterStart} 行`
          : removed.length
            ? `基准第 ${beforeStart} 行`
            : `新版第 ${afterStart} 行`,
        before: (removed.join('\n') || '—').slice(0, MAX_HUNK_TEXT),
        after: (added.join('\n') || '—').slice(0, MAX_HUNK_TEXT),
        source,
      });
    }
    return candidates;
  }

  private lcsOperations(before: string[], after: string[]): DiffOperation[] {
    const rows = Array.from({ length: before.length + 1 }, () => new Uint16Array(after.length + 1));
    for (let left = before.length - 1; left >= 0; left -= 1) {
      for (let right = after.length - 1; right >= 0; right -= 1) {
        rows[left][right] = before[left] === after[right]
          ? rows[left + 1][right + 1] + 1
          : Math.max(rows[left + 1][right], rows[left][right + 1]);
      }
    }
    const operations: DiffOperation[] = [];
    let left = 0;
    let right = 0;
    while (left < before.length || right < after.length) {
      if (left < before.length && right < after.length && before[left] === after[right]) {
        operations.push({ kind: 'equal', text: before[left] });
        left += 1;
        right += 1;
      } else if (left < before.length && (right >= after.length || rows[left + 1][right] >= rows[left][right + 1])) {
        operations.push({ kind: 'removed', text: before[left] });
        left += 1;
      } else {
        operations.push({ kind: 'added', text: after[right] });
        right += 1;
      }
    }
    return operations;
  }

  private greedyOperations(before: string[], after: string[]): DiffOperation[] {
    const operations: DiffOperation[] = [];
    let left = 0;
    let right = 0;
    while (left < before.length || right < after.length) {
      if (left < before.length && right < after.length && before[left] === after[right]) {
        operations.push({ kind: 'equal', text: before[left] });
        left += 1;
        right += 1;
        continue;
      }
      if (left < before.length) {
        operations.push({ kind: 'removed', text: before[left] });
        left += 1;
      }
      if (right < after.length) {
        operations.push({ kind: 'added', text: after[right] });
        right += 1;
      }
    }
    return operations;
  }

  /**
   * 分批把差异送模型分类，返回 id → 分类结果。单批失败只记日志不抛错，
   * 未分类的差异由调用方按确定性规则兜底，避免一批超时毁掉整份结果。
   */
  private async classifyInBatches(
    runtime: AiRuntimeConfig,
    input: { baselineVersion: string; candidateVersion: string; notes?: string },
    aiCandidates: Array<{ id: string } & Record<string, unknown>>,
    totalHunks: number,
  ) {
    const batches: Array<typeof aiCandidates> = [];
    for (let index = 0; index < aiCandidates.length; index += AI_CLASSIFY_BATCH_SIZE) {
      batches.push(aiCandidates.slice(index, index + AI_CLASSIFY_BATCH_SIZE));
    }

    const classified = new Map<string, Record<string, unknown>>();
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(AI_CLASSIFY_CONCURRENCY, batches.length) },
      async () => {
        while (cursor < batches.length) {
          const batch = batches[cursor];
          cursor += 1;
          if (!batch) continue;
          try {
            const raw = await this.callJson(runtime, [
              {
                role: 'system',
                content:
                  '你是受控对外资料的版本审查助手。输入已由确定性文本差异算法提取。必须逐条保留输入 id，不得遗漏、合并或编造差异。' +
                  '为每条差异判断 type(modified|added|removed|format)、risk(high|medium|low)、简洁标题、可回查位置和 0-100 置信度。' +
                  '高风险包括关键参数、法规合规、警示、价格、联系方式或责任主体变化。输出严格 JSON：' +
                  '{"differences":[{"id":string,"type":string,"risk":string,"title":string,"location":string,"confidence":number}]}。',
              },
              {
                role: 'user',
                content: JSON.stringify({
                  baseline_version: input.baselineVersion,
                  candidate_version: input.candidateVersion,
                  upload_notes: input.notes ?? '',
                  total_detected_hunks: totalHunks,
                  differences: batch,
                }),
              },
            ]);
            const response = this.parseJson(raw) as { differences?: Array<Record<string, unknown>> };
            (Array.isArray(response.differences) ? response.differences : [])
              .filter((item) => typeof item?.id === 'string')
              .forEach((item) => classified.set(String(item.id), item));
          } catch (error) {
            this.logger.warn(
              `AI 差异分类分批失败（${batch.length} 条转确定性兜底）: ${(error as Error).message}`,
            );
          }
        }
      },
    );
    await Promise.all(workers);
    return classified;
  }

  /** 单独一次小请求生成整体摘要：只送标题与风险，不重复送差异原文。 */
  private async summarizeDifferences(
    runtime: AiRuntimeConfig,
    input: { baselineVersion: string; candidateVersion: string; notes?: string },
    classified: Array<Record<string, unknown>>,
  ) {
    try {
      const raw = await this.callJson(runtime, [
        {
          role: 'system',
          content:
            '你是受控对外资料的版本审查助手。根据已分类的差异清单写一段简体中文摘要，' +
            '说明差异总量、风险重点和归档前建议。输出严格 JSON：{"summary":string}。',
        },
        {
          role: 'user',
          content: JSON.stringify({
            baseline_version: input.baselineVersion,
            candidate_version: input.candidateVersion,
            upload_notes: input.notes ?? '',
            total: classified.length,
            items: classified.map((item) => ({
              type: item.type,
              risk: item.risk,
              title: item.title,
            })),
          }),
        },
      ]);
      return this.textValue((this.parseJson(raw) as { summary?: unknown }).summary);
    } catch (error) {
      this.logger.warn(`AI 摘要生成失败，改用确定性摘要: ${(error as Error).message}`);
      return '';
    }
  }

  private async resolveRuntimeConfig(): Promise<AiRuntimeConfig> {
    const fallback = await this.resolveFallbackTarget();
    const routing = await this.aiGateway.resolveTargets(
      'external_docs.version_compare',
      fallback ? [fallback] : [],
    );
    const primary = routing.targets[0];
    if (!primary) {
      throw new BadRequestException('尚未配置可用的 AI 文本模型，请先在“AI模型管理”中启用默认模型');
    }
    return {
      targets: routing.targets,
      timeoutMs: routing.timeoutMs,
      model: primary.model,
      provider: primary.provider,
      routeMeta: { source: routing.source, strategy: routing.strategy },
    };
  }

  private async resolveFallbackTarget(): Promise<AiGatewayTarget | null> {
    const rows = await this.prisma.integrationConfig.findMany({
      where: { kind: 'openai', isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
    const eligible = rows.filter((row) => {
      const metadata = this.record(row.metadata);
      const kind = this.textValue(metadata.usage_kind) || 'auto';
      if (['image', 'embedding', 'document'].includes(kind)) return false;
      const modelName = (row.model || '').toLowerCase();
      return ![
        'embedding',
        'text-embedding',
        'qwen-doc',
        'image',
        'dall-e',
        'stable-diffusion',
        'wanx',
      ].some((keyword) => modelName.includes(keyword));
    });
    const selected = eligible.find((row) => this.record(row.metadata).is_default_enabled === true) ?? eligible[0];
    if (selected) {
      let apiKey = '';
      try {
        apiKey = this.secureConfig.decryptFromStorage(selected.encryptedSecret);
      } catch (error) {
        this.logger.warn(`无法解密默认 AI 模型密钥: ${(error as Error).message}`);
      }
      if (apiKey && selected.model) {
        const metadata = this.record(selected.metadata);
        return {
          id: selected.id,
          connectionId: selected.id,
          apiKey,
          model: selected.model,
          provider: selected.provider || 'openai-compatible',
          baseUrl: this.textValue(metadata.base_url) || undefined,
        };
      }
    }

    const envApiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    if (!envApiKey) return null;
    return {
      apiKey: envApiKey,
      model: this.config.get<string>('OPENAI_MODEL')?.trim() || 'gpt-4.1-mini',
      provider: 'openai',
      baseUrl: this.config.get<string>('OPENAI_BASE_URL')?.trim() || undefined,
    };
  }

  private async callJson(runtime: AiRuntimeConfig, messages: Array<{ role: 'system' | 'user'; content: string }>) {
    const globalTimeout = Number(this.config.get('OPENAI_TIMEOUT_MS') ?? 120_000);
    const externalDocsTimeout = Number(this.config.get('EXTERNAL_DOCS_AI_TIMEOUT_MS') ?? Math.min(globalTimeout, 60_000));
    const configuredQwenMaxTokens = Number(
      this.config.get('EXTERNAL_DOCS_QWEN_JSON_MAX_TOKENS') ?? DEFAULT_QWEN_JSON_MAX_TOKENS,
    );
    const qwenMaxTokens = runtime.targets.some((target) => this.isQwenProvider(target.provider))
      ? Number.isFinite(configuredQwenMaxTokens) && configuredQwenMaxTokens > 0
        ? Math.round(configuredQwenMaxTokens)
        : DEFAULT_QWEN_JSON_MAX_TOKENS
      : undefined;
    const result = await this.aiGateway.complete({
      scene: 'external_docs.version_compare',
      targets: runtime.targets,
      routeMeta: runtime.routeMeta,
      messages,
      responseFormat: { type: 'json_object' },
      retryWithoutResponseFormat: true,
      temperature: 0.1,
      maxTokens: qwenMaxTokens,
      timeoutMs: runtime.timeoutMs ?? (
        Number.isFinite(externalDocsTimeout) && externalDocsTimeout > 0 ? externalDocsTimeout : 60_000
      ),
    });
    runtime.model = result.model;
    runtime.provider = result.provider;
    return result.content || '{}';
  }

  private parseJson(raw: string) {
    const normalized = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try {
      return JSON.parse(normalized || '{}') as unknown;
    } catch {
      const start = normalized.indexOf('{');
      const end = normalized.lastIndexOf('}');
      if (start >= 0 && end > start) return JSON.parse(normalized.slice(start, end + 1)) as unknown;
      throw new BadRequestException('AI 返回内容不是有效 JSON');
    }
  }

  private lines(text: string) {
    return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  private record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }

  private textValue(value: unknown) {
    return typeof value === 'string' ? value.trim() : '';
  }

  private differenceType(value: unknown, fallback: DiffCandidate['type']): ExternalDifference['type'] {
    return ['modified', 'added', 'removed', 'format'].includes(String(value))
      ? String(value) as ExternalDifference['type']
      : fallback;
  }

  private differenceRisk(value: unknown): ExternalDifference['risk'] {
    return ['high', 'medium', 'low'].includes(String(value)) ? String(value) as ExternalDifference['risk'] : 'medium';
  }

  private localDifferenceRisk(candidate: DiffCandidate): ExternalDifference['risk'] {
    const content = `${candidate.before}\n${candidate.after}`;
    if (/\b\d+(?:\.\d+)?\s*(?:v|a|w|kw|mm|cm|mpa|℃|°c|%|元|天|个月|年)\b/i.test(content)) return 'high';
    if (/法规|标准|合规|警告|危险|禁止|不得|责任|价格|金额|型号|参数|电压|电流|功率|尺寸|公差|保修|联系方式/.test(content)) return 'high';
    if (candidate.type === 'removed' || candidate.type === 'modified') return 'medium';
    return 'low';
  }

  private isQwenProvider(provider: string) {
    const normalized = provider.trim().toLowerCase();
    return (
      ['qwen', 'tongyi', 'dashscope', 'aliyun'].some((item) => normalized.includes(item)) ||
      normalized.includes('千问') ||
      normalized.includes('通义')
    );
  }

  private confidenceValue(value: unknown) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number * 10) / 10)) : 95;
  }

  private defaultTitle(candidate: DiffCandidate) {
    if (candidate.type === 'added') return '新增内容';
    if (candidate.type === 'removed') return '删除内容';
    return '内容调整';
  }

  private fallbackSummary(baseline: string, candidate: string, differences: ExternalDifference[]) {
    const high = differences.filter((item) => item.risk === 'high').length;
    return `${candidate} 相对 ${baseline} 共识别 ${differences.length} 处文本差异，其中高风险 ${high} 处。请逐项复核并确认归档。`;
  }

  private fallbackArchiveSummary(baseline: string, candidate: string, differences: ExternalDifference[]) {
    const reviewed = differences.filter((item) => item.reviewed).length;
    const high = differences.filter((item) => item.risk === 'high').length;
    return `${candidate} 相对 ${baseline} 共识别 ${differences.length} 处差异，其中高风险 ${high} 处，已人工复核 ${reviewed} 处。请确认复核结果后归档。`;
  }
}
