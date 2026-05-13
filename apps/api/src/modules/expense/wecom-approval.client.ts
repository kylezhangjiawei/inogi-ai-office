import { createDecipheriv, createHash } from 'crypto';

import { ThirdPartyApiException } from './third-party-api.exception';
import type { ThirdPartyOfficialError, WeComExpenseConfig } from './expense.types';

const WECOM_BASE_URL = 'https://qyapi.weixin.qq.com';
const WECOM_ERROR_DOCS = [
  'https://developer.work.weixin.qq.com/document/path/90313',
  'https://developer.work.weixin.qq.com/document/path/91816',
  'https://developer.work.weixin.qq.com/document/path/90269',
];

type WeComApiResponse = {
  errcode?: number;
  errmsg?: string;
  [key: string]: unknown;
};

type WeComCallbackQuery = {
  msg_signature?: string;
  timestamp?: string;
  nonce?: string;
  echostr?: string;
};

export class WeComApprovalClient {
  constructor(private readonly config: WeComExpenseConfig) {}

  async getAccessToken() {
    const params = new URLSearchParams({
      corpid: this.config.corp_id,
      corpsecret: this.config.corp_secret,
    });
    const payload = await this.get<WeComApiResponse & { access_token?: string }>(
      `/cgi-bin/gettoken?${params.toString()}`,
      'gettoken',
    );
    return payload.access_token ?? '';
  }

  async getTemplateDetail(accessToken: string) {
    return this.post(
      `/cgi-bin/oa/gettemplatedetail?access_token=${accessToken}`,
      {
        template_id: this.config.approval_template_id,
      },
      'gettemplatedetail',
    );
  }

  async submitApproval(accessToken: string, payload: Record<string, unknown>) {
    return this.post(`/cgi-bin/oa/applyevent?access_token=${accessToken}`, payload, 'applyevent');
  }

  async getApprovalDetail(accessToken: string, spNo: string) {
    return this.post(
      `/cgi-bin/oa/getapprovaldetail?access_token=${accessToken}`,
      {
        sp_no: spNo,
      },
      'getapprovaldetail',
    );
  }

  verifySignature(query: WeComCallbackQuery, encrypted: string) {
    if (!query.msg_signature || !query.timestamp || !query.nonce) {
      return false;
    }
    const digest = createHash('sha1')
      .update([this.config.callback_token, query.timestamp, query.nonce, encrypted].sort().join(''))
      .digest('hex');
    return digest === query.msg_signature;
  }

  decryptCallbackPayload(encrypted: string) {
    const key = Buffer.from(`${this.config.callback_aes_key}=`, 'base64');
    const decipher = createDecipheriv('aes-256-cbc', key, key.subarray(0, 16));
    decipher.setAutoPadding(false);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64')),
      decipher.final(),
    ]);
    const unpadded = removePkcs7Padding(decrypted);
    const messageLength = unpadded.readUInt32BE(16);
    const message = unpadded.subarray(20, 20 + messageLength).toString('utf8');
    return message;
  }

  async verifyCallbackUrl(query: WeComCallbackQuery) {
    const encrypted = query.echostr ?? '';
    if (!encrypted || !this.verifySignature(query, encrypted)) {
      throw new ThirdPartyApiException('企业微信回调签名校验失败', {
        provider: 'wecom',
        code: 'invalid_callback_signature',
        message: 'msg_signature 与 token/timestamp/nonce/echostr 计算结果不一致',
        action: 'callback_verify',
        raw: query,
        docs: WECOM_ERROR_DOCS,
      });
    }
    return this.decryptCallbackPayload(encrypted);
  }

  private async get<T extends WeComApiResponse>(path: string, action: string): Promise<T> {
    const response = await fetch(`${WECOM_BASE_URL}${path}`);
    const payload = (await response.json().catch(() => ({}))) as T;
    this.assertOk(payload, action);
    return payload;
  }

  private async post<T extends WeComApiResponse = WeComApiResponse>(
    path: string,
    body: Record<string, unknown>,
    action: string,
  ): Promise<T> {
    const response = await fetch(`${WECOM_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json().catch(() => ({}))) as T;
    this.assertOk(payload, action);
    return payload;
  }

  private assertOk(payload: WeComApiResponse, action: string) {
    if (payload.errcode && payload.errcode !== 0) {
      const officialError: ThirdPartyOfficialError = {
        provider: 'wecom',
        code: payload.errcode,
        message: payload.errmsg ?? '企业微信接口返回错误',
        action,
        raw: payload,
        docs: WECOM_ERROR_DOCS,
      };
      throw new ThirdPartyApiException('企业微信审批接口调用失败', officialError);
    }
  }
}

function removePkcs7Padding(value: Buffer) {
  const padding = value[value.length - 1];
  if (padding < 1 || padding > 32) {
    return value;
  }
  return value.subarray(0, value.length - padding);
}

export const DEFAULT_WECOM_EXPENSE_CONFIG: WeComExpenseConfig = {
  enabled: false,
  corp_id: '',
  agent_id: '',
  corp_secret: '',
  approval_template_id: '',
  default_creator_userid: '',
  callback_token: '',
  callback_aes_key: '',
};
