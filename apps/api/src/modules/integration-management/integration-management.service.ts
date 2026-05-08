import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IntegrationConfig, Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { OpenAiScreeningService } from '../resume-screening/openai-screening.service';
import { SecureConfigService } from '../security/secure-config.service';
import { ListIntegrationQueryDto } from './dto/list-integration-query.dto';
import { SaveAiModelDto } from './dto/save-ai-model.dto';
import { SaveMailboxDto } from './dto/save-mailbox.dto';
import { TestAiModelConnectionDto } from './dto/test-ai-model-connection.dto';

type MailboxMetadata = {
  operator_name: string;
};

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly secureConfigService: SecureConfigService,
    private readonly openAiScreeningService: OpenAiScreeningService,
  ) {}

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

    return {
      items: items.map((item) => this.toAiModelResponse(item)),
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
    const currentStatus = payload.current_status?.trim();

    if (!name || !provider || !model || !currentStatus) {
      throw new BadRequestException('模型名称、服务商、模型标识和当前状态不能为空');
    }

    const operatorName = await this.resolveOperatorName(userId);

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
    const useImageModelTest = this.shouldUseImageModelConnectionTest(provider, model);

    try {
      const result = useImageModelTest ? await this.openAiScreeningService.testImageConnection(
        apiKey,
        model,
        baseUrl || undefined,
        provider,
      ) : await this.openAiScreeningService.testConnection(
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
      };
    }

    const parsed = value as Record<string, unknown>;
    const dailyTokenUsage = this.parseDailyTokenUsage(parsed.daily_token_usage);
    const todayTokens = typeof parsed.today_tokens === 'number' ? parsed.today_tokens : 0;
    const totalTokens =
      typeof parsed.total_tokens === 'number'
        ? parsed.total_tokens
        : Math.max(todayTokens, dailyTokenUsage.reduce((sum, item) => sum + item.tokens, 0));

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
    };
  }

  private toAiModelMetadata(
    payload: SaveAiModelDto,
    operatorName: string,
    base?: AiModelMetadata,
  ): AiModelMetadata {
    return {
      operator_name: operatorName,
      base_url: typeof payload.base_url === 'string' ? payload.base_url.trim() : base?.base_url ?? '',
      current_status: payload.current_status?.trim() || base?.current_status || '未配置',
      last_success_at:
        typeof payload.last_success_at === 'string'
          ? payload.last_success_at.trim() || null
          : base?.last_success_at ?? null,
      last_failure_at:
        typeof payload.last_failure_at === 'string'
          ? payload.last_failure_at.trim() || null
          : base?.last_failure_at ?? null,
      last_latency_ms:
        typeof payload.last_latency_ms === 'number'
          ? payload.last_latency_ms
          : base?.last_latency_ms ?? null,
      today_requests:
        typeof payload.today_requests === 'number'
          ? payload.today_requests
          : base?.today_requests ?? 0,
      today_tokens:
        typeof payload.today_tokens === 'number'
          ? payload.today_tokens
          : base?.today_tokens ?? 0,
      total_tokens: base?.total_tokens ?? 0,
      daily_token_usage: base?.daily_token_usage ?? [],
      is_default_enabled: Boolean(payload.is_default_enabled),
      today_usage_date: base?.today_usage_date ?? '',
      last_error_message: base?.last_error_message ?? null,
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
      today_requests: metadata.today_requests,
      today_tokens: metadata.today_tokens,
      total_tokens: metadata.total_tokens,
      daily_token_usage: metadata.daily_token_usage,
      enabled: config.isActive,
      is_default_enabled: metadata.is_default_enabled,
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
