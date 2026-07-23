import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { SecureConfigService } from '../security/secure-config.service';
import { TplusConfigDto, TplusExchangeCodeDto } from './dto/procurement.dto';
import { ProcurementService } from './procurement.service';

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
 *   授权与刷新流程尚未接入——配置好凭据后 fetchFromTplus 仍会 503 提示待授权。
 * 网关默认 https://openapi.chanjet.com，业务路径 /tplus/api/v2/...。
 */

const CONFIG_KIND = 'tplus';
const DEFAULT_BASE_URL = 'https://openapi.chanjet.com';

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
export interface TplusPurchaseOrderLine {
  orderNo: string;
  orderId?: string;
  lineNo?: string;
  supplierName?: string;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly procurement: ProcurementService,
    private readonly secureConfig: SecureConfigService,
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
    };
  }

  /** 录入/更新配置：appSecret 落库加密，不传则保留已存值。 */
  async saveConfig(dto: TplusConfigDto, actorId: string) {
    const existing = await this.findConfigRow();
    const meta = (existing?.metadata ?? {}) as Record<string, unknown>;
    const appSecret = dto.appSecret?.trim();
    const encryptedSecret = appSecret
      ? this.secureConfig.encryptForStorage(appSecret)
      : existing?.encryptedSecret ?? '';
    const metadata = {
      ...meta,
      baseUrl: dto.baseUrl?.trim() || DEFAULT_BASE_URL,
      appKey: dto.appKey.trim(),
      ...(dto.redirectUri !== undefined ? { redirectUri: dto.redirectUri.trim() } : {}),
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

  // ── OAuth token 管理（方式二：授权码换 token + refresh_token 自动续期）────────

  /** 鉴权接口的通用 GET：appKey/appSecret 放 header，成功返回 result 对象。 */
  private async authRequest(pathWithQuery: string): Promise<Record<string, unknown>> {
    const cred = await this.loadCredentials();
    if (!cred) {
      throw new ServiceUnavailableException('畅捷通 T+ 未配置：请先录入 appKey / appSecret');
    }
    const url = `${cred.baseUrl.replace(/\/+$/, '')}${pathWithQuery}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { appKey: cred.appKey, appSecret: cred.appSecret, 'Content-Type': 'application/json' },
    });
    const body = (await res.json().catch(() => null)) as {
      code?: string | number;
      msg?: string;
      message?: string;
      result?: Record<string, unknown>;
    } | null;
    if (!res.ok || !body || String(body.code) !== '200' || !body.result) {
      const reason = body?.msg ?? body?.message ?? `HTTP ${res.status}`;
      this.logger.error(`T+ 鉴权请求失败 ${pathWithQuery.split('?')[0]}: ${reason}`);
      throw new ServiceUnavailableException(`畅捷通鉴权失败：${reason}`);
    }
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
      throw new ServiceUnavailableException(
        '畅捷通 T+ 尚未完成授权：请在「T+ 集成」里完成开放平台授权（或粘贴授权码）',
      );
    }
    try {
      const qs = new URLSearchParams({ grantType: 'refresh_token', refreshToken });
      const result = await this.authRequest(`/auth/v2/refreshToken?${qs.toString()}`);
      await this.saveTokens(result);
      return String(result.access_token ?? '');
    } catch (error) {
      // refresh_token 过期/被作废：清空令牌，让前端显示「待授权」引导重新授权
      if (config) {
        await this.prisma.integrationConfig.update({
          where: { id: config.id },
          data: {
            metadata: {
              ...meta,
              openToken: '',
              refreshToken: '',
              openTokenExpireAt: 0,
              refreshTokenExpireAt: 0,
            } as Prisma.InputJsonObject,
          },
        });
      }
      throw error;
    }
  }

  async status() {
    const cred = await this.loadCredentials();
    const [suppliers, balances, refs] = await this.prisma.$transaction([
      this.prisma.procSupplier.count({ where: { source: 'tplus' } }),
      this.prisma.procInventoryBalance.count(),
      this.prisma.procPurchaseOrderRef.count(),
    ]);
    return {
      configured: Boolean(cred),
      authorized: Boolean(cred?.openToken),
      mirrored: { suppliers, balances, purchaseOrderRefs: refs },
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
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const o = raw as Record<string, unknown>;
        const totalPage = Number(o.TotalPage ?? o.TotalPageNum ?? 0);
        if (totalPage > 0) {
          const current = Number(o.CurrentPage ?? page);
          if (current >= totalPage) break;
          continue;
        }
      }
      if (rows.length < pageSize) break;
    }
    return all;
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
    return { upserted, createdMaterials };
  }

  /** 采购单同步：按任务已关联的单号逐单精确查（GetVoucherDTO），回推任务到货量/状态。 */
  async syncPurchaseOrders() {
    const refs = await this.prisma.procPurchaseOrderRef.findMany();
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
        const line = ref.tpLineNo ? lines.find((l) => l.lineNo === ref.tpLineNo) : lines[0];
        if (!line) continue;
        await this.prisma.procPurchaseOrderRef.update({
          where: { id: ref.id },
          data: {
            tpOrderId: line.orderId ?? ref.tpOrderId,
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
   * 调用 T+ OpenAPI。凭据未配置/未授权时抛 503——不返回假数据，避免上层把空结果当成「库存为 0」。
   */
  private async fetchFromTplus(path: string, param: Record<string, unknown> = {}): Promise<unknown> {
    const cred = await this.loadCredentials();
    if (!cred) {
      throw new ServiceUnavailableException(
        '畅捷通 T+ 未配置：请先在物料库「T+ 集成」里录入 appKey / appSecret',
      );
    }
    const openToken = await this.ensureOpenToken();
    const url = `${cred.baseUrl.replace(/\/+$/, '')}${path}`;
    const res = await fetch(url, {
      // 开放平台业务接口统一 POST；三个凭据全放 header（对齐官方文档）
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        appKey: cred.appKey,
        appSecret: cred.appSecret,
        openToken,
      },
      body: JSON.stringify({ param }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`T+ 请求失败 ${path} ${res.status} ${text.slice(0, 200)}`);
      throw new ServiceUnavailableException(`畅捷通 T+ 接口返回 ${res.status}`);
    }
    const body = (await res.json()) as Record<string, unknown> | unknown[] | null;
    // 业务失败可能 HTTP 200 + { code: 999, message }
    if (body && !Array.isArray(body) && body.code !== undefined) {
      const code = String(body.code);
      if (code !== '0' && code !== '200') {
        const message = String(body.message ?? body.msg ?? '未知错误');
        this.logger.error(`T+ 业务失败 ${path}: ${code} ${message}`);
        throw new ServiceUnavailableException(`畅捷通 T+：${message}`);
      }
    }
    return body;
  }

  /** T+ 各接口的行数据位置不统一（数组 / data / Rows / result），统一挖行。 */
  private toRows(raw: unknown): unknown[] {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
      const o = raw as Record<string, unknown>;
      for (const key of ['Data', 'data', 'Rows', 'rows', 'result', 'Items']) {
        if (Array.isArray(o[key])) return o[key] as unknown[];
      }
      // data 又包一层的情况（如 { data: { Rows: [...] } }）
      if (o.data && typeof o.data === 'object') return this.toRows(o.data);
    }
    return [];
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
    const partner = (dto.Partner ?? null) as Record<string, unknown> | null;
    const state = (dto.VoucherState ?? null) as Record<string, unknown> | null;
    const details = Array.isArray(dto.PurchaseOrderDetails)
      ? (dto.PurchaseOrderDetails as Record<string, unknown>[])
      : [];
    return details.map((detail, index) => ({
      orderNo,
      orderId: dto.ID !== undefined ? String(dto.ID) : undefined,
      lineNo: detail.RowNo !== undefined ? String(detail.RowNo) : String(index + 1),
      supplierName: partner?.Name ? String(partner.Name) : undefined,
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
    }));
  }
}
