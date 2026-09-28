import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { OssService } from '../oss/oss.service';
import { assertQualityRead, emptyQualityAnalysis, QUALITY_ANALYSIS_PREFIX, QUALITY_CAUSES, QUALITY_SOURCES, qualityFiles, qualityPhenomena, qualityText, type QualityAnalysis } from './quality-analysis';
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
  constructor(private readonly prisma: PrismaService, @Optional() private readonly oss?: OssService) {}


  async qualityAnalysis(id: string, actor: ProcActor) {
    const record = await assertQualityRead(this.prisma, id, actor);
    const stored = await this.prisma.runtimeState.findUnique({ where: { key: QUALITY_ANALYSIS_PREFIX + id } });
    const analysis = stored ? JSON.parse(stored.value) as QualityAnalysis : emptyQualityAnalysis();
    const canManage = actor.permissions.includes('*') || actor.permissions.includes('proc-quality:manage');
    const [people, suppliers, source] = await Promise.all([
      canManage ? this.prisma.user.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true }, orderBy: { name: 'asc' } }) : [],
      canManage ? this.prisma.procSupplier.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }) : [],
      this.prisma.runtimeState.findUnique({ where: { key: `procurement:execution:v1:quality:${id}` } }),
    ]);
    const productionSource = source ? JSON.parse(source.value) : null;
    const collaboration = await this.prisma.runtimeState.findUnique({ where: { key: `procurement:execution:v1:collaboration:${id}` } });
    const storedPlan = productionSource ? await this.prisma.runtimeState.findUnique({ where: { key: `procurement:execution:v1:plan:${productionSource.planId}` } }) : null;
    if (productionSource && storedPlan) productionSource.planVersion = JSON.parse(storedPlan.value).version;
    const warehouse = productionSource?.fieldIssueId ? await this.prisma.runtimeState.findUnique({ where: { key: `procurement:warehouse-flow:v1:issue:${productionSource.taskId}` } }) : null;
    const received = warehouse ? (JSON.parse(warehouse.value).lines as Array<{ code: string; name: string; signedQty?: number; signedBatches?: { batchNo: string; quantity: number }[] }>).filter(row => (row.signedQty ?? 0) > 0) : [];
    return { record: { ...this.qualityView(record), collaboration: collaboration ? JSON.parse(collaboration.value) : null }, analysis, people, suppliers, productionSource, receivedBatches: received.map(row => ({ code: row.code, name: row.name, batches: row.signedBatches ?? [] })) };
  }

  async qualityAttachment(id: string, fileId: string, actor: ProcActor) {
    await assertQualityRead(this.prisma, id, actor);
    const stored = await this.prisma.runtimeState.findUnique({ where: { key: QUALITY_ANALYSIS_PREFIX + id } });
    const analysis = stored ? JSON.parse(stored.value) as QualityAnalysis : emptyQualityAnalysis();
    if (!analysis.files.some(row => row.fileId === fileId)) throw new NotFoundException('该附件不属于此质量异常');
    const asset = await this.prisma.fileAsset.findFirst({ where: { id: fileId, status: 'active' } });
    if (!asset) throw new NotFoundException('附件已删除或不存在');
    const url = this.oss?.getReadUrl(asset.objectKey, 600)?.url;
    if (!url) throw new BadRequestException('附件暂时无法打开，请稍后重试');
    return { id: fileId, name: asset.fileName, mime: asset.mimeType, size: asset.fileSize, url, previewUrl: url, downloadUrl: url };
  }

  async saveQualityAnalysis(id: string, input: { requestId: string; version: number; baseUpdatedAt: string; action: string; data: Record<string, unknown> }, actor: ProcActor) {
    this.assertPermission(actor, 'proc-quality:manage');
    if (!input || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId) || !Number.isSafeInteger(input.version) || input.version < 0 || !['save', 'confirm'].includes(input.action)) throw new BadRequestException('质量分析提交标识或版本无效');
    const data = input.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BadRequestException('质量分析内容无效');
    const fingerprint = createHash('sha256').update(JSON.stringify([id, actor.id, input])).digest('hex');
    return this.write(async db => {
      const record = await assertQualityRead(db, id, actor);
      const requestKey = `${QUALITY_ANALYSIS_PREFIX}request:${input.requestId}`;
      const previousRequest = await db.runtimeState.findUnique({ where: { key: requestKey } });
      if (previousRequest) {
        if (previousRequest.value !== fingerprint) throw new ConflictException('提交标识已用于其他内容');
        return { id };
      }
      if (record.status === 'closed') throw new ConflictException('已关闭异常不能改写原因，请先按原流程重新打开');
      assertVersion(input.baseUpdatedAt, record.updatedAt);
      const key = QUALITY_ANALYSIS_PREFIX + id, stored = await db.runtimeState.findUnique({ where: { key } });
      const current = stored ? JSON.parse(stored.value) as QualityAnalysis : emptyQualityAnalysis();
      if (current.version !== input.version) throw new ConflictException('质量分析已更新，请保留草稿并重新核对');
      if (!QUALITY_CAUSES.includes(data.category as any)) throw new BadRequestException('主因类别无效');
      const detail = qualityText(data.detail, '原因说明', 4000, true), evidence = qualityText(data.evidence, '原因依据', 4000, true);
      const reason = qualityText(data.reason, '修改或确认依据');
      const disposition = data.disposition === undefined ? record.disposition : qualityText(data.disposition, '处置方式', 30);
      if (!['pending', 'return', 'rework', 'scrap', 'concession', 'replacement'].includes(disposition)) throw new BadRequestException('处置方式无效');
      const resolution = data.resolution === undefined ? record.resolution : qualityText(data.resolution, '处置结果', 4000, true) || null;
      if (disposition !== 'pending' && !resolution) throw new BadRequestException('请填写处置结果');
      const raw = data.responsibility as Record<string, unknown> | undefined;
      if (!raw || !['unknown', 'internal', 'supplier', 'other'].includes(String(raw.kind))) throw new BadRequestException('责任类型无效');
      let responsibility: QualityAnalysis['responsibility'] = { kind: raw.kind as QualityAnalysis['responsibility']['kind'], name: '' };
      if (raw.kind === 'internal') {
        const user = await db.user.findFirst({ where: { id: qualityText(raw.id, '责任人'), status: 'ACTIVE' }, select: { id: true, name: true } });
        if (!user) throw new BadRequestException('责任人不存在或已停用');
        responsibility = { kind: 'internal', id: user.id, name: user.name };
      } else if (raw.kind === 'supplier') {
        const supplier = await db.procSupplier.findUnique({ where: { id: qualityText(raw.id, '责任供应商') }, select: { id: true, name: true } });
        if (!supplier) throw new BadRequestException('责任供应商不存在');
        responsibility = { kind: 'supplier', id: supplier.id, name: supplier.name };
      } else if (raw.kind === 'other') responsibility.name = qualityText(raw.name, '责任主体', 200);
      const phenomena = qualityPhenomena(data.phenomena);
      const files = await qualityFiles(db, data.fileIds, actor, current.files);
      let materialBatches = current.materialBatches;
      if (data.materialBatches !== undefined) {
        const source = await db.runtimeState.findUnique({ where: { key: `procurement:execution:v1:quality:${id}` } });
        const link = source ? JSON.parse(source.value) : null;
        if (!link?.fieldIssueId) throw new BadRequestException('此异常没有现场实领批次来源');
        const warehouse = await db.runtimeState.findUnique({ where: { key: `procurement:warehouse-flow:v1:issue:${link.taskId}` } });
        const received: { code: string; signedQty?: number; signedBatches?: { batchNo: string; quantity: number }[] }[] = warehouse ? JSON.parse(warehouse.value).lines : [];
        if (!Array.isArray(data.materialBatches) || data.materialBatches.length > 2000) throw new BadRequestException('实际物料批次无效');
        const seen = new Set<string>();
        materialBatches = data.materialBatches.map((row: any) => {
          const code = qualityText(row?.code, '实领物料编码', 200), batchNo = row.batchNo ? qualityText(row.batchNo, '实领批号', 120) : null;
          const line = received.find(item => item.code === code);
          if (!line || !(line.signedQty! > 0) || (batchNo && !line.signedBatches?.some(item => item.batchNo === batchNo && item.quantity > 0))) throw new BadRequestException('批号必须来自此作业已签收记录，未知批号请保留待补');
          const identity = JSON.stringify([code, batchNo]); if (seen.has(identity)) throw new BadRequestException('实领批次不能重复'); seen.add(identity);
          return { code, batchNo };
        });
      }
      if (!Array.isArray(data.references) || data.references.length > 30) throw new BadRequestException('来源反馈最多 30 条');
      const references = data.references.map((row: any) => {
        if (!QUALITY_SOURCES.includes(row?.source)) throw new BadRequestException('反馈来源无效');
        return { source: row.source, reference: qualityText(row.reference, '来源单号或记录', 200), note: qualityText(row.note, '来源反馈', 2000) };
      });
      if (input.action === 'confirm' && (data.category === 'unknown' || !detail || !evidence || responsibility.kind === 'unknown' || !phenomena.length)) throw new BadRequestException('确认主因须填写原因、责任认定、依据及现象次数；未知项请先保存待分析');
      const at = new Date().toISOString();
      const snapshot: Omit<QualityAnalysis, 'history'> = { version: current.version + 1, state: input.action === 'confirm' ? 'confirmed' : 'pending', category: data.category as QualityAnalysis['category'], detail, evidence, responsibility, phenomena, files, references, ...(materialBatches ? { materialBatches } : {}),
        ...(input.action === 'confirm' ? { confirmedBy: actor.id, confirmedByName: actor.name, confirmedAt: at } : {}) };
      const next: QualityAnalysis = { ...snapshot, history: [...current.history, { actorId: actor.id, actorName: actor.name, at, action: input.action, reason, snapshot }] };
      if (stored) {
        const changed = await db.runtimeState.updateMany({ where: { key, value: stored.value }, data: { value: JSON.stringify(next) } });
        if (changed.count !== 1) throw new ConflictException('质量分析已更新，请重新核对');
      } else await db.runtimeState.create({ data: { key, value: JSON.stringify(next) } });
      const changedRecord = await db.procQualityRecord.updateMany({ where: { id, updatedAt: record.updatedAt }, data: { disposition, resolution, ...(disposition !== 'pending' ? { status: 'processing' } : {}), updatedBy: actor.id, updatedByName: actor.name } });
      if (changedRecord.count !== 1) throw new ConflictException('原异常已更新，请重新核对');
      await db.runtimeState.create({ data: { key: requestKey, value: fingerprint } });
      await db.auditLog.create({ data: { module: 'procurement', source: 'web', action: `quality.analysis.${input.action}`, resource: 'proc-quality-record', resourceId: id, userId: actor.id, actorName: actor.name, summary: input.action === 'confirm' ? '确认质量主因与责任' : '保存质量分析', meta: JSON.parse(JSON.stringify({ before: current, after: next })) as Prisma.InputJsonValue } });
      return { id };
    });
  }

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
    const analysisRows = quality.length ? await this.prisma.runtimeState.findMany({ where: { key: { in: quality.map(row => QUALITY_ANALYSIS_PREFIX + row.id) } } }) : [];
    const analyses = new Map(analysisRows.map(row => [row.key, JSON.parse(row.value) as QualityAnalysis]));
    const qualityRecords = quality.map(row => ({ ...this.qualityView(row), analysis: analyses.get(QUALITY_ANALYSIS_PREFIX + row.id) ?? null }));
    const units = [...new Set(productionReports.map((row) => row.unit))];
    const productionSummary = units.map((unit) => {
      const rows = productionReports.filter((row) => row.unit === unit);
      const sum = (key: 'plannedQty' | 'actualQty' | 'goodQty' | 'defectiveQty' | 'workHours') => rounded(rows.reduce((n, row) => n + row[key], 0));
      const capacityRecorded = rows.filter((row) => row.capacityQty !== null).length;
      const capacityQty = capacityRecorded === rows.length ? rounded(rows.reduce((n, row) => n + (row.capacityQty ?? 0), 0)) : null;
      return { unit, reports: rows.length, plannedQty: sum('plannedQty'), actualQty: sum('actualQty'), goodQty: sum('goodQty'), defectiveQty: sum('defectiveQty'), workHours: sum('workHours'), capacityQty, capacityRecorded, attainmentRate: rate(sum('actualQty'), sum('plannedQty')), yieldRate: rate(sum('goodQty'), sum('actualQty')), capacityUtilization: capacityQty === null ? null : rate(sum('actualQty'), capacityQty) };
    });
    const qualitySummary = QUALITY_SOURCES.flatMap((source) => [...new Set(qualityRecords.filter((row) => row.source === source).map((row) => row.unit))].map((unit) => {
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
    if (!QUALITY_SOURCES.includes(dto.source)) throw new BadRequestException('不良来源无效');
    if (!['open', 'processing', 'closed'].includes(dto.status)) throw new BadRequestException('处理状态无效');
    if (!['pending', 'return', 'rework', 'scrap', 'concession', 'replacement'].includes(dto.disposition)) throw new BadRequestException('处置方式无效');
    const data = { productId, treeNodeId, unit, stockPlanId: optionalId(dto.stockPlanId), taskId: optionalId(dto.taskId), materialId: optionalId(dto.materialId), supplierId: optionalId(dto.supplierId), productionReportId: optionalId(dto.productionReportId), source: dto.source, batchNo: requiredText(dto.batchNo, '批次编号'), inspectionDate: operationDay(dto.inspectionDate, '检验日期'), inspectedQty: decimal(dto.inspectedQty, '检验数量', 3, true), defectiveQty: decimal(dto.defectiveQty, '不良数量', 3, true), issue: requiredText(dto.issue, '不良现象'), disposition: dto.disposition, status: dto.status, resolution: optionalId(dto.resolution) };
    if (data.defectiveQty.greaterThan(data.inspectedQty)) throw new BadRequestException('不良数量不能超过检验数量');
    if (data.status === 'closed') throw new BadRequestException('关闭前必须由授权验证人通过独立复验，不能直接修改为已关闭');
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
        if (current.status === 'closed') throw new ConflictException('已关闭记录不能直接修改，请先由验证人填写原因重新打开');
        const executionSource = await db.runtimeState.findUnique({ where: { key: `procurement:execution:v1:quality:${id}` } });
        const receiptSource = await db.runtimeState.findUnique({ where: { key: `procurement:receipt-quality-record:v1:${id}` } });
        const analysisSource = await db.runtimeState.findUnique({ where: { key: QUALITY_ANALYSIS_PREFIX + id } });
        if (executionSource || receiptSource || analysisSource) {
          const identity = (row: typeof current | typeof data) => JSON.stringify([row.productId, row.treeNodeId, row.stockPlanId ?? null, row.taskId ?? null, row.materialId ?? null, row.supplierId ?? null, row.productionReportId ?? null, row.source, row.batchNo, row.inspectionDate.toISOString(), row.unit, row.inspectedQty.toString(), row.defectiveQty.toString()]);
          if (identity(current) !== identity(data)) throw new BadRequestException('原异常的来源、批次和检验数量已固定，不可改写；请在原记录补充分析、处置及复验');
        }
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
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2025', 'P2002'].includes(error.code)) throw new ConflictException('记录正在被其他人更新，请刷新后重试');
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
