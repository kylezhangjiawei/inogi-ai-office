import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { ImportSupplierQuotesDto, UpsertSupplierQuoteDto } from './dto/procurement.dto';
import type { ProcActor } from './procurement.types';

function num(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value);
}
function numOrNull(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' ? value : Number(value);
}
function day(value: Date | null | undefined): string | undefined {
  if (!value) return undefined;
  return value.toISOString().slice(0, 10);
}
function parseDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const t = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(t.getTime()) ? null : t;
}

export interface QuoteTier {
  minQty: number;
  unitPrice: number;
}

/**
 * 供应商报价库：商品(物料) × 厂家的现行比价基准，含起订量阶梯价。
 * 与任务询价流水（ProcQuotation）互不影响；历史价格弹窗仍走 listQuotations 聚合。
 */
@Injectable()
export class QuoteBookService {
  constructor(private readonly prisma: PrismaService) {}

  /** 树形数据：全部物料 + 各自厂家报价（无报价的物料也返回，支持「缺报价」视角）。 */
  async listQuoteBook() {
    const materials = await this.prisma.procMaterial.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: { supplierQuotes: { orderBy: { supplierName: 'asc' } } },
    });
    return {
      rows: materials.map((m) => ({
        id: m.id,
        name: m.name,
        spec: m.spec,
        unit: m.unit,
        category: m.category,
        productLine: m.productLine,
        latestPrice: numOrNull(m.latestPrice),
        latestSupplier: m.latestSupplier ?? undefined,
        latestQuoteDate: day(m.latestQuoteDate),
        quotes: m.supplierQuotes.map((q) => this.serialize(q)),
      })),
    };
  }

  /** 供应商目录（报价录入时选择/匹配用）。 */
  async listSuppliers() {
    const rows = await this.prisma.procSupplier.findMany({
      where: { enabled: true },
      orderBy: { name: 'asc' },
    });
    return {
      suppliers: rows.map((s) => ({
        id: s.id,
        name: s.name,
        shortName: s.shortName ?? undefined,
        source: s.source,
      })),
    };
  }

  async createQuote(dto: UpsertSupplierQuoteDto, actor: ProcActor) {
    const material = await this.prisma.procMaterial.findUnique({ where: { id: dto.materialId } });
    if (!material) throw new NotFoundException('商品不存在');
    const supplierName = dto.supplierName.trim();
    if (!supplierName) throw new BadRequestException('厂家名称不能为空');
    const exists = await this.prisma.procSupplierQuote.findUnique({
      where: { materialId_supplierName: { materialId: dto.materialId, supplierName } },
    });
    if (exists) throw new BadRequestException('该商品下已存在此厂家的报价，请直接编辑');
    const supplierId = await this.resolveSupplierId(dto.supplierId, supplierName);
    const quote = await this.prisma.procSupplierQuote.create({
      data: {
        materialId: dto.materialId,
        supplierId,
        supplierName,
        ...this.commonData(dto),
        createdBy: actor.id,
      },
    });
    return this.serialize(quote);
  }

  async updateQuote(id: string, dto: UpsertSupplierQuoteDto) {
    const exists = await this.prisma.procSupplierQuote.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('报价不存在');
    const supplierName = dto.supplierName.trim();
    if (!supplierName) throw new BadRequestException('厂家名称不能为空');
    if (supplierName !== exists.supplierName) {
      const dup = await this.prisma.procSupplierQuote.findUnique({
        where: { materialId_supplierName: { materialId: exists.materialId, supplierName } },
      });
      if (dup) throw new BadRequestException('该商品下已存在此厂家的报价');
    }
    const supplierId = await this.resolveSupplierId(dto.supplierId, supplierName);
    const quote = await this.prisma.procSupplierQuote.update({
      where: { id },
      data: { supplierId, supplierName, ...this.commonData(dto) },
    });
    return this.serialize(quote);
  }

  async deleteQuote(id: string) {
    const exists = await this.prisma.procSupplierQuote.findUnique({ where: { id } });
    if (!exists) throw new NotFoundException('报价不存在');
    await this.prisma.procSupplierQuote.delete({ where: { id } });
    return { ok: true };
  }

  /** 商品整行移出报价库 = 删除其下全部厂家报价（不动物料主数据）。 */
  async clearMaterialQuotes(materialId: string) {
    const result = await this.prisma.procSupplierQuote.deleteMany({ where: { materialId } });
    return { ok: true, deleted: result.count };
  }

  /**
   * 批量导入：物料按名精确匹配（找不到自动建待审核物料），厂家自动挂靠/新建，
   * 同商品同厂家整条覆盖（阶梯以导入为准）。逐条容错，失败行汇总返回。
   */
  async importQuotes(dto: ImportSupplierQuotesDto, actor: ProcActor) {
    const result = {
      created: 0,
      updated: 0,
      materialsCreated: 0,
      errors: [] as { materialName: string; supplierName: string; message: string }[],
    };
    for (const item of dto.items) {
      try {
        const materialName = item.materialName.trim();
        const supplierName = item.supplierName.trim();
        if (!materialName || !supplierName) throw new Error('商品名称与厂家名称不能为空');
        let material = await this.prisma.procMaterial.findFirst({ where: { name: materialName } });
        if (!material) {
          material = await this.prisma.procMaterial.create({
            data: {
              name: materialName,
              spec: item.spec?.trim() ?? '',
              unit: item.unit?.trim() ?? '',
              category: item.category?.trim() ?? '',
              reviewStatus: 'pending',
              reviewSource: 'import',
              createdBy: actor.id,
            },
          });
          result.materialsCreated += 1;
        }
        const supplierId = await this.resolveSupplierId(undefined, supplierName);
        const data = {
          supplierId,
          supplierName,
          supplierModel: item.supplierModel?.trim() ?? '',
          currency: item.currency ?? 'CNY',
          taxIncluded: item.taxIncluded ?? true,
          leadTimeDays: item.leadTimeDays ?? 0,
          tiers: this.normalizeTiers(item.tiers ?? []) as unknown as Prisma.InputJsonValue,
          quoteDate: parseDay(item.quoteDate),
          validUntil: parseDay(item.validUntil),
          note: item.note?.trim() || null,
        };
        const exists = await this.prisma.procSupplierQuote.findUnique({
          where: { materialId_supplierName: { materialId: material.id, supplierName } },
        });
        if (exists) {
          await this.prisma.procSupplierQuote.update({ where: { id: exists.id }, data });
          result.updated += 1;
        } else {
          await this.prisma.procSupplierQuote.create({
            data: { materialId: material.id, ...data, createdBy: actor.id },
          });
          result.created += 1;
        }
      } catch (err) {
        result.errors.push({
          materialName: item.materialName,
          supplierName: item.supplierName,
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return result;
  }

  /** 阶梯排序 + 去重档位（同 minQty 后者覆盖前者），入库前统一治理。 */
  private normalizeTiers(tiers: QuoteTier[]): QuoteTier[] {
    const byQty = new Map<number, number>();
    for (const t of tiers) byQty.set(t.minQty, t.unitPrice);
    return Array.from(byQty.entries())
      .map(([minQty, unitPrice]) => ({ minQty, unitPrice }))
      .sort((a, b) => a.minQty - b.minQty);
  }

  private commonData(dto: UpsertSupplierQuoteDto) {
    return {
      supplierModel: dto.supplierModel?.trim() ?? '',
      currency: dto.currency ?? 'CNY',
      taxIncluded: dto.taxIncluded ?? true,
      leadTimeDays: dto.leadTimeDays ?? 0,
      tiers: this.normalizeTiers(dto.tiers ?? []) as unknown as Prisma.InputJsonValue,
      quoteDate: parseDay(dto.quoteDate),
      validUntil: parseDay(dto.validUntil),
      note: dto.note?.trim() || null,
    };
  }

  /** 报价写入时厂家自动挂靠：显式 id 优先；否则按名匹配，匹配不到自动建本地供应商。 */
  private async resolveSupplierId(
    supplierId: string | undefined,
    supplierName: string,
  ): Promise<string> {
    if (supplierId) {
      const found = await this.prisma.procSupplier.findUnique({ where: { id: supplierId } });
      if (found) return found.id;
    }
    const byName = await this.prisma.procSupplier.findFirst({ where: { name: supplierName } });
    if (byName) return byName.id;
    const created = await this.prisma.procSupplier.create({
      data: { name: supplierName, source: 'local' },
    });
    return created.id;
  }

  private serialize(q: Prisma.ProcSupplierQuoteGetPayload<object>) {
    const tiers = Array.isArray(q.tiers) ? (q.tiers as unknown as QuoteTier[]) : [];
    return {
      id: q.id,
      materialId: q.materialId,
      supplierId: q.supplierId ?? undefined,
      supplierName: q.supplierName,
      supplierModel: q.supplierModel,
      currency: q.currency,
      taxIncluded: q.taxIncluded,
      leadTimeDays: q.leadTimeDays,
      tiers: tiers.map((t) => ({ minQty: num(t.minQty), unitPrice: num(t.unitPrice) })),
      quoteDate: day(q.quoteDate),
      validUntil: day(q.validUntil),
      note: q.note ?? undefined,
      updatedAt: q.updatedAt.toISOString(),
    };
  }
}
