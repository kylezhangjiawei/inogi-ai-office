import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ProcActor } from './procurement.types';
import { assertBomSelection, bomHash, buildBomSnapshot, type BomSnapshot } from './bom-revisions.model';

type RequestInput = { requestId: string; reason: string };
type DraftInput = RequestInput & { expectedFingerprint: string };
const PREFIX = 'procurement:bom-revisions:v1:request:';
const pages = ['page:proc-materials', 'page:proc-cockpit', 'page:proc-inventory-readiness'];

@Injectable()
export class BomRevisionsService {
  constructor(private readonly prisma: PrismaService) {}
  private permission(actor: ProcActor, write = false) {
    if (!actor.id || (!actor.permissions.includes('*') && (!pages.some(p => actor.permissions.includes(p)) || (write && !actor.permissions.includes('bom:publish')))))
      throw new ForbiddenException('需要 BOM 页面权限和对应发布权限');
  }
  private async lock(db: Prisma.TransactionClient) {
    // Same lock as ALL existing BOM editing/import routes; identity and publication serialize together.
    await db.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('procurement-common-bom-lines'))::text`;
  }
  private async draft(db: Prisma.TransactionClient, deviceId: string) {
    const device = await db.procBomNode.findUnique({ where: { id: deviceId } });
    if (!device || device.parentId) throw new NotFoundException('请先建立唯一的设备根节点');
    const rows = await db.procBomNode.findMany({ where: { productLine: device.productLine }, include: { material: true }, orderBy: { id: 'asc' } });
    const sorted = [...rows].sort((a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const fingerprint = bomHash(sorted.map(row => ({ id: row.id, parentId: row.parentId, name: row.name, productLine: row.productLine,
      productRootId: row.productRootId ?? null, code: row.code, materialId: row.materialId, qtyPer: row.qtyPer === null ? null : String(row.qtyPer),
      material: row.material ? { id: row.material.id, code: row.material.tpInventoryCode, name: row.material.name, unit: row.material.unit } : null })));
    return { device, rows: sorted, fingerprint };
  }
  private snapshot(draft: Awaited<ReturnType<BomRevisionsService['draft']>>): BomSnapshot {
    const { device, rows } = draft;
    const parents = new Set(rows.map(row => row.parentId));
    if (rows.some(row => parents.has(row.id) && (row.materialId || row.qtyPer !== null))) throw new BadRequestException('结构分类不能同时作为物料用量节点');
    return buildBomSnapshot({ deviceId: device.id, productRootId: device.productRootId ?? '',
      structure: rows.map(({ id, parentId, name }) => ({ id, parentId, name })),
      leaves: rows.filter(row => !parents.has(row.id) && row.id !== device.id).map(row => {
        if (!row.material || row.materialId !== row.material.id || row.code !== row.material.tpInventoryCode) throw new BadRequestException(`物料「${row.name}」关联已失效，请重新从物料库选择`);
        return { nodeId: row.id, parentId: row.parentId, deviceId: device.id, materialId: row.material.id,
          code: row.material.tpInventoryCode ?? '', name: row.material.name, unit: row.material.unit, qtyPer: row.qtyPer === null ? 0 : Number(row.qtyPer) };
      }) });
  }
  async read(deviceId: string, actor: ProcActor) {
    this.permission(actor);
    return this.prisma.$transaction(async db => {
      const draft = await this.draft(db, deviceId);
      let snapshot: BomSnapshot | null = null, issue: string | null = null;
      try { snapshot = this.snapshot(draft); } catch (error) { if (!(error instanceof BadRequestException)) throw error; issue = error.message; }
      const [revisions, products] = await Promise.all([
        db.procBomRevision.findMany({ where: { deviceId }, orderBy: { version: 'desc' } }),
        db.procTaskTreeNode.findMany({ where: { parentId: null }, select: { id: true, productId: true, name: true }, orderBy: { sortOrder: 'asc' } }),
      ]);
      return { deviceId, productRootId: draft.device.productRootId, draftFingerprint: draft.fingerprint,
        snapshotFingerprint: snapshot?.fingerprint ?? null, issue, revisions, products };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async options(actor: ProcActor) {
    this.permission(actor);
    const devices = await this.prisma.procBomNode.findMany({ where: { parentId: null, productRootId: { not: null } },
      select: { id: true, name: true, productLine: true, productRootId: true, productRoot: { select: { productId: true, name: true } },
        revisions: { where: { retiredAt: null }, select: { id: true, version: true }, orderBy: { version: 'desc' } } }, orderBy: { sortOrder: 'asc' } });
    return { devices };
  }
  async bind(deviceId: string, input: DraftInput & { productRootId: string }, actor: ProcActor) {
    return this.mutate('bind', deviceId, input, actor, async db => {
      const draft = await this.draft(db, deviceId); this.current(draft.fingerprint, input.expectedFingerprint);
      const product = await db.procTaskTreeNode.findUnique({ where: { id: input.productRootId } });
      if (!product || product.parentId) throw new BadRequestException('请选择有效的产品根节点');
      if (await db.procBomRevision.findFirst({ where: { deviceId } })) throw new ConflictException('设备已发布版本，不可重新绑定产品');
      await db.procBomNode.update({ where: { id: deviceId }, data: { productRootId: product.id } });
      return { deviceId, productRootId: product.id };
    });
  }
  async publish(deviceId: string, input: DraftInput, actor: ProcActor) {
    return this.mutate('publish', deviceId, input, actor, async db => {
      const draft = await this.draft(db, deviceId); this.current(draft.fingerprint, input.expectedFingerprint);
      const snapshot = this.snapshot(draft);
      const product = await db.procTaskTreeNode.findUnique({ where: { id: snapshot.productRootId } });
      if (!product || product.parentId) throw new BadRequestException('设备产品归属不再是有效根节点');
      const last = await db.procBomRevision.findFirst({ where: { deviceId }, orderBy: { version: 'desc' } });
      const revision = await db.procBomRevision.create({ data: { deviceId, productRootId: snapshot.productRootId, version: (last?.version ?? 0) + 1,
        snapshot: snapshot as unknown as Prisma.InputJsonObject, fingerprint: snapshot.fingerprint, requestId: input.requestId,
        requestHash: bomHash([actor.id, 'publish', deviceId, input]), publishedById: actor.id, publishedByName: actor.name, reason: input.reason.trim() } });
      return { ...revision, snapshot };
    });
  }
  async retire(revisionId: string, input: RequestInput, actor: ProcActor) {
    return this.mutate('retire', revisionId, input, actor, async db => {
      const revision = await db.procBomRevision.findUnique({ where: { id: revisionId } });
      if (!revision) throw new NotFoundException('发布版本不存在');
      if (revision.retiredAt) throw new ConflictException('版本已停用，请刷新');
      await db.procBomRevision.update({ where: { id: revisionId }, data: { retiredAt: new Date(), retiredById: actor.id, retiredByName: actor.name, retiredReason: input.reason.trim() } });
      return { id: revisionId, retired: true };
    });
  }
  async requireRevision(db: Prisma.TransactionClient, selection: { productRootId: string; deviceId: string; revisionId: string }) {
    await db.$queryRaw`SELECT pg_advisory_xact_lock_shared(hashtext('procurement-common-bom-lines'))::text`;
    const revision = await db.procBomRevision.findUnique({ where: { id: selection.revisionId } });
    if (!revision) throw new BadRequestException('请从 BOM 页面选择已发布版本');
    assertBomSelection(selection.productRootId, selection.deviceId, revision);
    const device = await db.procBomNode.findUnique({ where: { id: selection.deviceId } });
    if (!device || device.parentId || device.productRootId !== selection.productRootId) throw new BadRequestException('设备归属已变化，请重新核对');
    const snapshot = buildBomSnapshot(revision.snapshot as unknown as BomSnapshot);
    if (snapshot.fingerprint !== revision.fingerprint || snapshot.deviceId !== selection.deviceId || snapshot.productRootId !== selection.productRootId) throw new ConflictException('发布快照校验失败，请联系管理员核对');
    return { ...revision, snapshot, productLine: device.productLine };
  }
  private current(actual: string, expected: string) {
    if (actual !== expected) throw new ConflictException('BOM 已更新，请保留填写内容并刷新后重新核对');
  }
  private async mutate<T>(action: string, id: string, input: RequestInput, actor: ProcActor, work: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    this.permission(actor, true);
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId) || !input.reason?.trim() || input.reason.length > 2000) throw new BadRequestException('请填写有效的提交标识和核对依据');
    const signature = bomHash([actor.id, action, id, input]), key = PREFIX + input.requestId;
    try {
      return await this.prisma.$transaction(async db => {
        await this.lock(db);
        const saved = await db.runtimeState.findUnique({ where: { key } });
        if (saved) { const previous = JSON.parse(saved.value); if (previous.signature !== signature) throw new ConflictException('提交标识已用于其他内容'); return previous.result; }
        const result = await work(db);
        // Normalize JSON once so original response and idempotent retry have identical date representations.
        const serialized = JSON.stringify({ signature, result });
        await db.runtimeState.create({ data: { key, value: serialized } });
        await db.auditLog.create({ data: { module: 'procurement', source: 'web', action: `bom.${action}`, resource: 'bom-revision', resourceId: id,
          userId: actor.id, actorName: actor.name, summary: input.reason.trim(), meta: { requestId: input.requestId } } });
        return JSON.parse(serialized).result as T;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
    } catch (error) {
      if (['P2002', 'P2034', 'P2025'].includes((error as { code?: string }).code ?? '')) throw new ConflictException('BOM 正在更新，请保留填写内容并刷新后重试');
      throw error;
    }
  }
}
