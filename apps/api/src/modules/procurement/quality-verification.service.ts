import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { operationDay } from './procurement-operations.service';
import type { ProcActor } from './procurement.types';
import type { ReopenQualityRecordDto, VerifyQualityRecordDto } from './dto/procurement-operations.dto';

const PREFIX = 'procurement:quality-verification:v1:';
export interface QualityVerificationEntry {
  kind: 'verification' | 'reopen'; requestId: string; recordId: string;
  actorId: string; actorName: string; recordedAt: string; sourceVersion: string;
  verificationDate: string | null; inspectedQty: number | null; passedQty: number | null;
  evidence: string; closed: boolean; fingerprint: string;
  scope?: 'remaining' | 'all'; effectivePassedQty?: number;
  source: { batchNo: string; unit: string; defectiveQty: string; disposition: string; resolution: string | null };
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function effectiveVerificationQuantity(entry: QualityVerificationEntry | undefined, record: { disposition: string; resolution: string | null; defectiveQty: { toString(): string } }): number {
  if (entry?.kind !== 'verification' || entry.source.disposition !== record.disposition || entry.source.resolution !== record.resolution || entry.source.defectiveQty !== record.defectiveQty.toString()) return 0;
  return entry.effectivePassedQty ?? entry.passedQty ?? 0;
}
const text = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 4000) throw new BadRequestException(`请填写有效的${label}`);
  return value.trim();
};
function quantity(value: number, positive: boolean) {
  if (!Number.isFinite(value) || value < 0 || (positive && value === 0)) throw new BadRequestException('复验数量无效');
  const decimal = new Prisma.Decimal(value);
  if (decimal.decimalPlaces() > 3 || decimal.greaterThan('99999999999.999')) throw new BadRequestException('复验数量精度或范围无效');
  return decimal;
}

@Injectable()
export class QualityVerificationService {
  constructor(private readonly prisma: PrismaService) {}

  private permission(actor: ProcActor, write: boolean) {
    const allowed = write ? ['proc-quality:verify'] : ['proc-quality:verify', 'proc-quality:manage', 'page:proc-cockpit', 'page:rd-director-dashboard', 'page:production-execution'];
    if (!actor.id || (!actor.permissions.includes('*') && !allowed.some((key) => actor.permissions.includes(key)))) {
      throw new ForbiddenException(write ? '需要质量验证权限' : '没有查看质量记录的权限');
    }
  }

  async history(id: string, actor: ProcActor) {
    this.permission(actor, false);
    const record = await this.prisma.procQualityRecord.findUnique({ where: { id }, select: { id: true } });
    if (!record) throw new NotFoundException('不良记录不存在');
    const broadRead = ['*', 'proc-quality:verify', 'proc-quality:manage', 'page:proc-cockpit', 'page:rd-director-dashboard', 'production:plan', 'production:inspect', 'production:view-all'].some((permission) => actor.permissions.includes(permission));
    if (!broadRead) {
      const source = await this.prisma.runtimeState.findUnique({ where: { key: `procurement:execution:v1:quality:${id}` } });
      if (!source) throw new NotFoundException('不良记录不存在或不属于您的作业');
      const link = JSON.parse(source.value) as { planId: string; taskId: string };
      const [storedPlan, collaboration] = await Promise.all([
        this.prisma.runtimeState.findUnique({ where: { key: `procurement:execution:v1:plan:${link.planId}` } }),
        this.prisma.runtimeState.findUnique({ where: { key: `procurement:execution:v1:collaboration:${id}` } }),
      ]);
      const task = storedPlan ? (JSON.parse(storedPlan.value) as { tasks: Array<{ id: string; ownerId: string }> }).tasks.find((row) => row.id === link.taskId) : null;
      const assignment = collaboration ? JSON.parse(collaboration.value) as { ownerId: string; originatorId: string } : null;
      if (task?.ownerId !== actor.id && assignment?.ownerId !== actor.id && assignment?.originatorId !== actor.id) throw new NotFoundException('不良记录不存在或不属于您的作业');
    }
    const rows = await this.prisma.runtimeState.findMany({ where: { key: { startsWith: `${PREFIX}${id}:` } }, orderBy: { updatedAt: 'desc' } });
    return rows.map((row) => {
      const { fingerprint: _fingerprint, ...entry } = JSON.parse(row.value) as QualityVerificationEntry;
      return entry;
    });
  }

  async verify(id: string, input: VerifyQualityRecordDto, actor: ProcActor) {
    this.permission(actor, true);
    const scope = input.scope ?? 'all';
    if (!['remaining', 'all'].includes(scope)) throw new BadRequestException('复验范围无效');
    const date = operationDay(input.verificationDate, '复验日期');
    if (input.verificationDate > new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)) throw new BadRequestException('复验日期不能晚于今天');
    const inspected = quantity(input.inspectedQty, true), passed = quantity(input.passedQty, false);
    if (passed.greaterThan(inspected)) throw new BadRequestException('验证通过数量不能超过复验数量');
    const evidence = text(input.evidence, '复验依据与结论');
    return this.write(id, input.requestId, input.baseUpdatedAt, actor, 'verification',
      [input.verificationDate, inspected.toString(), passed.toString(), evidence, scope], async (record, db) => {
        if (record.status === 'closed') throw new ConflictException('记录已关闭，请重新读取');
        if (record.disposition === 'pending' || !record.resolution?.trim()) throw new BadRequestException('请先保存处置方式和处理结果，再提交复验');
        if (date < record.inspectionDate) throw new BadRequestException('复验日期不能早于原检验日期');
        if (inspected.greaterThan(record.defectiveQty)) throw new BadRequestException('复验数量不能超过原不良数量');
        const rows = await db.runtimeState.findMany({ where: { key: { startsWith: `${PREFIX}${id}:` } }, orderBy: { updatedAt: 'desc' } });
        const previous = rows.length ? JSON.parse(rows[0].value) as QualityVerificationEntry : undefined;
        const accepted = new Prisma.Decimal(scope === 'remaining' ? effectiveVerificationQuantity(previous, record) : 0);
        if (scope === 'remaining' && inspected.gt(record.defectiveQty.minus(accepted))) throw new BadRequestException('本轮只能复验尚未通过的数量，已通过实物不得重复计入');
        const effectivePassedQty = accepted.plus(passed).toNumber();
        return { verificationDate: input.verificationDate, inspectedQty: input.inspectedQty, passedQty: input.passedQty,
          evidence, scope, effectivePassedQty, closed: new Prisma.Decimal(effectivePassedQty).equals(record.defectiveQty) };
      });
  }

  async reopen(id: string, input: ReopenQualityRecordDto, actor: ProcActor) {
    this.permission(actor, true);
    const reason = text(input.reason, '重新打开原因');
    return this.write(id, input.requestId, input.baseUpdatedAt, actor, 'reopen', [reason], (record) => {
      if (record.status !== 'closed') throw new ConflictException('记录尚未关闭，请重新读取');
      return { verificationDate: null, inspectedQty: null, passedQty: null, evidence: reason, closed: false };
    });
  }

  private async write(id: string, requestId: string, sourceVersion: string, actor: ProcActor,
    kind: QualityVerificationEntry['kind'], values: unknown[], validate: (record: Prisma.ProcQualityRecordGetPayload<{}>, db: Prisma.TransactionClient) => Pick<QualityVerificationEntry, 'verificationDate' | 'inspectedQty' | 'passedQty' | 'evidence' | 'closed' | 'scope' | 'effectivePassedQty'> | Promise<Pick<QualityVerificationEntry, 'verificationDate' | 'inspectedQty' | 'passedQty' | 'evidence' | 'closed' | 'scope' | 'effectivePassedQty'>>) {
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) throw new BadRequestException('提交标识无效');
    if (typeof sourceVersion !== 'string' || !Number.isFinite(Date.parse(sourceVersion))) throw new BadRequestException('记录版本无效，请重新读取');
    const key = `${PREFIX}${id}:${requestId}`, fingerprint = hash([id, actor.id, kind, sourceVersion, values]);
    try {
      return await this.prisma.$transaction(async (db) => {
        const record = await db.procQualityRecord.findUnique({ where: { id } });
        if (!record) throw new NotFoundException('不良记录不存在');
        const previous = await db.runtimeState.findUnique({ where: { key } });
        if (previous) {
          const saved = JSON.parse(previous.value) as QualityVerificationEntry;
          if (saved.fingerprint !== fingerprint) throw new ConflictException('提交标识已用于其他内容，请重新打开表单');
          return { status: record.status, updatedAt: record.updatedAt.toISOString(), closed: saved.closed };
        }
        if (record.updatedAt.toISOString() !== sourceVersion) throw new ConflictException('处置记录已更新，请保留填写内容并重新核对');
        const collaboration = kind === 'verification' ? await db.runtimeState.findUnique({ where: { key: `procurement:execution:v1:collaboration:${id}` } }) : null;
        if (collaboration && JSON.parse(collaboration.value).phase === 'waiting_reply') throw new ConflictException('协同处理人尚未回复，请先收回处理结果再验证');
        const result = await validate(record, db), now = new Date();
        const entry: QualityVerificationEntry = { kind, requestId, recordId: id, actorId: actor.id, actorName: actor.name,
          recordedAt: now.toISOString(), sourceVersion, fingerprint, ...result,
          source: { batchNo: record.batchNo, unit: record.unit, defectiveQty: record.defectiveQty.toString(), disposition: record.disposition, resolution: record.resolution } };
        const changed = await db.procQualityRecord.updateMany({ where: { id, updatedAt: record.updatedAt },
          data: { status: result.closed ? 'closed' : 'processing', resolvedAt: result.closed ? now : null, updatedBy: actor.id, updatedByName: actor.name } });
        if (changed.count !== 1) throw new ConflictException('处置记录已更新，请重新核对');
        await db.runtimeState.create({ data: { key, value: JSON.stringify(entry) } });
        await db.auditLog.create({ data: { module: 'procurement', source: 'web', action: `quality.${kind}`, resource: 'proc-quality-record', resourceId: id,
          userId: actor.id, actorName: actor.name, summary: kind === 'reopen' ? '重新打开质量异常' : result.closed ? '复验通过并关闭质量异常' : '复验未完整通过，继续处理',
          meta: JSON.parse(JSON.stringify(entry)) as Prisma.InputJsonValue } });
        const updated = await db.procQualityRecord.findUniqueOrThrow({ where: { id } });
        return { status: updated.status, updatedAt: updated.updatedAt.toISOString(), closed: result.closed };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002', 'P2025'].includes(error.code)) throw new ConflictException('记录正在更新，请保留填写内容后重试');
      throw error;
    }
  }
}
