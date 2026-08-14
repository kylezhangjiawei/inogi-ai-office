import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../prisma/prisma.service';
import { ProcurementService } from './procurement.service';
import { PROC_TERMINAL_STATUSES, type ProcActor } from './procurement.types';
import { computeReplenishRows, type ReplenishRow } from './replenish-core';

/**
 * 补货建议：把「缺料预警」从统计数字变成可行动清单。
 *
 * 建议补货量 = 安全库存 − 当前库存 − T+ 在途（镜像里未到齐的单）− 进行中采购任务未到量，
 * 三重扣减避免重复下单；≤0 说明缺口已被覆盖，不出现在清单里。
 * 附最近一次采购的供应商/单价（来自 T+ 镜像）供询价参考。
 * 「生成任务」逐条复用 createTask（询价流程起点），依据写入 consumableNote 留痕。
 * 计算口径在 replenish-core.ts（与 MateChat 采购查询工具共用）。
 */

export type ReplenishSuggestion = ReplenishRow;

@Injectable()
export class MaterialReplenishService {
  private readonly logger = new Logger(MaterialReplenishService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly procurement: ProcurementService,
  ) {}

  async suggestions(): Promise<{ rows: ReplenishSuggestion[] }> {
    const materials = await this.prisma.procMaterial.findMany({
      where: { safeStock: { gt: 0 } },
      select: {
        id: true,
        erpCode: true,
        name: true,
        spec: true,
        unit: true,
        safeStock: true,
        balances: { select: { stockQty: true } },
      },
    });
    const shortage = materials.filter(
      (m) => m.balances.reduce((s, b) => s + Number(b.stockQty), 0) < Number(m.safeStock),
    );
    if (shortage.length === 0) return { rows: [] };
    const ids = shortage.map((m) => m.id);

    // T+ 在途：镜像里未到齐的单行（到货量 < 订购量）
    const mirrorRows = await this.prisma.procPurchaseOrderMirror.findMany({
      where: { materialId: { in: ids } },
      select: {
        materialId: true,
        orderedQty: true,
        receivedQty: true,
        supplierName: true,
        unitPrice: true,
        orderDate: true,
      },
      orderBy: { orderDate: 'desc' },
    });

    // 进行中采购任务的未到量（避免对同一缺口重复建任务）
    const openTasks = await this.prisma.procTask.findMany({
      where: { materialId: { in: ids }, status: { notIn: [...PROC_TERMINAL_STATUSES, 'pending_rd_review'] } },
      select: { materialId: true, quantity: true, arrivedQty: true },
    });

    const rows = computeReplenishRows(
      shortage.map((m) => ({
        id: m.id,
        erpCode: m.erpCode,
        name: m.name,
        spec: m.spec,
        unit: m.unit,
        safeStock: Number(m.safeStock),
        stock: m.balances.reduce((s, b) => s + Number(b.stockQty), 0),
      })),
      mirrorRows.map((r) => ({
        materialId: r.materialId as string,
        orderedQty: Number(r.orderedQty),
        receivedQty: Number(r.receivedQty),
        supplierName: r.supplierName,
        unitPrice: r.unitPrice === null ? null : Number(r.unitPrice),
      })),
      openTasks.map((t) => ({
        materialId: t.materialId as string,
        quantity: Number(t.quantity),
        arrivedQty: Number(t.arrivedQty),
      })),
    );
    return { rows };
  }

  /** 勾选条目批量建采购任务（询价流程起点）；数量可被前端修改，须为正整数。 */
  async createTasks(items: Array<{ materialId: string; quantity: number }>, actor: ProcActor) {
    if (!items.length) throw new BadRequestException('没有选中任何补货条目');
    if (items.length > 100) throw new BadRequestException('单次最多生成 100 个任务');
    const materials = await this.prisma.procMaterial.findMany({
      where: { id: { in: items.map((i) => i.materialId) } },
      select: { id: true, name: true, spec: true, unit: true, safeStock: true, balances: { select: { stockQty: true } } },
    });
    const byId = new Map(materials.map((m) => [m.id, m]));
    // 采购员自动分配：沿用该物料最近一次采购任务的负责人（含已完成任务，历史即经验）
    const recentTasks = await this.prisma.procTask.findMany({
      where: { materialId: { in: items.map((i) => i.materialId) }, buyer: { not: '' } },
      select: { materialId: true, buyer: true, buyerUserId: true },
      orderBy: { createdAt: 'desc' },
    });
    const buyerByMaterial = new Map<string, { buyer: string; buyerUserId: string | null }>();
    for (const t of recentTasks) {
      const id = t.materialId as string;
      if (!buyerByMaterial.has(id)) buyerByMaterial.set(id, { buyer: t.buyer, buyerUserId: t.buyerUserId });
    }
    const created: string[] = [];
    for (const item of items) {
      const material = byId.get(item.materialId);
      if (!material) throw new BadRequestException(`物料不存在：${item.materialId}`);
      const quantity = Math.floor(Number(item.quantity));
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException(`「${material.name}」的补货数量无效`);
      }
      const stock = material.balances.reduce((s, b) => s + Number(b.stockQty), 0);
      const needDate = new Date(Date.now() + 14 * 86400_000).toISOString().slice(0, 10);
      const historyBuyer = buyerByMaterial.get(material.id);
      const task = await this.procurement.createTask(
        {
          materialId: material.id,
          materialName: material.name,
          spec: material.spec || undefined,
          unit: material.unit || undefined,
          quantity,
          method: 'inquiry',
          priority: stock <= 0 ? 'high' : 'medium',
          needDate,
          ...(historyBuyer ? { buyer: historyBuyer.buyer, buyerUserId: historyBuyer.buyerUserId ?? undefined } : {}),
          consumableNote: `补货建议自动生成：当前库存 ${stock} / 安全库存 ${Number(material.safeStock)}${historyBuyer ? `；采购员沿用该物料历史负责人` : ''}`,
        },
        actor,
      );
      created.push((task as { code: string }).code);
    }
    this.logger.log(`补货建议生成采购任务 ${created.length} 个：${created.join(', ')}`);
    return { created: created.length, codes: created };
  }
}
