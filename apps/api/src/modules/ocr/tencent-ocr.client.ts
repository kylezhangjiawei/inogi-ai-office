import { createHash, createHmac } from 'crypto';

import { ThirdPartyApiException } from './third-party-api.exception';
import type { TencentOcrConfig } from './ocr.types';

const OCR_SERVICE = 'ocr';
const OCR_VERSION = '2018-11-19';
const DEFAULT_ENDPOINT = 'ocr.tencentcloudapi.com';
const DEFAULT_REGION = 'ap-guangzhou';
const TENCENT_ERROR_DOCS = [
  'https://cloud.tencent.com/document/product/866/33528',
  'https://cloud.tencent.com/document/product/866/90802',
  'https://cloud.tencent.com/document/product/866/73674',
];

type TencentCloudResponse<T> = {
  Response?: T & {
    RequestId?: string;
    Error?: {
      Code: string;
      Message: string;
    };
  };
};

export type TencentOcrCallInput = {
  action: string;
  payload: Record<string, unknown>;
};

export type TencentOcrDocumentKind = 'invoice' | 'voucher';

export type TencentOcrServiceDefinition = {
  key: string;
  label: string;
  category_key: string;
  category_label: string;
  action: string;
  document_kind: TencentOcrDocumentKind;
  mode: 'auto' | 'manual';
  description: string;
  input_mode: 'image' | 'image_or_pdf';
  invoice_types?: number[];
};

export type TencentOcrServiceCategory = {
  key: string;
  label: string;
  services: TencentOcrServiceDefinition[];
};

export class TencentOcrClient {
  constructor(private readonly config: TencentOcrConfig) {}

  async call<T = Record<string, unknown>>({ action, payload }: TencentOcrCallInput): Promise<TencentCloudResponse<T>> {
    const endpoint = this.config.endpoint || DEFAULT_ENDPOINT;
    const region = this.config.region || DEFAULT_REGION;
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const authorization = this.sign({
      action,
      body,
      date,
      endpoint,
      region,
      timestamp,
    });

    const response = await fetch(`https://${endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json; charset=utf-8',
        Host: endpoint,
        'X-TC-Action': action,
        'X-TC-Region': region,
        'X-TC-Timestamp': String(timestamp),
        'X-TC-Version': OCR_VERSION,
      },
      body,
    });

    const result = (await response.json().catch(() => ({}))) as TencentCloudResponse<T>;
    const officialError = result.Response?.Error;
    if (!response.ok || officialError) {
      throw new ThirdPartyApiException('腾讯 OCR 调用失败', {
        provider: 'tencent_ocr',
        code: officialError?.Code ?? response.status,
        message: officialError?.Message ?? response.statusText,
        request_id: result.Response?.RequestId,
        action,
        raw: result,
        docs: TENCENT_ERROR_DOCS,
      });
    }

    return result;
  }

  private sign(input: {
    action: string;
    body: string;
    date: string;
    endpoint: string;
    region: string;
    timestamp: number;
  }) {
    const hashedRequestPayload = createHash('sha256').update(input.body).digest('hex');
    const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${input.endpoint}\n`;
    const signedHeaders = 'content-type;host';
    const canonicalRequest = [
      'POST',
      '/',
      '',
      canonicalHeaders,
      signedHeaders,
      hashedRequestPayload,
    ].join('\n');

    const credentialScope = `${input.date}/${OCR_SERVICE}/tc3_request`;
    const hashedCanonicalRequest = createHash('sha256').update(canonicalRequest).digest('hex');
    const stringToSign = [
      'TC3-HMAC-SHA256',
      String(input.timestamp),
      credentialScope,
      hashedCanonicalRequest,
    ].join('\n');

    const secretDate = hmac(`TC3${this.config.secret_key}`, input.date);
    const secretService = hmac(secretDate, OCR_SERVICE);
    const secretSigning = hmac(secretService, 'tc3_request');
    const signature = hmac(secretSigning, stringToSign, 'hex') as string;

    // 腾讯 TC3 规范：算法名与 Credential 之间是空格而非逗号，
    // 其余字段之间用 ", " 分隔。写错会触发 AuthFailure.InvalidAuthorization。
    return (
      `TC3-HMAC-SHA256 ` +
      `Credential=${this.config.secret_id}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, ` +
      `Signature=${signature}`
    );
  }
}

function hmac(key: string | Buffer, value: string, encoding?: 'hex') {
  const digest = createHmac('sha256', key).update(value);
  return encoding ? digest.digest(encoding) : digest.digest();
}

export const DEFAULT_TENCENT_OCR_CONFIG: TencentOcrConfig = {
  enabled: false,
  secret_id: '',
  secret_key: '',
  region: DEFAULT_REGION,
  endpoint: DEFAULT_ENDPOINT,
  invoice_action: 'RecognizeGeneralInvoice',
};

export const TENCENT_OCR_SERVICES = [
  {
    key: 'auto_invoice',
    label: '自动识别票据类型',
    category_key: 'invoice',
    category_label: '票据单据识别',
    action: 'RecognizeGeneralInvoice',
    document_kind: 'invoice',
    mode: 'auto',
    description: '默认服务。先让腾讯 OCR 判断票据类型，再进入字段抽取。',
    input_mode: 'image_or_pdf',
  },
  {
    key: 'general_invoice',
    label: '通用票据识别（高级版）',
    category_key: 'invoice',
    category_label: '票据单据识别',
    action: 'RecognizeGeneralInvoice',
    document_kind: 'invoice',
    mode: 'manual',
    description: '适合混合票据、医疗发票、完税凭证、银行回单、购物小票等人工指定重识别。',
    input_mode: 'image_or_pdf',
  },
  {
    key: 'vat_invoice',
    label: '增值税发票识别',
    category_key: 'invoice',
    category_label: '票据单据识别',
    action: 'VatInvoiceOCR',
    document_kind: 'invoice',
    mode: 'manual',
    description: '人工明确为增值税发票时使用，支持图片和 PDF 字段结构化识别。',
    input_mode: 'image_or_pdf',
    invoice_types: [3],
  },
  {
    key: 'bank_receipt',
    label: '银行回单/付款凭证识别',
    category_key: 'voucher',
    category_label: '付款凭证识别',
    action: 'RecognizeGeneralInvoice',
    document_kind: 'voucher',
    mode: 'manual',
    description: '从银行回单、付款截图中抽取金额、日期、流水号等凭证信息。',
    input_mode: 'image_or_pdf',
    invoice_types: [20],
  },
  {
    key: 'general_text',
    label: '通用印刷体识别（高速版）',
    category_key: 'text',
    category_label: '通用文字识别',
    action: 'GeneralFastOCR',
    document_kind: 'invoice',
    mode: 'manual',
    description: '票据类型判断不准时，作为兜底抽取全文文本。高速版精度略低于高精度版但成本更低。',
    input_mode: 'image',
  },
  {
    key: 'accurate_text',
    label: '通用文字识别（高精度）',
    category_key: 'text',
    category_label: '通用文字识别',
    action: 'GeneralAccurateOCR',
    document_kind: 'invoice',
    mode: 'manual',
    description: '适合清晰图片的高精度文本抽取。',
    input_mode: 'image',
  },
  {
    key: 'store_sign',
    label: '商户门头照识别',
    category_key: 'merchant',
    category_label: '商户/门头照识别',
    action: 'RecognizeStoreName',
    document_kind: 'invoice',
    mode: 'manual',
    description: '用于商户门头照、上户材料等图像识别。',
    input_mode: 'image',
  },
  {
    key: 'card_antifraud',
    label: '通用卡证鉴伪',
    category_key: 'card',
    category_label: '卡证识别与鉴伪',
    action: 'RecognizeGeneralCardWarn',
    document_kind: 'invoice',
    mode: 'manual',
    description: '用于身份证、营业执照等卡证图片风险提示。',
    input_mode: 'image',
  },
  {
    key: 'site_photo_classification',
    label: '上户照片分类',
    category_key: 'merchant',
    category_label: '商户/门头照识别',
    action: 'ClassifyDetectOCR',
    document_kind: 'invoice',
    mode: 'manual',
    description: '用于上户材料、门店照片等图像分类，辅助区分商户资料类型。',
    input_mode: 'image',
  },
  {
    key: 'document_extract',
    label: '文档抽取',
    category_key: 'document',
    category_label: '文档智能抽取',
    action: 'ExtractDocBasic',
    document_kind: 'invoice',
    mode: 'manual',
    description: '用于票据类型无法明确时的文档结构化抽取兜底。',
    input_mode: 'image_or_pdf',
  },
  {
    key: 'voucher_general_text',
    label: '通用印刷体识别（高速版）',
    category_key: 'text',
    category_label: '通用文字识别',
    action: 'GeneralFastOCR',
    document_kind: 'voucher',
    mode: 'manual',
    description: '付款凭证、截图或银行回单版式不稳定时，先提取全文文本再做字段判断。',
    input_mode: 'image',
  },
  {
    key: 'voucher_accurate_text',
    label: '通用文字识别（高精度）',
    category_key: 'text',
    category_label: '通用文字识别',
    action: 'GeneralAccurateOCR',
    document_kind: 'voucher',
    mode: 'manual',
    description: '用于清晰付款截图、银行回单截图的高精度文字抽取。',
    input_mode: 'image',
  },
  {
    key: 'voucher_document_extract',
    label: '文档抽取',
    category_key: 'document',
    category_label: '文档智能抽取',
    action: 'ExtractDocBasic',
    document_kind: 'voucher',
    mode: 'manual',
    description: '用于 PDF 回单或结构化付款凭证的字段抽取兜底。',
    input_mode: 'image_or_pdf',
  },
] as const satisfies readonly TencentOcrServiceDefinition[];

export function getTencentOcrService(serviceKey?: string, documentKind: TencentOcrDocumentKind = 'invoice') {
  const fallbackKey = documentKind === 'voucher' ? 'bank_receipt' : 'auto_invoice';
  const key = serviceKey?.trim() || fallbackKey;
  return (
    TENCENT_OCR_SERVICES.find((service) => service.key === key && service.document_kind === documentKind) ??
    TENCENT_OCR_SERVICES.find((service) => service.key === fallbackKey)
  );
}

export function getTencentOcrServiceCategories(documentKind?: TencentOcrDocumentKind): TencentOcrServiceCategory[] {
  const services = documentKind
    ? TENCENT_OCR_SERVICES.filter((service) => service.document_kind === documentKind)
    : [...TENCENT_OCR_SERVICES];
  const groups = new Map<string, TencentOcrServiceCategory>();
  services.forEach((service) => {
    const group = groups.get(service.category_key) ?? {
      key: service.category_key,
      label: service.category_label,
      services: [],
    };
    group.services.push(service);
    groups.set(service.category_key, group);
  });
  return Array.from(groups.values());
}

export const TENCENT_OCR_SUPPORTED_ACTIONS = TENCENT_OCR_SERVICES.map((service) => ({
  key: service.key,
  label: service.label,
  default_action: service.action,
}));

export const LEGACY_TENCENT_OCR_SUPPORTED_ACTIONS = [
  {
    key: 'general_text',
    label: '通用文字识别',
    default_action: 'GeneralAccurateOCR',
  },
  {
    key: 'invoice_extract',
    label: '通用票据识别高级版',
    default_action: 'RecognizeGeneralInvoice',
  },
  {
    key: 'vat_invoice_verify',
    label: '增值税发票核验新版',
    default_action: 'VatInvoiceVerifyNew',
  },
  {
    key: 'store_sign',
    label: '商户门头照识别',
    default_action: 'RecognizeStoreName',
  },
  {
    key: 'site_photo_classification',
    label: '上户照片分类',
    default_action: 'ClassifyDetectOCR',
  },
  {
    key: 'card_antifraud',
    label: '通用卡证鉴伪',
    default_action: 'RecognizeGeneralCardWarn',
  },
  {
    key: 'document_extract',
    label: '文档抽取',
    default_action: 'ExtractDocBasic',
  },
] as const;
