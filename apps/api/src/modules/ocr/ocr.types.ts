export type ThirdPartyProvider = 'tencent_ocr' | 'wecom';

export type ThirdPartyOfficialError = {
  provider: ThirdPartyProvider;
  code: string | number;
  message: string;
  request_id?: string;
  action?: string;
  raw?: unknown;
  docs: string[];
};

export type TencentOcrConfig = {
  enabled: boolean;
  secret_id: string;
  secret_key: string;
  region: string;
  endpoint: string;
  invoice_action: string;
};

export type UploadedOcrFile = {
  originalname: string;
  buffer: Buffer;
  mimetype?: string;
};

export type TencentOcrRecognizeOptions = {
  action?: string;
  serviceKey?: string;
  documentKind?: 'invoice' | 'voucher';
  config?: Partial<TencentOcrConfig>;
};

export type TencentOcrTextResult = {
  provider: 'tencent_ocr';
  action: string;
  service_key?: string;
  service_label?: string;
  request_id?: string;
  confidence?: number;
  text: string;
  lines: string[];
  raw_response: unknown;
};
