import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IntegrationConfig, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { OcrService } from '../ocr/ocr.service';
import { OpenAiScreeningService } from '../resume-screening/openai-screening.service';
import { SecureConfigService } from '../security/secure-config.service';
import { ListIntegrationQueryDto } from './dto/list-integration-query.dto';
import { SaveAiModelDto } from './dto/save-ai-model.dto';
import { SaveMailboxDto } from './dto/save-mailbox.dto';
import { SaveOcrConfigDto } from './dto/save-ocr-config.dto';
import { TestAiModelConnectionDto } from './dto/test-ai-model-connection.dto';

type MailboxMetadata = {
  operator_name: string;
};

/** 模型连接列表用到的网关尝试字段，与 DISTINCT ON 原生查询回传的列一一对应。 */
type LatestGatewayAttemptRow = {
  connectionId: string | null;
  status: string;
  latencyMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
};

/**
 * 模型用途类型（能力轴，与连接轴 kind 正交）：
 * - text=纯文本对话/摘要/结构化提取
 * - multimodal=图文理解（可接收图片输入）
 * - image=图片生成 / 参考图生图 / 图片编辑
 * - embedding=向量化（RAG 检索），不可当对话模型
 * - document=文档解析（如 qwen-doc 系列），只用于文件读取，不可当对话模型
 * - video=视频生成（图生视频 / 文生视频），不可当对话模型
 * - audio=实时语音合成 / 语音对话，不可当普通对话模型
 * - auto=根据模型名称自动推断（兜底）
 */
type AiModelUsageKind = 'text' | 'multimodal' | 'image' | 'embedding' | 'document' | 'video' | 'audio' | 'auto';

const VALID_USAGE_KINDS: readonly string[] = [
  'text',
  'multimodal',
  'image',
  'embedding',
  'document',
  'video',
  'audio',
  'auto',
];

type AiModelMetadata = {
  operator_name: string;
  base_url: string;
  current_status: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_latency_ms: number | null;
  today_requests: number;
  today_tokens: number;
  total_tokens: number;
  daily_token_usage: AiModelDailyTokenUsage[];
  is_default_enabled: boolean;
  today_usage_date: string;
  last_error_message: string | null;
  /** 显式用途类型；不设置时前端按模型名称自动推断 */
  usage_kind: AiModelUsageKind;
  /** 输入单价（元 / 千 token）。0 表示未配置，成本统计会跳过这条连接。 */
  input_price_per_1k: number;
  /** 输出单价（元 / 千 token）。 */
  output_price_per_1k: number;
};

type AiModelDailyTokenUsage = {
  date: string;
  requests: number;
  tokens: number;
};

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 10;

@Injectable()
export class IntegrationManagementService {
  private readonly logger = new Logger(IntegrationManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secureConfigService: SecureConfigService,
    private readonly openAiScreeningService: OpenAiScreeningService,
    private readonly ocrService: OcrService,
  ) {}

  /** 腾讯 OCR 配置：读取脱敏后的当前配置（DB / env / 未配置） */
  getOcrConfig() {
    return this.ocrService.getMaskedTencentConfig();
  }

  /** 腾讯 OCR 配置：保存到 IntegrationConfig(kind=tencent_ocr)，与 OcrService/经费共用同一处 */
  async saveOcrConfig(payload: SaveOcrConfigDto, userId?: string) {
    const operatorName = await this.resolveOperatorName(userId);
    const secretKey = this.resolveTransportSecret({
      encryptedSecret: payload.encrypted_secret,
      plainSecret: payload.plain_secret,
    });
    return this.ocrService.saveTencentConfig(
      {
        enabled: payload.enabled,
        secret_id: payload.secret_id,
        // 空字符串视为「未提供」→ 保留原密钥
        secret_key: secretKey || undefined,
        region: payload.region,
        endpoint: payload.endpoint,
        invoice_action: payload.invoice_action,
      },
      operatorName,
    );
  }

  getSecurityPublicKey() {
    return {
      algorithm: 'RSA-OAEP',
      public_key: this.secureConfigService.getPublicKey(),
    };
  }

  async listMailboxes(query: ListIntegrationQueryDto) {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.page_size ?? DEFAULT_PAGE_SIZE;
    const keyword = query.keyword?.trim() ?? '';

    const where: Prisma.IntegrationConfigWhereInput = {
      kind: 'mail',
      ...(keyword
        ? {
            OR: [
              { accountIdentifier: { contains: keyword, mode: 'insensitive' } },
              { name: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.integrationConfig.count({ where }),
      this.prisma.integrationConfig.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: items.map((item) => this.toMailboxResponse(item)),
      total,
      page,
      page_size: pageSize,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async saveMailbox(payload: SaveMailboxDto, userId?: string) {
    const email = payload.email?.trim();
    if (!email) {
      throw new BadRequestException('邮箱地址不能为空');
    }

    const operatorName = await this.resolveOperatorName(userId);

    if (payload.id) {
      const existing = await this.prisma.integrationConfig.findFirst({
        where: { id: payload.id, kind: 'mail' },
      });
      if (!existing) {
        throw new NotFoundException('邮箱配置不存在');
      }

      const nextSecret = this.resolveStoredSecret(
        {
          encryptedSecret: payload.encrypted_secret,
          plainSecret: payload.plain_secret,
        },
        existing.encryptedSecret,
      );

      const updated = await this.prisma.integrationConfig.update({
        where: { id: payload.id },
        data: {
          name: email,
          accountIdentifier: email,
          encryptedSecret: nextSecret,
          isActive: Boolean(payload.enabled),
          metadata: {
            ...this.parseMailboxMetadata(existing.metadata),
            operator_name: operatorName,
          } satisfies MailboxMetadata as Prisma.InputJsonValue,
        },
      });

      return this.toMailboxResponse(updated);
    }

    const nextSecret = this.resolveStoredSecret({
      encryptedSecret: payload.encrypted_secret,
      plainSecret: payload.plain_secret,
    });
    if (!nextSecret) {
      throw new BadRequestException('邮箱密码不能为空');
    }

    const created = await this.prisma.integrationConfig.create({
      data: {
        kind: 'mail',
        name: email,
        accountIdentifier: email,
        encryptedSecret: nextSecret,
        isActive: Boolean(payload.enabled),
        metadata: {
          operator_name: operatorName,
        } satisfies MailboxMetadata as Prisma.InputJsonValue,
      },
    });

    return this.toMailboxResponse(created);
  }

  async deleteMailbox(mailboxId: string) {
    const existing = await this.prisma.integrationConfig.findFirst({
      where: { id: mailboxId, kind: 'mail' },
    });
    if (!existing) {
      throw new NotFoundException('邮箱配置不存在');
    }

    await this.prisma.integrationConfig.delete({ where: { id: mailboxId } });
    return { id: mailboxId };
  }

  async listAiModels(query: ListIntegrationQueryDto) {
    const page = query.page ?? DEFAULT_PAGE;
    const pageSize = query.page_size ?? DEFAULT_PAGE_SIZE;
    const keyword = query.keyword?.trim() ?? '';

    const where: Prisma.IntegrationConfigWhereInput = {
      kind: 'openai',
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword, mode: 'insensitive' } },
              { provider: { contains: keyword, mode: 'insensitive' } },
              { model: { contains: keyword, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, items] = await Promise.all([
      this.prisma.integrationConfig.count({ where }),
      this.prisma.integrationConfig.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const connectionIds = items.map((item) => item.id);
    const [latestGatewayAttempts, todayGatewayAttempts] = await this.loadGatewayRuntime(connectionIds);

    const latestAttemptByConnection = new Map(
      latestGatewayAttempts
        .filter((attempt) => Boolean(attempt.connectionId))
        .map((attempt) => [attempt.connectionId as string, attempt]),
    );
    const todayAttemptsByConnection = new Map(
      todayGatewayAttempts
        .filter((group) => Boolean(group.connectionId))
        .map((group) => [group.connectionId as string, group._count._all]),
    );

    return {
      items: items.map((item) => {
        const response = this.toAiModelResponse(item);
        const latestAttempt = latestAttemptByConnection.get(item.id);
        const todayGatewayRequests = todayAttemptsByConnection.get(item.id) ?? 0;
        if (!latestAttempt) {
          return {
            ...response,
            today_requests: response.today_requests + todayGatewayRequests,
          };
        }

        const metadataRuntimeAt = Math.max(
          this.timestampOrZero(response.last_success_at),
          this.timestampOrZero(response.last_failure_at),
        );
        const gatewayRuntimeAt = latestAttempt.createdAt.getTime();
        if (gatewayRuntimeAt <= metadataRuntimeAt) {
          return {
            ...response,
            today_requests: response.today_requests + todayGatewayRequests,
          };
        }

        const gatewayRuntimeIso = latestAttempt.createdAt.toISOString();
        const gatewaySucceeded = latestAttempt.status === 'success';
        const gatewayFailed = latestAttempt.status === 'failed';
        return {
          ...response,
          current_status: gatewaySucceeded ? '运行正常' : gatewayFailed ? '连接异常' : '临时熔断',
          last_success_at: gatewaySucceeded ? gatewayRuntimeIso : response.last_success_at,
          last_failure_at: gatewayFailed ? gatewayRuntimeIso : response.last_failure_at,
          last_latency_ms: latestAttempt.latencyMs > 0 ? latestAttempt.latencyMs : response.last_latency_ms,
          today_requests: response.today_requests + todayGatewayRequests,
          last_error_message: gatewaySucceeded
            ? null
            : latestAttempt.errorMessage || latestAttempt.errorCode || response.last_error_message,
        };
      }),
      total,
      page,
      page_size: pageSize,
      total_pages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async saveAiModel(payload: SaveAiModelDto, userId?: string) {
    const name = payload.name?.trim();
    const provider = payload.provider?.trim();
    const model = payload.model?.trim();

    if (!name || !provider || !model) {
      throw new BadRequestException('模型名称、服务商、模型标识不能为空');
    }

    const operatorName = await this.resolveOperatorName(userId);

    // 若本次保存把这条设为默认，先把其它模型的 is_default_enabled 清零
    // 保证全表至多一条默认模型，避免前端"默认模型不确定"的问题
    if (payload.is_default_enabled) {
      await this.clearOtherDefaultModels(payload.id);
    }

    if (payload.id) {
      const existing = await this.prisma.integrationConfig.findFirst({
        where: { id: payload.id, kind: 'openai' },
      });
      if (!existing) {
        throw new NotFoundException('AI 模型配置不存在');
      }

      const existingMetadata = this.parseAiModelMetadata(existing.metadata);
      const encryptedSecret = this.resolveStoredSecret(
        {
          encryptedSecret: payload.encrypted_secret,
          plainSecret: payload.plain_secret,
        },
        existing.encryptedSecret,
      );

      const updated = await this.prisma.integrationConfig.update({
        where: { id: payload.id },
        data: {
          name,
          provider,
          model,
          encryptedSecret,
          isActive: Boolean(payload.enabled),
          metadata: this.toAiModelMetadata(payload, operatorName, existingMetadata) as Prisma.InputJsonValue,
        },
      });

      return this.toAiModelResponse(updated);
    }

    const created = await this.prisma.integrationConfig.create({
      data: {
        kind: 'openai',
        name,
        provider,
        model,
        encryptedSecret:
          this.resolveStoredSecret({
            encryptedSecret: payload.encrypted_secret,
            plainSecret: payload.plain_secret,
          }) ?? this.secureConfigService.encryptForStorage(''),
        isActive: Boolean(payload.enabled),
        metadata: this.toAiModelMetadata(payload, operatorName) as Prisma.InputJsonValue,
      },
    });

    return this.toAiModelResponse(created);
  }

  async testAiModelConnection(payload: TestAiModelConnectionDto) {
    const model = payload.model?.trim();
    if (!model) {
      throw new BadRequestException('模型标识不能为空');
    }

    const existing = payload.id
      ? await this.prisma.integrationConfig.findFirst({
          where: { id: payload.id, kind: 'openai' },
        })
      : null;

    if (payload.id && !existing) {
      throw new NotFoundException('AI 模型配置不存在');
    }

    const existingMetadata = this.parseAiModelMetadata(existing?.metadata ?? null);
    const baseUrl = payload.base_url?.trim() ?? existingMetadata.base_url;
    const apiKey = this.resolveTransportSecret({
      encryptedSecret: payload.encrypted_secret,
      plainSecret: payload.plain_secret,
    }) || (existing ? this.decryptSecret(existing.encryptedSecret) : '');

    if (!apiKey) {
      throw new BadRequestException('请先填写 API Key，或在已保存模型上进行连通性测试');
    }

    const provider = payload.provider?.trim() || existing?.provider || 'openai';
    const usageKind = this.resolveConnectionTestUsageKind(
      payload.usage_kind,
      existingMetadata.usage_kind,
      model,
    );
    const useImageModelTest = this.shouldUseImageModelConnectionTest(provider, model);
    const useEmbeddingModelTest = this.shouldUseEmbeddingConnectionTest(model);
    const useDashScopeNativeTest = !useImageModelTest
      && (usageKind === 'image' || usageKind === 'video' || usageKind === 'audio');

    try {
      const result = useImageModelTest
        ? await this.openAiScreeningService.testImageConnection(
            apiKey,
            model,
            baseUrl || undefined,
            provider,
          )
        : useDashScopeNativeTest
          ? await this.openAiScreeningService.testDashScopeNativeConnection(
              usageKind,
              apiKey,
              model,
              baseUrl || undefined,
              provider,
            )
          : useEmbeddingModelTest || usageKind === 'embedding'
          ? await this.openAiScreeningService.testEmbeddingConnection(
              apiKey,
              model,
              baseUrl || undefined,
              provider,
            )
          : await this.openAiScreeningService.testConnection(
              apiKey,
              model,
              baseUrl || undefined,
              provider,
            );

      if (existing) {
        const runtimeMetadata = this.mergeAiRuntimeMetadata(existingMetadata, {
          base_url: baseUrl,
          current_status: '运行正常',
          last_success_at: new Date().toISOString(),
          last_latency_ms: result.durationMs,
          total_tokens: result.usage.totalTokens,
          clear_error: true,
        });

        await this.prisma.integrationConfig.update({
          where: { id: existing.id },
          data: { metadata: runtimeMetadata as Prisma.InputJsonValue },
        });
      }

      return {
        success: true,
        message: 'AI 模型连通性测试成功',
        model: result.modelName,
        base_url: result.baseUrl,
        duration_ms: result.durationMs,
        output_text: result.outputText,
        total_tokens: result.usage.totalTokens,
      };
    } catch (error) {
      const message = this.getSourceErrorMessage(error);

      if (existing) {
        const runtimeMetadata = this.mergeAiRuntimeMetadata(existingMetadata, {
          base_url: baseUrl,
          current_status: '连接异常',
          last_failure_at: new Date().toISOString(),
          last_error_message: message,
        });

        await this.prisma.integrationConfig.update({
          where: { id: existing.id },
          data: { metadata: runtimeMetadata as Prisma.InputJsonValue },
        });
      }

      return {
        success: false,
        message,
        model,
        base_url: baseUrl || null,
      };
    }
  }

  async deleteAiModel(modelId: string) {
    const existing = await this.prisma.integrationConfig.findFirst({
      where: { id: modelId, kind: 'openai' },
    });
    if (!existing) {
      throw new NotFoundException('AI 模型配置不存在');
    }

    await this.prisma.integrationConfig.delete({ where: { id: modelId } });
    return { id: modelId };
  }

  private shouldUseImageModelConnectionTest(provider: string, model: string) {
    const normalizedProvider = provider.trim().toLowerCase();
    const normalizedModel = model.trim().toLowerCase();
    const isOpenAiProvider = !normalizedProvider || normalizedProvider.includes('openai');
    return isOpenAiProvider && (normalizedModel.startsWith('gpt-image-') || normalizedModel.startsWith('dall-e-'));
  }

  /** 模型名含 embedding/embed 的走 embeddings.create 测试，避免 chat 接口 400 */
  private shouldUseEmbeddingConnectionTest(model: string) {
    const normalizedModel = model.trim().toLowerCase();
    return /(^|[\-_/])embed(ding)?(s)?($|[\-_/])/.test(normalizedModel) || normalizedModel.includes('embedding');
  }

  private resolveConnectionTestUsageKind(
    requestedKind: string | undefined,
    storedKind: AiModelUsageKind,
    model: string,
  ): AiModelUsageKind {
    const explicitKind = requestedKind?.trim();
    if (explicitKind && VALID_USAGE_KINDS.includes(explicitKind) && explicitKind !== 'auto') {
      return explicitKind as AiModelUsageKind;
    }
    if (storedKind && storedKind !== 'auto') {
      return storedKind;
    }

    const normalizedModel = model.trim().toLowerCase();
    if (this.shouldUseEmbeddingConnectionTest(normalizedModel)) return 'embedding';
    if (/qwen-image|wan\d.*image|gpt-image|dall-e/.test(normalizedModel)) return 'image';
    if (/happyhorse|(^|[\-_/])(i2v|t2v|r2v)($|[\-_/])/.test(normalizedModel)) return 'video';
    if (/audio|tts|speech|realtime/.test(normalizedModel)) return 'audio';
    if (/doc/.test(normalizedModel)) return 'document';
    return 'text';
  }

  private async resolveOperatorName(userId?: string) {
    if (!userId) return '系统';

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    return user?.name?.trim() || '系统';
  }

  private parseMailboxMetadata(value: Prisma.JsonValue): MailboxMetadata {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { operator_name: '系统' };
    }

    const parsed = value as Record<string, unknown>;
    return {
      operator_name: typeof parsed.operator_name === 'string' ? parsed.operator_name : '系统',
    };
  }

  private parseAiModelMetadata(value: Prisma.JsonValue | null): AiModelMetadata {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {
        operator_name: '系统',
        base_url: '',
        current_status: '未配置',
        last_success_at: null,
        last_failure_at: null,
        last_latency_ms: null,
        today_requests: 0,
        today_tokens: 0,
        total_tokens: 0,
        daily_token_usage: [],
        is_default_enabled: false,
        today_usage_date: '',
        last_error_message: null,
        usage_kind: 'auto' as AiModelUsageKind,
        input_price_per_1k: 0,
        output_price_per_1k: 0,
      };
    }

    const parsed = value as Record<string, unknown>;
    const dailyTokenUsage = this.parseDailyTokenUsage(parsed.daily_token_usage);
    const todayTokens = typeof parsed.today_tokens === 'number' ? parsed.today_tokens : 0;
    const totalTokens =
      typeof parsed.total_tokens === 'number'
        ? parsed.total_tokens
        : Math.max(todayTokens, dailyTokenUsage.reduce((sum, item) => sum + item.tokens, 0));

    const rawUsageKind = typeof parsed.usage_kind === 'string' ? parsed.usage_kind : 'auto';
    return {
      operator_name: typeof parsed.operator_name === 'string' ? parsed.operator_name : '系统',
      base_url: typeof parsed.base_url === 'string' ? parsed.base_url : '',
      current_status: typeof parsed.current_status === 'string' ? parsed.current_status : '未配置',
      last_success_at: typeof parsed.last_success_at === 'string' ? parsed.last_success_at : null,
      last_failure_at: typeof parsed.last_failure_at === 'string' ? parsed.last_failure_at : null,
      last_latency_ms: typeof parsed.last_latency_ms === 'number' ? parsed.last_latency_ms : null,
      today_requests: typeof parsed.today_requests === 'number' ? parsed.today_requests : 0,
      today_tokens: todayTokens,
      total_tokens: totalTokens,
      daily_token_usage: dailyTokenUsage,
      is_default_enabled: typeof parsed.is_default_enabled === 'boolean' ? parsed.is_default_enabled : false,
      today_usage_date: typeof parsed.today_usage_date === 'string' ? parsed.today_usage_date : '',
      last_error_message: typeof parsed.last_error_message === 'string' ? parsed.last_error_message : null,
      usage_kind: (VALID_USAGE_KINDS.includes(rawUsageKind) ? rawUsageKind : 'auto') as AiModelUsageKind,
      input_price_per_1k: this.parsePrice(parsed.input_price_per_1k),
      output_price_per_1k: this.parsePrice(parsed.output_price_per_1k),
    };
  }

  /**
   * 读取网关运行时数据用于增强模型列表（最新状态/延迟/今日调用数）。
   * 这份数据是「锦上添花」：网关表还没迁移、或统计查询出问题时，模型连接列表必须照常
   * 打得开——它是配置模型的唯一入口，整页 500 会让人连改配置都做不了。
   */
  private async loadGatewayRuntime(
    connectionIds: string[],
  ): Promise<[LatestGatewayAttemptRow[], Array<{ connectionId: string | null; _count: { _all: number } }>]> {
    if (connectionIds.length === 0) return [[], []];
    try {
      return await Promise.all([
        // DISTINCT ON 让数据库只回传「每个连接的最新一条尝试」，并且只取用到的列。
        // Prisma 的 distinct 在 orderBy 与 distinct 字段不一致时会退化成全表整行回传后在内存去重，
        // 而本查询没有时间窗，模型连接列表每次翻页都会触发。
        this.prisma.$queryRaw<LatestGatewayAttemptRow[]>(Prisma.sql`
          SELECT DISTINCT ON ("connectionId")
            "connectionId", status, "latencyMs", "errorCode", "errorMessage", "createdAt"
          FROM "AiGatewayAttempt"
          WHERE "connectionId" IN (${Prisma.join(connectionIds)})
          ORDER BY "connectionId", "createdAt" DESC
        `),
        this.prisma.aiGatewayAttempt.groupBy({
          by: ['connectionId'],
          where: {
            connectionId: { in: connectionIds },
            createdAt: { gte: this.getShanghaiDayStart() },
          },
          _count: { _all: true },
        }),
      ]);
    } catch (error) {
      this.logger.warn(
        `读取 AI 网关运行数据失败，模型列表降级为仅显示配置信息（常见原因：网关相关迁移尚未执行）：${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [[], []];
    }
  }

  /** 单价必须是有限非负数；异常值一律当作未配置，避免脏数据把成本算成 NaN。 */
  private parsePrice(value: unknown): number {
    const price = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(price) && price > 0 ? price : 0;
  }

  /**
   * 把除 excludeId 之外的所有 openai 类型模型的 is_default_enabled 清零，
   * 保证全表至多一条"默认模型"。
   */
  private async clearOtherDefaultModels(excludeId?: string): Promise<void> {
    const candidates = await this.prisma.integrationConfig.findMany({
      where: {
        kind: 'openai',
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });
    await Promise.all(
      candidates
        .filter((cfg) => {
          const meta = this.parseAiModelMetadata(cfg.metadata);
          return meta.is_default_enabled;
        })
        .map((cfg) => {
          const meta = this.parseAiModelMetadata(cfg.metadata);
          return this.prisma.integrationConfig.update({
            where: { id: cfg.id },
            data: {
              metadata: {
                ...meta,
                is_default_enabled: false,
              } as Prisma.InputJsonValue,
            },
          });
        }),
    );
  }

  private toAiModelMetadata(
    payload: SaveAiModelDto,
    operatorName: string,
    base?: AiModelMetadata,
  ): AiModelMetadata {
    // 运行时字段（current_status / last_success_at / last_failure_at / last_latency_ms /
    // today_requests / today_tokens / total_tokens / daily_token_usage / today_usage_date /
    // last_error_message）只能由"测试连通性"和"实际使用"路径写入，不允许通过保存表单覆盖。
    // 否则会出现：测试成功 → 用户保存 → 把刚刚刷新的"运行正常"又覆盖回旧的"连接异常"。
    return {
      operator_name: operatorName,
      base_url: typeof payload.base_url === 'string' ? payload.base_url.trim() : base?.base_url ?? '',
      current_status: base?.current_status ?? '未配置',
      last_success_at: base?.last_success_at ?? null,
      last_failure_at: base?.last_failure_at ?? null,
      last_latency_ms: base?.last_latency_ms ?? null,
      today_requests: base?.today_requests ?? 0,
      today_tokens: base?.today_tokens ?? 0,
      total_tokens: base?.total_tokens ?? 0,
      daily_token_usage: base?.daily_token_usage ?? [],
      is_default_enabled: Boolean(payload.is_default_enabled),
      today_usage_date: base?.today_usage_date ?? '',
      last_error_message: base?.last_error_message ?? null,
      usage_kind: (
        VALID_USAGE_KINDS.includes(payload.usage_kind ?? '')
          ? payload.usage_kind
          : (base?.usage_kind ?? 'auto')
      ) as AiModelUsageKind,
      input_price_per_1k: payload.input_price_per_1k === undefined
        ? base?.input_price_per_1k ?? 0
        : this.parsePrice(payload.input_price_per_1k),
      output_price_per_1k: payload.output_price_per_1k === undefined
        ? base?.output_price_per_1k ?? 0
        : this.parsePrice(payload.output_price_per_1k),
    };
  }

  private mergeAiRuntimeMetadata(
    base: AiModelMetadata,
    patch: {
      base_url?: string;
      current_status: string;
      last_success_at?: string;
      last_failure_at?: string;
      last_latency_ms?: number | null;
      total_tokens?: number | null;
      last_error_message?: string | null;
      clear_error?: boolean;
    },
  ): AiModelMetadata {
    const today = this.getShanghaiDateKey();
    const resetUsage = base.today_usage_date !== today;
    const todayRequests = resetUsage ? 0 : base.today_requests;
    const todayTokens = resetUsage ? 0 : base.today_tokens;
    const addedTokens = Math.max(0, patch.total_tokens ?? 0);
    const nextTodayRequests = todayRequests + 1;
    const nextTodayTokens = todayTokens + addedTokens;

    return {
      ...base,
      base_url: patch.base_url?.trim() ?? base.base_url,
      current_status: patch.current_status,
      last_success_at: patch.last_success_at ?? base.last_success_at,
      last_failure_at: patch.last_failure_at ?? base.last_failure_at,
      last_latency_ms:
        typeof patch.last_latency_ms === 'number' || patch.last_latency_ms === null
          ? patch.last_latency_ms
          : base.last_latency_ms,
      today_requests: nextTodayRequests,
      today_tokens: nextTodayTokens,
      total_tokens: base.total_tokens + addedTokens,
      daily_token_usage: this.upsertDailyTokenUsage(base.daily_token_usage, {
        date: today,
        requests: nextTodayRequests,
        tokens: nextTodayTokens,
      }),
      today_usage_date: today,
      last_error_message: patch.clear_error ? null : patch.last_error_message ?? base.last_error_message,
    };
  }

  private toMailboxResponse(config: IntegrationConfig) {
    const metadata = this.parseMailboxMetadata(config.metadata);
    return {
      id: config.id,
      email: config.accountIdentifier ?? config.name,
      has_password: Boolean(this.decryptSecret(config.encryptedSecret)),
      enabled: config.isActive,
      created_at: config.createdAt.toISOString(),
      updated_at: config.updatedAt.toISOString(),
      operator_name: metadata.operator_name,
    };
  }

  private toAiModelResponse(config: IntegrationConfig) {
    const metadata = this.parseAiModelMetadata(config.metadata);
    const hasTodayUsage = metadata.today_usage_date === this.getShanghaiDateKey();
    return {
      id: config.id,
      name: config.name,
      provider: config.provider ?? '',
      model: config.model ?? '',
      base_url: metadata.base_url,
      current_status: metadata.current_status,
      last_success_at: metadata.last_success_at,
      last_failure_at: metadata.last_failure_at,
      last_latency_ms: metadata.last_latency_ms,
      today_requests: hasTodayUsage ? metadata.today_requests : 0,
      today_tokens: hasTodayUsage ? metadata.today_tokens : 0,
      total_tokens: metadata.total_tokens,
      daily_token_usage: metadata.daily_token_usage,
      enabled: config.isActive,
      is_default_enabled: metadata.is_default_enabled,
      usage_kind: metadata.usage_kind,
      input_price_per_1k: metadata.input_price_per_1k,
      output_price_per_1k: metadata.output_price_per_1k,
      created_at: config.createdAt.toISOString(),
      updated_at: config.updatedAt.toISOString(),
      operator_name: metadata.operator_name,
      has_api_key: Boolean(this.decryptSecret(config.encryptedSecret)),
      last_error_message: metadata.last_error_message,
    };
  }

  private decryptSecret(value: string) {
    try {
      return this.secureConfigService.decryptFromStorage(value);
    } catch {
      return '';
    }
  }

  private resolveTransportSecret(payload: { encryptedSecret?: string; plainSecret?: string }) {
    const encryptedSecret = payload.encryptedSecret?.trim();
    if (encryptedSecret) {
      return this.secureConfigService.decryptTransportValue(encryptedSecret);
    }

    const plainSecret = payload.plainSecret?.trim();
    return plainSecret || '';
  }

  private resolveStoredSecret(
    payload: { encryptedSecret?: string; plainSecret?: string },
    fallback?: string,
  ) {
    const secret = this.resolveTransportSecret(payload);
    if (secret) {
      return this.secureConfigService.encryptForStorage(secret);
    }
    return fallback;
  }

  private getShanghaiDateKey() {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(new Date());
  }

  private getShanghaiDayStart() {
    const shanghaiOffsetMs = 8 * 60 * 60 * 1000;
    const shanghaiNow = new Date(Date.now() + shanghaiOffsetMs);
    return new Date(Date.UTC(
      shanghaiNow.getUTCFullYear(),
      shanghaiNow.getUTCMonth(),
      shanghaiNow.getUTCDate(),
    ) - shanghaiOffsetMs);
  }

  private timestampOrZero(value: string | null) {
    if (!value) return 0;
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  private parseDailyTokenUsage(value: unknown): AiModelDailyTokenUsage[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return null;
        }

        const record = item as Record<string, unknown>;
        const date = typeof record.date === 'string' ? record.date.trim() : '';
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return null;
        }

        return {
          date,
          requests: typeof record.requests === 'number' ? Math.max(0, Math.floor(record.requests)) : 0,
          tokens: typeof record.tokens === 'number' ? Math.max(0, Math.floor(record.tokens)) : 0,
        };
      })
      .filter((item): item is AiModelDailyTokenUsage => Boolean(item))
      .sort((left, right) => left.date.localeCompare(right.date));
  }

  private upsertDailyTokenUsage(
    current: AiModelDailyTokenUsage[],
    next: AiModelDailyTokenUsage,
  ): AiModelDailyTokenUsage[] {
    const withoutToday = current.filter((item) => item.date !== next.date);
    return [...withoutToday, next].sort((left, right) => left.date.localeCompare(right.date)).slice(-366);
  }

  private getSourceErrorMessage(error: unknown) {
    if (error instanceof Error) {
      const details = error as Error & {
        status?: number;
        code?: string;
        type?: string;
        request_id?: string;
      };

      const meta = [
        typeof details.status === 'number' ? `status=${details.status}` : '',
        typeof details.code === 'string' ? `code=${details.code}` : '',
        typeof details.type === 'string' ? `type=${details.type}` : '',
        typeof details.request_id === 'string' ? `request_id=${details.request_id}` : '',
      ]
        .filter(Boolean)
        .join(', ');

      return meta ? `${error.message} (${meta})` : error.message;
    }

    return '未知错误';
  }
}
