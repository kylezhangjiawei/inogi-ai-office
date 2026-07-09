import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

import { PrismaService } from '../../prisma/prisma.service';
import { SecureConfigService } from '../security/secure-config.service';

export type WebSearchSource = {
  title: string;
  url: string;
  siteName?: string;
};

export type WebSearchResult = {
  /** 联网检索后由搜索代理整理出的资料要点（客观转述，供主模型引用） */
  summary: string;
  sources: WebSearchSource[];
};

/**
 * 模型无关的联网搜索工具。
 *
 * RAG 的兜底层：主对话模型可以是任何 provider（OpenAI / 千问 / 自定义端点），
 * 联网检索本身固定走「阿里 compatible-mode 端点的千问 + enable_search」充当搜索代理，
 * 把互联网资料整理成文本要点 + 来源列表，注入任意主模型的上下文。
 * 没有可用的阿里配置时返回 null，调用方优雅降级（明确告知联网不可用）。
 */
@Injectable()
export class WebSearchService {
  private readonly logger = new Logger(WebSearchService.name);
  private readonly envQwenKey: string | null;
  private readonly envQwenBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly secureConfigService: SecureConfigService,
  ) {
    this.envQwenKey =
      this.config.get<string>('DASHSCOPE_API_KEY') ??
      this.config.get<string>('QWEN_API_KEY') ??
      null;
    this.envQwenBaseUrl =
      this.config.get<string>('DASHSCOPE_BASE_URL')?.trim().replace(/\/$/, '') ??
      'https://dashscope.aliyuncs.com/compatible-mode/v1';
  }

  /** 是否存在可用的搜索代理（前端可据此隐藏联网入口） */
  async isAvailable(): Promise<boolean> {
    return (await this.resolveSearchAgent()) !== null;
  }

  /**
   * 联网检索：返回资料要点 + 来源列表；不可用或检索失败返回 null。
   * conversationContext 可选，用于让搜索代理理解指代（如“那明天呢”）。
   */
  async search(
    query: string,
    opts: { conversationContext?: string } = {},
  ): Promise<WebSearchResult | null> {
    const agent = await this.resolveSearchAgent();
    if (!agent) return null;

    const client = new OpenAI({ apiKey: agent.apiKey, baseURL: agent.baseUrl, timeout: 60_000 });
    try {
      const completion = await client.chat.completions.create({
        model: agent.model,
        messages: [
          {
            role: 'system',
            content:
              '你是联网检索助手。基于联网搜索到的最新资料回答用户问题：客观转述检索到的关键信息（保留具体数字、日期、机构名），结构清晰、直接给要点，不要寒暄或免责声明。检索资料不足时如实说明「未检索到相关结果」。',
          },
          ...(opts.conversationContext
            ? [{ role: 'user' as const, content: `（对话背景，仅用于理解指代）\n${opts.conversationContext}` }]
            : []),
          { role: 'user', content: query },
        ],
        temperature: 0.3,
        // DashScope 扩展参数：强制联网并要求返回来源列表
        ...({ enable_search: true, search_options: { forced_search: true, enable_source: true } } as Record<string, unknown>),
      });

      const summary = completion.choices[0]?.message?.content?.trim() ?? '';
      if (!summary) return null;
      return { summary, sources: this.extractSources(completion) };
    } catch (err) {
      this.logger.warn(
        `联网检索失败(model=${agent.model}): ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  // ── 内部 ───────────────────────────────────────────────────────────────────

  /**
   * 找搜索代理：已启用的「阿里端点 + 千问对话模型」配置优先（与 AI 模型管理联动），
   * 没有配置但环境有 DASHSCOPE_API_KEY 时用环境兜底（模型名可用 WEB_SEARCH_MODEL 覆盖）。
   */
  private async resolveSearchAgent(): Promise<{ model: string; apiKey: string; baseUrl: string } | null> {
    const configs = await this.prisma.integrationConfig.findMany({
      where: { kind: 'openai', isActive: true },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
    });

    for (const config of configs) {
      const model = config.model ?? '';
      const provider = config.provider ?? '';
      if (!/qwen|tongyi|dashscope|阿里|通义/i.test(`${provider} ${model}`)) continue;
      // 排除 embedding / 文档解析 / 图像等非对话模型
      if (/embedding|-doc-|doc-turbo|image|ocr|tts|asr/i.test(model)) continue;
      const metadata =
        config.metadata && typeof config.metadata === 'object' && !Array.isArray(config.metadata)
          ? (config.metadata as Record<string, unknown>)
          : {};
      const baseUrl =
        (typeof metadata.base_url === 'string' && metadata.base_url.trim().replace(/\/$/, '')) ||
        this.envQwenBaseUrl;
      // enable_search 是阿里 compatible-mode 扩展，非阿里端点不可用
      if (!/dashscope|aliyuncs\.com/i.test(baseUrl)) continue;
      const apiKey = this.decryptSecret(config.encryptedSecret) || this.envQwenKey || '';
      if (!apiKey) continue;
      return { model, apiKey, baseUrl };
    }

    if (this.envQwenKey) {
      return {
        model: this.config.get<string>('WEB_SEARCH_MODEL') ?? 'qwen-plus',
        apiKey: this.envQwenKey,
        baseUrl: this.envQwenBaseUrl,
      };
    }
    return null;
  }

  /** DashScope 返回的来源列表在扩展字段 search_info.search_results 中，防御式解析 */
  private extractSources(completion: unknown): WebSearchSource[] {
    const raw =
      (completion as { search_info?: { search_results?: unknown[] } })?.search_info
        ?.search_results ?? [];
    if (!Array.isArray(raw)) return [];
    const out: WebSearchSource[] = [];
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const url = typeof o.url === 'string' ? o.url : '';
      if (!url) continue;
      out.push({
        url,
        title: typeof o.title === 'string' && o.title ? o.title : url,
        siteName: typeof o.site_name === 'string' ? o.site_name : undefined,
      });
      if (out.length >= 8) break;
    }
    return out;
  }

  private decryptSecret(value: string): string {
    try {
      return this.secureConfigService.decryptFromStorage(value);
    } catch {
      return '';
    }
  }
}
