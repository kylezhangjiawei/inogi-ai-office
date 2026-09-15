import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CandidateFilterTask, CandidateFilterTaskBatch, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

export const CANDIDATE_FILTER_LEASE_MS = 120_000;
export const CANDIDATE_FILTER_HEARTBEAT_MS = 20_000;
export const CANDIDATE_FILTER_TASK_CONCURRENCY = 2;
export const CANDIDATE_FILTER_MAX_CLAIMS = 3;

export type CandidateFilterClaim = { id: string; claimToken: string };
export type CandidateFilterTaskRecord = CandidateFilterTask & { batches: CandidateFilterTaskBatch[] };
export type CandidateFilterPhase = 'queued' | 'preparing' | 'analyzing' | 'scoring' | 'saving' | 'complete' | 'failed';

export class CandidateFilterLeaseLostError extends Error {
  constructor() { super('筛选任务执行权已转移，当前工作进程已停止保存'); this.name = 'CandidateFilterLeaseLostError'; }
}

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const includeBatches = { batches: { orderBy: { batchIndex: 'asc' as const } } };
const activeStatuses = ['pending', 'processing'];
const metadataSelect = {
  id: true, userId: true, activeUserId: true, fingerprint: true, status: true, phase: true,
  payloadJson: true, totalCount: true, processedCount: true, resultJson: true, error: true,
  claimToken: true, leaseUntil: true, attempts: true, createdAt: true, updatedAt: true, completedAt: true,
} satisfies Prisma.CandidateFilterTaskSelect;
type TaskMetadata = Prisma.CandidateFilterTaskGetPayload<{ select: typeof metadataSelect }>;
const metadataRecord = (task: TaskMetadata): CandidateFilterTaskRecord => ({ ...task, snapshotJson: null, analysisJson: null, batches: [] });
type CheckpointUpdate = {
  phase: CandidateFilterPhase;
  snapshotJson?: Prisma.InputJsonValue;
  analysisJson?: Prisma.InputJsonValue;
  totalCount?: number;
  processedIncrement?: number;
};

function completionJson(value: unknown): Prisma.InputJsonValue {
  if (!value || typeof value !== 'object') throw new BadRequestException('模型完成结果无效');
  const record = value as Record<string, unknown>;
  if (typeof record.content !== 'string' || typeof record.modelName !== 'string' || !record.usage || typeof record.usage !== 'object') throw new BadRequestException('模型完成结果无效');
  const usage = record.usage as Record<string, unknown>;
  const tokenCount = (key: string) => {
    const count = usage[key];
    if (count === null || count === undefined) return null;
    if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) throw new BadRequestException('模型用量无效');
    return count;
  };
  // 强制字段白名单，避免将调用方临时持有的模型连接/API key 一起存入数据库。
  return { content: record.content, modelName: record.modelName, usage: {
    inputTokens: tokenCount('inputTokens'), outputTokens: tokenCount('outputTokens'), totalTokens: tokenCount('totalTokens'),
  } };
}

/** 所有协调只使用短数据库事务；模型请求必须在事务外执行。 */
@Injectable()
export class CandidateFilterTaskStore {
  constructor(private readonly prisma: PrismaService) {}

  private queueTransaction<T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('resume-screening:candidate-filter-queue'))`;
      return run(tx);
    });
  }

  private owned(tx: Prisma.TransactionClient, id: string, userId: string) {
    return tx.candidateFilterTask.findFirst({ where: { id, userId }, select: metadataSelect }).then((task) => {
      if (!task) throw new NotFoundException('筛选任务不存在');
      return metadataRecord(task);
    });
  }

  async create(userId: string, fingerprint: string, payload: unknown, initial?: { snapshot: unknown; totalCount: number }): Promise<CandidateFilterTaskRecord> {
    if (initial && (!Number.isSafeInteger(initial.totalCount) || initial.totalCount < 0)) throw new BadRequestException('候选人数无效');
    return this.queueTransaction(async (tx) => {
      const active = await tx.candidateFilterTask.findUnique({ where: { activeUserId: userId }, select: metadataSelect });
      if (active) {
        if (active.fingerprint === fingerprint) return metadataRecord(active);
        throw new ConflictException('已有筛选任务正在进行，请等待完成后再提交其他条件');
      }
      return metadataRecord(await tx.candidateFilterTask.create({ data: {
        userId, activeUserId: userId, fingerprint, payloadJson: json(payload),
        ...(initial ? { snapshotJson: json(initial.snapshot), totalCount: initial.totalCount } : {}),
      }, select: metadataSelect }));
    });
  }

  /** 轮询只读元数据；完整快照、分析与成功批次仅在领取执行权时读取。 */
  getOwned(id: string, userId: string): Promise<CandidateFilterTaskRecord> { return this.owned(this.prisma, id, userId); }

  getCurrent(userId: string): Promise<CandidateFilterTaskRecord | null> {
    return this.prisma.candidateFilterTask.findFirst({ where: { userId, status: { in: activeStatuses } }, orderBy: { createdAt: 'desc' }, select: metadataSelect }).then((task) => task ? metadataRecord(task) : null);
  }

  latest(userId: string): Promise<CandidateFilterTaskRecord | null> {
    return this.prisma.candidateFilterTask.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' }, select: metadataSelect }).then((task) => task ? metadataRecord(task) : null);
  }

  retry(id: string, userId: string): Promise<CandidateFilterTaskRecord> {
    return this.queueTransaction(async (tx) => {
      const task = await this.owned(tx, id, userId);
      const active = await tx.candidateFilterTask.findUnique({ where: { activeUserId: userId }, select: metadataSelect });
      if (active?.id === id) return metadataRecord(active);
      if (active) throw new ConflictException('已有筛选任务正在进行，请等待完成后再重试');
      if (task.status !== 'failed') throw new BadRequestException('只有失败的筛选任务可以重试');
      return metadataRecord(await tx.candidateFilterTask.update({ where: { id }, data: {
        status: 'pending', phase: 'queued', activeUserId: userId, error: null, completedAt: null,
        claimToken: null, leaseUntil: null, attempts: 0,
      }, select: metadataSelect }));
    });
  }

  claim(): Promise<CandidateFilterTaskRecord | null> {
    return this.queueTransaction(async (tx) => {
      const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT (clock_timestamp() AT TIME ZONE 'UTC') AS "now"`;
      const expired = { status: 'processing', OR: [{ leaseUntil: { lte: now } }, { leaseUntil: null }] };
      await tx.candidateFilterTask.updateMany({ where: { ...expired, attempts: { gte: CANDIDATE_FILTER_MAX_CLAIMS } }, data: {
        status: 'failed', phase: 'failed', activeUserId: null, claimToken: null, leaseUntil: null, completedAt: now,
        error: '后台任务多次中断，已保存完成的批次，请点击重试继续',
      } });
      const running = await tx.candidateFilterTask.count({ where: { status: 'processing', leaseUntil: { gt: now } } });
      if (running >= CANDIDATE_FILTER_TASK_CONCURRENCY) return null;
      const next = await tx.candidateFilterTask.findFirst({ where: { OR: [{ status: 'pending' }, expired] }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      if (!next) return null;
      return tx.candidateFilterTask.update({ where: { id: next.id }, data: {
        status: 'processing', phase: next.analysisJson ? 'scoring' : next.snapshotJson ? 'analyzing' : 'preparing',
        claimToken: randomUUID(), leaseUntil: new Date(now.getTime() + CANDIDATE_FILTER_LEASE_MS),
        attempts: { increment: 1 }, error: null,
      }, include: includeBatches });
    });
  }

  private fence(claim: CandidateFilterClaim): Prisma.Sql {
    // 使用数据库实时时钟，避免多实例机器时钟偏差，或行锁等待跨过租约截止时刻。
    return Prisma.sql`"id" = ${claim.id} AND "claimToken" = ${claim.claimToken}
      AND "status" = 'processing' AND "leaseUntil" > (clock_timestamp() AT TIME ZONE 'UTC')`;
  }

  /** 心跳不能复活已过期的租约，即使尚未被其他实例领取。 */
  async heartbeat(claim: CandidateFilterClaim): Promise<boolean> {
    const updated = await this.prisma.$executeRaw(Prisma.sql`UPDATE "CandidateFilterTask"
      SET "leaseUntil" = (clock_timestamp() AT TIME ZONE 'UTC') + ${CANDIDATE_FILTER_LEASE_MS} * INTERVAL '1 millisecond', "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC')
      WHERE ${this.fence(claim)}`);
    return updated === 1;
  }

  private async lockClaim(tx: Prisma.TransactionClient, claim: CandidateFilterClaim): Promise<void> {
    // UPDATE 先取得行锁。后续 checkpoint、批次计数与最终发布均在此锁内完成。
    const locked = await tx.$executeRaw(Prisma.sql`UPDATE "CandidateFilterTask" SET "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC') WHERE ${this.fence(claim)}`);
    if (locked !== 1) throw new CandidateFilterLeaseLostError();
  }

  private async updateClaim(tx: Prisma.TransactionClient, claim: CandidateFilterClaim, data: CheckpointUpdate): Promise<CandidateFilterTaskRecord> {
    const assignments = [Prisma.sql`"phase" = ${data.phase}`, Prisma.sql`"updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC')`];
    if (data.snapshotJson !== undefined) assignments.push(Prisma.sql`"snapshotJson" = ${JSON.stringify(data.snapshotJson)}::jsonb`);
    if (data.analysisJson !== undefined) assignments.push(Prisma.sql`"analysisJson" = ${JSON.stringify(data.analysisJson)}::jsonb`);
    if (data.totalCount !== undefined) assignments.push(Prisma.sql`"totalCount" = ${data.totalCount}`);
    if (data.processedIncrement !== undefined) assignments.push(Prisma.sql`"processedCount" = "processedCount" + ${data.processedIncrement}`);
    const updated = await tx.$executeRaw(Prisma.sql`UPDATE "CandidateFilterTask" SET ${Prisma.join(assignments)} WHERE ${this.fence(claim)}`);
    if (updated !== 1) throw new CandidateFilterLeaseLostError();
    return metadataRecord(await tx.candidateFilterTask.findUniqueOrThrow({ where: { id: claim.id }, select: metadataSelect }));
  }

  async setPhase(claim: CandidateFilterClaim, phase: CandidateFilterPhase): Promise<void> {
    const updated = await this.prisma.$executeRaw(Prisma.sql`UPDATE "CandidateFilterTask" SET "phase" = ${phase}, "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC') WHERE ${this.fence(claim)}`);
    if (updated !== 1) throw new CandidateFilterLeaseLostError();
  }

  saveSnapshot(claim: CandidateFilterClaim, snapshot: unknown, totalCount: number): Promise<CandidateFilterTaskRecord> {
    if (!Number.isSafeInteger(totalCount) || totalCount < 0) throw new BadRequestException('候选人数无效');
    return this.prisma.$transaction(async (tx) => {
      await this.lockClaim(tx, claim);
      const task = await tx.candidateFilterTask.findUniqueOrThrow({ where: { id: claim.id } });
      if (task.snapshotJson !== null) return { ...task, batches: [] };
      await this.updateClaim(tx, claim, { snapshotJson: json(snapshot), totalCount, phase: 'analyzing' });
      return { ...task, snapshotJson: json(snapshot) as Prisma.JsonValue, totalCount, phase: 'analyzing', batches: [] };
    });
  }

  saveAnalysis(claim: CandidateFilterClaim, analysis: unknown): Promise<CandidateFilterTaskRecord> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockClaim(tx, claim);
      const task = await tx.candidateFilterTask.findUniqueOrThrow({ where: { id: claim.id }, select: { ...metadataSelect, analysisJson: true } });
      if (task.analysisJson !== null) return { ...metadataRecord(task), analysisJson: task.analysisJson };
      return this.updateClaim(tx, claim, { analysisJson: completionJson(analysis), phase: 'scoring' });
    });
  }

  saveBatch(claim: CandidateFilterClaim, batchIndex: number, completion: unknown, candidateCount: number): Promise<CandidateFilterTaskRecord> {
    if (!Number.isSafeInteger(batchIndex) || batchIndex < 0 || !Number.isSafeInteger(candidateCount) || candidateCount < 1) throw new BadRequestException('筛选批次无效');
    return this.prisma.$transaction(async (tx) => {
      await this.lockClaim(tx, claim);
      const task = await tx.candidateFilterTask.findUniqueOrThrow({ where: { id: claim.id }, select: metadataSelect });
      const existing = await tx.candidateFilterTaskBatch.findUnique({ where: { taskId_batchIndex: { taskId: claim.id, batchIndex } }, select: { id: true } });
      if (existing) return metadataRecord(task);
      if (task.processedCount + candidateCount > task.totalCount) throw new BadRequestException('已处理人数不能超过本次候选人总数');
      await tx.candidateFilterTaskBatch.create({ data: { taskId: task.id, batchIndex, candidateCount, completionJson: completionJson(completion) } });
      return this.updateClaim(tx, claim, { processedIncrement: candidateCount, phase: 'scoring' });
    });
  }

  /** 评分行与任务完成一起提交，事务回滚时不会留下半份评分版本。 */
  finalize<T>(claim: CandidateFilterClaim, publish: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockClaim(tx, claim);
      const task = await tx.candidateFilterTask.findUniqueOrThrow({ where: { id: claim.id }, select: { totalCount: true, processedCount: true } });
      const batches = await tx.candidateFilterTaskBatch.aggregate({ where: { taskId: claim.id }, _sum: { candidateCount: true } });
      const savedCount = batches._sum.candidateCount ?? 0;
      const result = await publish(tx);
      const clarify = result !== null && typeof result === 'object' && (result as { action?: unknown }).action === 'clarify';
      if (clarify ? savedCount !== 0 || task.processedCount !== 0 : task.totalCount < 1 || task.processedCount !== task.totalCount || savedCount !== task.totalCount) {
        throw new BadRequestException('筛选批次尚未全部完成，不能发布部分结果');
      }
      const updated = await tx.$executeRaw(Prisma.sql`UPDATE "CandidateFilterTask" SET
        "status" = 'completed', "phase" = 'complete', "resultJson" = ${JSON.stringify(result)}::jsonb,
        "snapshotJson" = NULL, "analysisJson" = NULL,
        "error" = NULL, "activeUserId" = NULL, "claimToken" = NULL, "leaseUntil" = NULL,
        "completedAt" = (clock_timestamp() AT TIME ZONE 'UTC'), "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC') WHERE ${this.fence(claim)}`);
      // 若发布跨越租约截止时间，整个事务回滚；新的 worker 可以安全重做发布。
      if (updated !== 1) throw new CandidateFilterLeaseLostError();
      // Published scores are the durable result. Completed jobs no longer need duplicate resume/checkpoint data.
      await tx.candidateFilterTaskBatch.deleteMany({ where: { taskId: claim.id } });
      return result;
    }, { timeout: 30_000 });
  }

  async fail(claim: CandidateFilterClaim, error: string): Promise<boolean> {
    const updated = await this.prisma.$executeRaw(Prisma.sql`UPDATE "CandidateFilterTask" SET
      "status" = 'failed', "phase" = 'failed', "error" = ${error.slice(0, 4000)},
      "activeUserId" = NULL, "claimToken" = NULL, "leaseUntil" = NULL,
      "completedAt" = (clock_timestamp() AT TIME ZONE 'UTC'), "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC') WHERE ${this.fence(claim)}`);
    return updated === 1;
  }
}
