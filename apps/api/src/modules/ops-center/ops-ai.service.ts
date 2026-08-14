import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { AiGatewayService } from '../ai-gateway/ai-gateway.service';
import type { AiGatewayTarget } from '../ai-gateway/ai-gateway.types';
import { SecureConfigService } from '../security/secure-config.service';

/** 传给 AI 的报错上下文（已脱敏）。 */
export type OpsErrorContext = {
  method: string;
  path: string;
  statusCode: number;
  errorName?: string | null;
  errorMessage?: string | null;
  errorStack?: string | null;
  requestMeta?: unknown;
  responseMeta?: unknown;
  occurrences: number;
  firstSeen?: string | null;
  lastSeen?: string | null;
  affectedUsers: number;
};

/** AI 归因结构化结果。 */
export type OpsErrorAnalysis = {
  summary: string;
  probable_causes: string[];
  impact: string;
  investigation_steps: string[];
  fix_suggestions: string[];
  /** 生成来源：ai = 模型生成；unavailable = 未配置模型的本地兜底。 */
  generated_by: 'ai' | 'unavailable';
  model?: string | null;
};

const ANALYSIS_TIMEOUT_MS = 60_000;

@Injectable()
export class OpsAiService {
  private readonly logger = new Logger(OpsAiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secureConfig: SecureConfigService,
    private readonly aiGateway: AiGatewayService,
  ) {}

  /** 取「集成管理」里已启用的 OpenAI 模型配置（与对话/简历筛选同源）；未配置返回 null。 */
  private async resolveModelConfig(): Promise<AiGatewayTarget | null> {
    const cfg = await this.prisma.integrationConfig.findFirst({
      where: { kind: 'openai', isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!cfg) return null;
    let apiKey = '';
    try {
      apiKey = this.secureConfig.decryptFromStorage(cfg.encryptedSecret) ?? '';
    } catch {
      apiKey = '';
    }
    if (!apiKey) return null;
    const meta = (cfg.metadata && typeof cfg.metadata === 'object' && !Array.isArray(cfg.metadata)
      ? (cfg.metadata as Record<string, unknown>)
      : {});
    const baseUrl = typeof meta.base_url === 'string' && meta.base_url ? meta.base_url : undefined;
    return {
      id: cfg.id,
      connectionId: cfg.id,
      provider: cfg.provider?.trim() || 'openai',
      apiKey,
      baseUrl,
      model: cfg.model?.trim() || 'gpt-4.1-mini',
    };
  }

  /** 模型是否就绪（前端据此提示用户去配置）。 */
  async isReady(): Promise<boolean> {
    const fallback = await this.resolveModelConfig();
    const routing = await this.aiGateway.resolveTargets(
      'ops.error_analysis',
      fallback ? [fallback] : [],
      { advanceRoundRobin: false },
    );
    return routing.targets.length > 0;
  }

  async analyze(ctx: OpsErrorContext): Promise<OpsErrorAnalysis> {
    const cfg = await this.resolveModelConfig();
    const routing = await this.aiGateway.resolveTargets('ops.error_analysis', cfg ? [cfg] : []);
    if (routing.targets.length === 0) {
      return {
        summary: '尚未配置可用的 AI 模型，无法进行智能归因。',
        probable_causes: [],
        impact: '',
        investigation_steps: ['前往「集成管理 → AI 模型」启用一个 OpenAI 兼容模型后重试。'],
        fix_suggestions: [],
        generated_by: 'unavailable',
        model: null,
      };
    }

    const systemPrompt =
      '你是一名资深后端 SRE / 运维专家。根据给定的线上接口报错上下文，做根因分析。' +
      '严格只输出 JSON，键为：summary(string，一句话结论)、probable_causes(string[]，按可能性从高到低，每条简明指出原因)、' +
      'impact(string，影响面/严重程度)、investigation_steps(string[]，可执行的排查步骤)、fix_suggestions(string[]，修复方向)。' +
      '基于事实推断，不要编造未提供的信息；中文输出。';
    const userPayload = {
      接口: `${ctx.method} ${ctx.path}`,
      状态码: ctx.statusCode,
      错误类型: ctx.errorName ?? null,
      错误信息: ctx.errorMessage ?? null,
      错误堆栈: ctx.errorStack ? ctx.errorStack.slice(0, 3000) : null,
      请求摘要: ctx.requestMeta ?? null,
      响应摘要: ctx.responseMeta ?? null,
      近7天同类发生次数: ctx.occurrences,
      影响用户数: ctx.affectedUsers,
      首次出现: ctx.firstSeen ?? null,
      最近出现: ctx.lastSeen ?? null,
    };

    try {
      const result = await this.aiGateway.complete({
        scene: 'ops.error_analysis',
        targets: routing.targets,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(userPayload) },
        ],
        responseFormat: { type: 'json_object' },
        timeoutMs: routing.timeoutMs ?? ANALYSIS_TIMEOUT_MS,
      });
      const parsed = this.parseAnalysis(result.content);
      return { ...parsed, generated_by: 'ai', model: result.model };
    } catch (error) {
      this.logger.warn(`[OpsAiService.analyze] AI 调用失败: ${error instanceof Error ? error.message : String(error)}`);
      return {
        summary: 'AI 调用失败，请稍后重试或检查模型配置/网络。',
        probable_causes: [],
        impact: '',
        investigation_steps: [error instanceof Error ? error.message : '未知错误'],
        fix_suggestions: [],
        generated_by: 'unavailable',
        model: routing.targets[0]?.model ?? null,
      };
    }
  }

  private parseAnalysis(text: string): Omit<OpsErrorAnalysis, 'generated_by' | 'model'> {
    const asArray = (v: unknown): string[] =>
      Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : typeof v === 'string' && v.trim() ? [v.trim()] : [];
    try {
      const obj = JSON.parse(text) as Record<string, unknown>;
      return {
        summary: typeof obj.summary === 'string' ? obj.summary : '',
        probable_causes: asArray(obj.probable_causes),
        impact: typeof obj.impact === 'string' ? obj.impact : '',
        investigation_steps: asArray(obj.investigation_steps),
        fix_suggestions: asArray(obj.fix_suggestions),
      };
    } catch {
      // 模型未按 JSON 返回时，整体作为 summary 兜底。
      return { summary: text.trim().slice(0, 2000), probable_causes: [], impact: '', investigation_steps: [], fix_suggestions: [] };
    }
  }
}
