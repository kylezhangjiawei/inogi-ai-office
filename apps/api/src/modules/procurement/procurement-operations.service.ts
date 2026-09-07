import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ProcurementOperationsQueryDto, SaveProductionReportDto, SaveQualityRecordDto } from './dto/procurement-operations.dto';
import type { ProcActor } from './procurement.types';

type Db = Prisma.TransactionClient;
const productionInclude = { treeNode: { select: { name: true } }, stockPlan: { select: { code: true } } } as const;
const qualityInclude = { ...productionInclude, material: { select: { name: true } }, supplier: { select: { name: true } }, task: { select: { code: true } } } as const;
type ProductionRow = Prisma.ProcProductionReportGetPayload<{ include: typeof productionInclude }>;
type QualityRow = Prisma.ProcQualityRecordGetPayload<{ include: typeof qualityInclude }>;

const number = (value: Prisma.Decimal | number) => Number(value);
const optionalId = (value?: string | null) => value?.trim() || null;
const rate = (part: number, total: number) => total > 0 ? Math.round(part / total * 10000) / 100 : null;
const rounded = (value: number) => Math.round((value + Number.EPSILON) * 1000) / 1000;

function requiredText(value: string, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`请填写${label}`);
  return value.trim();
}

export function operationDay(value: string, label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException(`${label}格式无效`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException(`${label}不存在`);
  return date;
}

function decimal(value: number, label: string, digits = 3, positive = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (positive && value === 0)) throw new BadRequestException(`${label}必须是${positive ? '大于 0 的' : '非负'}有效数字`);
  const result = new Prisma.Decimal(value);
  if (result.decimalPlaces() > digits || result.greaterThan(digits === 2 ? '99999999.99' : '99999999999.999')) throw new BadRequestException(`${label}超出范围或小数位数过多`);
  return result;
}

function assertVersion(base: string | undefined, current: Date) {
  if (!base || !Number.isFinite(Date.parse(base)) || Date.parse(base) !== current.getTime()) throw new ConflictException('记录已被更新，请刷新后重新打开编辑，避免覆盖他人的修改');
}

/** 用实际存储归属定位生产任务，禁止从任务标题或客户端缺省产品推断。 */
export function locateProductionTaskSource(rows: Array<{ key: string; value: unknown }>, taskId: string) {
  const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
  const matches: Array<{ taskId: string; productId: string; title: string }> = [];
  const visit = (tasks: unknown, productId: string) => {
    if (!Array.isArray(tasks)) return;
    for (const task of tasks) {
      if (!isRecord(task)) continue;
      if (task.task_id === taskId && task.archived !== true && task.status !== 'archived') matches.push({ taskId, productId, title: String(task.title ?? '') });
      visit(task.subtasks, productId);
    }
  };
  const categories = (value: unknown, productId: string) => {
    if (!Array.isArray(value)) return;
    for (const category of value) {
      if (!isRecord(category) || !Array.isArray(category.children)) continue;
      for (const child of category.children) if (isRecord(child)) visit(child.tasks, productId);
    }
  };
  for (const row of rows) {
    if (row.key === 'rdws.production.taskCategories') categories(row.value, 'prod-portable-o2');
    if (row.key === 'rdws.production.productTaskCategories' && isRecord(row.value)) {
      for (const [productId, value] of Object.entries(row.value)) {
        if (productId !== 'prod-portable-o2') categories(value, productId);
      }
    }
  }
  if (!matches.length) throw new NotFoundException('生产任务不存在或已归档，请刷新任务后重试');
  if (matches.length !== 1) throw new ConflictException('生产任务的产品归属不唯一，请先核对任务数据');
  return matches[0];
}

@Injectable()
export class ProcurementOperationsService {
  constructor(private readonly prisma: PrismaService) {}

  async productionTaskSource(taskId: string) {
    const rows = await this.prisma.systemSetting.findMany({ where: { key: { in: ['rdws.production.taskCategories', 'rdws.production.productTaskCategories'] } }, select: { key: true, value: true } });
    return locateProductionTaskSource(rows, requiredText(taskId, '生产任务'));
  }

  private assertPermission(actor: ProcActor, permission: string) {
    if (!actor.permissions.includes('*') && !actor.permissions.includes(permission)) throw new ForbiddenException('没有执行该操作的权限');
  }

  /** 校验显式归属；跨产品、跨模块的记录不能靠客户端传入 ID 拼接。 */
  private async scope(db: Db, productId: string, treeNodeId?: string, stockPlanId?: string | null) {
    requiredText(productId, '产品');
    const node = treeNodeId ? await db.procTaskTreeNode.findUnique({ where: { id: treeNodeId } }) : null;
    if (treeNodeId && (!node || node.productId !== productId)) throw new BadRequestException('所选子系统模块不属于当前产品');
    const plan = stockPlanId ? await db.procStockPlan.findUnique({ where: { id: stockPlanId } }) : null;
    if (stockPlanId && (!plan || plan.productId !== productId || (treeNodeId && plan.treeNodeId !== treeNodeId))) throw new BadRequestException('备货计划不属于当前产品或子系统模块');
    return { node, plan };
  }

  private monthRange(month?: string) {
    const value = month || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) throw new BadRequestException('月份格式无效');
    const start = operationDay(`${value}-01`, '月份');
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return { month: value, range: { gte: start, lt: end } };
  }

  async list(query: ProcurementOperationsQueryDto) {
    await this.scope(this.prisma, query.productId, query.treeNodeId, query.stockPlanId);
    const { month, range } = this.monthRange(query.month);
    const where = { productId: query.productId, ...(query.treeNodeId ? { treeNodeId: query.treeNodeId } : {}), ...(query.stockPlanId ? { stockPlanId: query.stockPlanId } : {}) };
    const [reports, quality] = await Promise.all([
      this.prisma.procProductionReport.findMany({ where: { ...where, reportDate: range }, include: productionInclude, orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }] }),
      this.prisma.procQualityRecord.findMany({ where: { ...where, inspectionDate: range }, include: qualityInclude, orderBy: [{ inspectionDate: 'desc' }, { createdAt: 'desc' }] }),
    ]);
    const productionReports = reports.map((row) => this.productionView(row));
    const qualityRecords = quality.map((row) => this.qualityView(row));
    const units = [...new Set(productionReports.map((row) => row.unit))];
    const productionSummary = units.map((unit) => {
      const rows = productionReports.filter((row) => row.unit === unit);
      const sum = (key: 'plannedQty' | 'actualQty' | 'goodQty' | 'defectiveQty' | 'workHours') => rounded(rows.reduce((n, row) => n + row[key], 0));
      const capacityRecorded = rows.filter((row) => row.capacityQty !== null).length;
      const capacityQty = capacityRecorded === rows.length ? rounded(rows.reduce((n, row) => n + (row.capacityQty ?? 0), 0)) : null;
      return { unit, reports: rows.length, plannedQty: sum('plannedQty'), actualQty: sum('actualQty'), goodQty: sum('goodQty'), defectiveQty: sum('defectiveQty'), workHours: sum('workHours'), capacityQty, capacityRecorded, attainmentRate: rate(sum('actualQty'), sum('plannedQty')), yieldRate: rate(sum('goodQty'), sum('actualQty')), capacityUtilization: capacityQty === null ? null : rate(sum('actualQty'), capacityQty) };
    });
    const qualitySummary = ['procurement', 'production'].flatMap((source) => [...new Set(qualityRecords.filter((row) => row.source === source).map((row) => row.unit))].map((unit) => {
      const rows = qualityRecords.filter((row) => row.source === source && row.unit === unit);
      const inspectedQty = rounded(rows.reduce((n, row) => n + row.inspectedQty, 0));
      const defectiveQty = rounded(rows.reduce((n, row) => n + row.defectiveQty, 0));
      return { source, unit, records: rows.length, open: rows.filter((row) => row.status !== 'closed').length, inspectedQty, defectiveQty, defectRate: rate(defectiveQty, inspectedQty) };
    }));
    return { month, productionReports, qualityRecords, productionSummary, qualitySummary };
  }

  async options(query: ProcurementOperationsQueryDto) {
    const { node } = await this.scope(this.prisma, query.productId, query.treeNodeId, query.stockPlanId);
    const taskWhere: Prisma.ProcTaskWhereInput = { productId: query.productId, status: { not: 'pending_rd_review' }, ...(query.stockPlanId ? { OR: [{ stockPlanId: query.stockPlanId }, { stockPlanId: null }] } : {}), ...(query.treeNodeId ? { AND: [{ OR: [{ treeNodeId: query.treeNodeId }, ...(node?.materialId ? [{ treeNodeId: null, materialId: node.materialId }] : [])] }] } : {}) };
    const [plans, tasks, suppliers, reports] = await Promise.all([
      this.prisma.procStockPlan.findMany({ where: { productId: query.productId, ...(query.treeNodeId ? { treeNodeId: query.treeNodeId } : {}), ...(query.stockPlanId ? { id: query.stockPlanId } : {}) }, select: { id: true, code: true, unit: true, materialId: true }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.procTask.findMany({ where: taskWhere, select: { id: true, code: true, materialId: true, stockPlanId: true, unit: true }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.procSupplier.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.procProductionReport.findMany({ where: { productId: query.productId, ...(query.treeNodeId ? { treeNodeId: query.treeNodeId } : {}), ...(query.stockPlanId ? { stockPlanId: query.stockPlanId } : {}) }, select: { id: true, reportDate: true, shift: true, lineName: true, unit: true, stockPlanId: true, actualQty: true, goodQty: true }, orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }] }),
    ]);
    const materialIds = [...new Set([node?.materialId, ...plans.map((row) => row.materialId), ...tasks.map((row) => row.materialId)].filter((id): id is string => Boolean(id)))];
    const materials = await this.prisma.procMaterial.findMany({ where: { id: { in: materialIds } }, select: { id: true, name: true, unit: true }, orderBy: { name: 'asc' } });
    return { plans, tasks, materials, suppliers, productionReports: reports.map((row) => ({ ...row, reportDate: row.reportDate.toISOString().slice(0, 10), actualQty: number(row.actualQty), defectiveQty: rounded(number(row.actualQty) - number(row.goodQty)), goodQty: undefined })) };
  }

  async saveProductionReport(id: string | null, dto: SaveProductionReportDto, actor: ProcActor) {
    this.assertPermission(actor, 'proc-production:report');
    const productId = requiredText(dto.productId, '产品');
    const treeNodeId = requiredText(dto.treeNodeId, '子系统模块');
    const unit = requiredText(dto.unit, '数量单位');
    const data = { productId, treeNodeId, stockPlanId: optionalId(dto.stockPlanId), unit, reportDate: operationDay(dto.reportDate, '报工日期'), shift: requiredText(dto.shift, '班次'), lineName: requiredText(dto.lineName, '产线或工序'), plannedQty: decimal(dto.plannedQty, '计划产量'), actualQty: decimal(dto.actualQty, '实际产量'), goodQty: decimal(dto.goodQty, '良品数量'), workHours: decimal(dto.workHours, '投入工时', 2), capacityQty: dto.capacityQty == null ? null : decimal(dto.capacityQty, '本班产能'), note: optionalId(dto.note) };
    if (data.goodQty.greaterThan(data.actualQty)) throw new BadRequestException('良品数量不能超过实际产量');
    return this.write(async (db) => {
      const { node, plan } = await this.scope(db, productId, treeNodeId, data.stockPlanId);
      if (!node?.parentId) throw new BadRequestException('请在具体子系统模块中登记报工');
      if (plan && plan.unit !== unit) throw new BadRequestException('报工单位必须与关联备货计划一致');
      if (id) {
        const current = await db.procProductionReport.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('生产报工记录不存在');
        if (current.productId !== productId || current.treeNodeId !== treeNodeId) throw new BadRequestException('不能将报工记录移动到其他产品或模块');
        assertVersion(dto.baseUpdatedAt, current.updatedAt);
        const quality = await db.procQualityRecord.findMany({ where: { productionReportId: id } });
        if (quality.some((row) => row.unit !== unit || row.stockPlanId !== data.stockPlanId)) throw new BadRequestException('该报工已有不良记录，不能改变其单位或备货计划');
        const linkedDefective = quality.reduce((sum, row) => sum.plus(row.defectiveQty), new Prisma.Decimal(0));
        if (linkedDefective.greaterThan(data.actualQty.minus(data.goodQty))) throw new BadRequestException('报工不良数量不能小于已关联的不良记录合计');
        const linkedInspected = quality.reduce((sum, row) => sum.plus(row.inspectedQty), new Prisma.Decimal(0));
        if (linkedInspected.greaterThan(data.actualQty)) throw new BadRequestException('实际产量不能小于已关联不良记录的检验数量合计');
        const changed = await db.procProductionReport.updateMany({ where: { id, updatedAt: current.updatedAt }, data: { ...data, updatedBy: actor.id, updatedByName: actor.name } });
        if (changed.count !== 1) throw new ConflictException('记录已被更新，请刷新后重试');
        return this.productionView(await db.procProductionReport.findUniqueOrThrow({ where: { id }, include: productionInclude }));
      }
      return this.productionView(await db.procProductionReport.create({ data: { ...data, createdBy: actor.id, createdByName: actor.name }, include: productionInclude }));
    });
  }

  async saveQualityRecord(id: string | null, dto: SaveQualityRecordDto, actor: ProcActor) {
    this.assertPermission(actor, 'proc-quality:manage');
    const productId = requiredText(dto.productId, '产品');
    const treeNodeId = requiredText(dto.treeNodeId, '子系统模块');
    const unit = requiredText(dto.unit, '数量单位');
    if (!['procurement', 'production'].includes(dto.source)) throw new BadRequestException('不良来源无效');
    if (!['open', 'processing', 'closed'].includes(dto.status)) throw new BadRequestException('处理状态无效');
    if (!['pending', 'return', 'rework', 'scrap', 'concession', 'replacement'].includes(dto.disposition)) throw new BadRequestException('处置方式无效');
    const data = { productId, treeNodeId, unit, stockPlanId: optionalId(dto.stockPlanId), taskId: optionalId(dto.taskId), materialId: optionalId(dto.materialId), supplierId: optionalId(dto.supplierId), productionReportId: optionalId(dto.productionReportId), source: dto.source, batchNo: requiredText(dto.batchNo, '批次编号'), inspectionDate: operationDay(dto.inspectionDate, '检验日期'), inspectedQty: decimal(dto.inspectedQty, '检验数量', 3, true), defectiveQty: decimal(dto.defectiveQty, '不良数量', 3, true), issue: requiredText(dto.issue, '不良现象'), disposition: dto.disposition, status: dto.status, resolution: optionalId(dto.resolution) };
    if (data.defectiveQty.greaterThan(data.inspectedQty)) throw new BadRequestException('不良数量不能超过检验数量');
    if (data.status === 'closed' && (!data.resolution || data.disposition === 'pending')) throw new BadRequestException('关闭前请选择处置方式并填写处理结果');
    if (data.productionReportId && data.source !== 'production') throw new BadRequestException('只有生产不良可以关联生产报工');
    return this.write(async (db) => {
      const { node, plan } = await this.scope(db, productId, treeNodeId, data.stockPlanId);
      if (!node?.parentId) throw new BadRequestException('请在具体子系统模块中登记不良');
      if (plan && plan.unit !== unit) throw new BadRequestException('不良数量单位必须与关联备货计划一致');
      const task = data.taskId ? await db.procTask.findUnique({ where: { id: data.taskId } }) : null;
      if (data.taskId && (!task || task.productId !== productId || (task.treeNodeId ? task.treeNodeId !== treeNodeId : !node.materialId || task.materialId !== node.materialId))) throw new BadRequestException('采购任务不属于当前产品或模块');
      if (task?.status === 'pending_rd_review') throw new BadRequestException('该任务尚未进入采购流程，不能登记采购不良');
      if (task?.stockPlanId && task.stockPlanId !== data.stockPlanId) throw new BadRequestException('所选采购任务归属另一备货计划，请选择该任务对应的计划');
      if (task && task.unit !== unit) throw new BadRequestException('不良数量单位必须与关联采购任务一致');
      if (plan?.materialId && task?.materialId && plan.materialId !== task.materialId) throw new BadRequestException('采购任务与备货计划的物料不一致');
      if (data.materialId) {
        const material = await db.procMaterial.findUnique({ where: { id: data.materialId } });
        if (!material || ![node.materialId, plan?.materialId, task?.materialId].includes(material.id)) throw new BadRequestException('物料未关联到当前模块、备货计划或采购任务');
        if (material.unit && material.unit !== unit) throw new BadRequestException('不良数量单位必须与物料一致');
        if ((plan?.materialId && plan.materialId !== material.id) || (task?.materialId && task.materialId !== material.id)) throw new BadRequestException('所选物料与关联计划或采购任务不一致');
      }
      if (data.supplierId && !await db.procSupplier.findUnique({ where: { id: data.supplierId }, select: { id: true } })) throw new BadRequestException('供应商不存在');
      const duplicate = await db.procQualityRecord.findFirst({ where: { productId, treeNodeId, source: data.source, batchNo: data.batchNo, inspectionDate: data.inspectionDate, unit, productionReportId: data.productionReportId, ...(id ? { id: { not: id } } : {}) }, select: { id: true } });
      if (duplicate) throw new ConflictException('该批次当天已有同类不良记录，请编辑现有记录；分批检验请填写不同的子批次编号');
      if (data.productionReportId) {
        const report = await db.procProductionReport.findUnique({ where: { id: data.productionReportId } });
        if (!report || report.productId !== productId || report.treeNodeId !== treeNodeId || report.stockPlanId !== data.stockPlanId || report.unit !== unit) throw new BadRequestException('关联报工与当前产品、模块、计划或单位不一致');
        if (data.inspectedQty.greaterThan(report.actualQty)) throw new BadRequestException('检验数量不能超过关联报工的实际产量');
        const linked = await db.procQualityRecord.findMany({ where: { productionReportId: report.id, ...(id ? { id: { not: id } } : {}) }, select: { defectiveQty: true, inspectedQty: true } });
        const total = linked.reduce((sum, row) => sum.plus(row.defectiveQty), data.defectiveQty);
        if (total.greaterThan(report.actualQty.minus(report.goodQty))) throw new BadRequestException('累计登记不良数量超过报工不良数量，请核对是否重复登记');
        const inspected = linked.reduce((sum, row) => sum.plus(row.inspectedQty), data.inspectedQty);
        if (inspected.greaterThan(report.actualQty)) throw new BadRequestException('关联同一报工的检验数量合计不能超过实际产量，请按互不重叠的子批次登记');
      }
      if (id) {
        const current = await db.procQualityRecord.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('不良记录不存在');
        if (current.productId !== productId || current.treeNodeId !== treeNodeId) throw new BadRequestException('不能将不良记录移动到其他产品或模块');
        assertVersion(dto.baseUpdatedAt, current.updatedAt);
        const changed = await db.procQualityRecord.updateMany({ where: { id, updatedAt: current.updatedAt }, data: { ...data, resolvedAt: data.status === 'closed' ? current.resolvedAt ?? new Date() : null, updatedBy: actor.id, updatedByName: actor.name } });
        if (changed.count !== 1) throw new ConflictException('记录已被更新，请刷新后重试');
        return this.qualityView(await db.procQualityRecord.findUniqueOrThrow({ where: { id }, include: qualityInclude }));
      }
      return this.qualityView(await db.procQualityRecord.create({ data: { ...data, resolvedAt: data.status === 'closed' ? new Date() : null, createdBy: actor.id, createdByName: actor.name }, include: qualityInclude }));
    });
  }

  /** Serializable 保护报工与不良合计约束，避免并发重复登记超过报工不良数。 */
  private async write<T>(action: (db: Db) => Promise<T>): Promise<T> {
    try { return await this.prisma.$transaction(action, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2025'].includes(error.code)) throw new ConflictException('记录正在被其他人更新，请刷新后重试');
      throw error;
    }
  }

  private productionView(row: ProductionRow) {
    return { ...row, treeNode: undefined, stockPlan: undefined, treeNodeName: row.treeNode.name, stockPlanCode: row.stockPlan?.code ?? null, reportDate: row.reportDate.toISOString().slice(0, 10), plannedQty: number(row.plannedQty), actualQty: number(row.actualQty), goodQty: number(row.goodQty), defectiveQty: rounded(number(row.actualQty) - number(row.goodQty)), workHours: number(row.workHours), capacityQty: row.capacityQty === null ? null : number(row.capacityQty), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  private qualityView(row: QualityRow) {
    return { ...row, treeNode: undefined, stockPlan: undefined, material: undefined, supplier: undefined, task: undefined, treeNodeName: row.treeNode.name, stockPlanCode: row.stockPlan?.code ?? null, materialName: row.material?.name ?? null, supplierName: row.supplier?.name ?? null, taskCode: row.task?.code ?? null, inspectionDate: row.inspectionDate.toISOString().slice(0, 10), inspectedQty: number(row.inspectedQty), defectiveQty: number(row.defectiveQty), defectRate: rate(number(row.defectiveQty), number(row.inspectedQty)), resolvedAt: row.resolvedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }
}
