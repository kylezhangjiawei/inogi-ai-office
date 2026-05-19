import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

@Injectable()
export class OcrService {
  constructor(private readonly configService: ConfigService) {}

  getTencentConfig(overrides: Partial<TencentOcrConfig> = {}): TencentOcrConfig {
    return {
      ...DEFAULT_TENCENT_OCR_CONFIG,
      enabled: this.envBool('TENCENTCLOUD_OCR_ENABLED'),
      secret_id: this.configService.get<string>('TENCENTCLOUD_SECRET_ID') ?? '',
      secret_key: this.configService.get<string>('TENCENTCLOUD_SECRET_KEY') ?? '',
      region:
        this.configService.get<string>('TENCENTCLOUD_OCR_REGION') ??
        DEFAULT_TENCENT_OCR_CONFIG.region,
      endpoint:
        this.configService.get<string>('TENCENTCLOUD_OCR_ENDPOINT') ??
        DEFAULT_TENCENT_OCR_CONFIG.endpoint,
      invoice_action:
        this.configService.get<string>('TENCENTCLOUD_OCR_INVOICE_ACTION') ??
        DEFAULT_TENCENT_OCR_CONFIG.invoice_action,
      ...overrides,
    };
  }

  hasTencentConfig(config = this.getTencentConfig()) {
    return Boolean(config.secret_id && config.secret_key);
  }

  assertTencentReady(config = this.getTencentConfig()) {
    if (!this.hasTencentConfig(config)) {
      throw new BadRequestException({
        message: '腾讯 OCR 配置不完整',
        missing: [
          !config.secret_id ? 'tencent_ocr.secret_id' : null,
          !config.secret_key ? 'tencent_ocr.secret_key' : null,
        ].filter(Boolean),
      });
    }
  }

  createTencentClient(config = this.getTencentConfig()) {
    this.assertTencentReady(config);
    return new TencentOcrClient(config);
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
    const config = this.getTencentConfig(options.config);
    const service = options.action ? undefined : getTencentOcrService(options.serviceKey, documentKind);
    const action =
      options.action ??
      service?.action ??
      config.invoice_action ??
      DEFAULT_TENCENT_OCR_CONFIG.invoice_action;
    const result = await this.createTencentClient(config).call({
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
