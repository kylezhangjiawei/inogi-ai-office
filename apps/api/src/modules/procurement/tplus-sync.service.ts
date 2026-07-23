import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { SecureConfigService } from '../security/secure-config.service';
import { TplusConfigDto } from './dto/procurement.dto';
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
    return {
      configured: Boolean(appKey && hasSecret),
      baseUrl: (typeof meta.baseUrl === 'string' && meta.baseUrl) || DEFAULT_BASE_URL,
      appKeyMasked: appKey ? `${appKey.slice(0, 4)}****${appKey.slice(-4)}` : null,
      hasSecret,
      authorized: Boolean(typeof meta.openToken === 'string' && meta.openToken),
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

  async syncSuppliers() {
    const rows = this.mapSuppliers(await this.fetchFromTplus('/supplier/list'));
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
    const rows = this.mapInventory(await this.fetchFromTplus('/inventory/balance'));
    let upserted = 0;
    for (const b of rows) {
      const material = await this.prisma.procMaterial.findUnique({
        where: { tpInventoryCode: b.inventoryCode },
        select: { id: true },
      });
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
    return { upserted };
  }

  /** 采购单同步：只更新已被任务关联的单据行，并回推任务到货量/状态。 */
  async syncPurchaseOrders() {
    const rows = this.mapPurchaseOrders(await this.fetchFromTplus('/purchase-order/list'));
    const byOrderNo = new Map<string, TplusPurchaseOrderLine[]>();
    for (const line of rows) {
      const list = byOrderNo.get(line.orderNo) ?? [];
      list.push(line);
      byOrderNo.set(line.orderNo, list);
    }

    const refs = await this.prisma.procPurchaseOrderRef.findMany({
      where: { tpOrderNo: { in: [...byOrderNo.keys()] } },
    });
    const touchedTasks = new Set<string>();
    for (const ref of refs) {
      const lines = byOrderNo.get(ref.tpOrderNo) ?? [];
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
      touchedTasks.add(ref.taskId);
    }
    for (const taskId of touchedTasks) await this.procurement.recomputeArrival(taskId);
    return { updatedRefs: refs.length, updatedTasks: touchedTasks.size };
  }

  // ── 外部调用出口（唯一） ─────────────────────────────────────────────────────

  /**
   * 调用 T+ OpenAPI。凭据未配置/未授权时抛 503——不返回假数据，避免上层把空结果当成「库存为 0」。
   */
  private async fetchFromTplus(path: string): Promise<unknown[]> {
    const cred = await this.loadCredentials();
    if (!cred) {
      throw new ServiceUnavailableException(
        '畅捷通 T+ 未配置：请先在采购工作台「T+ 集成」里录入 appKey / appSecret',
      );
    }
    if (!cred.openToken) {
      throw new ServiceUnavailableException(
        '畅捷通 T+ 已配置凭据但尚未完成授权（openToken 为空），OAuth 授权流程接入后可用',
      );
    }
    const url = `${cred.baseUrl.replace(/\/+$/, '')}${path}`;
    const res = await fetch(url, {
      // 开放平台业务接口统一 POST；三个凭据全放 header（对齐官方文档）
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        appKey: cred.appKey,
        appSecret: cred.appSecret,
        openToken: cred.openToken,
      },
      body: JSON.stringify({ param: {} }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.error(`T+ 请求失败 ${path} ${res.status} ${text.slice(0, 200)}`);
      throw new ServiceUnavailableException(`畅捷通 T+ 接口返回 ${res.status}`);
    }
    const body = (await res.json()) as { data?: unknown };
    const data = body?.data ?? body;
    return Array.isArray(data) ? data : [];
  }

  // ── 字段映射：待拿到真实响应样例后按文档补全 ─────────────────────────────────

  private mapSuppliers(rows: unknown[]): TplusSupplier[] {
    return rows
      .map((row) => row as Record<string, unknown>)
      .filter((r) => typeof r.Code === 'string' || typeof r.code === 'string')
      .map((r) => ({
        code: String(r.Code ?? r.code),
        name: String(r.Name ?? r.name ?? ''),
        shortName: r.ShortName ? String(r.ShortName) : undefined,
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
        unit: r.Unit ? String(r.Unit) : undefined,
        warehouse: r.WarehouseName ? String(r.WarehouseName) : '',
        stockQty: Number(r.ExistingQuantity ?? r.Quantity ?? 0),
        availableQty: r.AvailableQuantity === undefined ? undefined : Number(r.AvailableQuantity),
        inTransitQty: r.InTransitQuantity === undefined ? undefined : Number(r.InTransitQuantity),
      }));
  }

  private mapPurchaseOrders(rows: unknown[]): TplusPurchaseOrderLine[] {
    const lines: TplusPurchaseOrderLine[] = [];
    for (const row of rows) {
      const order = row as Record<string, unknown>;
      const orderNo = String(order.Code ?? order.code ?? '');
      if (!orderNo) continue;
      const details = Array.isArray(order.RDRecordDetails)
        ? (order.RDRecordDetails as Record<string, unknown>[])
        : [order];
      for (const detail of details) {
        lines.push({
          orderNo,
          orderId: order.ID ? String(order.ID) : undefined,
          lineNo: detail.RowNo ? String(detail.RowNo) : undefined,
          supplierName:
            typeof order.Partner === 'object' && order.Partner
              ? String((order.Partner as Record<string, unknown>).Name ?? '')
              : undefined,
          orderedQty: Number(detail.Quantity ?? 0),
          receivedQty: Number(detail.ReceivedQuantity ?? detail.ExecutedQuantity ?? 0),
          unitPrice: detail.Price === undefined ? undefined : Number(detail.Price),
          orderDate: order.VoucherDate ? String(order.VoucherDate) : undefined,
          etaDate: detail.DeliveryDate ? String(detail.DeliveryDate) : undefined,
          approvalStatus: order.AuditStatus ? String(order.AuditStatus) : undefined,
          status: order.Status ? String(order.Status) : undefined,
        });
      }
    }
    return lines;
  }
}
