import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { KEY_MATERIAL_CLUES } from './key-material-clues';
import { isProductionWarehouse } from './inventory-readiness';
import type { ProcActor } from './procurement.types';
import { ProductionReadinessService } from './production-readiness.service';
import { executionDay, executionMonth, type ExecutionPlan } from './production-execution.model';

const PREFIX = 'procurement:key-materials:v1:';
export interface KeyMaterialMapping { version: number; materialIds: string[]; inclusion: 'included' | 'pending' | 'excluded'; actorId: string; actorName: string; note: string; at: string }
export interface SaveKeyMaterialMapping { requestId: string; version: number; materialIds: string[]; inclusion: KeyMaterialMapping['inclusion']; note: string }
const decode = (value?: string | null): KeyMaterialMapping | null => value ? JSON.parse(value) as KeyMaterialMapping : null;
const formalId = (id: string) => /^material:([A-Za-z0-9_-]{1,128})$/.exec(id)?.[1];
const materialSelect = { id: true, name: true, spec: true, unit: true, category: true, productLine: true, tpInventoryCode: true, erpCode: true, updatedAt: true } as const;

@Injectable()
export class KeyMaterialsService {
  constructor(private readonly prisma: PrismaService, private readonly readiness: ProductionReadinessService) {}
  private permission(actor: ProcActor, write = false) {
    if (!actor.id || (!actor.permissions.includes('*') && (!actor.permissions.includes('page:proc-key-materials') || (write && !actor.permissions.includes('material:review'))))) throw new ForbiddenException('没有查看或核对关键物料的权限');
  }
  async list(actor: ProcActor) {
    this.permission(actor);
    const stored = await this.prisma.runtimeState.findMany({ where: { key: { in: KEY_MATERIAL_CLUES.map((row) => `${PREFIX}current:${row.id}`) } } });
    const byId = new Map(stored.map((row) => [row.key, decode(row.value)]));
    const clues = KEY_MATERIAL_CLUES.map((row) => ({ ...row, mapping: byId.get(`${PREFIX}current:${row.id}`) ?? { version: 0, materialIds: [], inclusion: row.kind === 'candidate' ? 'pending' : 'included', actorId: '', actorName: '', note: '', at: null } }));
    const scopes = await this.prisma.runtimeState.findMany({ where: { key: { startsWith: `${PREFIX}current:material:` } } });
    const explicit = new Map(scopes.map(row => [row.key.slice(`${PREFIX}current:material:`.length), decode(row.value)!]));
    const inherited = clues.filter(row => row.mapping.inclusion === 'included').flatMap(row => row.mapping.materialIds);
    const ids = [...new Set([...inherited, ...explicit.keys()])];
    const materials = await this.prisma.procMaterial.findMany({ where: { id: { in: ids } }, orderBy: [{ name: 'asc' }, { id: 'asc' }], select: { ...materialSelect, balances: { select: { warehouse: true, stockQty: true, availableQty: true, inTransitQty: true, syncedAt: true } } } });
    return { clues, materials: materials.map(({ balances, ...material }) => {
      const warehouse = balances.filter((row) => isProductionWarehouse(row.warehouse));
      const scope = explicit.get(material.id) ?? { version: 0, materialIds: [material.id], inclusion: 'included' as const, actorId: '', actorName: '', note: '沿用已核对会议映射', at: null };
      return { ...material, scope, available: warehouse.length ? warehouse.reduce((sum, row) => sum.plus(row.availableQty), new Prisma.Decimal(0)).toNumber() : null,
        inTransit: warehouse.length ? warehouse.reduce((sum, row) => sum.plus(row.inTransitQty), new Prisma.Decimal(0)).toNumber() : null,
        syncedAt: warehouse.length && warehouse.every((row) => row.syncedAt) ? warehouse.map((row) => row.syncedAt!.toISOString()).sort()[0] : null };
    }), canReview: actor.permissions.includes('*') || actor.permissions.includes('material:review') };
  }
  async monthly(month: string, date: string, actor: ProcActor) {
    this.permission(actor); executionMonth(month); executionDay(date, '需求日');
    const directory = await this.list(actor);
    const stored = await this.prisma.runtimeState.findMany({ where: { key: { startsWith: 'procurement:execution:v1:plan:' } } });
    const allPlans = stored.map(row => JSON.parse(row.value) as ExecutionPlan);
    const plans = allPlans.filter(plan => plan.month === month);
    const views = await Promise.all(plans.map(plan => this.readiness.calculate(this.prisma, plan.id, date)));
    const active = directory.materials.filter(row => row.scope.inclusion === 'included');
    const ids = active.map(row => row.id);
    const [quality, tasks] = ids.length ? await Promise.all([
      this.prisma.procQualityRecord.findMany({ where: { materialId: { in: ids }, status: { not: 'closed' } }, select: { id: true, materialId: true, issue: true, status: true } }),
      this.prisma.procTask.findMany({ where: { materialId: { in: ids } }, select: { id: true, materialId: true, code: true, buyer: true, status: true } }),
    ]) : [[], []];
    const materials = active.map(material => ({ ...material,
      plans: views.flatMap(view => {
        const plan = plans.find(plan => plan.id === view.planId)!;
        return view.lines.filter(line => line.code === (material.tpInventoryCode || material.erpCode)).map(line => {
          const problems = [...line.problems];
          if (line.unit !== material.unit) problems.push('物料库与计划 BOM 单位不一致，须核对');
          if (active.filter(row => (row.tpInventoryCode || row.erpCode) === line.code).length > 1) problems.push('正式编码对应多个物料主档，须核对');
          // Independent plan simulations may see the same unreserved warehouse stock.
          // Only confirmed allocations can establish coverage when other formal plans share it.
          const shared = allPlans.filter(candidate => candidate.targetQty > 0 && candidate.bom.some(row => row.code === line.code)).length > 1;
          if (shared && line.warehouse !== null && line.warehouse > 0) {
            const childReserved = new Prisma.Decimal(line.warehouse).minus(line.maxReservable ?? line.warehouse);
            const reservedWarehouse = Prisma.Decimal.min(new Prisma.Decimal(line.ownReserved).plus(childReserved), line.warehouse);
            const committed = reservedWarehouse.plus(line.lineQty).plus(line.incoming);
            if (reservedWarehouse.lt(line.warehouse) && committed.lt(line.remainingDemand)) problems.push('共享库存尚未充分分配给本计划，请在原计划确认占用后刷新');
          }
          return { planId: view.planId, productId: plan.productId, productName: plan.productName, productLine: plan.productLine, demand: line.demand, remainingDemand: line.remainingDemand, gap: problems.length ? null : line.gap, date, problems, incoming: line.incoming, purchase: line.purchase };
        });
      }),
      quality: quality.filter(row => row.materialId === material.id), tasks: tasks.filter(row => row.materialId === material.id),
    }));
    return { month, date, planCount: plans.length, clues: directory.clues, materials };
  }
  async options(query: string, page: number, actor: ProcActor) {
    this.permission(actor, true);
    const keyword = query?.trim() || '';
    if (keyword.length > 200 || !Number.isSafeInteger(page) || page < 1) throw new BadRequestException('物料搜索条件无效');
    const where: Prisma.ProcMaterialWhereInput = keyword ? { OR: ['name', 'spec', 'tpInventoryCode', 'erpCode'].map((key) => ({ [key]: { contains: keyword, mode: 'insensitive' } })) } : {};
    const [total, items] = await Promise.all([this.prisma.procMaterial.count({ where }), this.prisma.procMaterial.findMany({ where, select: materialSelect, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (page - 1) * 30, take: 30 })]);
    return { items, page, total, pageSize: 30 };
  }
  async history(id: string, actor: ProcActor) {
    this.permission(actor);
    if (!formalId(id) && !KEY_MATERIAL_CLUES.some((row) => row.id === id)) throw new BadRequestException('核对线索不存在');
    const rows = await this.prisma.runtimeState.findMany({ where: { key: { startsWith: `${PREFIX}history:${id}:` } }, orderBy: { key: 'desc' } });
    return rows.map((row) => decode(row.value));
  }
  async save(id: string, input: SaveKeyMaterialMapping, actor: ProcActor) {
    this.permission(actor, true);
    const clue = KEY_MATERIAL_CLUES.find((row) => row.id === id), materialId = formalId(id);
    if (!clue && !materialId) throw new BadRequestException('核对线索不存在');
    if (!input || !Number.isSafeInteger(input.version) || input.version < 0 || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId)) throw new BadRequestException('提交版本或标识无效');
    if (!Array.isArray(input.materialIds) || input.materialIds.length > 2000 || input.materialIds.some((item) => typeof item !== 'string' || !item || item.length > 128)) throw new BadRequestException('正式物料列表无效');
    const materialIds = [...new Set(input.materialIds)].sort();
    if (materialId) {
      if (!['included', 'excluded'].includes(input.inclusion)) throw new BadRequestException('正式目录只能纳入或退出');
      if (input.inclusion === 'included' && (materialIds.length !== 1 || materialIds[0] !== materialId)) throw new BadRequestException('只能操作当前正式物料');
    } else if (!['included', 'pending', 'excluded'].includes(input.inclusion) || (clue!.kind !== 'candidate' && input.inclusion !== 'included')) throw new BadRequestException('固定会议线索必须保留，只有网格包可确认纳入状态');
    if (input.inclusion === 'included' && materialIds.length === 0) throw new BadRequestException('请至少选择一个正式物料');
    if (input.inclusion !== 'included' && materialIds.length) throw new BadRequestException('待定或排除条目不能同时绑定正式物料');
    if (typeof input.note !== 'string' || !input.note.trim() || input.note.length > 4000) throw new BadRequestException('请填写核对依据');
    const key = `${PREFIX}current:${id}`, requestKey = `${PREFIX}request:${id}:${input.requestId}`;
    const fingerprint = createHash('sha256').update(JSON.stringify([actor.id, id, input.version, materialIds, input.inclusion, input.note.trim()])).digest('hex');
    try {
      return await this.prisma.$transaction(async (db) => {
        const repeated = await db.runtimeState.findUnique({ where: { key: requestKey } });
        if (repeated) {
          if (repeated.value !== fingerprint) throw new ConflictException('提交编号已被使用，请重新核对');
          return { saved: true };
        }
        const before = decode((await db.runtimeState.findUnique({ where: { key } }))?.value);
        if ((before?.version ?? 0) !== input.version) throw new ConflictException('映射已被其他人更新，请保留草稿并重新核对');
        const checkedIds = materialId ? [materialId] : materialIds;
        const materials = await db.procMaterial.findMany({ where: { id: { in: checkedIds } }, select: materialSelect });
        if (materials.length !== checkedIds.length) throw new BadRequestException('存在已删除或未匹配的物料，请重新选择');
        if (input.inclusion === 'included' && materials.some((row) => !row.tpInventoryCode?.trim() && !row.erpCode.trim())) throw new BadRequestException('请先在物料库补齐正式编码，不能把临时需求当正式物料');
        const state: KeyMaterialMapping = { version: input.version + 1, materialIds, inclusion: input.inclusion, actorId: actor.id, actorName: actor.name, note: input.note.trim(), at: new Date().toISOString() };
        const value = JSON.stringify(state);
        await db.runtimeState.upsert({ where: { key }, create: { key, value }, update: { value } });
        await db.runtimeState.create({ data: { key: `${PREFIX}history:${id}:${String(state.version).padStart(12, '0')}`, value } });
        await db.runtimeState.create({ data: { key: requestKey, value: fingerprint } });
        await db.auditLog.create({ data: { module: 'procurement', source: 'web', action: materialId ? 'key-material.scope-confirmed' : 'key-material.mapping-confirmed', resource: 'key-material', resourceId: id, userId: actor.id, actorName: actor.name, summary: `核对关键物料：${clue?.name ?? materials[0].name}`, meta: { before: before ? JSON.parse(JSON.stringify(before)) : null, after: JSON.parse(value) } } });
        return { saved: true };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) throw new ConflictException('映射正在更新，请保留草稿后重新核对');
      throw error;
    }
  }
}
