import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { OssService } from '../oss/oss.service';
import type { ProcActor } from './procurement.types';

export const QUALIFICATION_PREFIX = 'procurement:supplier-qualification:v1:';
export type SupplyQualificationStatus = 'pending' | 'approved' | 'suspended' | 'withdrawn';
export interface QualificationEvidence { fileId: string; name: string; objectKey: string; size: number; mime: string }
export interface SupplyQualificationRevision {
  version: number; status: SupplyQualificationStatus; effectiveFrom: string; effectiveUntil: string | null;
  products: Array<{ id: string; name: string }>; reason: string; evidence: QualificationEvidence[];
  actorId: string; actorName: string; at: string;
}
export interface SupplyQualification extends SupplyQualificationRevision {
  id: string; materialId: string; materialName: string; materialCode: string; supplierId: string; supplierName: string;
  history: SupplyQualificationRevision[];
}
export interface QualificationCommand {
  requestId: string; version: number; materialId: string; supplierId: string; status: SupplyQualificationStatus;
  productIds: string[]; effectiveFrom: string; effectiveUntil?: string; reason: string; evidenceFileIds: string[];
}
const can = (actor: ProcActor, code: string) => actor.permissions.includes('*') || actor.permissions.includes(code);
const text = (value: unknown, label: string, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new BadRequestException(`请填写有效的${label}`);
  return value.trim();
};
const day = (value: unknown) => {
  const result = text(value, '生效日期', 10);
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(`${result}T00:00:00Z`)) || new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) !== result) throw new BadRequestException('生效日期无效');
  return result;
};
export const qualificationId = (materialId: string, supplierId: string) => createHash('sha256').update(JSON.stringify([materialId, supplierId])).digest('hex').slice(0, 32);
export function effectiveQualification(row: SupplyQualification, materialApproved: boolean, supplierEnabled: boolean, today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)) {
  if (row.status !== 'approved') return row.status;
  if (!materialApproved) return 'material_unapproved';
  if (!supplierEnabled) return 'supplier_disabled';
  if (row.effectiveFrom > today) return 'scheduled';
  if (row.effectiveUntil && row.effectiveUntil < today) return 'expired';
  return 'approved';
}

@Injectable()
export class SupplierQualificationsService {
  constructor(private readonly prisma: PrismaService, private readonly oss: OssService) {}
  private access(actor: ProcActor) {
    if (!actor.id || !['page:proc-materials', 'page:proc-quote-book'].some((permission) => can(actor, permission))) throw new ForbiddenException('没有查看物料供货关系的权限');
  }
  private async products(db: Pick<Prisma.TransactionClient, 'systemSetting' | 'procTaskTreeNode'>) {
    const saved = await db.systemSetting.findUnique({ where: { key: 'rd.products' }, select: { value: true } });
    const catalog = Array.isArray(saved?.value) ? saved.value.flatMap((row) => row && typeof row === 'object' && !Array.isArray(row) && typeof row.id === 'string' && typeof row.name === 'string' ? [{ id: row.id, name: row.name }] : []) : [];
    if (catalog.length) return catalog;
    const nodes = await db.procTaskTreeNode.findMany({ where: { parentId: null }, select: { productId: true, name: true } });
    return [...new Map(nodes.map((node) => [node.productId, { id: node.productId, name: node.name }])).values()];
  }
  async list(actor: ProcActor, materialId?: string, supplierId?: string) {
    this.access(actor);
    const [stored, materials, suppliers, products] = await Promise.all([
      this.prisma.runtimeState.findMany({ where: { key: { startsWith: `${QUALIFICATION_PREFIX}relation:` } }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.procMaterial.findMany({ select: { id: true, name: true, spec: true, tpInventoryCode: true, erpCode: true, reviewStatus: true }, orderBy: { name: 'asc' } }),
      this.prisma.procSupplier.findMany({ select: { id: true, name: true, tpCode: true, enabled: true }, orderBy: { name: 'asc' } }),
      this.products(this.prisma),
    ]);
    const relations = stored.map((item) => JSON.parse(item.value) as SupplyQualification).filter((row) => (!materialId || row.materialId === materialId) && (!supplierId || row.supplierId === supplierId));
    return { relations: relations.map((row) => ({ ...row, effectiveStatus: effectiveQualification(row, materials.find((material) => material.id === row.materialId)?.reviewStatus === 'approved', suppliers.find((supplier) => supplier.id === row.supplierId)?.enabled === true) })),
      materials, suppliers, products, canRegister: can(actor, 'quote-book:manage') || can(actor, 'material:review'), canReview: can(actor, 'material:review') };
  }
  async attachment(id: string, fileId: string, actor: ProcActor) {
    this.access(actor);
    const stored = await this.prisma.runtimeState.findUnique({ where: { key: `${QUALIFICATION_PREFIX}relation:${id}` } });
    if (!stored) throw new NotFoundException('供货关系不存在');
    const row = JSON.parse(stored.value) as SupplyQualification;
    const evidence = [row, ...row.history].flatMap((revision) => revision.evidence).find((file) => file.fileId === fileId);
    if (!evidence) throw new NotFoundException('证据不属于此供货关系');
    const asset = await this.prisma.fileAsset.findUnique({ where: { id: fileId } });
    if (!asset || asset.status !== 'active' || asset.deletedAt || asset.objectKey !== evidence.objectKey) throw new NotFoundException('证据已删除或发生变化，原留痕仍保留');
    const url = this.oss.getReadUrl(asset.objectKey, 600)?.url;
    if (!url) throw new BadRequestException('证据暂时无法打开');
    return { id: fileId, name: evidence.name, mime: evidence.mime, size: evidence.size, url };
  }
  async save(input: QualificationCommand, actor: ProcActor) {
    this.access(actor);
    if (!can(actor, 'quote-book:manage') && !can(actor, 'material:review')) throw new ForbiddenException('没有登记供货关系的权限');
    if (!input || !/^[A-Za-z0-9_-]{16,128}$/.test(input.requestId) || !Number.isSafeInteger(input.version) || input.version < 0) throw new BadRequestException('提交标识或版本无效');
    if (!['pending', 'approved', 'suspended', 'withdrawn'].includes(input.status)) throw new BadRequestException('供货关系状态无效');
    if (input.status !== 'pending' && !can(actor, 'material:review')) throw new ForbiddenException('确认、暂停或撤销供货资格需要物料审核权限');
    const materialId = text(input.materialId, '正式物料'), supplierId = text(input.supplierId, '供应商');
    const reason = text(input.reason, '本次依据与原因', 2000), effectiveFrom = day(input.effectiveFrom), effectiveUntil = input.effectiveUntil ? day(input.effectiveUntil) : null;
    if (effectiveUntil && effectiveUntil < effectiveFrom) throw new BadRequestException('失效日期不能早于生效日期');
    if (!Array.isArray(input.productIds) || !input.productIds.length || input.productIds.length > 50 || input.productIds.some((id) => typeof id !== 'string')) throw new BadRequestException('请选择适用产品');
    if (!Array.isArray(input.evidenceFileIds) || input.evidenceFileIds.length > 20 || input.evidenceFileIds.some((id) => typeof id !== 'string')) throw new BadRequestException('证据文件无效');
    const id = qualificationId(materialId, supplierId), key = `${QUALIFICATION_PREFIX}relation:${id}`, requestKey = `${QUALIFICATION_PREFIX}request:${input.requestId}`;
    const fingerprint = createHash('sha256').update(JSON.stringify([actor.id, input])).digest('hex');
    try {
      return await this.prisma.$transaction(async (db) => {
        const repeated = await db.runtimeState.findUnique({ where: { key: requestKey } });
        if (repeated) { const previous = JSON.parse(repeated.value); if (previous.fingerprint !== fingerprint) throw new ConflictException('提交编号已用于其他内容'); return { id }; }
        const [stored, material, supplier, products] = await Promise.all([
          db.runtimeState.findUnique({ where: { key } }), db.procMaterial.findUnique({ where: { id: materialId } }), db.procSupplier.findUnique({ where: { id: supplierId } }), this.products(db),
        ]);
        const previous = stored ? JSON.parse(stored.value) as SupplyQualification : null;
        const stopping = Boolean(previous && ['suspended', 'withdrawn'].includes(input.status));
        if (!material || (!stopping && material.reviewStatus !== 'approved')) throw new BadRequestException('请选择已审核通过的正式物料');
        if (!supplier) throw new BadRequestException('请选择真实供应商，报价中的自由名称不能代替供应商档案');
        if ((previous?.version ?? 0) !== input.version) throw new ConflictException('供货关系已更新，请重新核对后提交');
        if (!previous && input.status !== 'pending') throw new BadRequestException('新关系先登记为待审核，再明确确认供货资格');
        if (previous?.status === 'withdrawn' && input.status !== 'pending') throw new BadRequestException('已撤销关系需重新登记待审核');
        if (previous && previous.status !== 'pending' && !can(actor, 'material:review')) throw new ForbiddenException('已确认关系的变更需要物料审核权限');
        if (input.status === 'approved' && !supplier.enabled) throw new BadRequestException('供应商已停用，不能确认可供货');
        const selected = [...new Set(input.productIds)].map((productId) => products.find((product) => product.id === productId) ?? (stopping ? previous?.products.find((product) => product.id === productId) : undefined));
        if (selected.some((product) => !product)) throw new BadRequestException('适用产品已失效，请重新选择');
        const fileIds = [...new Set(input.evidenceFileIds)];
        if (input.status === 'approved' && !fileIds.length) throw new BadRequestException('确认可供货必须提供审核或验证依据，曾报价 / 曾通过样品不能自动认定合格');
        const assets = fileIds.length ? await db.fileAsset.findMany({ where: { id: { in: fileIds }, status: 'active', deletedAt: null } }) : [];
        const knownEvidence = previous ? [previous, ...previous.history].flatMap((revision) => revision.evidence) : [];
        const evidence = fileIds.map((fileId) => {
          const asset = assets.find((file) => file.id === fileId);
          const retained = knownEvidence.find((file) => file.fileId === fileId);
          if (stopping && !asset && retained) return retained;
          if (!asset || asset.fileSize <= 0 || (asset.uploadedBy !== actor.id && !knownEvidence.some((file) => file.fileId === fileId && file.objectKey === asset.objectKey))) throw new BadRequestException('请使用本人上传的有效证据，或此关系已留存的证据');
          return { fileId, name: asset.fileName, objectKey: asset.objectKey, size: asset.fileSize, mime: asset.mimeType };
        });
        const revision: SupplyQualificationRevision = { version: input.version + 1, status: input.status, effectiveFrom, effectiveUntil, products: selected as Array<{ id: string; name: string }>, reason, evidence, actorId: actor.id, actorName: actor.name, at: new Date().toISOString() };
        const record: SupplyQualification = { ...revision, id, materialId, materialName: material.name, materialCode: material.tpInventoryCode || material.erpCode || '', supplierId, supplierName: supplier.name,
          history: previous ? [...previous.history, { version: previous.version, status: previous.status, effectiveFrom: previous.effectiveFrom, effectiveUntil: previous.effectiveUntil, products: previous.products, reason: previous.reason, evidence: previous.evidence, actorId: previous.actorId, actorName: previous.actorName, at: previous.at }] : [] };
        if (stored) {
          const changed = await db.runtimeState.updateMany({ where: { key, value: stored.value }, data: { value: JSON.stringify(record) } });
          if (changed.count !== 1) throw new ConflictException('供货关系已更新，请重新核对');
        } else await db.runtimeState.create({ data: { key, value: JSON.stringify(record) } });
        await db.runtimeState.create({ data: { key: requestKey, value: JSON.stringify({ id, fingerprint }) } });
        return { id };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (['P2002', 'P2034'].includes(String((error as { code?: string }).code))) throw new ConflictException('供货关系被同时更新，请刷新后重试');
      throw error;
    }
  }
}
