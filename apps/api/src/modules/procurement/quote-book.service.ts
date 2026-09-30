import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { ChatService } from '../chat/chat.service';
import { OcrService } from '../ocr/ocr.service';
import { OssService } from '../oss/oss.service';
import { SIGNED_URL_TTL_SECONDS } from '../oss/oss.constants';
import {
  AiParseQuotesDto,
  ImportSupplierQuoteItemDto,
  ImportSupplierQuotesDto,
  UpsertSupplierQuoteDto,
} from './dto/procurement.dto';
import type { ProcActor } from './procurement.types';
import type { SupplierProfileDto } from './quote-book.controller';

const supplierIdentity = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, '').toLocaleLowerCase();

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
 * 任务引用时复制到 ProcQuotation 形成当次快照，库内后续更新不回写已生成任务报价；
 * 历史价格弹窗仍走 listQuotations 聚合。
 */
@Injectable()
export class QuoteBookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chatService: ChatService,
    private readonly ocrService: OcrService,
    private readonly ossService: OssService,
  ) {}

  /**
   * 图片表格导入：腾讯 OCR 提取文本 → AI 抽取结构化报价。
   * 未配置 OCR / 识别为空时返回错误说明，前端提示改用表格文件。
   */
  async ocrParseQuotes(file: { originalname: string; buffer: Buffer; mimetype: string }) {
    const ocrReady = await this.ocrService.hasTencentConfig().catch(() => false);
    if (!ocrReady) return { items: [], error: '尚未配置腾讯 OCR，无法识别图片表格；请上传 xlsx/xls 文件' };
    try {
      const ocr = await this.ocrService.recognizeImageText(file);
      const text = (ocr.text || ocr.lines.join('\n')).trim();
      if (!text) return { items: [], error: '图片中未识别到文字' };
      const result = await this.aiParseQuotes({
        text: `以下是对一张报价表图片做 OCR 得到的文本（行列可能有错位，请按语义还原）：\n${text}`,
      });
      return { ...result, ocrText: text.slice(0, 2000) };
    } catch (err) {
      return { items: [], error: err instanceof Error ? err.message : 'OCR 识别失败' };
    }
  }

  /**
   * AI 识别报价表兜底：规则解析不理想时，把表格 CSV 文本交给对话模型抽取结构化报价。
   * AI 不可用/输出不合法时返回空 items + 错误说明（前端保留规则解析结果）。
   */
  async aiParseQuotes(dto: AiParseQuotesDto) {
    try {
      const result = await this.chatService.complete({
        system: [
          '你是采购报价表解析助手。用户提供一份报价表的 CSV 文本（可能含多段表格、重复表头、总计行、模具信息）。',
          '提取所有「商品 × 供应商」的产品报价，输出 JSON 对象：{"items":[{',
          'materialName(商品/产品名称,string,必填)、supplierName(供应商,string,必填)、unitPrice(产品单价,number,必填,>0)、',
          'minQty(起订量,number,无则0；"1k"=1000)、spec(规格,string)、unit(单位,string)、supplierModel(厂家型号,string)、',
          'leadTimeDays(交期天数,number)、note(备注,string,可把穴数/材料/模具价/不含抛光费等附加信息并入)、',
          'quoteDate(报价日期,YYYY-MM-DD)、validUntil(有效期至,YYYY-MM-DD)}]}',
          '注意：',
          '- 模具价格不是产品单价；总计/合计行不要输出；同商品同供应商多档起订量输出多条。',
          '- 矩阵形态：表头可能是「名称,起订量,供应商A(单价/元),供应商B(单价/元)」——每个价格列的列头就是供应商名，每行每列展开成一条报价；「/」表示该档不报价，跳过。',
          '- 合并单元格：商品名称可能只在段落首行出现，后续行为空时沿用上一个名称。',
          '- 「历史采购价格」类表没有供应商，不构成报价，整段跳过。',
          '只输出 JSON，不要解释。',
        ].join('\n'),
        messages: [{ role: 'user', content: dto.text }],
        json: true,
        temperature: 0,
        // 大表 + 4000 输出 tokens，60s 会偶发超时
        timeoutMs: 120_000,
        maxRetries: 0,
        maxTokens: 4000,
      });
      const items = this.mergeAiItems(this.parseAiQuoteItems(result.content));
      if (items.length === 0) return { items: [], model: result.model, error: 'AI 未能从表格中识别出有效报价' };
      return { items, model: result.model };
    } catch (err) {
      return { items: [], error: err instanceof Error ? err.message : 'AI 服务暂不可用' };
    }
  }

  /** AI 每档输出一条，导入端点按（商品,供应商）整条 upsert——先合并同键多档，防止相互覆盖。 */
  private mergeAiItems(items: ImportSupplierQuoteItemDto[]): ImportSupplierQuoteItemDto[] {
    const map = new Map<string, ImportSupplierQuoteItemDto>();
    for (const item of items) {
      const key = JSON.stringify([supplierIdentity(item.materialName), supplierIdentity(item.spec || ''), supplierIdentity(item.supplierName)]);
      const existing = map.get(key);
      if (existing) {
        existing.tiers.push(...item.tiers);
        existing.spec ??= item.spec; existing.unit ??= item.unit;
        existing.supplierModel ??= item.supplierModel; existing.note ??= item.note;
        existing.quoteDate ??= item.quoteDate; existing.validUntil ??= item.validUntil;
        existing.leadTimeDays ??= item.leadTimeDays;
      } else {
        map.set(key, item);
      }
    }
    return Array.from(map.values());
  }

  private parseAiQuoteItems(content: string): ImportSupplierQuoteItemDto[] {
    try {
      const jsonText = content.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
      const raw = JSON.parse(jsonText) as { items?: unknown };
      if (!Array.isArray(raw.items)) return [];
      const str = (v: unknown, max: number) =>
        typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
      const items: ImportSupplierQuoteItemDto[] = [];
      for (const entry of raw.items.slice(0, 500)) {
        const r = entry as Record<string, unknown>;
        const materialName = str(r.materialName, 200);
        const supplierName = str(r.supplierName, 200);
        const unitPrice = Number(r.unitPrice);
        if (!materialName || !supplierName || !Number.isFinite(unitPrice) || unitPrice <= 0) continue;
        const minQty = Number(r.minQty);
        const leadTimeDays = Number(r.leadTimeDays);
        const dayRe = /^\d{4}-\d{2}-\d{2}$/;
        const quoteDate = str(r.quoteDate, 32);
        const validUntil = str(r.validUntil, 32);
        items.push({
          materialName,
          supplierName,
          spec: str(r.spec, 200),
          unit: str(r.unit, 20),
          supplierModel: str(r.supplierModel, 200),
          leadTimeDays: Number.isFinite(leadTimeDays) && leadTimeDays > 0 ? Math.round(leadTimeDays) : undefined,
          note: str(r.note, 500),
          quoteDate: quoteDate && dayRe.test(quoteDate) ? quoteDate : undefined,
          validUntil: validUntil && dayRe.test(validUntil) ? validUntil : undefined,
          tiers: [{ minQty: Number.isFinite(minQty) && minQty > 0 ? minQty : 0, unitPrice }],
        } as ImportSupplierQuoteItemDto);
      }
      return items;
    } catch {
      return [];
    }
  }

  /** 树形数据：全部物料 + 各自厂家报价（无报价的物料也返回，支持「缺报价」视角）。 */
  async listQuoteBook() {
    const materials = await this.prisma.procMaterial.findMany({
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
      include: {
        supplierQuotes: {
          orderBy: { supplierName: 'asc' },
          include: { supplier: { select: { id: true, name: true, source: true, enabled: true } } },
        },
      },
    });
    return {
      rows: materials.map((m) => ({
        id: m.id,
        name: m.name,
        spec: m.spec,
        unit: m.unit,
        category: m.category,
        productLine: m.productLine,
        tpInventoryCode: m.tpInventoryCode ?? undefined,
        erpCode: m.erpCode,
        reviewStatus: m.reviewStatus,
        imageUrl: m.imageKey
          ? this.ossService.getSignedUrl(m.imageKey, SIGNED_URL_TTL_SECONDS.DOCUMENT) ?? undefined
          : undefined,
        latestPrice: numOrNull(m.latestPrice),
        latestSupplier: m.latestSupplier ?? undefined,
        latestQuoteDate: day(m.latestQuoteDate),
        quotes: m.supplierQuotes.map((q) => ({
          ...this.serialize(q),
          // Keep the real relation separate from the historical supplier-name snapshot.
          supplier: q.supplier ? {
            id: q.supplier.id,
            name: q.supplier.name,
            source: q.supplier.source,
            enabled: q.supplier.enabled,
          } : undefined,
        })),
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
        tpCode: s.tpCode ?? undefined,
        source: s.source,
      })),
    };
  }

  async supplierDirectory() {
    const rows = await this.prisma.procSupplier.findMany({ orderBy: { name: 'asc' } });
    return { suppliers: rows.map(s => {
      const metadata = s.metadata && typeof s.metadata === 'object' && !Array.isArray(s.metadata) ? s.metadata : {};
      const profile = metadata.quoteBook && typeof metadata.quoteBook === 'object' && !Array.isArray(metadata.quoteBook) ? metadata.quoteBook : {};
      const field = (key: string) => typeof profile[key] === 'string' ? profile[key] as string : '';
      return { id: s.id, name: s.name, shortName: s.shortName, tpCode: s.tpCode, enabled: s.enabled, source: s.source,
        contact: s.contact, phone: s.phone, email: s.email, address: s.address,
        description: field('description'), tags: field('tags'), cooperationStart: field('cooperationStart'),
        supplyScope: field('supplyScope'), owner: field('owner'), grade: field('grade'),
        materialRoles: metadata.quoteBookMaterialRoles || {} };
    }) };
  }

  async saveSupplierProfile(id: string | undefined, dto: SupplierProfileDto) {
    const name = dto.name.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (!name) throw new BadRequestException('供应商名称不能为空');
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quote-supplier:${supplierIdentity(name)}`}))`;
      const rows = await tx.procSupplier.findMany();
      const current = id ? rows.find(s => s.id === id) : undefined;
      if (id && !current) throw new NotFoundException('供应商不存在');
      const matches = rows.filter(s => supplierIdentity(s.name) === supplierIdentity(name) && s.id !== id);
      if (matches.length && (!current || supplierIdentity(current.name) !== supplierIdentity(name))) throw new BadRequestException('该供应商已存在，请选择已有档案；同名档案请先核对 ERP 编码');
      const metadata = current?.metadata && typeof current.metadata === 'object' && !Array.isArray(current.metadata) ? current.metadata : {};
      const quoteBook = Object.fromEntries(['description', 'tags', 'cooperationStart', 'supplyScope', 'owner', 'grade'].map(key => [key, (dto[key as keyof SupplierProfileDto] as string | undefined)?.trim() || '']));
      const data = {
        metadata: { ...metadata, quoteBook } as Prisma.InputJsonValue,
        // ERP owns its master fields; local business annotations remain editable.
        ...(current?.source === 'tplus' ? {} : { name, shortName: dto.shortName?.trim() || null, contact: dto.contact?.trim() || null,
          phone: dto.phone?.trim() || null, email: dto.email?.trim() || null, address: dto.address?.trim() || null, enabled: dto.enabled ?? true }),
      };
      if (current) return tx.procSupplier.update({ where: { id: current.id }, data, select: { id: true } });
      return tx.procSupplier.create({ data: { ...data, name, source: 'local' }, select: { id: true } });
    });
  }

  async saveSupplierMaterialRole(id: string, materialId: string, role: string) {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quote-material-role:${materialId}`}))`;
      if (!await tx.procMaterial.findUnique({ where: { id: materialId } })) throw new NotFoundException('物料不存在');
      const suppliers = await tx.procSupplier.findMany();
      if (!suppliers.some(s => s.id === id)) throw new NotFoundException('供应商不存在');
      for (const supplier of suppliers) {
        const metadata = supplier.metadata && typeof supplier.metadata === 'object' && !Array.isArray(supplier.metadata) ? supplier.metadata : {};
        const stored = metadata.quoteBookMaterialRoles;
        const roles = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
        if (supplier.id !== id && !(role === 'primary' && roles[materialId] === 'primary')) continue;
        await tx.procSupplier.update({ where: { id: supplier.id }, data: { metadata: { ...metadata, quoteBookMaterialRoles: { ...roles, [materialId]: supplier.id === id ? role : 'alternative' } } as Prisma.InputJsonValue } });
      }
      return { ok: true };
    });
  }

  async createQuote(dto: UpsertSupplierQuoteDto, actor: ProcActor) {
    const material = await this.prisma.procMaterial.findUnique({ where: { id: dto.materialId } });
    if (!material) throw new NotFoundException('商品不存在');
    let supplierName = dto.supplierName.trim();
    if (!supplierName) throw new BadRequestException('厂家名称不能为空');
    const supplierId = await this.resolveSupplierId(dto.supplierId, supplierName);
    supplierName = (await this.prisma.procSupplier.findUniqueOrThrow({ where: { id: supplierId } })).name;
    const linked = await this.prisma.procSupplierQuote.findFirst({ where: { materialId: dto.materialId, supplierId } });
    if (linked) throw new BadRequestException('该商品下已存在此供应商档案的报价，请直接编辑');
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
    let supplierName = dto.supplierName.trim();
    if (!supplierName) throw new BadRequestException('厂家名称不能为空');
    const supplierId = await this.resolveSupplierId(dto.supplierId, supplierName);
    supplierName = (await this.prisma.procSupplier.findUniqueOrThrow({ where: { id: supplierId } })).name;
    const linked = await this.prisma.procSupplierQuote.findFirst({ where: { materialId: exists.materialId, supplierId, id: { not: id } } });
    if (linked) throw new BadRequestException('该商品下已存在此厂家的报价，请编辑已有报价');
    // 价格或币种发生变化时把旧现行版本留痕（首档单价快照）
    const oldTier = this.firstTier(exists.tiers);
    const newTiers = this.normalizeTiers(dto.tiers ?? []);
    if (oldTier && (JSON.stringify(exists.tiers) !== JSON.stringify(newTiers) || exists.currency !== (dto.currency ?? 'CNY'))) {
      const material = await this.prisma.procMaterial.findUnique({ where: { id: exists.materialId }, select: { name: true } });
      await this.archiveQuoteHistory({
        materialId: exists.materialId,
        materialName: material?.name ?? '',
        supplierId: exists.supplierId,
        supplierName: exists.supplierName,
        currency: exists.currency,
        unitPrice: oldTier.unitPrice,
        minQty: oldTier.minQty || null,
        quoteDate: exists.quoteDate ?? exists.updatedAt,
        label: '被新报价覆盖的历史版本',
      });
    }
    const quote = await this.prisma.procSupplierQuote.update({
      where: { id },
      data: { supplierId, supplierName, ...this.commonData(dto) },
    });
    return this.serialize(quote);
  }

  async deleteQuote(id: string) {
    const exists = await this.prisma.procSupplierQuote.findUnique({
      where: { id },
      include: { material: { select: { name: true } } },
    });
    if (!exists) throw new NotFoundException('报价不存在');
    // 删除前留痕最后一版，历史价格弹窗仍可追溯
    const tier = this.firstTier(exists.tiers);
    if (tier) {
      await this.archiveQuoteHistory({
        materialId: exists.materialId,
        materialName: exists.material?.name ?? '',
        supplierId: exists.supplierId,
        supplierName: exists.supplierName,
        currency: exists.currency,
        unitPrice: tier.unitPrice,
        minQty: tier.minQty || null,
        quoteDate: exists.quoteDate ?? exists.updatedAt,
        label: '删除前的最后版本',
      });
    }
    await this.prisma.procSupplierQuote.delete({ where: { id } });
    return { ok: true };
  }

  /** 商品整行移出报价库 = 删除其下全部厂家报价（不动物料主数据；逐条留痕最后版本）。 */
  async clearMaterialQuotes(materialId: string) {
    const rows = await this.prisma.procSupplierQuote.findMany({
      where: { materialId },
      include: { material: { select: { name: true } } },
    });
    for (const row of rows) {
      const tier = this.firstTier(row.tiers);
      if (!tier) continue;
      await this.archiveQuoteHistory({
        materialId: row.materialId,
        materialName: row.material?.name ?? '',
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        currency: row.currency,
        unitPrice: tier.unitPrice,
        minQty: tier.minQty || null,
        quoteDate: row.quoteDate ?? row.updatedAt,
        label: '移出报价库前的最后版本',
      });
    }
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
    const grouped = new Map<string, ImportSupplierQuoteItemDto>();
    for (const item of dto.items) {
      const key = JSON.stringify([supplierIdentity(item.materialName), supplierIdentity(item.spec || ''), supplierIdentity(item.supplierName)]);
      const previous = grouped.get(key);
      if (previous) {
        if ((previous.currency || 'CNY') !== (item.currency || 'CNY') || (previous.taxIncluded ?? true) !== (item.taxIncluded ?? true)) throw new BadRequestException('重复报价的币种或含税口径冲突，请核对后导入');
        for (const tier of item.tiers) {
          const duplicate = previous.tiers.find(t => t.minQty === tier.minQty);
          if (duplicate && duplicate.unitPrice !== tier.unitPrice) throw new BadRequestException('重复报价的同一起订量存在不同价格，请核对后导入');
          if (!duplicate) previous.tiers.push(tier);
        }
      } else grouped.set(key, { ...item, tiers: [...item.tiers] });
    }
    for (const item of grouped.values()) {
      try {
        const materialName = item.materialName.trim();
        let supplierName = item.supplierName.trim();
        if (!materialName || !supplierName) throw new Error('商品名称与厂家名称不能为空');
        const supplierId = await this.resolveSupplierId(undefined, supplierName);
        supplierName = (await this.prisma.procSupplier.findUniqueOrThrow({ where: { id: supplierId } })).name;
        const material = await this.prisma.$transaction(async tx => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quote-material:${supplierIdentity(materialName)}`}))`;
          const candidates = (await tx.procMaterial.findMany({ where: { name: { equals: materialName, mode: 'insensitive' } } })).filter(m => !item.spec?.trim() || supplierIdentity(m.spec) === supplierIdentity(item.spec));
          if (candidates.length > 1) throw new BadRequestException('物料名称匹配到多个档案，请填写准确规格或在已有物料中手动录入');
          if (candidates[0]) return candidates[0];
          const created = await tx.procMaterial.create({
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
          return created;
        });
        const data = {
          source: 'manual', sourceRef: null,
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
          ...(item.imageKey ? { imageKey: item.imageKey } : {}),
        };
        const exists = await this.prisma.procSupplierQuote.findFirst({ where: { materialId: material.id, supplierId } });
        if (exists) {
          // 价格或币种变化才把旧现行版本留痕；同表重复导入（值未变）不刷历史
          const oldTier = this.firstTier(exists.tiers);
          if (oldTier && (JSON.stringify(exists.tiers) !== JSON.stringify(data.tiers) || exists.currency !== data.currency)) {
            await this.archiveQuoteHistory({
              materialId: material.id,
              materialName: material.name,
              supplierId: exists.supplierId,
              supplierName: exists.supplierName,
              currency: exists.currency,
              unitPrice: oldTier.unitPrice,
              minQty: oldTier.minQty || null,
              quoteDate: exists.quoteDate ?? exists.updatedAt,
              label: '被新导入覆盖的历史版本',
            });
          }
          await this.prisma.procSupplierQuote.update({ where: { id: exists.id }, data });
          result.updated += 1;
        } else {
          await this.prisma.procSupplierQuote.upsert({
            where: { materialId_supplierId: { materialId: material.id, supplierId } },
            create: { materialId: material.id, ...data, createdBy: actor.id },
            update: data,
          });
          result.created += 1;
        }
        // 表格里的历史轮次（早前轮次/「6.2报价」类额外价格列）逐条留痕
        for (const h of item.historyPrices ?? []) {
          await this.archiveQuoteHistory({
            materialId: material.id,
            materialName: material.name,
            supplierId,
            supplierName,
            currency: data.currency,
            unitPrice: h.unitPrice,
            minQty: h.minQty || null,
            quoteDate: parseDay(item.quoteDate),
            label: h.label ?? '导入表中的历史轮次',
          });
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

  /**
   * 报价演变留痕：把一条历史/被覆盖的价格写入 ProcQuotation 流水（channel=quote-book），
   * 与任务询价共用「历史价格」弹窗（趋势折线/分组对比）。同商品同厂家同币种同价已有记录则跳过，
   * 防止重复导入刷出重复历史；留痕失败不阻塞主流程。
   */
  private async archiveQuoteHistory(input: {
    materialId: string;
    materialName: string;
    supplierId?: string | null;
    supplierName: string;
    currency: string;
    unitPrice: number;
    minQty?: number | null;
    quoteDate?: Date | null;
    label?: string;
  }) {
    try {
      const dup = await this.prisma.procQuotation.findFirst({
        where: {
          materialId: input.materialId,
          supplierId: input.supplierId ?? null,
          supplierName: input.supplierName,
          currency: input.currency,
          unitPrice: input.unitPrice,
          channel: 'quote-book',
        },
        select: { id: true },
      });
      if (dup) return;
      await this.prisma.procQuotation.create({
        data: {
          materialId: input.materialId,
          materialName: input.materialName,
          supplierId: input.supplierId ?? null,
          supplierName: input.supplierName,
          currency: input.currency,
          unitPrice: input.unitPrice,
          minOrderQty: input.minQty ?? null,
          quoteDate: input.quoteDate ?? new Date(),
          channel: 'quote-book',
          note: input.label ?? '报价库历史版本',
        },
      });
    } catch {
      // 留痕失败不阻塞主流程
    }
  }

  /** 现行报价的首档（最低起订量档），用于历史留痕的单价快照。 */
  private firstTier(tiers: unknown): QuoteTier | null {
    if (!Array.isArray(tiers) || tiers.length === 0) return null;
    const t = tiers[0] as QuoteTier;
    return Number.isFinite(num(t.unitPrice)) ? { minQty: num(t.minQty), unitPrice: num(t.unitPrice) } : null;
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
      source: 'manual', sourceRef: null,
      supplierModel: dto.supplierModel?.trim() ?? '',
      currency: dto.currency ?? 'CNY',
      taxIncluded: dto.taxIncluded ?? true,
      leadTimeDays: dto.leadTimeDays ?? 0,
      tiers: this.normalizeTiers(dto.tiers ?? []) as unknown as Prisma.InputJsonValue,
      quoteDate: parseDay(dto.quoteDate),
      validUntil: parseDay(dto.validUntil),
      note: dto.note?.trim() || null,
      // 未传 imageKey 表示不动已有图片（编辑表单不管理图片）
      ...(dto.imageKey !== undefined ? { imageKey: dto.imageKey.trim() || null } : {}),
    };
  }

  /** 报价写入时厂家自动挂靠：显式 id 优先；否则按名匹配，匹配不到自动建本地供应商。 */
  private async resolveSupplierId(
    supplierId: string | undefined,
    supplierName: string,
  ): Promise<string> {
    if (supplierId) {
      const found = await this.prisma.procSupplier.findUnique({ where: { id: supplierId } });
      if (!found) throw new BadRequestException('供应商不存在，请重新选择');
      if (!found.enabled) throw new BadRequestException('供应商已停用');
      return found.id;
    }
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quote-supplier:${supplierIdentity(supplierName)}`}))`;
      const matches = (await tx.procSupplier.findMany()).filter(s => supplierIdentity(s.name) === supplierIdentity(supplierName));
      if (matches.length > 1) throw new BadRequestException('存在同名供应商，请在手动录入中明确选择供应商档案');
      if (matches[0]) {
        if (!matches[0].enabled) throw new BadRequestException('供应商已停用');
        return matches[0].id;
      }
      return (await tx.procSupplier.create({ data: { name: supplierName.normalize('NFKC').trim().replace(/\s+/g, ' '), source: 'local' } })).id;
    });
  }

  private serialize(q: Prisma.ProcSupplierQuoteGetPayload<object>) {
    const tiers = Array.isArray(q.tiers) ? (q.tiers as unknown as QuoteTier[]) : [];
    return {
      id: q.id,
      materialId: q.materialId,
      supplierId: q.supplierId ?? undefined,
      supplierName: q.supplierName,
      supplierModel: q.supplierModel,
      source: q.source ?? 'manual', sourceRef: q.sourceRef ?? undefined,
      currency: q.currency,
      taxIncluded: q.taxIncluded,
      leadTimeDays: q.leadTimeDays,
      tiers: tiers.map((t) => ({ minQty: num(t.minQty), unitPrice: num(t.unitPrice) })),
      quoteDate: day(q.quoteDate),
      validUntil: day(q.validUntil),
      note: q.note ?? undefined,
      // 存 OSS key，出口重签（避免长期保存短效签名 URL）
      imageUrl: q.imageKey
        ? this.ossService.getSignedUrl(q.imageKey, SIGNED_URL_TTL_SECONDS.DOCUMENT) ?? undefined
        : undefined,
      updatedAt: q.updatedAt.toISOString(),
    };
  }
}
