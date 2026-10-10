import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryStockService } from '../inventory-stock/inventory-stock.service';
import { stockForCode } from '../inventory-stock/inventory-stock.model';
import type { ProcActor } from './procurement.types';

const PREFIX = 'procurement:component-inventory:';
export type ComponentInventoryInput = { source: 'erp' | 'manual'; quantity?: number; unavailable?: number; unit: string; countedAt?: string; note?: string; expectedVersion: number };
type RecordValue = ComponentInventoryInput & { version: number; updatedBy: string; updatedAt: string };
export type ComponentInventoryView = {
  materialId: string; materialName: string; code: string | null; unit: string; source: 'erp' | 'manual';
  quantity: number | null; available: number | null; unavailable: number | null; countedAt: string | null;
  updatedBy: string | null; note: string; version: number; issues: string[];
};
function validQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12 && new Prisma.Decimal(value).decimalPlaces() <= 3;
}
function decode(value: string): RecordValue {
  try { const record = JSON.parse(value); if (record && ['manual', 'erp'].includes(record.source) && Number.isInteger(record.version) && record.version > 0) return record; } catch { /* Keep corrupt records unknown. */ }
  throw new BadRequestException('组件库存记录损坏，请核对后修复');
}
@Injectable()
export class ComponentInventoryService {
  constructor(private readonly prisma: PrismaService, private readonly inventory: InventoryStockService) {}
  async read(ids: string[], db: Prisma.TransactionClient | PrismaService = this.prisma): Promise<ComponentInventoryView[]> {
    const unique = [...new Set(ids)];
    if (unique.length > 1000 || unique.some(id => typeof id !== 'string' || !id.trim() || id.length > 128)) throw new BadRequestException('组件物料范围无效');
    if (!unique.length) return [];
    const [materials, saved] = await Promise.all([
      db.procMaterial.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, unit: true, tpInventoryCode: true } }),
      db.runtimeState.findMany({ where: { key: { in: unique.map(id => PREFIX + id) } }, select: { key: true, value: true } }),
    ]);
    const records = new Map(saved.map(row => [row.key.slice(PREFIX.length), row.value]));
    const snapshot = await this.inventory.read({ codes: [...new Set(materials.map(m => m.tpInventoryCode).filter((code): code is string => Boolean(code)))], scope: { kind: 'production' } }, db);
    return materials.map(material => {
      const row: ComponentInventoryView = { materialId: material.id, materialName: material.name, code: material.tpInventoryCode, unit: material.unit, source: 'erp', quantity: null, available: null, unavailable: null, countedAt: null, updatedBy: null, note: '', version: 0, issues: [] };
      let record: RecordValue | undefined;
      try { if (records.has(material.id)) record = decode(records.get(material.id)!); }
      catch (error) { row.issues.push((error as Error).message); return row; }
      if (record) { row.version = record.version; row.source = record.source; }
      if (record?.source === 'manual') {
        row.note = record.note || ''; row.updatedBy = record.updatedBy; row.countedAt = record.countedAt || null;
        if (!validQuantity(record.quantity) || !validQuantity(record.unavailable) || record.unavailable > record.quantity || !row.countedAt || !Number.isFinite(Date.parse(row.countedAt)) || !material.unit || record.unit !== material.unit) {
          row.issues.push('人工库存数量、单位或统计时间无效，请重新核对'); return row;
        }
        row.quantity = record.quantity; row.unavailable = record.unavailable;
        row.available = new Prisma.Decimal(record.quantity).minus(record.unavailable).toNumber();
        return row;
      }
      if (!material.tpInventoryCode) { row.issues.push('未关联 ERP 存货编码，可人工登记组件库存'); return row; }
      const stock = stockForCode(snapshot, material.tpInventoryCode, material.unit);
      row.issues = stock.issues;
      row.countedAt = stock.rows.map(r => r.syncedAt).filter((at): at is string => Boolean(at)).sort()[0] ?? null;
      if (stock.available !== null && stock.rows.every(r => r.bookQty !== null)) {
        row.available = stock.available;
        row.quantity = stock.rows.reduce((sum, r) => sum.plus(r.bookQty!), new Prisma.Decimal(0)).toNumber();
        row.unavailable = new Prisma.Decimal(row.quantity).minus(row.available).toNumber();
      }
      return row;
    });
  }
  async save(id: string, input: ComponentInventoryInput, actor: ProcActor) {
    if (!actor.id || !actor.permissions.some(p => p === '*' || p === 'proc-task:create')) throw new ForbiddenException('没有维护备货组件库存的权限');
    if (!input || !['erp', 'manual'].includes(input.source) || !Number.isInteger(input.expectedVersion) || input.expectedVersion < 0 || typeof input.unit !== 'string' || typeof (input.note ?? '') !== 'string' || (input.note?.length ?? 0) > 1000) throw new BadRequestException('库存来源、版本或说明无效');
    if (input.source === 'manual' && (!validQuantity(input.quantity) || !validQuantity(input.unavailable) || input.unavailable > input.quantity)) throw new BadRequestException('库存数量必须非负，最多三位小数，不可用数量不能超过实际库存');
    if (input.source === 'manual' && (!input.countedAt || !Number.isFinite(Date.parse(input.countedAt)) || Date.parse(input.countedAt) > Date.now() + 60_000)) throw new BadRequestException('请填写有效的盘点时间，不能晚于当前时间');
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${PREFIX + id}))`;
      const material = await tx.procMaterial.findUnique({ where: { id }, select: { unit: true } });
      if (!material) throw new NotFoundException('组件物料不存在');
      if (!material.unit || input.unit !== material.unit) throw new BadRequestException('库存单位与组件物料单位不一致');
      const before = await tx.runtimeState.findUnique({ where: { key: PREFIX + id } });
      const previous = before ? decode(before.value) : null;
      if ((previous?.version ?? 0) !== input.expectedVersion) throw new ConflictException('组件库存已更新，请刷新后重新填写');
      const record: RecordValue = { source: input.source, unit: material.unit, expectedVersion: input.expectedVersion,
        ...(input.source === 'manual' ? { quantity: input.quantity, unavailable: input.unavailable, countedAt: new Date(input.countedAt!).toISOString() } : {}),
        note: input.note?.trim() || '', version: input.expectedVersion + 1, updatedBy: actor.name, updatedAt: new Date().toISOString() };
      const value = JSON.stringify(record);
      await tx.runtimeState.upsert({ where: { key: PREFIX + id }, create: { key: PREFIX + id, value }, update: { value } });
      await tx.auditLog.create({ data: { module: 'procurement', source: 'web', action: 'component-inventory.update', resource: 'proc-material', resourceId: id, userId: actor.id, actorName: actor.name, summary: '更新组件实际库存来源', meta: { before: previous ? JSON.parse(JSON.stringify(previous)) : null, after: JSON.parse(value) } } });
    });
    return (await this.read([id]))[0];
  }
}
