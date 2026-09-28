import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryStockService } from '../inventory-stock/inventory-stock.service';
import { stockForCode, type StockScope } from '../inventory-stock/inventory-stock.model';
import { exactMaterial, mappingFingerprint, sourceOrderFingerprint, type MaterialIdentity, type SourceOrderLine, type MappingEvidence } from './order-material-mapping';

type Actor = { id: string; name: string; permissions: string[] };
export type OrderStockCheck = { lineId: string; materialId: string | null; mappingState: 'exact' | 'confirmed' | 'unmatched' | 'stale'; stockState: 'known' | 'unknown'; availableQty: number | null; sufficient: boolean | null; issues: string[]; checkedAt: string; scope: StockScope; sourceFingerprint: string; updatedAt: string; warehouses?: { warehouse: string; available: number | null; syncedAt: string | null }[] };
export type ConfirmOrderMaterial = { materialId: string; expectedUpdatedAt: string; expectedSourceFingerprint: string; requestId: string; reason: string };
const identity = (row: { id: string; tpInventoryCode: string | null; unit: string; reviewStatus: string }): MaterialIdentity => ({ id: row.id, code: row.tpInventoryCode ?? '', unit: row.unit, active: row.reviewStatus === 'approved' });
const emptyScope: StockScope = { kind: 'selected', warehouses: [] };

@Injectable()
export class OrderStockService {
  constructor(private readonly prisma: PrismaService, private readonly stock: InventoryStockService = new InventoryStockService(prisma)) {}
  access(actor: Actor, write = false) {
    if (!actor.id || (!actor.permissions.includes('*') && (!actor.permissions.includes('page:order-workbench') || (write && !actor.permissions.includes('order-processing:material-map'))))) throw new ForbiddenException('需要订单工作台及物料核对权限');
  }
  async options(query: Record<string, unknown>, actor: Actor) {
    this.access(actor);
    if (query.q !== undefined && typeof query.q !== 'string') throw new BadRequestException('查询条件无效');
    const q = String(query.q ?? '').trim(); if (q.length > 128) throw new BadRequestException('查询内容过长');
    const materials = await this.prisma.procMaterial.findMany({ where: { reviewStatus: 'approved', tpInventoryCode: { not: null }, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { tpInventoryCode: { contains: q } }, { spec: { contains: q, mode: 'insensitive' } }] } : {}) }, select: { id: true, name: true, spec: true, unit: true, tpInventoryCode: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 50 });
    const warehouses = await this.prisma.procInventoryBalance.findMany({ distinct: ['warehouse'], select: { warehouse: true }, orderBy: { warehouse: 'asc' } });
    return { materials: materials.filter(row => row.unit.trim() && row.tpInventoryCode?.trim()), warehouses: warehouses.map(row => row.warehouse).filter(Boolean) };
  }
  async check(lines: SourceOrderLine[], scope: StockScope): Promise<OrderStockCheck[]> {
    if (!lines.length) return [];
    return this.prisma.$transaction(async db => {
      const saved = await db.orderProcessingOrderProduct.findMany({ where: { id: { in: lines.map(line => line.id) } } });
      const materials = await db.procMaterial.findMany({ where: { OR: [{ id: { in: saved.flatMap(line => line.materialId ? [line.materialId] : []) } }, { tpInventoryCode: { in: lines.map(line => line.sku.trim()).filter(Boolean) } }] } });
      const candidates = materials.map(identity);
      const checked = lines.map(line => {
        const original = saved.find(row => row.id === line.id && row.orderId === line.orderId);
        const source = original ?? line;
        const evidence = original?.mappingEvidence as MappingEvidence | null;
        let material: MaterialIdentity | null = null;
        let mappingState: OrderStockCheck['mappingState'] = 'unmatched';
        if (evidence || original?.materialId) {
          const bound = candidates.find(row => row.id === original?.materialId);
          if (bound?.active && bound.code.trim() && bound.unit.trim() === source.unit.trim() && evidence?.fingerprint === mappingFingerprint(source, bound)) { material = bound; mappingState = 'confirmed'; }
          else mappingState = 'stale';
        } else if (original) { material = exactMaterial(source, candidates); if (material) mappingState = 'exact'; }
        return { source, original, material, mappingState };
      });
      // Customer delivery scope must be explicit. Production raw-material warehouses are not a shipping default.
      const selected = scope?.kind === 'selected' && scope.warehouses.length > 0;
      const snapshot = selected ? await this.stock.read({ codes: checked.flatMap(row => row.material ? [row.material.code] : []), scope }, db) : null;
      return checked.map(({ source, original, material, mappingState }) => {
        const issues: string[] = [];
        const requested = lines.find(row => row.id === source.id)!;
        const changedDuringRead = sourceOrderFingerprint(requested) !== sourceOrderFingerprint(source) || requested.orderQty !== source.orderQty;
        if (changedDuringRead) issues.push('订单在查询期间已变化，请刷新明细后重新核对');
        if (!material) issues.push(mappingState === 'stale' ? '原核对依据或物料已变化，请重新核对' : '订单商品尚未明确关联正式物料');
        if (!selected) issues.push('请明确选择可出货仓库，库存参考不构成库存预留');
        const view = material && snapshot ? stockForCode(snapshot, material.code, material.unit) : null;
        issues.push(...(view?.issues ?? []));
        if (!Number.isFinite(source.orderQty) || source.orderQty <= 0) issues.push('订单需求数量无效');
        const availableQty = issues.length ? null : view?.available ?? null;
        return { lineId: source.id, materialId: material?.id ?? original?.materialId ?? null, mappingState, stockState: availableQty === null ? 'unknown' as const : 'known' as const, availableQty,
          sufficient: availableQty === null ? null : new Prisma.Decimal(availableQty).gte(source.orderQty), issues: [...new Set(issues)], checkedAt: snapshot?.readAt ?? new Date().toISOString(), scope: scope ?? emptyScope,
          sourceFingerprint: sourceOrderFingerprint(requested), updatedAt: original?.updatedAt.toISOString() ?? '', warehouses: view?.rows.map(row => ({ warehouse: row.warehouse, available: row.available, syncedAt: row.syncedAt })) };
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async confirm(orderId: string, lineId: string, input: ConfirmOrderMaterial, actor: Actor) {
    this.access(actor, true);
    if (!input || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId) || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 2000 || typeof input.materialId !== 'string' || !input.materialId || input.materialId.length > 200 || !/^[a-f0-9]{64}$/.test(input.expectedSourceFingerprint) || !Number.isFinite(Date.parse(input.expectedUpdatedAt))) throw new BadRequestException('请提交完整的物料核对依据');
    const key = `order-processing:material-map:v1:request:${input.requestId}`;
    const signature = createHash('sha256').update(JSON.stringify([actor.id, orderId, lineId, input.materialId, input.expectedUpdatedAt, input.expectedSourceFingerprint, input.reason])).digest('hex');
    try {
      return await this.prisma.$transaction(async db => {
        const previous = await db.runtimeState.findUnique({ where: { key } });
        if (previous) { if (previous.value !== signature) throw new ConflictException('请求标识已用于其他操作'); return { saved: true }; }
        const line = await db.orderProcessingOrderProduct.findUnique({ where: { id: lineId } });
        if (!line || line.orderId !== orderId) throw new NotFoundException('订单明细不存在或不属于本订单');
        if (line.updatedAt.toISOString() !== input.expectedUpdatedAt || sourceOrderFingerprint(line) !== input.expectedSourceFingerprint) throw new ConflictException('订单来源已变化，请保留草稿并刷新依据');
        const row = await db.procMaterial.findUnique({ where: { id: input.materialId } });
        if (!row || row.reviewStatus !== 'approved' || !row.tpInventoryCode?.trim() || !row.unit.trim() || row.unit.trim() !== line.unit.trim()) throw new BadRequestException('请选择已审核、具有正式编码且单位一致的物料');
        const material = identity(row);
        const evidence: MappingEvidence = { fingerprint: mappingFingerprint(line, material), code: material.code, unit: material.unit, actorId: actor.id, actorName: actor.name, at: new Date().toISOString(), reason: input.reason.trim() };
        const result = await db.orderProcessingOrderProduct.updateMany({ where: { id: lineId, orderId, updatedAt: new Date(input.expectedUpdatedAt) }, data: { materialId: material.id, mappingEvidence: evidence } });
        if (result.count !== 1) throw new ConflictException('订单明细已更新，请保留草稿并刷新依据');
        await db.runtimeState.create({ data: { key, value: signature } });
        await db.auditLog.create({ data: { module: 'order-processing', source: 'web', action: 'order-processing.material-map', resource: 'order-material', resourceId: lineId, userId: actor.id, actorName: actor.name, summary: input.reason.trim(), meta: { orderId, before: line.materialId, materialId: material.id, evidence } } });
        return { saved: true };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code)) throw new ConflictException('并发核对冲突，请保留草稿并刷新依据后重试');
      throw error;
    }
  }
}
