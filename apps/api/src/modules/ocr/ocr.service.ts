import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../prisma/prisma.service';
import { SecureConfigService } from '../security/secure-config.service';
import {
  DEFAULT_TENCENT_OCR_CONFIG,
  TencentOcrClient,
  getTencentOcrService,
  type TencentOcrDocumentKind,
} from './tencent-ocr.client';
import type {
  TencentOcrConfig,
  TencentOcrRecognizeOptions,
  TencentOcrTextResult,
  UploadedOcrFile,
} from './ocr.types';

const OCR_TEXT_FIELD_NAMES = new Set([
  'DetectedText',
  'AdvancedInfo',
  'Text',
  'Value',
  'Name',
  'Content',
  'Description',
  'Item',
  'Word',
  'Line',
]);

const TENCENT_INTEGRATION_KIND = 'tencent_ocr';
const CONFIG_CACHE_TTL_MS = 60_000;

@Injectable()
export class OcrService {
  private cachedConfig: TencentOcrConfig | null = null;
  private cachedAt = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly secureConfig: SecureConfigService,
  ) {}

  // 加载腾讯 OCR 配置：DB(IntegrationConfig kind=tencent_ocr) 优先，env 回退（带 60s 缓存）
  private async loadBaseConfig(): Promise<TencentOcrConfig> {
    if (this.cachedConfig && Date.now() - this.cachedAt < CONFIG_CACHE_TTL_MS) {
      return this.cachedConfig;
    }

    let secret_id = '';
    let secret_key = '';
    let region = DEFAULT_TENCENT_OCR_CONFIG.region;
    let endpoint = DEFAULT_TENCENT_OCR_CONFIG.endpoint;
    let invoice_action = DEFAULT_TENCENT_OCR_CONFIG.invoice_action;
    let enabled = false;

    const record = await this.prisma.integrationConfig
      .findFirst({
        where: { kind: TENCENT_INTEGRATION_KIND, isActive: true },
        orderBy: { updatedAt: 'desc' },
      })
      .catch(() => null);

    if (record) {
      secret_id = record.accountIdentifier ?? '';
      try {
        secret_key = record.encryptedSecret
          ? this.secureConfig.decryptFromStorage(record.encryptedSecret)
          : '';
      } catch {
        secret_key = '';
      }
      const meta = (record.metadata && typeof record.metadata === 'object' ? record.metadata : {}) as Record<
        string,
        unknown
      >;
      if (typeof meta.region === 'string' && meta.region) region = meta.region;
      if (typeof meta.endpoint === 'string' && meta.endpoint) endpoint = meta.endpoint;
      if (typeof meta.invoice_action === 'string' && meta.invoice_action) invoice_action = meta.invoice_action;
      enabled = meta.enabled !== false;
    } else {
      // 没有 DB 记录时回退到 env（仅做迁移过渡，存在 key 时打告警）
      secret_id = this.configService.get<string>('TENCENTCLOUD_SECRET_ID') ?? '';
      secret_key = this.configService.get<string>('TENCENTCLOUD_SECRET_KEY') ?? '';
      region = this.configService.get<string>('TENCENTCLOUD_OCR_REGION') ?? region;
      endpoint = this.configService.get<string>('TENCENTCLOUD_OCR_ENDPOINT') ?? endpoint;
      invoice_action = this.configService.get<string>('TENCENTCLOUD_OCR_INVOICE_ACTION') ?? invoice_action;
      enabled = this.envBool('TENCENTCLOUD_OCR_ENABLED');
      if (secret_id || secret_key) {
        // eslint-disable-next-line no-console
        console.warn(
          '[OcrService] 腾讯 OCR key 仍从环境变量读取。建议在系统设置 → 集成配置中迁移到数据库（kind=tencent_ocr）。',
        );
      }
    }

    const config: TencentOcrConfig = {
      ...DEFAULT_TENCENT_OCR_CONFIG,
      enabled,
      secret_id,
      secret_key,
      region,
      endpoint,
      invoice_action,
    };
    this.cachedConfig = config;
    this.cachedAt = Date.now();
    return config;
  }

  // 外部调用：admin 更新 IntegrationConfig 后调用，立刻失效缓存
  invalidateConfigCache() {
    this.cachedConfig = null;
    this.cachedAt = 0;
  }

  async getTencentConfig(overrides: Partial<TencentOcrConfig> = {}): Promise<TencentOcrConfig> {
    const base = await this.loadBaseConfig();
    return { ...base, ...overrides };
  }

  async hasTencentConfig(config?: TencentOcrConfig): Promise<boolean> {
    const cfg = config ?? (await this.getTencentConfig());
    return Boolean(cfg.secret_id && cfg.secret_key);
  }

  async assertTencentReady(config?: TencentOcrConfig): Promise<void> {
    const cfg = config ?? (await this.getTencentConfig());
    if (!cfg.secret_id || !cfg.secret_key) {
      throw new BadRequestException({
        message: '腾讯 OCR 配置不完整',
        missing: [
          !cfg.secret_id ? 'tencent_ocr.secret_id' : null,
          !cfg.secret_key ? 'tencent_ocr.secret_key' : null,
        ].filter(Boolean),
      });
    }
  }

  async createTencentClient(config?: TencentOcrConfig): Promise<TencentOcrClient> {
    const cfg = config ?? (await this.getTencentConfig());
    await this.assertTencentReady(cfg);
    return new TencentOcrClient(cfg);
  }

  buildTencentOcrPayload(
    file: UploadedOcrFile,
    service?: { invoice_types?: readonly number[] },
  ) {
    const payload: Record<string, unknown> = {
      ImageBase64: file.buffer.toString('base64'),
    };
    if (service?.invoice_types?.length) {
      payload.Types = [...service.invoice_types];
    }
    return payload;
  }

  async recognizeWithTencent(
    file: UploadedOcrFile,
    options: TencentOcrRecognizeOptions = {},
  ): Promise<TencentOcrTextResult> {
    const documentKind: TencentOcrDocumentKind = options.documentKind ?? 'invoice';
    const config = await this.getTencentConfig(options.config);
    const service = options.action ? undefined : getTencentOcrService(options.serviceKey, documentKind);
    const action =
      options.action ??
      service?.action ??
      config.invoice_action ??
      DEFAULT_TENCENT_OCR_CONFIG.invoice_action;
    const client = await this.createTencentClient(config);
    const result = await client.call({
      action,
      payload: this.buildTencentOcrPayload(
        file,
        service && 'invoice_types' in service ? { invoice_types: service.invoice_types } : undefined,
      ),
    });
    const response = result.Response ?? {};
    const lines = this.extractTencentTextLines(response);

    return {
      provider: 'tencent_ocr',
      action,
      service_key: service?.key,
      service_label: service?.label,
      request_id: response.RequestId,
      confidence: this.extractTencentConfidence(response),
      text: lines.join('\n'),
      lines,
      raw_response: response,
    };
  }

  recognizeImageText(file: UploadedOcrFile, serviceKey = 'accurate_text') {
    return this.recognizeWithTencent(file, {
      documentKind: 'invoice',
      serviceKey,
    });
  }

  extractTencentTextLines(response: unknown) {
    const lines: string[] = [];
    this.collectTencentText(response, lines);
    return Array.from(new Set(lines.map((line) => line.trim()).filter(Boolean)));
  }

  private collectTencentText(value: unknown, lines: string[], parentKey?: string) {
    if (Array.isArray(value)) {
      value.forEach((item) => this.collectTencentText(item, lines, parentKey));
      return;
    }
    if (!value || typeof value !== 'object') {
      if (typeof value === 'string' && parentKey && OCR_TEXT_FIELD_NAMES.has(parentKey)) {
        lines.push(value);
      }
      return;
    }

    Object.entries(value).forEach(([key, child]) => {
      if (typeof child === 'string' && OCR_TEXT_FIELD_NAMES.has(key)) {
        lines.push(child);
      }
      this.collectTencentText(child, lines, key);
    });
  }

  private extractTencentConfidence(response: unknown) {
    const values: number[] = [];
    this.collectTencentConfidence(response, values);
    if (!values.length) return undefined;
    const normalized = values.map((value) => (value > 1 ? value / 100 : value)).filter((value) => value >= 0 && value <= 1);
    if (!normalized.length) return undefined;
    return Math.round((normalized.reduce((sum, value) => sum + value, 0) / normalized.length) * 1000) / 1000;
  }

  private collectTencentConfidence(value: unknown, values: number[], parentKey?: string) {
    if (Array.isArray(value)) {
      value.forEach((item) => this.collectTencentConfidence(item, values, parentKey));
      return;
    }
    if (!value || typeof value !== 'object') {
      const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
      if (Number.isFinite(numeric) && parentKey && /confidence|score|prob|rate/i.test(parentKey)) {
        values.push(numeric);
      }
      return;
    }
    Object.entries(value).forEach(([key, child]) => this.collectTencentConfidence(child, values, key));
  }

  private envBool(key: string) {
    return this.configService.get<string>(key) === 'true';
  }
}
