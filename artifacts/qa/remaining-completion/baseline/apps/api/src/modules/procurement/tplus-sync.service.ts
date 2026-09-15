import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { SecureConfigService } from '../security/secure-config.service';
import { TplusConfigDto, TplusExchangeCodeDto } from './dto/procurement.dto';
import { ProcurementService } from './procurement.service';
import { TplusPoMatchService } from './tplus-po-match.service';

/**
 * 畅捷通 T+ 只读同步适配层。
 *
 * 定位：T+ 是供应商 / 库存 / 采购单的唯一事实源（SoT），本系统只拉不推——
 * 下单与入库都在 T+ 内完成，同步结果落到 ProcSupplier / ProcInventoryBalance /
 * ProcPurchaseOrderRef 三张镜像表，再由 ProcurementService.recomputeArrival
 * 反推采购任务的到货量与状态。
 *
 * 凭据模型（对齐开放平台文档 open.chanjet.com）：
 * - appKey / appSecret：应用凭据，经配置端点录入（secret 落库加密）；
 * - openToken：OAuth2 动态令牌（授权码换取，6 天有效 + refreshToken 轮转），
 *   已接入授权回调、刷新令牌轮转与失效后的重新授权。
 * 网关默认 https://openapi.chanjet.com，业务路径 /tplus/api/v2/...。
 */

const CONFIG_KIND = 'tplus';
const DEFAULT_BASE_URL = 'https://openapi.chanjet.com';

/**
 * 鉴权请求失败。transient=true 表示网络抖动或平台侧临时故障——凭证本身没有被否定，
 * 绝不能因此清空 refreshToken。
 *
 * 这里刻意「默认判为瞬时」：误判成瞬时的代价只是留着一个已死的令牌继续重试（可见、可恢复），
 * 误判成永久失效的代价是把一个还能用的 refreshToken 删掉、逼人去畅捷通手工重新授权。
 * 线上就是这么断的：2026-07-29 一次 `fetch failed` 让凭证被清空，此后自动同步静默停摆一个月。
 */
export class TplusAuthError extends ServiceUnavailableException {
  constructor(message: string, readonly transient: boolean) {
    super(message);
  }
}

/** 平台明确否定凭证的信号；只有命中这些才允许清空令牌。 */
const TOKEN_REJECTED_PATTERN =
  /invalid[_\s-]*(refresh[_\s-]*)?token|token[_\s-]*(is[_\s-]*)?(invalid|expired|revoked)|refresh[_\s-]*token.*(invalid|expired)|unauthorized|授权(已)?(失效|过期|被撤销)|令牌(失效|过期)|请重新授权/i;

/** HTTP 状态码里代表「平台明确拒绝」而非「暂时不可用」的那些。 */
function isDefinitiveAuthStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403;
}

export function isTransientAuthFailure(error: unknown): boolean {
  if (error instanceof TplusAuthError) return error.transient;
  // 非本层抛出的异常（例如 fetch 的 TypeError）一律按瞬时处理
  return true;
}

// ── T+ 调用留痕：脱敏 ────────────────────────────────────────────────────────
//
// 这里的取舍是「白名单」而不是「黑名单」，因为泄一次的代价极高：
// 刷新令牌就挂在 /auth/v2/refreshToken 的查询串上，appKey/appSecret 在请求头里，
// 换令牌的响应体里还有 access_token / refresh_token / 永久授权码。
// 仓库里已经有过一次教训（241b80e：477 条留痕明文存了刷新令牌，最后只能全量轮换），
// 那次泄的是自家登录令牌，这次会是整个畅捷通账套的访问凭证。

/** 查询串里允许原样保留的参数；其余一律丢弃，不做「像不像密钥」的猜测。 */
const TPLUS_SAFE_QUERY_KEYS = new Set(['grantType', 'pageIndex', 'pageSize']);

/** metadata 里保留的调用留痕条数。鉴权调用每天几次，50 条够看两周以上。 */
const TPLUS_CALL_LOG_LIMIT = 50;

/** 响应/错误文本里需要抹掉的字段名（大小写与下划线/驼峰都算）。 */
const TPLUS_SECRET_FIELDS = [
  'access_token', 'accessToken', 'refresh_token', 'refreshToken',
  'openToken', 'appAccessToken', 'appTicket', 'appSecret', 'appKey',
  'user_auth_permanent_code', 'userAuthPermanentCode',
  'orgPermanentAuthCode', 'code', 'tempAuthCode',
];

/**
 * 把请求目标压成可留痕的字符串：只保留路径 + 白名单查询参数。
 * 任何未列入白名单的参数连值带键一起丢掉，不写 `key=***`——键名本身也可能有信息量。
 */
export function redactTplusTarget(pathWithQuery: string): string {
  const raw = String(pathWithQuery ?? '');
  const [path, query] = raw.split('?');
  if (!query) return path;
  const kept: string[] = [];
  for (const [key, value] of new URLSearchParams(query)) {
    if (TPLUS_SAFE_QUERY_KEYS.has(key)) kept.push(`${key}=${value}`);
  }
  return kept.length > 0 ? `${path}?${kept.join('&')}` : path;
}

/**
 * 抹掉自由文本里的凭证值。用于平台返回的错误消息——它有时会把令牌原样回显。
 * 同时截断长度，避免恶意或异常报文撑爆 metadata。
 */
export function redactTplusText(text: unknown, maxLength = 300): string {
  let out = String(text ?? '');
  for (const field of TPLUS_SECRET_FIELDS) {
    // 匹配 field=xxx / "field":"xxx" / field: xxx 三种常见形态
    const pattern = new RegExp(`(["']?${field}["']?\\s*[:=]\\s*["']?)([^"'&,}\\s]{4,})`, 'gi');
    out = out.replace(pattern, '$1***');
  }
  return out.slice(0, maxLength);
}
const DEFAULT_MATERIAL_MASTER_PATH = '/tplus/api/v2/inventory/Query';
const LEGACY_MATERIAL_MASTER_PATH = '/tplus/api/v2/inventory/QueryPage';
const MATERIAL_MASTER_PAGE_SIZE = 1000;
const MATERIAL_MASTER_MAX_PAGES = 100;
const MATERIAL_MASTER_SELECT_FIELDS = [
  'ID',
  'Code',
  'Name',
  'Specification',
  'InventoryClass.Code',
  'InventoryClass.Name',
  'Unit.Code',
  'Unit.Name',
  'Disabled',
  'LatestCost',
  'Ts',
].join(',');
const TPLUS_SYNC_TIME_ZONE = 'Asia/Shanghai';

export interface TplusCredentials {
  baseUrl: string;
  appKey: string;
  appSecret: string;
  /** 开放平台访问令牌（OAuth2 动态获取；未授权时为空）。 */
  openToken: string;
}

/** T+ 返回结构的归一化中间形态：三个 map* 函数的输出。 */
export interface TplusSupplier {
  code: string;
  name: string;
  shortName?: string;
  contact?: string;
  phone?: string;
  email?: string;
  address?: string;
  enabled?: boolean;
}
export interface TplusInventoryBalance {
  inventoryCode: string;
  name?: string;
  spec?: string;
  unit?: string;
  warehouse?: string;
  stockQty: number;
  availableQty?: number;
  inTransitQty?: number;
}
export interface TplusMaterialMaster {
  inventoryCode: string;
  name: string;
  spec?: string;
  unit?: string;
  category?: string;
  enabled?: boolean;
  sourceId?: string;
  latestCost?: number;
}
export interface TplusMaterialMasterSyncResult extends Record<string, number> {
  received: number;
  created: number;
  updated: number;
  conflicts: number;
  disabled: number;
  scannedNodes: number;
  linkedNodes: number;
  unmatchedNodes: number;
  ambiguousNodes: number;
}
export interface TplusPurchaseOrderLine {
  orderNo: string;
  orderId?: string;
  lineNo?: string;
  supplierName?: string;
  /** T+ 存货编码/名称：物料匹配锚点（编码 ↔ ProcMaterial.tpInventoryCode）。 */
  inventoryCode?: string;
  inventoryName?: string;
  spec?: string;
  unit?: string;
  orderedQty: number;
  receivedQty: number;
  unitPrice?: number;
  orderDate?: string;
  etaDate?: string;
  approvalStatus?: string;
  status?: string;
}

@Injectable()
export class TplusSyncService {
  private readonly logger = new Logger(TplusSyncService.name);
  private materialMasterSyncInFlight: Promise<TplusMaterialMasterSyncResult> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly procurement: ProcurementService,
    private readonly secureConfig: SecureConfigService,
    private readonly poMatch: TplusPoMatchService,
  ) {}

  private async findConfigRow() {
    return this.prisma.integrationConfig.findFirst({
      where: { kind: CONFIG_KIND, isActive: true },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /** 凭据：存于 IntegrationConfig(kind='tplus')。appKey+appSecret 齐即视为已配置。 */
  async loadCredentials(): Promise<TplusCredentials | null> {
    const config = await this.findConfigRow();
    if (!config) return null;
    const meta = (config.metadata ?? {}) as Record<string, unknown>;
    const baseUrl = typeof meta.baseUrl === 'string' && meta.baseUrl ? meta.baseUrl : DEFAULT_BASE_URL;
    const appKey = typeof meta.appKey === 'string' ? meta.appKey : '';
    const openToken = typeof meta.openToken === 'string' ? meta.openToken : '';
    let appSecret = '';
    try {
      appSecret = this.secureConfig.decryptFromStorage(config.encryptedSecret);
    } catch {
      appSecret = '';
    }
    if (!appKey || !appSecret) return null;
    return { baseUrl, appKey, appSecret, openToken };
  }

  /** 配置状态（不回显 secret，appKey 掩码）。 */
  async getConfig() {
    const config = await this.findConfigRow();
    const meta = (config?.metadata ?? {}) as Record<string, unknown>;
    const appKey = typeof meta.appKey === 'string' ? meta.appKey : '';
    let hasSecret = false;
    if (config?.encryptedSecret) {
      try {
        hasSecret = Boolean(this.secureConfig.decryptFromStorage(config.encryptedSecret));
      } catch {
        hasSecret = false;
      }
    }
    const openTokenExpireAt = typeof meta.openTokenExpireAt === 'number' ? meta.openTokenExpireAt : 0;
    const refreshTokenExpireAt = typeof meta.refreshTokenExpireAt === 'number' ? meta.refreshTokenExpireAt : 0;
    return {
      configured: Boolean(appKey && hasSecret),
      baseUrl: (typeof meta.baseUrl === 'string' && meta.baseUrl) || DEFAULT_BASE_URL,
      appKeyMasked: appKey ? `${appKey.slice(0, 4)}****${appKey.slice(-4)}` : null,
      hasSecret,
      redirectUri: typeof meta.redirectUri === 'string' ? meta.redirectUri : null,
      authorized: Boolean(typeof meta.openToken === 'string' && meta.openToken),
      tokenExpireAt: openTokenExpireAt ? new Date(openTokenExpireAt).toISOString() : null,
      refreshExpireAt: refreshTokenExpireAt ? new Date(refreshTokenExpireAt).toISOString() : null,
      updatedAt: config?.updatedAt?.toISOString() ?? null,
      // 断链时刻与原因：让「已连续 N 天未同步」在页面上算得出来
      authBrokenSince: typeof meta.authBrokenSince === 'string' ? meta.authBrokenSince : null,
      authBrokenReason: typeof meta.authBrokenReason === 'string' ? meta.authBrokenReason : null,
      /**
       * 自愈链就绪情况。三个根凭证齐了，令牌失效才能免人工重新授权自动换新；
       * 缺哪个必须让人看见——以前这三个在库里存没存完全不可见，
       * 于是没人知道「自动恢复」到底有没有可能成功。
       * appTicket 由开放平台每 10 分钟推送到 /tplus/notify，回调不通就永远拿不到。
       */
      selfHeal: {
        appTicket: Boolean(meta.appTicket),
        orgPermanentAuthCode: Boolean(meta.orgPermanentAuthCode),
        userAuthPermanentCode: Boolean(meta.userAuthPermanentCode),
        ready: Boolean(meta.appTicket && meta.orgPermanentAuthCode && meta.userAuthPermanentCode),
        /**
         * 开放平台是否往「消息接收地址」推送过任何消息。
         * 一次都没有，基本可断定平台侧那个地址没配——三个根凭证全靠这条推送链拿到，
         * 收不到就意味着自动续期永远不可能生效，只能反复人工授权。
         */
        everReceivedPush: Boolean(meta.appTicketAt)
          || (Array.isArray(meta.notifyLog) && (meta.notifyLog as unknown[]).length > 0),
      },
      /**
       * 最近的鉴权调用与失败留痕（已脱敏）。断链是间歇性的，只留「最后一次同步结果」
       * 根本查不出规律；这份历史就是用来回答「上次到底是怎么断的」。
       */
      callLog: Array.isArray(meta.callLog) ? (meta.callLog as unknown[]).slice(0, 20) : [],
      // 每日自动同步：默认开启，显式 false 才关
      autoSync: meta.autoSync !== false,
      lastAutoSyncAt: typeof meta.lastAutoSyncAt === 'string' ? meta.lastAutoSyncAt : null,
      lastAutoSyncSummary: typeof meta.lastAutoSyncSummary === 'string' ? meta.lastAutoSyncSummary : null,
      lastMaterialSyncAt: typeof meta.lastMaterialSyncAt === 'string' ? meta.lastMaterialSyncAt : null,
      lastMaterialSyncSummary: typeof meta.lastMaterialSyncSummary === 'string' ? meta.lastMaterialSyncSummary : null,
      lastMaterialSyncSucceeded: typeof meta.lastMaterialSyncSucceeded === 'boolean' ? meta.lastMaterialSyncSucceeded : null,
    };
  }

  /** 录入/更新配置：appSecret 落库加密；appKey/appSecret 不传则保留已存值。 */
  async saveConfig(dto: TplusConfigDto, actorId: string) {
    const existing = await this.findConfigRow();
    const meta = (existing?.metadata ?? {}) as Record<string, unknown>;
    const appKey = dto.appKey?.trim() || (typeof meta.appKey === 'string' ? meta.appKey : '');
    if (!appKey) {
      throw new BadRequestException('首次配置必须提供 appKey');
    }
    const appSecret = dto.appSecret?.trim();
    const encryptedSecret = appSecret
      ? this.secureConfig.encryptForStorage(appSecret)
      : existing?.encryptedSecret ?? '';
    const metadata = {
      ...meta,
      baseUrl: dto.baseUrl?.trim() || (typeof meta.baseUrl === 'string' && meta.baseUrl ? meta.baseUrl : DEFAULT_BASE_URL),
      appKey,
      ...(dto.redirectUri !== undefined ? { redirectUri: dto.redirectUri.trim() } : {}),
      ...(dto.autoSync !== undefined ? { autoSync: dto.autoSync } : {}),
      updatedBy: actorId,
    } as Prisma.InputJsonObject;
    if (existing) {
      await this.prisma.integrationConfig.update({
        where: { id: existing.id },
        data: { metadata, encryptedSecret },
      });
    } else {
      await this.prisma.integrationConfig.create({
        data: {
          kind: CONFIG_KIND,
          name: '畅捷通 T+',
          isActive: true,
          metadata,
          encryptedSecret,
        },
      });
    }
    return this.getConfig();
  }

  // ── 开放平台消息接收 + 永久授权码自愈链 ──────────────────────────────────────

  /**
   * 处理开放平台「消息接收地址」推送（POST，公网、无登录态）。
   * 消息类型（对齐官方消息列表文档）：APP_TEST 配置验证；APP_TICKET 每 10 分钟推送的
   * 应用票据（换 appAccessToken 的原料）；TEMP_AUTH_CODE 企业临时授权码（10 分钟有效，
   * 收到立即串链换成企业永久授权码落库）；APP_CANCEL_* 取消开通/授权告警。
   * 无论处理结果如何都应答成功，避免平台重试轰炸；原始报文留最近 20 条（票据消息除外，太频繁）。
   */
  async handlePlatformMessage(body: Record<string, unknown>) {
    const msgType = String(body?.msgType ?? '').toUpperCase();
    const biz = (body?.bizContent ?? {}) as Record<string, unknown>;
    const config = await this.findConfigRow();
    if (!config) {
      this.logger.warn(`收到 T+ 平台消息但集成未配置：${msgType}`);
      return { result: 'success' };
    }
    const meta = (config.metadata ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    if (msgType !== 'APP_TICKET') {
      const log = Array.isArray(meta.notifyLog) ? (meta.notifyLog as unknown[]) : [];
      patch.notifyLog = [
        { msgType, at: new Date().toISOString(), raw: JSON.stringify(body).slice(0, 800) },
        ...log,
      ].slice(0, 20);
    }

    try {
      if (msgType === 'APP_TICKET') {
        // 公网端点：入库字符串一律截断，防恶意超长报文撑爆 metadata
        const ticket = String(biz.appTicket ?? '').slice(0, 256);
        if (ticket) {
          patch.appTicket = ticket;
          patch.appTicketAt = new Date().toISOString();
        }
      } else if (msgType === 'TEMP_AUTH_CODE') {
        const tempAuthCode = String(biz.tempAuthCode ?? '').slice(0, 256);
        this.logger.log('收到企业临时授权码，尝试换取企业永久授权码');
        const appTicket = String(meta.appTicket ?? '');
        if (tempAuthCode && appTicket) {
          // 临时授权码 10 分钟有效，收到立即串链
          const appAccessToken = await this.fetchAppAccessToken(appTicket);
          const result = await this.authPost('/auth/orgAuth/getPermanentAuthCode', {
            appAccessToken,
            tempAuthCode,
          });
          if (result.permanentAuthCode) {
            patch.orgPermanentAuthCode = String(result.permanentAuthCode);
            patch.orgPermanentAuthCodeAt = new Date().toISOString();
            this.logger.log('企业永久授权码已入库（token 自愈链就绪）');
          }
        } else if (tempAuthCode) {
          // appTicket 尚未收到过（每 10 分钟推一次），暂存临时码等待下次开通重试
          patch.tempAuthCode = tempAuthCode;
          this.logger.warn('暂无 appTicket，企业临时授权码已暂存（10 分钟内有效）');
        }
      } else if (msgType === 'APP_CANCEL_OPEN' || msgType === 'APP_CANCEL_AUTHORIZATION') {
        this.logger.warn(`T+ 平台通知：${msgType === 'APP_CANCEL_OPEN' ? '应用被取消开通' : '应用被取消授权'}，同步将失效`);
      }
    } catch (error) {
      // 串链失败不影响应答：下次「开通授权」会再推临时码
      this.logger.warn(`平台消息 ${msgType} 处理失败：${(error as Error).message}`);
    }

    if (Object.keys(patch).length > 0) {
      await this.prisma.integrationConfig.update({
        where: { id: config.id },
        data: { metadata: { ...meta, ...patch } as Prisma.InputJsonObject },
      });
    }
    // 应答格式对齐开放平台校验要求：必须是 {'result':'success'}
    return { result: 'success' };
  }

  /** 鉴权类 POST（appKey/appSecret 放 header），成功返回 result 对象。 */
  private async authPost(path: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const cred = await this.loadCredentials();
    if (!cred) {
      throw new ServiceUnavailableException('畅捷通 T+ 未配置：请先录入 appKey / appSecret');
    }
    const res = await fetch(`${cred.baseUrl.replace(/\/+$/, '')}${path}`, {
      method: 'POST',
      headers: { appKey: cred.appKey, appSecret: cred.appSecret, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json().catch(() => null)) as {
      code?: string | number;
      msg?: string;
      message?: string;
      result?: Record<string, unknown>;
    } | null;
    if (!res.ok || !body || String(body.code) !== '200' || !body.result) {
      const reason = body?.msg ?? body?.message ?? `HTTP ${res.status}`;
      throw new ServiceUnavailableException(`畅捷通鉴权失败（${path.split('/').pop()}）：${reason}`);
    }
    return body.result;
  }

  private async fetchAppAccessToken(appTicket: string): Promise<string> {
    const result = await this.authPost('/auth/appAuth/getAppAccessToken', { appTicket });
    const token = String(result.appAccessToken ?? '');
    if (!token) throw new ServiceUnavailableException('应用凭证响应缺少 appAccessToken');
    return token;
  }

  /**
   * 永久授权码自愈：refresh 链断掉时用「企业凭证 + 用户永久授权码」重新铸 token。
   * 依赖三个已落库的根凭证：appTicket（10 分钟推送）、orgPermanentAuthCode（开通消息串链）、
   * userAuthPermanentCode（授权/刷新响应留存）。任一缺失则抛错由调用方回落「待授权」。
   */
  private async mintTokenByPermanentCode(): Promise<string> {
    const config = await this.findConfigRow();
    const meta = (config?.metadata ?? {}) as Record<string, unknown>;
    const appTicket = String(meta.appTicket ?? '');
    const orgPermanentAuthCode = String(meta.orgPermanentAuthCode ?? '');
    const userAuthPermanentCode = String(meta.userAuthPermanentCode ?? '');
    if (!appTicket || !orgPermanentAuthCode || !userAuthPermanentCode) {
      throw new ServiceUnavailableException('永久授权码自愈链凭证不全（需消息接收地址已配置并完成过一次开通授权）');
    }
    const appAccessToken = await this.fetchAppAccessToken(appTicket);
    const org = await this.authPost('/auth/orgAuth/getOrgAccessToken', {
      appAccessToken,
      permanentAuthCode: orgPermanentAuthCode,
    });
    const orgAccessToken = String(org.orgAccessToken ?? '');
    if (!orgAccessToken) throw new ServiceUnavailableException('企业凭证响应缺少 orgAccessToken');
    const result = await this.authPost('/auth/token/getTokenByPermanentCode', {
      orgAccessToken,
      userAuthPermanentCode,
    });
    await this.saveTokens(result);
    this.logger.log('token 已通过永久授权码自愈换新');
    return String(result.access_token ?? '');
  }

  // ── OAuth token 管理（方式二：授权码换 token + refresh_token 自动续期）────────

  /** 鉴权接口的通用 GET：appKey/appSecret 放 header，成功返回 result 对象。 */
  private async authRequest(pathWithQuery: string): Promise<Record<string, unknown>> {
    const cred = await this.loadCredentials();
    if (!cred) {
      throw new ServiceUnavailableException('畅捷通 T+ 未配置：请先录入 appKey / appSecret');
    }
    const url = `${cred.baseUrl.replace(/\/+$/, '')}${pathWithQuery}`;
    const startedAt = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'GET',
        headers: { appKey: cred.appKey, appSecret: cred.appSecret, 'Content-Type': 'application/json' },
      });
    } catch (error) {
      // DNS / 连接重置 / 超时：凭证没被否定过，判为瞬时
      const reason = (error as Error).message || '网络不可达';
      this.logger.error(`T+ 鉴权请求网络失败 ${pathWithQuery.split('?')[0]}: ${reason}`);
      await this.recordTplusCall({
        kind: 'auth', target: pathWithQuery, ok: false, durationMs: Date.now() - startedAt, reason,
      });
      throw new TplusAuthError(`畅捷通鉴权请求失败：${reason}`, true);
    }
    const body = (await res.json().catch(() => null)) as {
      code?: string | number;
      msg?: string;
      message?: string;
      result?: Record<string, unknown>;
    } | null;
    if (!res.ok || !body || String(body.code) !== '200' || !body.result) {
      const reason = body?.msg ?? body?.message ?? `HTTP ${res.status}`;
      // 只有平台明确拒绝（4xx 或回文点名令牌失效）才算永久失效；5xx、限流、空响应都按瞬时
      const definitive = isDefinitiveAuthStatus(res.status) || TOKEN_REJECTED_PATTERN.test(reason);
      this.logger.error(
        `T+ 鉴权请求失败 ${pathWithQuery.split('?')[0]}: ${reason}（${definitive ? '平台明确拒绝' : '按瞬时故障处理'}）`,
      );
      await this.recordTplusCall({
        kind: 'auth',
        target: pathWithQuery,
        ok: false,
        durationMs: Date.now() - startedAt,
        reason: `${definitive ? '平台拒绝' : '瞬时故障'}：${reason}`,
      });
      throw new TplusAuthError(`畅捷通鉴权失败：${reason}`, !definitive);
    }
    await this.recordTplusCall({
      kind: 'auth', target: pathWithQuery, ok: true, durationMs: Date.now() - startedAt,
    });
    return body.result;
  }

  /** 把 getToken/refreshToken 的返回落到 metadata（openToken 与 refreshToken 双轮转）。 */
  private async saveTokens(result: Record<string, unknown>) {
    const config = await this.findConfigRow();
    if (!config) throw new ServiceUnavailableException('畅捷通 T+ 未配置');
    const meta = (config.metadata ?? {}) as Record<string, unknown>;
    const now = Date.now();
    const expiresIn = Number(result.expires_in ?? 0);
    const refreshExpiresIn = Number(result.refresh_expires_in ?? 0);
    await this.prisma.integrationConfig.update({
      where: { id: config.id },
      data: {
        metadata: {
          ...meta,
          openToken: String(result.access_token ?? ''),
          refreshToken: String(result.refresh_token ?? ''),
          openTokenExpireAt: expiresIn > 0 ? now + expiresIn * 1000 : 0,
          refreshTokenExpireAt: refreshExpiresIn > 0 ? now + refreshExpiresIn * 1000 : 0,
          orgId: result.org_id !== undefined ? String(result.org_id) : (meta.orgId ?? ''),
          // 官方推荐的续命根凭证（授权码换 token 才返回；刷新接口不返回则保留已存值）
          ...(result.user_auth_permanent_code
            ? { userAuthPermanentCode: String(result.user_auth_permanent_code) }
            : {}),
          // 拿到新令牌即视为断链恢复：清掉告警标记，下次再断才会重新通知
          authBrokenSince: null,
          authBrokenReason: null,
          authAlertSentAt: null,
        } as Prisma.InputJsonObject,
      },
    });
  }

  /** 授权码换 token：回调直达或用户手动粘贴 code 都走这里。 */
  async exchangeAuthCode(dto: TplusExchangeCodeDto) {
    const config = await this.findConfigRow();
    const meta = (config?.metadata ?? {}) as Record<string, unknown>;
    const redirectUri = typeof meta.redirectUri === 'string' ? meta.redirectUri : '';
    const qs = new URLSearchParams({ grantType: 'authorization_code', code: dto.code.trim() });
    // redirectUri 须与授权时一致；平台校验不严格时缺省也可通过，因此这里可选
    if (redirectUri) qs.set('redirectUri', redirectUri);
    const result = await this.authRequest(`/auth/v2/getToken?${qs.toString()}`);
    await this.saveTokens(result);
    this.logger.log('T+ 授权完成，openToken 已入库');
    return this.getConfig();
  }

  /**
   * 确保 openToken 可用：距过期不足 12 小时即用 refreshToken 换新（刷新后旧 token
   * 立即失效且 refresh_token 轮转，必须先落库再返回）。刷新失败时清空 token 要求重新授权。
   */
  private async ensureOpenToken(): Promise<string> {
    const config = await this.findConfigRow();
    const meta = (config?.metadata ?? {}) as Record<string, unknown>;
    const openToken = typeof meta.openToken === 'string' ? meta.openToken : '';
    const refreshToken = typeof meta.refreshToken === 'string' ? meta.refreshToken : '';
    const expireAt = typeof meta.openTokenExpireAt === 'number' ? meta.openTokenExpireAt : 0;
    const fresh = openToken && expireAt - Date.now() > 12 * 3600 * 1000;
    if (fresh) return openToken;
    if (!refreshToken) {
      // 无刷新令牌也先试永久授权码自愈（消息链就绪时可免人工重授权）
      try {
        return await this.mintTokenByPermanentCode();
      } catch (mintError) {
        this.logger.warn(`永久授权码自愈失败：${(mintError as Error).message}`);
        throw new ServiceUnavailableException(
          '畅捷通 T+ 尚未完成授权：请在「T+ 集成」里完成开放平台授权（或粘贴授权码）',
        );
      }
    }
    // 瞬时故障重试两次再放弃：一次抖动就走到下面的清空分支，代价是人工重新授权
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const qs = new URLSearchParams({ grantType: 'refresh_token', refreshToken });
        const result = await this.authRequest(`/auth/v2/refreshToken?${qs.toString()}`);
        await this.saveTokens(result);
        return String(result.access_token ?? '');
      } catch (error) {
        lastError = error;
        if (!isTransientAuthFailure(error)) break;
        if (attempt < 2) {
          const backoffMs = 1000 * 2 ** attempt;
          this.logger.warn(
            `T+ 令牌刷新遇到瞬时故障（第 ${attempt + 1} 次）：${(error as Error).message}，${backoffMs}ms 后重试`,
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        }
      }
    }

    // refresh 链断掉：先走永久授权码自愈
    try {
      return await this.mintTokenByPermanentCode();
    } catch (mintError) {
      this.logger.warn(`永久授权码自愈失败：${(mintError as Error).message}`);
    }

    // 关键分歧点：只有平台明确否定了凭证才清空。网络抖动、5xx、限流一律保留 refreshToken
    // 原样返回错误——留着一个可能还有效的令牌下次再试，远好过逼人去畅捷通手工重新授权。
    if (isTransientAuthFailure(lastError)) {
      this.logger.error(
        `T+ 令牌刷新连续失败但未被平台否定，保留 refreshToken 待下次重试：${(lastError as Error).message}`,
      );
      throw lastError;
    }
    if (config) {
      // 必须重读：上面几次刷新尝试已经往 callLog 里写过留痕，
      // 拿函数开头那份 meta 去 spread 会把刚记下的失败原因整段抹掉——
      // 而那正是事后查「这次为什么断」的唯一依据。
      const latest = await this.findConfigRow();
      const freshMeta = (latest?.metadata ?? meta) as Record<string, unknown>;
      await this.prisma.integrationConfig.update({
        where: { id: config.id },
        data: {
          metadata: {
            ...freshMeta,
            openToken: '',
            refreshToken: '',
            openTokenExpireAt: 0,
            refreshTokenExpireAt: 0,
            // 记下断链时刻，供「已连续 N 天未同步」与一次性告警判定
            authBrokenSince: typeof freshMeta.authBrokenSince === 'string'
              ? freshMeta.authBrokenSince
              : new Date().toISOString(),
            authBrokenReason: redactTplusText((lastError as Error).message),
          } as Prisma.InputJsonObject,
        },
      });
    }
    throw lastError;
  }

  async status() {
    const cred = await this.loadCredentials();
    const [suppliers, materials, balances, refs] = await this.prisma.$transaction([
      this.prisma.procSupplier.count({ where: { source: 'tplus' } }),
      this.prisma.procMaterial.count({ where: { tpInventoryCode: { not: null } } }),
      this.prisma.procInventoryBalance.count(),
      this.prisma.procPurchaseOrderRef.count(),
    ]);
    return {
      configured: Boolean(cred),
      authorized: Boolean(cred?.openToken),
      mirrored: { suppliers, materials, balances, purchaseOrderRefs: refs },
    };
  }

  // ── 同步入口 ────────────────────────────────────────────────────────────────

  /** 逐页拉全量（上限 50 页防失控），页内行数不足 PageSize 即停。 */
  private async fetchAllPages(
    path: string,
    base: Record<string, unknown>,
    startPage: number,
  ): Promise<unknown[]> {
    const pageSize = 200;
    const all: unknown[] = [];
    for (let page = startPage; page < startPage + 100; page += 1) {
      const raw = await this.fetchFromTplus(path, { ...base, PageSize: pageSize, PageIndex: page });
      const rows = this.toRows(raw);
      all.push(...rows);
      // 优先按服务端返回的总页数终止（部分接口会把 PageSize 钳到更小值，行数判断会提前漏停）
      const pageInfo = this.pageInfo(raw, page);
      if (pageInfo.totalPage > 0) {
        if (pageInfo.currentPage >= pageInfo.totalPage) break;
        continue;
      }
      if (rows.length < pageSize) break;
    }
    return all;
  }

  /**
   * 存货档案查询使用 T+ 官方的 Ts 游标分页，不能复用其他接口的 PageIndex 分页。
   * 查询结果按 Ts 升序返回，下一页必须携带上一页最后一条记录的 Ts。
   */
  private async fetchMaterialMasterRows(
    path: string,
    onProgress?: (progress: string) => void,
  ): Promise<unknown[]> {
    const all: unknown[] = [];
    let cursor = '';

    for (let page = 1; page <= MATERIAL_MASTER_MAX_PAGES; page += 1) {
      const raw = await this.fetchFromTplus(path, {
        PageSize: String(MATERIAL_MASTER_PAGE_SIZE),
        SelectFields: MATERIAL_MASTER_SELECT_FIELDS,
        ...(cursor ? { Ts: cursor } : {}),
      });
      const rows = this.toRows(raw);
      all.push(...rows);
      onProgress?.(`正在读取 T+ 存货档案 ${all.length} 条…`);

      if (rows.length < MATERIAL_MASTER_PAGE_SIZE) return all;

      const lastRow = this.jsonObject(rows.at(-1));
      const nextCursorValue = lastRow.Ts ?? lastRow.ts ?? lastRow.TS;
      const nextCursor =
        typeof nextCursorValue === 'string' || typeof nextCursorValue === 'number'
          ? String(nextCursorValue).trim()
          : '';
      if (!nextCursor) {
        throw new ServiceUnavailableException(
          'T+ 存货档案分页结果缺少 Ts 游标，已中止同步以避免遗漏物料',
        );
      }
      if (nextCursor === cursor) {
        throw new ServiceUnavailableException(
          'T+ 存货档案分页游标未前进，已中止同步以避免重复请求',
        );
      }
      cursor = nextCursor;
    }

    throw new ServiceUnavailableException(
      `T+ 存货档案超过 ${MATERIAL_MASTER_MAX_PAGES * MATERIAL_MASTER_PAGE_SIZE} 条，已中止同步以避免不完整写入`,
    );
  }

  async syncSuppliers() {
    // 往来单位分页查询：T+ 的供应商在往来单位档案里
    const rows = this.mapSuppliers(
      await this.fetchAllPages('/tplus/api/v2/partner/QueryPage', {}, 1),
    );
    let upserted = 0;
    for (const s of rows) {
      await this.prisma.procSupplier.upsert({
        where: { tpCode: s.code },
        create: {
          tpCode: s.code,
          name: s.name,
          shortName: s.shortName ?? null,
          contact: s.contact ?? null,
          phone: s.phone ?? null,
          email: s.email ?? null,
          address: s.address ?? null,
          enabled: s.enabled ?? true,
          source: 'tplus',
          syncedAt: new Date(),
        },
        update: {
          name: s.name,
          shortName: s.shortName ?? null,
          contact: s.contact ?? null,
          phone: s.phone ?? null,
          email: s.email ?? null,
          address: s.address ?? null,
          enabled: s.enabled ?? true,
          source: 'tplus',
          syncedAt: new Date(),
        },
      });
      upserted += 1;
    }
    return { upserted };
  }

  /**
   * 拉取 T+ 存货档案全量主数据。与现存量同步不同，这里会包含零库存、尚未产生仓库余额的
   * 存货，因此是物料库完整性的事实来源。同步只做幂等 upsert，不删除本地缺失项，也不覆盖
   * 本系统维护的安全库存、产品线、审核备注、图片等字段。
   */
  syncMaterialMaster(onProgress?: (progress: string) => void): Promise<TplusMaterialMasterSyncResult> {
    if (!this.materialMasterSyncInFlight) {
      this.materialMasterSyncInFlight = this.performMaterialMasterSync(onProgress)
        .then(async (result) => {
          const summary = this.materialMasterSummary(result);
          await this.recordMaterialMasterSync(true, summary).catch((recordError) => {
            // 业务数据已经同步成功时，可观测性写入失败不应把整个同步标记为失败。
            this.logger.warn(`记录 T+ 存货主档同步结果失败：${(recordError as Error).message}`);
          });
          return result;
        })
        .catch(async (error) => {
          await this.recordMaterialMasterSync(false, (error as Error).message).catch((recordError) => {
            this.logger.warn(`记录 T+ 存货主档同步失败：${(recordError as Error).message}`);
          });
          throw error;
        })
        .finally(() => {
          this.materialMasterSyncInFlight = null;
        });
    }
    return this.materialMasterSyncInFlight;
  }

  private async performMaterialMasterSync(
    onProgress?: (progress: string) => void,
  ): Promise<TplusMaterialMasterSyncResult> {
    const path = this.materialMasterPath();
    onProgress?.('正在读取 T+ 存货档案…');
    const rawRows = await this.fetchMaterialMasterRows(path, onProgress);
    const mappedRows = this.mapMaterialMaster(rawRows);
    // 某些账套会按存货多计量单位返回重复行；主档按编码收敛为一条。
    const rows = [...new Map(mappedRows.map((item) => [item.inventoryCode, item])).values()];
    const existingMaterials = await this.prisma.procMaterial.findMany({
      select: {
        id: true,
        name: true,
        spec: true,
        unit: true,
        category: true,
        erpCode: true,
        tpInventoryCode: true,
        metadata: true,
      },
    });
    if (rows.length === 0 && existingMaterials.some((material) => Boolean(material.tpInventoryCode))) {
      throw new ServiceUnavailableException(
        rawRows.length > 0
          ? 'T+ 存货档案有返回数据，但字段结构无法识别；已中止同步，请检查接口版本'
          : 'T+ 存货档案返回 0 条，与本地已有 T+ 物料不一致；已中止同步，请检查接口权限或路径',
      );
    }
    type ExistingMaterial = (typeof existingMaterials)[number];
    const byTpCode = new Map<string, ExistingMaterial>();
    const byErpCode = new Map<string, ExistingMaterial[]>();
    for (const material of existingMaterials) {
      const tpCode = material.tpInventoryCode?.trim();
      if (tpCode) byTpCode.set(tpCode, material);
      const erpCode = material.erpCode.trim();
      if (erpCode) byErpCode.set(erpCode, [...(byErpCode.get(erpCode) ?? []), material]);
    }

    let created = 0;
    let updated = 0;
    let conflicts = 0;
    const syncedAt = new Date().toISOString();
    for (let index = 0; index < rows.length; index += 1) {
      if (index > 0 && index % 100 === 0) {
        onProgress?.(`正在写入物料主档 ${index}/${rows.length}…`);
      }
      const item = rows[index];
      let existing = byTpCode.get(item.inventoryCode);
      if (!existing) {
        const erpMatches = byErpCode.get(item.inventoryCode) ?? [];
        if (erpMatches.length > 1) {
          // ERP 编码不是唯一键，歧义时宁可留待人工处理，也不能错误覆盖任意一条。
          conflicts += 1;
          continue;
        }
        existing = erpMatches[0];
      }

      const existingMetadata = this.jsonObject(existing?.metadata);
      const previousTplusMetadata = this.jsonObject(existingMetadata.tplusMaster);
      const metadata = {
        ...existingMetadata,
        tplusMaster: {
          ...previousTplusMetadata,
          inventoryCode: item.inventoryCode,
          enabled: item.enabled ?? true,
          sourcePath: path,
          lastSeenAt: syncedAt,
          ...(item.sourceId ? { sourceId: item.sourceId } : {}),
          ...(item.category ? { category: item.category } : {}),
          ...(item.latestCost !== undefined ? { latestCost: item.latestCost } : {}),
        },
      } as Prisma.InputJsonObject;

      if (existing) {
        const data: Prisma.ProcMaterialUpdateInput = {
          tpInventoryCode: item.inventoryCode,
          erpCode: item.inventoryCode,
          metadata,
          ...(item.name ? { name: item.name } : {}),
          ...(item.spec !== undefined ? { spec: item.spec } : {}),
          ...(item.unit !== undefined ? { unit: item.unit } : {}),
          ...(item.category && (!existing.category.trim() || existing.category === '未分类')
            ? { category: item.category }
            : {}),
        };
        await this.prisma.procMaterial.update({ where: { id: existing.id }, data });
        updated += 1;
      } else {
        const createdMaterial = await this.prisma.procMaterial.create({
          data: {
            name: item.name || item.inventoryCode,
            spec: item.spec ?? '',
            unit: item.unit ?? '',
            category: item.category || '未分类',
            productLine: '',
            erpCode: item.inventoryCode,
            tpInventoryCode: item.inventoryCode,
            reviewStatus: 'approved',
            reviewSource: 'import',
            remark: '由畅捷通 T+ 存货主档同步自动创建',
            metadata,
          },
          select: {
            id: true,
            name: true,
            spec: true,
            unit: true,
            category: true,
            erpCode: true,
            tpInventoryCode: true,
            metadata: true,
          },
        });
        byTpCode.set(item.inventoryCode, createdMaterial);
        byErpCode.set(item.inventoryCode, [createdMaterial]);
        created += 1;
      }
    }

    onProgress?.('物料主档已写入，正在补齐任务树关联…');
    const tree = await this.procurement.reconcileProcTaskTreeMaterialLinks();
    return {
      received: rows.length,
      created,
      updated,
      conflicts,
      disabled: rows.filter((item) => item.enabled === false).length,
      ...tree,
    };
  }

  private materialMasterPath() {
    const configured = process.env.TPLUS_MATERIAL_MASTER_PATH?.trim();
    // 兼容已部署环境中的旧示例值；该路径不是 T+ 存货档案的有效开放接口，会返回 403。
    if (configured === LEGACY_MATERIAL_MASTER_PATH) return DEFAULT_MATERIAL_MASTER_PATH;
    return configured?.startsWith('/tplus/api/v2/') ? configured : DEFAULT_MATERIAL_MASTER_PATH;
  }

  private jsonObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private materialMasterSummary(result: TplusMaterialMasterSyncResult) {
    return [
      `received=${result.received}`,
      `created=${result.created}`,
      `updated=${result.updated}`,
      `conflicts=${result.conflicts}`,
      `linkedNodes=${result.linkedNodes}`,
    ].join(',');
  }

  /** 保存最近一次结果和最多 20 条轻量历史，便于线上判断同步是否真正跑到主档步骤。 */
  private async recordMaterialMasterSync(succeeded: boolean, summary: string) {
    const row = await this.findConfigRow();
    if (!row) return;
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const at = new Date().toISOString();
    const previousHistory = Array.isArray(meta.materialSyncHistory)
      ? meta.materialSyncHistory.slice(-19)
      : [];
    await this.prisma.integrationConfig.update({
      where: { id: row.id },
      data: {
        metadata: {
          ...meta,
          lastMaterialSyncAt: at,
          lastMaterialSyncSummary: summary.slice(0, 500),
          lastMaterialSyncSucceeded: succeeded,
          materialSyncHistory: [...previousHistory, { at, succeeded, summary: summary.slice(0, 500) }],
        } as Prisma.InputJsonObject,
      },
    });
  }

  async syncInventory() {
    const rows = this.mapInventory(
      await this.fetchAllPages(
        '/tplus/api/v2/currentStock/Query',
        { GroupInfo: { Warehouse: true, Inventory: true } },
        1,
      ),
    );
    let upserted = 0;
    let createdMaterials = 0;
    for (const b of rows) {
      // T+ 存货没有对应物料时自动创建主数据（ERP 是事实源，免审核直接生效）；
      // 分类/产品线 T+ 不提供，落「未分类」由分类管理页整理。
      let material = await this.prisma.procMaterial.findUnique({
        where: { tpInventoryCode: b.inventoryCode },
        select: { id: true },
      });
      if (!material && b.name) {
        material = await this.prisma.procMaterial.create({
          data: {
            name: b.name,
            spec: b.spec ?? '',
            unit: b.unit ?? '',
            category: '未分类',
            productLine: '',
            erpCode: b.inventoryCode,
            tpInventoryCode: b.inventoryCode,
            reviewStatus: 'approved',
            remark: '由畅捷通 T+ 库存同步自动创建',
          },
          select: { id: true },
        });
        createdMaterials += 1;
      }
      const warehouse = b.warehouse ?? '';
      await this.prisma.procInventoryBalance.upsert({
        where: {
          tpInventoryCode_warehouse: { tpInventoryCode: b.inventoryCode, warehouse },
        },
        create: {
          tpInventoryCode: b.inventoryCode,
          materialId: material?.id ?? null,
          materialName: b.name ?? '',
          spec: b.spec ?? '',
          unit: b.unit ?? '',
          warehouse,
          stockQty: new Prisma.Decimal(b.stockQty),
          availableQty: new Prisma.Decimal(b.availableQty ?? b.stockQty),
          inTransitQty: new Prisma.Decimal(b.inTransitQty ?? 0),
          syncedAt: new Date(),
        },
        update: {
          materialId: material?.id ?? null,
          materialName: b.name ?? '',
          stockQty: new Prisma.Decimal(b.stockQty),
          availableQty: new Prisma.Decimal(b.availableQty ?? b.stockQty),
          inTransitQty: new Prisma.Decimal(b.inTransitQty ?? 0),
          syncedAt: new Date(),
        },
      });
      upserted += 1;
    }
    const tree = createdMaterials > 0
      ? await this.procurement.reconcileProcTaskTreeMaterialLinks()
      : { scannedNodes: 0, linkedNodes: 0, unmatchedNodes: 0, ambiguousNodes: 0 };
    return { upserted, createdMaterials, ...tree };
  }

  /** 采购单同步：按任务已关联的单号逐单精确查（GetVoucherDTO），回推任务到货量/状态。 */
  async syncPurchaseOrders() {
    // 免费样品来货登记的关联没有 T+ 单号，拿空号去查 GetVoucherDTO 必然失败，直接排除。
    const refs = (await this.prisma.procPurchaseOrderRef.findMany({ where: { NOT: { tpOrderNo: '' } } }))
      .filter((ref) => (ref.metadata as Prisma.JsonObject | null)?.freeSample !== true);
    const orderNos = [...new Set(refs.map((r) => r.tpOrderNo))];
    const touchedTasks = new Set<string>();
    let updatedRefs = 0;
    let failed = 0;
    for (const orderNo of orderNos) {
      let lines: TplusPurchaseOrderLine[] = [];
      try {
        const raw = await this.fetchFromTplus(
          '/tplus/api/v2/PurchaseOrderOpenApi/GetVoucherDTO',
          { voucherCode: orderNo },
        );
        lines = this.mapVoucherLines(this.unwrapVoucher(raw));
      } catch (error) {
        failed += 1;
        this.logger.warn(`采购单 ${orderNo} 查询失败：${(error as Error).message}`);
        continue;
      }
      for (const ref of refs.filter((r) => r.tpOrderNo === orderNo)) {
        const lineNo = ref.tpLineNo?.trim();
        const line = lineNo ? lines.find((l) => l.lineNo === lineNo) : lines[0];
        if (!line) continue;
        await this.prisma.procPurchaseOrderRef.update({
          where: { id: ref.id },
          data: {
            tpOrderId: line.orderId ?? ref.tpOrderId,
            tpLineNo: line.lineNo,
            supplierName: line.supplierName ?? ref.supplierName,
            orderedQty: new Prisma.Decimal(line.orderedQty),
            receivedQty: new Prisma.Decimal(line.receivedQty),
            unitPrice: line.unitPrice === undefined ? ref.unitPrice : new Prisma.Decimal(line.unitPrice),
            orderDate: line.orderDate ? new Date(line.orderDate) : ref.orderDate,
            etaDate: line.etaDate ? new Date(line.etaDate) : ref.etaDate,
            approvalStatus: line.approvalStatus ?? ref.approvalStatus,
            status: line.status ?? ref.status,
            syncedAt: new Date(),
          },
        });
        updatedRefs += 1;
        touchedTasks.add(ref.taskId);
      }
    }
    for (const taskId of touchedTasks) await this.procurement.recomputeArrival(taskId);
    return { orders: orderNos.length, failed, updatedRefs, updatedTasks: touchedTasks.size };
  }

  // ── 外部调用出口（唯一） ─────────────────────────────────────────────────────

  /**
   * 调用 T+ OpenAPI（常规单据接口：请求体包 { param }）。
   * 凭据未配置/未授权时抛 503——不返回假数据，避免上层把空结果当成「库存为 0」。
   */
  private async fetchFromTplus(path: string, param: Record<string, unknown> = {}): Promise<unknown> {
    return this.postTplus(path, { param });
  }

  /** 底层 POST：FindVoucherList 系列的请求体不包 param，与常规接口共用凭据/错误处理。 */
  private async postTplus(path: string, payload: Record<string, unknown>): Promise<unknown> {
    const cred = await this.loadCredentials();
    if (!cred) {
      throw new ServiceUnavailableException(
        '畅捷通 T+ 未配置：请先在物料库「T+ 集成」里录入 appKey / appSecret',
      );
    }
    const openToken = await this.ensureOpenToken();
    const url = `${cred.baseUrl.replace(/\/+$/, '')}${path}`;
    const startedAt = Date.now();
    const res = await fetch(url, {
      // 开放平台业务接口统一 POST；三个凭据全放 header（对齐官方文档）
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        appKey: cred.appKey,
        appSecret: cred.appSecret,
        openToken,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`T+ 请求失败 ${path} ${res.status} ${text.slice(0, 200)}`);
      await this.recordTplusCall({
        kind: 'failure', target: path, ok: false, durationMs: Date.now() - startedAt,
        reason: `HTTP ${res.status} ${text}`,
      });
      throw new ServiceUnavailableException(this.tplusHttpErrorMessage(path, res.status, text));
    }
    const body = (await res.json()) as Record<string, unknown> | unknown[] | null;
    // 业务失败可能 HTTP 200 + { code: 999, message }
    if (body && !Array.isArray(body) && body.code !== undefined) {
      const code = String(body.code);
      if (code !== '0' && code !== '200') {
        const message = String(body.message ?? body.msg ?? '未知错误');
        this.logger.error(`T+ 业务失败 ${path}: ${code} ${message}`);
        await this.recordTplusCall({
          kind: 'failure', target: path, ok: false, durationMs: Date.now() - startedAt,
          reason: `业务码 ${code}：${message}`,
        });
        throw new ServiceUnavailableException(`畅捷通 T+：${message}`);
      }
    }
    return body;
  }

  /** 把 T+ 网关错误转换成不泄露凭据、但足够让管理员处理的用户提示。 */
  private tplusHttpErrorMessage(path: string, status: number, responseText: string): string {
    let providerMessage = '';
    try {
      const body = JSON.parse(responseText) as Record<string, unknown>;
      const value = body.message ?? body.msg ?? body.error_description ?? body.error;
      if (typeof value === 'string') {
        providerMessage = value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 160);
      }
    } catch {
      // HTML 网关页或空响应不向前端透传，避免暴露代理内部信息。
    }

    const detail = providerMessage ? `（${providerMessage}）` : '';
    if (status === 403 && path === DEFAULT_MATERIAL_MASTER_PATH) {
      return [
        `畅捷通 T+ 拒绝存货查询，HTTP 403${detail}`,
        '请在开放平台当前应用的「权限配置」中申请“存货查询”接口权限',
        '再到「开发管理」为授权用户执行“更新授权”，并重新获取 token',
      ].join('；');
    }
    return `畅捷通 T+ 接口返回 ${status}${detail}`;
  }

  /** T+ 各接口的行数据位置不统一（数组 / data / Rows / result），统一挖行。 */
  private toRows(raw: unknown): unknown[] {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>;
      for (const key of ['Data', 'data', 'Rows', 'rows', 'Records', 'records', 'List', 'list', 'result', 'Items']) {
        if (Array.isArray(o[key])) return o[key] as unknown[];
      }
      // data / result 又包一层的情况（如 { data: { Rows: [...] } }）
      for (const key of ['Data', 'data', 'result']) {
        if (o[key] && typeof o[key] === 'object') {
          const nested = this.toRows(o[key]);
          if (nested.length) return nested;
        }
      }
    }
    return [];
  }

  private pageInfo(raw: unknown, fallbackPage: number): { currentPage: number; totalPage: number } {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { currentPage: fallbackPage, totalPage: 0 };
    }
    const object = raw as Record<string, unknown>;
    const totalPage = Number(
      object.TotalPage ?? object.TotalPageNum ?? object.PageCount ?? object.totalPage ?? object.totalPages ?? 0,
    );
    if (totalPage > 0) {
      return {
        currentPage: Number(object.CurrentPage ?? object.PageIndex ?? object.currentPage ?? fallbackPage),
        totalPage,
      };
    }
    for (const key of ['Data', 'data', 'result']) {
      if (object[key] && typeof object[key] === 'object') {
        const nested = this.pageInfo(object[key], fallbackPage);
        if (nested.totalPage > 0) return nested;
      }
    }
    return { currentPage: fallbackPage, totalPage: 0 };
  }

  // ── 字段映射：待拿到真实响应样例后按文档补全 ─────────────────────────────────

  private mapSuppliers(rows: unknown[]): TplusSupplier[] {
    return rows
      .map((row) => row as Record<string, unknown>)
      .filter((r) => typeof r.Code === 'string' || typeof r.code === 'string')
      // 往来单位含客户与供应商：有类型信息且不含「供应商」的跳过，无类型信息的保留
      .filter((r) => {
        const typeName =
          r.PartnerType && typeof r.PartnerType === 'object'
            ? String((r.PartnerType as Record<string, unknown>).Name ?? '')
            : '';
        return !typeName || typeName.includes('供应商');
      })
      .map((r) => ({
        code: String(r.Code ?? r.code),
        name: String(r.Name ?? r.name ?? ''),
        shortName: r.PartnerAbbName ? String(r.PartnerAbbName) : r.ShortName ? String(r.ShortName) : undefined,
        contact: r.Contact ? String(r.Contact) : undefined,
        phone: r.Phone ? String(r.Phone) : undefined,
        email: r.Email ? String(r.Email) : undefined,
        address: r.Address ? String(r.Address) : undefined,
        enabled: r.Disabled === undefined ? true : !r.Disabled,
      }));
  }

  /** 存货档案字段兼容：不同 T+ 小版本会把档案/单位/分类返回为字符串或 { Code, Name }。 */
  private mapMaterialMaster(rows: unknown[]): TplusMaterialMaster[] {
    const textOf = (value: unknown): string | undefined => {
      if (typeof value === 'string') return value.trim();
      if (typeof value === 'number') return String(value);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const object = value as Record<string, unknown>;
        const nested = object.Name ?? object.name ?? object.Code ?? object.code;
        if (typeof nested === 'string' || typeof nested === 'number') return String(nested).trim();
      }
      return undefined;
    };
    const booleanOf = (value: unknown): boolean | undefined => {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value !== 0;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'yes', '是', '启用'].includes(normalized)) return true;
        if (['false', '0', 'no', '否', '停用'].includes(normalized)) return false;
      }
      return undefined;
    };
    const numberOf = (value: unknown): number | undefined => {
      if (value === undefined || value === null || value === '') return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    return rows
      .map((row) => row as Record<string, unknown>)
      .map((r) => {
        const inventory = this.jsonObject(r.Inventory ?? r.inventory);
        const code = textOf(
          r.InventoryCode ?? r.inventoryCode ?? r.Code ?? r.code ?? inventory.Code ?? inventory.code,
        );
        const disabled = booleanOf(r.Disabled ?? r.disabled ?? r.IsDisabled ?? r.isDisabled ?? r.IsStop);
        const explicitlyEnabled = booleanOf(r.Enabled ?? r.enabled ?? r.IsEnabled ?? r.isEnabled);
        const enabled = disabled === undefined ? explicitlyEnabled : !disabled;
        return {
          inventoryCode: code ?? '',
          name: textOf(r.InventoryName ?? r.inventoryName ?? r.Name ?? r.name ?? inventory.Name ?? inventory.name) ?? '',
          spec: textOf(r.Specification ?? r.specification ?? r.Spec ?? r.spec ?? inventory.Specification),
          unit: textOf(r.UnitName ?? r.unitName ?? r.BaseUnit ?? r.Unit ?? r.unit ?? r.StockUnit),
          category: textOf(
            r.InventoryClassName ?? r.inventoryClassName ?? r.InventoryClass ?? r.CategoryName ?? r.Category,
          ),
          enabled,
          sourceId: textOf(r.ID ?? r.Id ?? r.id),
          latestCost: numberOf(r.LatestCost ?? r.ReferenceCost ?? r.CostPrice),
        } satisfies TplusMaterialMaster;
      })
      .filter((item) => Boolean(item.inventoryCode));
  }

  private mapInventory(rows: unknown[]): TplusInventoryBalance[] {
    return rows
      .map((row) => row as Record<string, unknown>)
      .filter((r) => r.InventoryCode ?? r.inventoryCode)
      .map((r) => ({
        inventoryCode: String(r.InventoryCode ?? r.inventoryCode),
        name: r.InventoryName ? String(r.InventoryName) : undefined,
        spec: r.Specification ? String(r.Specification) : undefined,
        unit: r.UnitName ? String(r.UnitName) : r.Unit ? String(r.Unit) : undefined,
        warehouse: r.WarehouseName ? String(r.WarehouseName) : '',
        stockQty: Number(r.ExistingQuantity ?? r.Quantity ?? 0),
        availableQty: r.AvailableQuantity === undefined ? undefined : Number(r.AvailableQuantity),
        inTransitQty: r.InTransitQuantity === undefined ? undefined : Number(r.InTransitQuantity),
      }));
  }

  /** GetVoucherDTO 的返回可能被 data 包裹，挖出含 Code/明细的单据对象。 */
  private unwrapVoucher(raw: unknown): Record<string, unknown> | null {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    if (o.Code !== undefined || o.PurchaseOrderDetails !== undefined) return o;
    if (o.data && typeof o.data === 'object' && !Array.isArray(o.data)) {
      return this.unwrapVoucher(o.data);
    }
    return null;
  }

  /**
   * 采购订单单据 → 明细行。已入库量近似取 CountQuantity（累计执行数量，
   * 与「入库」的语义差异需在真实账套核单验证）。
   */
  private mapVoucherLines(dto: Record<string, unknown> | null): TplusPurchaseOrderLine[] {
    if (!dto) return [];
    const orderNo = String(dto.Code ?? '');
    if (!orderNo) return [];
    // 真实账套里 Partner/Unit 直接是字符串（"网购"/"个"），部分版本才是 { Name } 对象，两种都兼容
    const nameOf = (value: unknown): string | undefined => {
      if (typeof value === 'string' && value) return value;
      if (value && typeof value === 'object') {
        const name = (value as Record<string, unknown>).Name;
        if (name) return String(name);
      }
      return undefined;
    };
    const state = (dto.VoucherState ?? null) as Record<string, unknown> | null;
    const details = Array.isArray(dto.PurchaseOrderDetails)
      ? (dto.PurchaseOrderDetails as Record<string, unknown>[])
      : [];
    return details.map((detail, index) => {
      const inventory = (detail.Inventory ?? null) as Record<string, unknown> | null;
      return {
      orderNo,
      orderId: dto.ID !== undefined ? String(dto.ID) : undefined,
      lineNo: detail.RowNo !== undefined ? String(detail.RowNo) : String(index + 1),
      supplierName: nameOf(dto.Partner),
      inventoryCode: inventory?.Code ? String(inventory.Code) : undefined,
      inventoryName: inventory?.Name ? String(inventory.Name) : undefined,
      spec: inventory?.Specification ? String(inventory.Specification) : undefined,
      unit: nameOf(detail.Unit),
      orderedQty: Number(detail.Quantity ?? 0),
      receivedQty: Number(detail.CountQuantity ?? 0),
      unitPrice:
        detail.OrigTaxPrice !== undefined
          ? Number(detail.OrigTaxPrice)
          : detail.Price !== undefined
            ? Number(detail.Price)
            : undefined,
      orderDate: dto.VoucherDate ? String(dto.VoucherDate) : undefined,
      etaDate: detail.AcceptDate
        ? String(detail.AcceptDate)
        : dto.AcceptDate
          ? String(dto.AcceptDate)
          : undefined,
      approvalStatus: state?.Name ? String(state.Name) : undefined,
      status: state?.Code ? String(state.Code) : undefined,
      };
    });
  }

  // ── 全量镜像同步 ─────────────────────────────────────────────────────────────

  /**
   * 全量拉取 T+ 采购订单到镜像表：FindVoucherList 只取单号清单（对未知响应结构的依赖
   * 压到最小），明细复用已验证字段映射的 GetVoucherDTO 逐单精查。
   * 日期过滤（近 days 天）失败时自动降级为无过滤拉取（部分账套 paramDic 键名不同）。
   */
  async syncPurchaseOrderMirror(days = 90, onProgress?: (progress: string) => void) {
    const codes = await this.fetchOrderCodes(days);
    let upserted = 0;
    let failed = 0;
    let matchedMaterials = 0;
    let done = 0;
    for (const orderNo of codes) {
      done += 1;
      if (done % 20 === 0) onProgress?.(`采购单明细 ${done}/${codes.length}`);
      let lines: TplusPurchaseOrderLine[] = [];
      try {
        const raw = await this.fetchFromTplus(
          '/tplus/api/v2/PurchaseOrderOpenApi/GetVoucherDTO',
          { voucherCode: orderNo },
        );
        lines = this.mapVoucherLines(this.unwrapVoucher(raw));
      } catch (error) {
        failed += 1;
        this.logger.warn(`采购单 ${orderNo} 明细查询失败：${(error as Error).message}`);
        continue;
      }
      for (const line of lines) {
        // 存货编码精确匹配物料（确定性）；匹配不上留空给规则/AI 匹配任务时兜底
        let materialId: string | null = null;
        if (line.inventoryCode) {
          const material = await this.prisma.procMaterial.findUnique({
            where: { tpInventoryCode: line.inventoryCode },
            select: { id: true },
          });
          materialId = material?.id ?? null;
          if (materialId) matchedMaterials += 1;
        }
        const lineNo = line.lineNo ?? '';
        const data = {
          tpOrderId: line.orderId ?? null,
          supplierName: line.supplierName ?? '',
          inventoryCode: line.inventoryCode ?? '',
          inventoryName: line.inventoryName ?? '',
          spec: line.spec ?? '',
          unit: line.unit ?? '',
          orderedQty: new Prisma.Decimal(line.orderedQty),
          receivedQty: new Prisma.Decimal(line.receivedQty),
          unitPrice: line.unitPrice === undefined ? null : new Prisma.Decimal(line.unitPrice),
          orderDate: line.orderDate ? new Date(line.orderDate) : null,
          etaDate: line.etaDate ? new Date(line.etaDate) : null,
          approvalStatus: line.approvalStatus ?? null,
          status: line.status ?? null,
          materialId,
          syncedAt: new Date(),
        };
        await this.prisma.procPurchaseOrderMirror.upsert({
          where: { tpOrderNo_tpLineNo: { tpOrderNo: orderNo, tpLineNo: lineNo } },
          create: { tpOrderNo: orderNo, tpLineNo: lineNo, ...data },
          update: data,
        });
        upserted += 1;
      }
    }
    // 顺带刷新任务已关联单据的到货量（同一套单号来源，避免用户再点一次）
    const refSync = await this.syncPurchaseOrders().catch(() => null);
    return { orders: codes.length, lines: upserted, failed, matchedMaterials, refSync };
  }

  /** FindVoucherList 分页拉单号：先带日期区间过滤，失败降级为无过滤。 */
  private async fetchOrderCodes(days: number): Promise<string[]> {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 3600 * 1000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    // 官方结构（已在真实账套验证）：paramDic 里日期字段给 [起, 止] 两元素即区间过滤
    const withDate = {
      'PurchaseOrder.VoucherDate': [
        { text: fmt(start), value: fmt(start) },
        { text: fmt(end), value: fmt(end) },
      ],
    };
    try {
      return await this.fetchCodesPaged(withDate);
    } catch (error) {
      this.logger.warn(`按日期过滤拉单失败，降级为全量：${(error as Error).message}`);
      return this.fetchCodesPaged({});
    }
  }

  // ── 每日自动同步 ─────────────────────────────────────────────────────────────

  /** 每天北京时间 3:00 自动同步：不受服务器部署时区影响。 */
  @Cron('0 3 * * *', { name: 'tplus-auto-sync', timeZone: TPLUS_SYNC_TIME_ZONE })
  async autoSyncCron() {
    await this.autoSync().catch((error) => {
      this.logger.warn(`T+ 自动同步异常退出：${(error as Error).message}`);
    });
  }

  /**
   * 令牌保活：每 6 小时主动续一次，不依赖同步是否成功。
   *
   * 原先只有同步链路会顺带刷新令牌，于是「同步连续失败几天」会直接演变成
   * 「openToken 过期 → 需要人工重新授权」。把续期和业务同步解耦，
   * 任何一晚的同步故障都不再危及授权本身。
   */
  @Cron('0 */6 * * *', { name: 'tplus-token-keepalive', timeZone: TPLUS_SYNC_TIME_ZONE })
  async tokenKeepaliveCron() {
    try {
      const config = await this.findConfigRow();
      const meta = (config?.metadata ?? {}) as Record<string, unknown>;
      // 没有任何令牌可续时不空转报错——那是「从未授权」，不是「授权断了」
      if (!meta.refreshToken && !meta.openToken) return;
      await this.ensureOpenToken();
    } catch (error) {
      this.logger.warn(`T+ 令牌保活失败：${(error as Error).message}`);
    }
  }

  /**
   * 全链路自动同步：物料主档 → 供应商 → 库存 → 采购单全量（含任务到货回推）→ 匹配建议。
   * 未配置/未授权/开关关闭时跳过；单步失败记日志并继续，结果摘要落 metadata 供前端展示。
   */
  async autoSync(onProgress?: (progress: string) => void, options: { force?: boolean } = {}) {
    const config = await this.getConfig();
    if (!config.configured || !config.authorized) {
      // 不能静默早退：以前这里只打一条 debug 又不更新时间戳，界面上就一直挂着
      // 上一次成功那条摘要，看起来「跑过而且基本成功」，实际已经停了一个月没人知道。
      const reason = config.configured ? '未授权（需重新授权畅捷通）' : '未配置 appKey / appSecret';
      this.logger.warn(`T+ 自动同步跳过：${reason}`);
      await this.recordAutoSyncOutcome(`跳过 ✗ ${reason}`);
      if (config.configured) await this.alertAuthBrokenOnce(reason);
      return { skipped: true as const, reason };
    }
    if (!config.autoSync && !options.force) {
      return { skipped: true as const, reason: '自动同步已关闭' };
    }
    const parts: string[] = [];
    let failedSteps = 0;
    const step = async (label: string, run: () => Promise<Record<string, unknown>>) => {
      onProgress?.(`${parts.length ? parts.join('；') + '；' : ''}正在同步${label}…`);
      try {
        const result = await run();
        parts.push(`${label} ✓ ${Object.entries(result).filter(([, v]) => typeof v === 'number').map(([k, v]) => `${k}=${v}`).join(',')}`);
      } catch (error) {
        failedSteps += 1;
        parts.push(`${label} ✗ ${(error as Error).message}`);
        this.logger.warn(`T+ 自动同步「${label}」失败：${(error as Error).message}`);
      }
    };
    await step('物料主档', () => this.syncMaterialMaster(onProgress));
    await step('供应商', () => this.syncSuppliers());
    await step('库存', () => this.syncInventory());
    await step('采购单全量', () => this.syncPurchaseOrderMirror(90, (p) => onProgress?.(`${parts.join('；')}；${p}`)));
    await step('匹配', () => this.poMatch.runMatch());

    const summary = parts.join('；');
    await this.recordAutoSyncOutcome(summary);
    this.logger.log(`T+ 自动同步完成：${summary}`);
    return { skipped: false as const, summary, failedSteps };
  }

  /**
   * T+ 调用留痕（阶段一：不建表，沿用 notifyLog 那套存在 metadata 里）。
   *
   * 只记两类，其余不记：鉴权调用（每天几次，正是"反复要重新授权"的唯一线索）
   * 与任意端点的失败。业务批量调用一次同步几百次，全记下来是噪音。
   *
   * 写入前一律经过 redactTplusTarget / redactTplusText；调用方不要把请求头、
   * 请求体或原始 URL 传进来。留痕失败绝不能影响同步本身，所以整段吞异常。
   */
  private async recordTplusCall(entry: {
    kind: 'auth' | 'failure';
    target: string;
    ok: boolean;
    durationMs: number;
    reason?: unknown;
  }) {
    try {
      const row = await this.findConfigRow();
      if (!row) return;
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const log = Array.isArray(meta.callLog) ? (meta.callLog as unknown[]) : [];
      const next = [
        {
          at: new Date().toISOString(),
          kind: entry.kind,
          target: redactTplusTarget(entry.target),
          ok: entry.ok,
          durationMs: entry.durationMs,
          ...(entry.reason === undefined ? {} : { reason: redactTplusText(entry.reason) }),
        },
        ...log,
      ].slice(0, TPLUS_CALL_LOG_LIMIT);
      await this.prisma.integrationConfig.update({
        where: { id: row.id },
        data: { metadata: { ...meta, callLog: next } as Prisma.InputJsonObject },
      });
    } catch (error) {
      this.logger.warn(`T+ 调用留痕写入失败（不影响同步）：${(error as Error).message}`);
    }
  }

  /** 每次自动同步都要留下时间戳——包括跳过，否则界面无从判断它是否还在跑。 */
  private async recordAutoSyncOutcome(summary: string) {
    const row = await this.findConfigRow();
    if (!row) return;
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    await this.prisma.integrationConfig.update({
      where: { id: row.id },
      data: {
        metadata: {
          ...meta,
          lastAutoSyncAt: new Date().toISOString(),
          lastAutoSyncSummary: summary.slice(0, 500),
        } as Prisma.InputJsonObject,
      },
    });
  }

  /**
   * 授权断链只在「从正常转为异常」时通知一次，不每晚重复骚扰。
   * authBrokenSince 由清空令牌那一刻写入，saveTokens 成功时清掉。
   */
  private async alertAuthBrokenOnce(reason: string) {
    const row = await this.findConfigRow();
    if (!row) return;
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    if (meta.authAlertSentAt) return;
    const brokenSince = typeof meta.authBrokenSince === 'string' ? meta.authBrokenSince : new Date().toISOString();
    try {
      await this.procurement.notifyErpAuthBroken(reason, brokenSince);
    } catch (error) {
      this.logger.warn(`T+ 授权断链通知发送失败：${(error as Error).message}`);
    }
    await this.prisma.integrationConfig.update({
      where: { id: row.id },
      data: {
        metadata: {
          ...meta,
          authBrokenSince: brokenSince,
          authAlertSentAt: new Date().toISOString(),
        } as Prisma.InputJsonObject,
      },
    });
  }

  /**
   * FindVoucherList 官方结构（真实账套验证）：请求体不包 param、pageIndex 从 0 起、
   * selectFields 为 `PurchaseOrder.Code` 风格数组；响应为 data.Columns + data.Rows 二维数组。
   */
  private async fetchCodesPaged(paramDic: Record<string, unknown>): Promise<string[]> {
    const codes = new Set<string>();
    const pageSize = 100;
    for (let page = 0; page < 100; page += 1) {
      const raw = (await this.postTplus('/tplus/api/v2/PurchaseOrderOpenApi/FindVoucherList', {
        pageSize,
        pageIndex: page,
        selectFields: ['PurchaseOrder.Code'],
        paramDic,
      })) as Record<string, unknown> | null;
      const data = (raw?.data ?? {}) as Record<string, unknown>;
      const columns = Array.isArray(data.Columns) ? data.Columns.map((c) => String(c).toLowerCase()) : [];
      const codeIdx = Math.max(0, columns.indexOf('code'));
      const rows = Array.isArray(data.Rows) ? (data.Rows as unknown[][]) : [];
      for (const row of rows) {
        const value = Array.isArray(row) ? row[codeIdx] : undefined;
        if (value) codes.add(String(value));
      }
      const totalPages = Number(data.TotalPageNum ?? 0);
      if (rows.length === 0 || (totalPages > 0 && page + 1 >= totalPages)) break;
    }
    return [...codes];
  }
}
