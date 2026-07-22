import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import { PrismaService } from '../../prisma/prisma.service';
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
  apiKey: string;
  model: string;
  provider: string;
  baseURL?: string;
};

type DiffOperation = { kind: 'equal' | 'removed' | 'added'; text: string };

const MAX_AI_HUNKS = 160;
const MAX_HUNK_TEXT = 1800;

@Injectable()
export class ExternalDocumentAiService {
  private readonly logger = new Logger(ExternalDocumentAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly secureConfig: SecureConfigService,
    private readonly ocrService: OcrService,
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
    try {
      runtime = await this.resolveRuntimeConfig();
    } catch (error) {
      this.logger.warn(`AI 模型不可用，资料比对使用确定性降级: ${(error as Error).message}`);
    }

    if (candidates.length === 0) {
      return {
        summary: `${input.candidateVersion} 与 ${input.baselineVersion} 的可提取文字内容一致，未发现文本差异。仍建议人工核对图片、颜色和版式。`,
        differences: [] as ExternalDifference[],
        model: runtime?.model ?? 'deterministic-diff-v1',
        provider: runtime?.provider ?? 'local-diff',
      };
    }

    const aiCandidates = candidates.slice(0, MAX_AI_HUNKS);
    let parsed: {
      summary?: unknown;
      differences?: Array<Record<string, unknown>>;
    } = {};
    let aiSucceeded = false;
    if (runtime) {
      try {
        const raw = await this.callJson(runtime, [
          {
            role: 'system',
            content:
              '你是受控对外资料的版本审查助手。输入已由确定性文本差异算法提取。必须逐条保留输入 id，不得遗漏、合并或编造差异。' +
              '为每条差异判断 type(modified|added|removed|format)、risk(high|medium|low)、简洁标题、可回查位置和 0-100 置信度。' +
              '高风险包括关键参数、法规合规、警示、价格、联系方式或责任主体变化。输出严格 JSON：' +
              '{"summary":string,"differences":[{"id":string,"type":string,"risk":string,"title":string,"location":string,"confidence":number}]}。' +
              'summary 使用简体中文，说明差异总量、风险重点和归档前建议。',
          },
          {
            role: 'user',
            content: JSON.stringify({
              baseline_version: input.baselineVersion,
              candidate_version: input.candidateVersion,
              upload_notes: input.notes ?? '',
              total_detected_hunks: candidates.length,
              differences: aiCandidates,
            }),
          },
        ]);
        parsed = this.parseJson(raw) as typeof parsed;
        aiSucceeded = true;
      } catch (error) {
        this.logger.warn(`AI 差异分类失败，保留确定性差异进入人工复核: ${(error as Error).message}`);
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
      return { summary, model: runtime.model, provider: runtime.provider };
    } catch (error) {
      this.logger.warn(`AI 摘要生成失败，使用确定性摘要: ${(error as Error).message}`);
      const summary = this.fallbackArchiveSummary(input.baselineVersion, input.candidateVersion, input.differences);
      return {
        summary,
        model: runtime?.model ?? 'deterministic-diff-v1',
        provider: `${runtime?.provider ?? 'local-diff'}:fallback`,
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

  private async resolveRuntimeConfig(): Promise<AiRuntimeConfig> {
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
          apiKey,
          model: selected.model,
          provider: selected.provider || 'openai-compatible',
          baseURL: this.textValue(metadata.base_url) || undefined,
        };
      }
    }

    const envApiKey = this.config.get<string>('OPENAI_API_KEY')?.trim();
    if (!envApiKey) {
      throw new BadRequestException('尚未配置可用的 AI 文本模型，请先在“AI模型管理”中启用默认模型');
    }
    return {
      apiKey: envApiKey,
      model: this.config.get<string>('OPENAI_MODEL')?.trim() || 'gpt-4.1-mini',
      provider: 'openai',
      baseURL: this.config.get<string>('OPENAI_BASE_URL')?.trim() || undefined,
    };
  }

  private async callJson(runtime: AiRuntimeConfig, messages: Array<{ role: 'system' | 'user'; content: string }>) {
    const globalTimeout = Number(this.config.get('OPENAI_TIMEOUT_MS') ?? 120_000);
    const externalDocsTimeout = Number(this.config.get('EXTERNAL_DOCS_AI_TIMEOUT_MS') ?? Math.min(globalTimeout, 60_000));
    const client = new OpenAI({
      apiKey: runtime.apiKey,
      ...(runtime.baseURL ? { baseURL: runtime.baseURL } : {}),
      timeout: Number.isFinite(externalDocsTimeout) && externalDocsTimeout > 0 ? externalDocsTimeout : 60_000,
    });
    try {
      const response = await client.chat.completions.create({
        model: runtime.model,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.1,
      });
      return response.choices[0]?.message?.content ?? '{}';
    } catch (firstError) {
      if (!this.shouldRetryWithoutJsonMode(firstError)) throw firstError;
      this.logger.warn(`AI JSON mode 调用失败，回退普通 JSON 提示: ${(firstError as Error).message}`);
      const response = await client.chat.completions.create({
        model: runtime.model,
        messages,
        temperature: 0.1,
      });
      return response.choices[0]?.message?.content ?? '{}';
    }
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

  private shouldRetryWithoutJsonMode(error: unknown) {
    const info = this.record(error);
    const status = Number(info.status);
    const message = (error as Error)?.message?.toLowerCase() ?? '';
    return status === 400 && /response[_ -]?format|json[_ -]?mode|json_object/.test(message);
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
