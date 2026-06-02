import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PDFParse } from 'pdf-parse';

import { PrismaService } from '../../prisma/prisma.service';
import { OcrService } from '../ocr';
import { createInitialOrderProcessingState } from './order-processing.seed';
import {
  InventoryItem,
  InventoryStatus,
  InvoiceInfo,
  InvoiceLine,
  InvoiceTemplate,
  OrderDetail,
  OrderProcessingState,
  OrderProduct,
  OrderSource,
  OrderSummary,
  PageResult,
  ProductCheckStatus,
  ReminderRule,
  StockMovement,
} from './order-processing.types';

const STATE_KEY = 'order-processing:state:v1';
const ACTIVE_TEMPLATE_SETTING = 'active-template-id';
const REMINDER_RULE_SETTING = 'reminder-rule';
const DEFAULT_PAGE_SIZE = 12;
const PRODUCT_PAGE_SIZE = 8;

type UploadedFileLike = { originalname: string; size?: number; mimetype?: string; buffer?: Buffer };
type StockItemInput = { id: string; qty: number };
type InvoiceDraftLineInput = {
  lineId: string;
  sku: string;
  name: string;
  spec: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  subtotal?: number;
  sortOrder: number;
};
type InvoiceExportLine = {
  id: string;
  name: string;
  spec: string;
  unit: string;
  quantity: number;
  unitPrice: string;
  subtotal: string;
  status: string;
};
type ParsedOrderDraft = { order: OrderSummary; detail: OrderDetail; metadata: Record<string, unknown> };
type ParsedStockInDraft = {
  type: string;
  supplier: string;
  poNumber: string;
  handler: string;
  documentNo: string;
  warehouse: string;
  businessDate: string;
  remark: string;
  items: StockItemInput[];
};
type ExtractedDocument = {
  fileName: string;
  extension: string;
  rows: string[][];
  text: string;
  provider: 'spreadsheet' | 'csv' | 'pdf' | 'ocr';
};
type CatalogItem = {
  id: string;
  name: string;
  category: string;
  spec: string;
  unit: string;
  stock: number;
  sysPrice: number;
};
type DateRange = { start: Date; end: Date };
type PrismaTx = Prisma.TransactionClient;
type OrderRow = Prisma.OrderProcessingOrderGetPayload<{
  include: {
    invoice: true;
    products: { orderBy: { sortOrder: 'asc' } };
  };
}>;
type OrderProductRow = Prisma.OrderProcessingOrderProductGetPayload<Record<string, never>>;

@Injectable()
export class OrderProcessingService {
  private initializationPromise: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ocrService: OcrService,
  ) {}

  async getWorkbench(query: Record<string, unknown>) {
    await this.ensureInitialized();
    const source = this.toSource(query.source);
    const orderQ = this.toString(query.q);
    const orderPage = this.toPage(query.orderPage);
    const pageSize = this.toPageSize(query.orderPageSize, 6);
    const productPage = this.toPage(query.productPage);
    const productPageSize = this.toPageSize(query.productPageSize, PRODUCT_PAGE_SIZE);
    const selectedMailboxId = this.toString(query.mailboxId);
    const where = this.buildOrderWhere(source, orderQ);

    const [total, orders, requestedOrder, stats, settings, activeMailboxCount] = await Promise.all([
      this.prisma.orderProcessingOrder.count({ where }),
      this.prisma.orderProcessingOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (orderPage - 1) * pageSize,
        take: pageSize,
      }),
      this.toString(query.orderId)
        ? this.prisma.orderProcessingOrder.findFirst({
            where: { ...where, id: this.toString(query.orderId) },
          })
        : Promise.resolve(null),
      this.buildOrderStats(),
      this.getTemplatesAndSettings(),
      this.prisma.integrationConfig.count({ where: { kind: 'mail', isActive: true } }),
    ]);

    const queue = this.paginateRows(orders.map((order) => this.toOrderSummary(order)), total, orderPage, pageSize);
    const selectedOrderSummary = requestedOrder ? this.toOrderSummary(requestedOrder) : queue.items[0] ?? null;
    const selectedOrder = selectedOrderSummary ? await this.getOrderRow(selectedOrderSummary.id) : null;
    const orderDetails = selectedOrder ? this.toOrderDetail(selectedOrder) : null;
    const productRows = orderDetails ? this.paginate(orderDetails.products, productPage, productPageSize) : this.paginate([], productPage, productPageSize);

    return {
      stats,
      wecomMail: {
        connected: activeMailboxCount > 0,
        enabled: activeMailboxCount > 0,
        message: activeMailboxCount > 0 ? `已启用 ${activeMailboxCount} 个企业微信邮箱` : '请先在邮箱管理启用企业微信邮箱',
        selectedMailboxId: selectedMailboxId || undefined,
      },
      queue,
      selectedOrder: selectedOrderSummary,
      orderDetails,
      productRows,
      templates: settings.templates,
      activeTemplateId: settings.activeTemplateId,
      reminderRule: settings.reminderRule,
    };
  }

  async uploadOrders(files: UploadedFileLike[] = [], payload: Record<string, unknown> = {}) {
    await this.ensureInitialized();
    const payloadNames = Array.isArray(payload.fileNames) ? payload.fileNames.map((name) => this.toString(name)).filter(Boolean) : [];
    const fallbackNames = payloadNames.length > 0 ? payloadNames : [this.toString(payload.fileName)].filter(Boolean);
    if (files.length === 0) {
      throw new BadRequestException(fallbackNames.length > 0 ? '订货单接口需要上传文件内容，不能只提交文件名' : '请选择要上传的订货单文件');
    }

    const state = await this.getStateSnapshot();
    const created: ParsedOrderDraft[] = [];
    for (const [index, file] of files.entries()) {
      const item = await this.parseUploadedOrder(file, state, index);
      state.orders.unshift(item.order);
      state.orderDetails[item.detail.id] = item.detail;
      created.push(item);
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of created) {
        await this.insertOrderDetail(tx, item.order, item.detail, item.metadata.originalFileName as string, item.metadata as Prisma.InputJsonValue);
      }
    });

    return { created: created.map((item) => item.order), message: `已解析 ${created.length} 份订货单，请复核后生成发票` };
  }

  async generateInvoice(orderId: string, payload: Record<string, unknown> = {}) {
    await this.ensureInitialized();
    const settings = await this.getTemplatesAndSettings();
    const requestedTemplateId = this.toString(payload.templateId);
    const templateId = requestedTemplateId || settings.activeTemplateId;
    if (!settings.templates.some((template) => template.id === templateId)) {
      throw new BadRequestException('发票模板不存在');
    }
    const invoiceLines = this.toInvoiceDraftLines(payload.lines);
    const updated = await this.prisma.$transaction(async (tx) => {
      const order = await tx.orderProcessingOrder.findUnique({
        where: { id: orderId },
        include: { invoice: true, products: { orderBy: { sortOrder: 'asc' } } },
      });
      if (!order) throw new NotFoundException('订单不存在');

      const finalInvoiceLines = this.buildInvoiceLines(order.products, invoiceLines);
      if (finalInvoiceLines.length === 0) throw new BadRequestException('当前订货单没有可生成发票的商品明细');
      const finalInvoiceInfo = this.toInvoiceInfo(payload.info, {
        customer: order.customer,
        orderId: order.id,
        date: this.formatDate(order.shipDate),
      });
      const invoiceNo = order.invoice?.invoiceNo || (await this.nextInvoiceNo(tx));
      const amount = this.sumInvoiceLines(finalInvoiceLines);
      const now = new Date();
      const currentMetadata = this.toRecord(order.invoice?.metadata);

      await tx.orderProcessingOrder.update({
        where: { id: orderId },
        data: {
          generated: true,
          status: '已生成',
          type: 'success',
        },
      });
      await tx.orderProcessingInvoice.upsert({
        where: { orderId },
        create: {
          id: `INV-${orderId}`,
          orderId,
          invoiceNo,
          amount,
          generatedAt: now,
          templateId,
          metadata: { ...currentMetadata, info: finalInvoiceInfo, lines: finalInvoiceLines } as Prisma.InputJsonValue,
        },
        update: {
          invoiceNo,
          amount,
          generatedAt: now,
          templateId,
          metadata: { ...currentMetadata, info: finalInvoiceInfo, lines: finalInvoiceLines } as Prisma.InputJsonValue,
        },
      });
      return tx.orderProcessingOrder.findUnique({
        where: { id: orderId },
        include: { invoice: true, products: { orderBy: { sortOrder: 'asc' } } },
      });
    });

    if (!updated) throw new NotFoundException('订单不存在');
    return { order: this.toOrderSummary(updated), orderDetails: this.toOrderDetail(updated), message: '商业发票已生成' };
  }

  async exportInvoice(orderId: string) {
    await this.ensureInitialized();
    const updated = await this.prisma.$transaction(async (tx) => {
      const order = await tx.orderProcessingOrder.findUnique({
        where: { id: orderId },
        include: { invoice: true, products: { orderBy: { sortOrder: 'asc' } } },
      });
      if (!order) throw new NotFoundException('订单不存在');

      const products = order.products.map((product) => this.toOrderProduct(product));
      const invoiceLines = this.toInvoiceLines(order.invoice?.metadata);
      const amount = invoiceLines.length > 0 ? this.sumInvoiceLines(invoiceLines) : this.sumProductAmount(products);
      if (!order.generated || !order.invoice?.generatedAt) {
        throw new BadRequestException('请先生成商业发票，再执行导出');
      }
      const invoiceNo = order.invoice.invoiceNo || (await this.nextInvoiceNo(tx));
      await tx.orderProcessingOrder.update({
        where: { id: orderId },
        data: { invoiceExported: true, status: '已导出', type: 'success' },
      });
      await tx.orderProcessingInvoice.upsert({
        where: { orderId },
        create: {
          id: `INV-${orderId}`,
          orderId,
          invoiceNo,
          amount,
          generatedAt: order.invoice?.generatedAt ?? new Date(),
          exportedAt: new Date(),
        },
        update: {
          invoiceNo,
          amount,
          exportedAt: new Date(),
        },
      });

      return tx.orderProcessingOrder.findUnique({
        where: { id: orderId },
        include: { invoice: true, products: { orderBy: { sortOrder: 'asc' } } },
      });
    });

    if (!updated) throw new NotFoundException('订单不存在');
    const detail = this.toOrderDetail(updated);
    const settings = await this.getTemplatesAndSettings();
    const templateName = settings.templates.find((template) => template.id === detail.invoiceTemplateId)?.name ?? '商业发票模板';
    const exportInfo = detail.invoiceInfo ?? { customer: detail.customer, orderId: detail.orderId, date: detail.date };
    const exportLines: InvoiceExportLine[] =
      detail.invoiceLines?.map((line) => ({
        id: line.id,
        name: line.name,
        spec: line.spec,
        unit: line.unit,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        subtotal: line.subtotal,
        status: '已确认',
      })) ??
      detail.products.map((product) => ({
        id: product.id,
        name: product.name,
        spec: product.spec,
        unit: product.unit,
        quantity: product.orderQty,
        unitPrice: product.orderPrice,
        subtotal: product.subtotal,
        status: product.status,
      }));
    const pdf = this.buildInvoicePdf({
      detail,
      info: exportInfo,
      lines: exportLines,
      templateName,
    });

    return {
      fileName: `${detail.invoiceNo || detail.orderId}.pdf`,
      mimeType: 'application/pdf',
      encoding: 'base64',
      content: pdf.toString('base64'),
      message: '发票 PDF 已导出',
    };
  }

  async saveActiveTemplate(templateId: string) {
    await this.ensureInitialized();
    const template = await this.prisma.orderProcessingInvoiceTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new NotFoundException('模板不存在');
    await this.saveSetting(ACTIVE_TEMPLATE_SETTING, templateId);
    const settings = await this.getTemplatesAndSettings();
    return { templates: settings.templates, activeTemplateId: settings.activeTemplateId };
  }

  async saveTemplate(payload: Record<string, unknown>) {
    await this.ensureInitialized();
    const id = this.toString(payload.id) || `custom-${Date.now()}`;
    const name = this.toString(payload.name) || '自定义模板';
    const existing = await this.prisma.orderProcessingInvoiceTemplate.findUnique({ where: { id } });
    const template = await this.prisma.orderProcessingInvoiceTemplate.upsert({
      where: { id },
      create: {
        id,
        name,
        source: existing?.source ?? 'builtin',
        config: this.toRecord(payload.config) as Prisma.InputJsonValue,
      },
      update: {
        name,
        config: this.toRecord(payload.config) as Prisma.InputJsonValue,
      },
    });
    await this.saveSetting(ACTIVE_TEMPLATE_SETTING, id);
    const settings = await this.getTemplatesAndSettings();
    return { template: this.toTemplate(template), templates: settings.templates, activeTemplateId: id, message: '模板已保存' };
  }

  async generateAiTemplate(files: UploadedFileLike[] = [], payload: Record<string, unknown> = {}) {
    await this.ensureInitialized();
    if (files.length === 0) throw new BadRequestException('请上传一份发票样式文件');
    const extractedDocs = await Promise.all(files.map((file) => this.extractUploadedDocument(file, '发票模板')));
    const detectedFields = this.detectInvoiceTemplateFields(extractedDocs.map((doc) => doc.text).join('\n'));
    const aiCount = await this.prisma.orderProcessingInvoiceTemplate.count({ where: { source: 'ai' } });
    const template = await this.prisma.orderProcessingInvoiceTemplate.create({
      data: {
        id: `ai-${Date.now()}`,
        name: this.toString(payload.name) || `识别模板 ${aiCount + 1}`,
        source: 'ai',
        accentColor: '#8b5cf6',
        config: {
          sourceFiles: files.map((file) => file.originalname),
          detectedFields,
          headerStyle: 'compact-commercial-invoice',
          generatedBy: 'document-parser',
          parsedAt: new Date().toISOString(),
        },
      },
    });
    await this.saveSetting(ACTIVE_TEMPLATE_SETTING, template.id);
    const settings = await this.getTemplatesAndSettings();
    return { template: this.toTemplate(template), templates: settings.templates, activeTemplateId: template.id, message: '模板草稿已生成并应用，请预览后确认' };
  }

  async saveReminderRule(payload: Record<string, unknown>) {
    await this.ensureInitialized();
    const current = await this.getReminderRule();
    const daysBefore = this.toNonNegativeInteger(payload.daysBefore ?? current.daysBefore, '提前提醒天数');
    const reminderRule = {
      enabled: this.toBoolean(payload.enabled, current.enabled),
      daysBefore,
    };
    await this.saveSetting(REMINDER_RULE_SETTING, reminderRule);
    return { reminderRule, message: '提醒规则已保存' };
  }

  async getInventory(query: Record<string, unknown>) {
    await this.ensureInitialized();
    const q = this.toString(query.q);
    const category = this.toString(query.category);
    const status = this.toString(query.status);
    const page = this.toPage(query.page);
    const pageSize = this.toPageSize(query.pageSize, DEFAULT_PAGE_SIZE);
    const dateRange = this.resolveInventoryDateRange(query);
    const movementDateWhere = this.buildMovementDateWhere(dateRange);
    const scopedMovementItems = dateRange
      ? await this.prisma.orderProcessingStockMovement.findMany({
          where: movementDateWhere,
          distinct: ['itemId'],
          select: { itemId: true },
        })
      : [];
    const scopedItemIds = dateRange ? scopedMovementItems.map((item) => item.itemId) : null;
    const where = this.buildInventoryWhere(q, category, status, scopedItemIds);

    const [total, rows, allRows, categories, recentMovements] = await Promise.all([
      this.prisma.orderProcessingInventoryItem.count({ where }),
      this.prisma.orderProcessingInventoryItem.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.orderProcessingInventoryItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      this.prisma.orderProcessingInventoryItem.findMany({
        distinct: ['category'],
        select: { category: true },
        orderBy: { category: 'asc' },
      }),
      this.prisma.orderProcessingStockMovement.findMany({
        where: movementDateWhere,
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);

    return {
      summary: this.buildInventorySummary(allRows.map((item) => this.toInventoryItem(item))),
      inventory: this.paginateRows(rows.map((item) => this.toInventoryItem(item)), total, page, pageSize),
      categories: categories.map((item) => item.category),
      statuses: ['正常', '偏低', '缺货'] satisfies InventoryStatus[],
      recentMovements: recentMovements.map((movement) => this.toStockMovement(movement)),
    };
  }

  async getInventoryDetail(itemId: string) {
    await this.ensureInitialized();
    const item = await this.prisma.orderProcessingInventoryItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException(`商品 ${itemId} 不存在`);

    const [movements, relatedProducts] = await Promise.all([
      this.prisma.orderProcessingStockMovement.findMany({
        where: { itemId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
      this.prisma.orderProcessingOrderProduct.findMany({
        where: { sku: itemId },
        include: { order: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    return {
      item: this.toInventoryItem(item),
      movements: movements.map((movement) => this.toStockMovement(movement)),
      relatedOrders: relatedProducts.map((product) => ({
        ...this.toOrderProduct(product),
        orderId: product.orderId,
        customer: product.order.customer,
        date: this.formatDate(product.order.shipDate),
      })),
    };
  }

  async recognizeStockIn(files: UploadedFileLike[] = []) {
    await this.ensureInitialized();
    if (files.length === 0) throw new BadRequestException('请选择入库单据文件');
    const stockIn = await this.parseStockInFiles(files);
    const fields = [
      stockIn.businessDate ? 'date' : null,
      stockIn.supplier ? 'supplier' : null,
      stockIn.poNumber ? 'po' : null,
      stockIn.handler ? 'handler' : null,
      ...stockIn.items.map((_, index) => `item-${index}`),
    ].filter(Boolean);
    return {
      files: files.map((file) => ({ name: file.originalname, size: this.formatFileSize(file.size ?? 0) })),
      fields,
      stockIn,
      confidence: stockIn.items.length > 0 ? 0.86 : 0,
      message: '单据已解析，请人工复核后入库',
    };
  }

  async createStockIn(payload: Record<string, unknown>) {
    await this.ensureInitialized();
    const items = this.toStockItems(payload.items);
    if (items.length === 0) throw new BadRequestException('至少需要一项入库商品');
    const handler = this.toString(payload.handler) || '当前用户';
    const supplier = this.toString(payload.supplier);
    const poNumber = this.toString(payload.poNumber);
    const documentNo = this.toString(payload.documentNo);
    const warehouse = this.toString(payload.warehouse);
    const businessDate = this.toOptionalDate(payload.businessDate, '入库日期');
    const remark = this.toString(payload.remark);
    const changedSkus = items.map((item) => item.id);

    await this.prisma.$transaction(async (tx) => {
      for (const row of items) {
        const item = await tx.orderProcessingInventoryItem.findUnique({ where: { id: row.id } });
        if (!item) throw new NotFoundException(`商品 ${row.id} 不存在`);
        const updated = await tx.orderProcessingInventoryItem.update({
          where: { id: row.id },
          data: {
            stock: { increment: row.qty },
            inboundPending: Math.max(0, item.inboundPending - row.qty),
          },
        });
        await tx.orderProcessingInventoryItem.update({
          where: { id: row.id },
          data: { status: this.computeInventoryStatus({ stock: updated.stock, safe: updated.safe }) },
        });
        await tx.orderProcessingStockMovement.create({
          data: {
            id: `MV-${Date.now()}-${row.id}-${Math.random().toString(36).slice(2, 7)}`,
            itemId: item.id,
            itemName: item.name,
            type: 'in',
            qty: row.qty,
            operator: handler,
            note: `${supplier ? `${supplier} · ` : ''}${poNumber ? `关联 ${poNumber}` : documentNo ? `入库单 ${documentNo}` : '手工入库'}${warehouse ? ` · ${warehouse}` : ''}${remark ? ` · ${remark}` : ''}`,
            relatedOrderId: poNumber || undefined,
            documentNo: documentNo || undefined,
            warehouse: warehouse || undefined,
            supplier: supplier || undefined,
            businessDate: businessDate ?? undefined,
            metadata: { stockInType: this.toString(payload.type) || 'purchase' },
          },
        });
      }
    });

    await this.refreshProductChecksForSkus(changedSkus);
    const inventory = await this.prisma.orderProcessingInventoryItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    return { message: '入库已确认', summary: this.buildInventorySummary(inventory.map((item) => this.toInventoryItem(item))), inventory: inventory.map((item) => this.toInventoryItem(item)) };
  }

  async createStockOut(itemId: string, payload: Record<string, unknown>) {
    await this.ensureInitialized();
    const qty = this.toPositiveInteger(payload.qty, '出库数量');
    const operator = this.toString(payload.operator) || '当前用户';

    await this.prisma.$transaction(async (tx) => {
      const item = await tx.orderProcessingInventoryItem.findUnique({ where: { id: itemId } });
      if (!item) throw new NotFoundException(`商品 ${itemId} 不存在`);
      const updatedRows = await tx.orderProcessingInventoryItem.updateMany({
        where: { id: itemId, stock: { gte: qty } },
        data: {
          stock: { decrement: qty },
          outboundPending: Math.max(0, item.outboundPending - qty),
        },
      });
      if (updatedRows.count === 0) throw new BadRequestException('出库数量不能超过当前库存');
      const updated = await tx.orderProcessingInventoryItem.findUnique({ where: { id: itemId } });
      if (!updated) throw new NotFoundException(`商品 ${itemId} 不存在`);
      await tx.orderProcessingInventoryItem.update({
        where: { id: itemId },
        data: { status: this.computeInventoryStatus({ stock: updated.stock, safe: updated.safe }) },
      });
      await tx.orderProcessingStockMovement.create({
        data: {
          id: `MV-${Date.now()}-${item.id}-${Math.random().toString(36).slice(2, 7)}`,
          itemId: item.id,
          itemName: item.name,
          type: 'out',
          qty,
          operator,
          note: this.toString(payload.note) || '手工出库',
        },
      });
    });

    await this.refreshProductChecksForSkus([itemId]);
    return this.getInventoryDetail(itemId);
  }

  async adjustInventory(itemId: string, payload: Record<string, unknown>) {
    await this.ensureInitialized();
    const operator = this.toString(payload.operator) || '当前用户';
    const nextStock = this.toNonNegativeInteger(payload.stock, '调整后库存');

    await this.prisma.$transaction(async (tx) => {
      const item = await tx.orderProcessingInventoryItem.findUnique({ where: { id: itemId } });
      if (!item) throw new NotFoundException(`商品 ${itemId} 不存在`);
      const diff = nextStock - item.stock;
      await tx.orderProcessingInventoryItem.update({
        where: { id: itemId },
        data: {
          stock: nextStock,
          status: this.computeInventoryStatus({ stock: nextStock, safe: item.safe }),
        },
      });
      await tx.orderProcessingStockMovement.create({
        data: {
          id: `MV-${Date.now()}-${item.id}-${Math.random().toString(36).slice(2, 7)}`,
          itemId: item.id,
          itemName: item.name,
          type: 'adjust',
          qty: Math.abs(diff),
          operator,
          note: this.toString(payload.note) || `库存调整 ${diff >= 0 ? '+' : '-'}${Math.abs(diff)}`,
        },
      });
    });

    await this.refreshProductChecksForSkus([itemId]);
    return this.getInventoryDetail(itemId);
  }

  async exportInventory(query: Record<string, unknown>) {
    const result = await this.getInventory({ ...query, page: 1, pageSize: 10000 });
    const lines = [
      'SKU,Name,Category,Spec,Stock,Safe,Inbound,Outbound,Status',
      ...result.inventory.items.map((item) => [item.id, item.name, item.category, item.spec, item.stock, item.safe, item.in, item.out, item.status].map((cell) => this.csvCell(cell)).join(',')),
    ];
    return {
      fileName: `inventory-${new Date().toISOString().slice(0, 10)}.csv`,
      mimeType: 'text/csv;charset=utf-8',
      content: lines.join('\n'),
    };
  }

  private ensureInitialized() {
    if (!this.initializationPromise) {
      this.initializationPromise = this.initializeStorage().catch((error) => {
        this.initializationPromise = null;
        throw error;
      });
    }
    return this.initializationPromise;
  }

  private async initializeStorage() {
    const [orderCount, inventoryCount, templateCount] = await Promise.all([
      this.prisma.orderProcessingOrder.count(),
      this.prisma.orderProcessingInventoryItem.count(),
      this.prisma.orderProcessingInvoiceTemplate.count(),
    ]);

    if (orderCount === 0 && inventoryCount === 0) {
      const runtimeState = await this.readRuntimeState();
      await this.persistInitialState(runtimeState ?? createInitialOrderProcessingState());
      return;
    }

    if (templateCount === 0) {
      await this.seedTemplatesAndSettings(createInitialOrderProcessingState());
    } else {
      await this.ensureSettings();
    }
  }

  private async readRuntimeState() {
    const record = await this.prisma.runtimeState.findUnique({ where: { key: STATE_KEY } });
    if (!record) return null;
    try {
      return this.hydrateState(JSON.parse(record.value) as OrderProcessingState);
    } catch {
      return null;
    }
  }

  private async persistInitialState(rawState: OrderProcessingState) {
    const state = this.hydrateState(rawState);
    state.orders.forEach((order) => this.ensureStateOrderDetail(state, order.id));

    await this.prisma.$transaction(async (tx) => {
      await tx.orderProcessingStockMovement.deleteMany();
      await tx.orderProcessingOrderProduct.deleteMany();
      await tx.orderProcessingInvoice.deleteMany();
      await tx.orderProcessingOrder.deleteMany();
      await tx.orderProcessingInventoryItem.deleteMany();
      await tx.orderProcessingInvoiceTemplate.deleteMany();
      await tx.orderProcessingSetting.deleteMany();

      await tx.orderProcessingInventoryItem.createMany({
        data: state.inventory.map((item, index) => ({
          id: item.id,
          name: item.name,
          category: item.category,
          spec: item.spec,
          stock: item.stock,
          safe: item.safe,
          inboundPending: item.in,
          outboundPending: item.out,
          status: item.status,
          sortOrder: index,
        })),
      });

      await tx.orderProcessingOrder.createMany({
        data: state.orders.map((order) => ({
          id: order.id,
          customer: order.customer,
          type: order.type,
          status: order.status,
          shipDate: this.parseShipDate(order.date, new Date(order.createdAt).getFullYear()),
          source: order.source,
          generated: order.generated,
          invoiceExported: order.invoiceExported,
          createdAt: new Date(order.createdAt),
        })),
      });

      for (const order of state.orders) {
        await this.insertOrderDetail(tx, order, state.orderDetails[order.id]);
      }

      await tx.orderProcessingStockMovement.createMany({
        data: state.movements.map((movement) => ({
          id: movement.id,
          itemId: movement.itemId,
          itemName: movement.itemName,
          type: movement.type,
          qty: movement.qty,
          operator: movement.operator,
          note: movement.note,
          relatedOrderId: movement.relatedOrderId,
          documentNo: movement.documentNo,
          warehouse: movement.warehouse,
          supplier: movement.supplier,
          businessDate: movement.businessDate ? this.parseDate(movement.businessDate) : undefined,
          createdAt: this.parseDateTime(movement.time),
        })),
      });

      await tx.orderProcessingInvoiceTemplate.createMany({
        data: state.templates.map((template) => ({
          id: template.id,
          name: template.name,
          source: template.source,
          accentColor: template.accentColor,
          config: (template.config ?? {}) as Prisma.InputJsonValue,
          createdAt: template.createdAt ? this.parseDate(template.createdAt) : undefined,
        })),
      });

      await tx.orderProcessingSetting.createMany({
        data: [
          { key: ACTIVE_TEMPLATE_SETTING, value: state.activeTemplateId },
          { key: REMINDER_RULE_SETTING, value: state.reminderRule as Prisma.InputJsonValue },
        ],
      });
    });
  }

  private async insertOrderDetail(tx: PrismaTx, order: OrderSummary, detail: OrderDetail, originalFileName?: string, metadata: Prisma.InputJsonValue = {}) {
    const createdAt = new Date(order.createdAt);
    const detailMailMetadata = detail.mailContent
      ? {
          mailSubject: detail.mailContent.subject,
          mailSender: detail.mailContent.sender,
          mailReceivedAt: detail.mailContent.receivedAt,
          mailBody: detail.mailContent.body,
        }
      : {};
    const orderMetadata = { ...detailMailMetadata, ...this.toRecord(metadata) } as Prisma.InputJsonValue;
    await tx.orderProcessingOrder.upsert({
      where: { id: order.id },
      create: {
        id: order.id,
        customer: order.customer,
        type: order.type,
        status: order.status,
        shipDate: this.parseShipDate(order.date, createdAt.getFullYear()),
        source: order.source,
        generated: order.generated,
        invoiceExported: order.invoiceExported,
        originalFileName,
        metadata: orderMetadata,
        createdAt,
      },
      update: {
        customer: order.customer,
        type: order.type,
        status: order.status,
        shipDate: this.parseShipDate(order.date, createdAt.getFullYear()),
        source: order.source,
        generated: order.generated,
        invoiceExported: order.invoiceExported,
        originalFileName,
        metadata: orderMetadata,
      },
    });
    await tx.orderProcessingOrderProduct.deleteMany({ where: { orderId: order.id } });
    await tx.orderProcessingOrderProduct.createMany({
      data: detail.products.map((product, index) => ({
        id: `OP-${order.id}-${index + 1}`,
        orderId: order.id,
        sku: product.id,
        name: product.name,
        category: product.category,
        spec: product.spec,
        unit: product.unit,
        orderQty: product.orderQty,
        stockQty: product.stockQty,
        orderPrice: this.parseCurrency(product.orderPrice),
        sysPrice: this.parseCurrency(product.sysPrice),
        subtotal: this.parseCurrency(product.subtotal),
        status: product.status,
        remark: product.remark,
        sortOrder: index,
      })),
    });
    if (detail.invoiceNo || order.generated || order.invoiceExported) {
      const invoiceNo = detail.invoiceNo || (await this.nextInvoiceNo(tx));
      await tx.orderProcessingInvoice.upsert({
        where: { orderId: order.id },
        create: {
          id: `INV-${order.id}`,
          orderId: order.id,
          invoiceNo,
          amount: this.parseCurrency(detail.amount),
          generatedAt: detail.generatedAt ? new Date(detail.generatedAt) : order.generated ? createdAt : undefined,
          exportedAt: order.invoiceExported ? createdAt : undefined,
        },
        update: {
          invoiceNo,
          amount: this.parseCurrency(detail.amount),
          generatedAt: detail.generatedAt ? new Date(detail.generatedAt) : order.generated ? createdAt : undefined,
          exportedAt: order.invoiceExported ? createdAt : undefined,
        },
      });
    } else {
      await tx.orderProcessingInvoice.deleteMany({ where: { orderId: order.id } });
    }
  }

  private async seedTemplatesAndSettings(state: OrderProcessingState) {
    await this.prisma.$transaction(async (tx) => {
      await tx.orderProcessingInvoiceTemplate.createMany({
        data: state.templates.map((template) => ({
          id: template.id,
          name: template.name,
          source: template.source,
          accentColor: template.accentColor,
          config: (template.config ?? {}) as Prisma.InputJsonValue,
        })),
      });
      await tx.orderProcessingSetting.createMany({
        data: [
          { key: ACTIVE_TEMPLATE_SETTING, value: state.activeTemplateId },
          { key: REMINDER_RULE_SETTING, value: state.reminderRule as Prisma.InputJsonValue },
        ],
        skipDuplicates: true,
      });
    });
  }

  private async ensureSettings() {
    const initial = createInitialOrderProcessingState();
    await this.prisma.orderProcessingSetting.upsert({
      where: { key: ACTIVE_TEMPLATE_SETTING },
      create: { key: ACTIVE_TEMPLATE_SETTING, value: initial.activeTemplateId },
      update: {},
    });
    await this.prisma.orderProcessingSetting.upsert({
      where: { key: REMINDER_RULE_SETTING },
      create: { key: REMINDER_RULE_SETTING, value: initial.reminderRule as Prisma.InputJsonValue },
      update: {},
    });
  }

  private async getStateSnapshot(): Promise<OrderProcessingState> {
    const [orders, inventory, movements, templates, settings] = await Promise.all([
      this.prisma.orderProcessingOrder.findMany({
        orderBy: { createdAt: 'desc' },
        include: { invoice: true, products: { orderBy: { sortOrder: 'asc' } } },
      }),
      this.prisma.orderProcessingInventoryItem.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      this.prisma.orderProcessingStockMovement.findMany({ orderBy: { createdAt: 'desc' } }),
      this.prisma.orderProcessingInvoiceTemplate.findMany({ orderBy: { createdAt: 'asc' } }),
      this.getTemplatesAndSettings(),
    ]);

    return {
      orders: orders.map((order) => this.toOrderSummary(order)),
      orderDetails: Object.fromEntries(orders.map((order) => [order.id, this.toOrderDetail(order)])),
      inventory: inventory.map((item) => this.toInventoryItem(item)),
      movements: movements.map((movement) => this.toStockMovement(movement)),
      templates: templates.map((template) => this.toTemplate(template)),
      activeTemplateId: settings.activeTemplateId,
      reminderRule: settings.reminderRule,
      updatedAt: new Date().toISOString(),
    };
  }

  private hydrateState(state: OrderProcessingState): OrderProcessingState {
    const initial = createInitialOrderProcessingState();
    return {
      ...initial,
      ...state,
      orderDetails: { ...initial.orderDetails, ...(state.orderDetails ?? {}) },
      templates: state.templates?.length ? state.templates : initial.templates,
      inventory: state.inventory?.length ? state.inventory : initial.inventory,
      movements: state.movements ?? initial.movements,
      reminderRule: state.reminderRule ?? initial.reminderRule,
    };
  }

  private buildOrderWhere(source: OrderSource | null, q: string): Prisma.OrderProcessingOrderWhereInput {
    const sourceWhere: Prisma.OrderProcessingOrderWhereInput =
      source === 'wecom_mail'
        ? { source: { in: ['wecom_mail', 'gmail'] } }
        : source
          ? { source }
          : {};
    return {
      ...sourceWhere,
      ...(q
        ? {
            OR: [
              { customer: { contains: q, mode: 'insensitive' } },
              { id: { contains: q, mode: 'insensitive' } },
              { status: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  private buildInventoryWhere(q: string, category: string, status: string, scopedItemIds: string[] | null = null): Prisma.OrderProcessingInventoryItemWhereInput {
    return {
      ...(scopedItemIds ? { id: { in: scopedItemIds.length > 0 ? scopedItemIds : ['__no_inventory_items__'] } } : {}),
      ...(q
        ? {
            OR: [
              { id: { contains: q, mode: 'insensitive' } },
              { name: { contains: q, mode: 'insensitive' } },
              { category: { contains: q, mode: 'insensitive' } },
              { spec: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(category && category !== 'all' ? { category } : {}),
      ...(status && status !== 'all' ? { status } : {}),
    };
  }

  private async getOrderRow(orderId: string) {
    const order = await this.prisma.orderProcessingOrder.findUnique({
      where: { id: orderId },
      include: { invoice: true, products: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!order) throw new NotFoundException('订单不存在');
    return order;
  }

  private async buildOrderStats() {
    const [pending, abnormal, generated, unexported] = await Promise.all([
      this.prisma.orderProcessingOrder.count({ where: { generated: false } }),
      this.prisma.orderProcessingOrder.count({ where: { OR: [{ type: 'error' }, { status: { contains: '确认' } }] } }),
      this.prisma.orderProcessingOrder.count({ where: { generated: true } }),
      this.prisma.orderProcessingOrder.count({ where: { generated: true, invoiceExported: false } }),
    ]);
    return { pending, abnormal, generated, unexported };
  }

  private async getTemplatesAndSettings() {
    await this.ensureSettings();
    const [templates, activeSetting, reminderSetting] = await Promise.all([
      this.prisma.orderProcessingInvoiceTemplate.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.orderProcessingSetting.findUnique({ where: { key: ACTIVE_TEMPLATE_SETTING } }),
      this.prisma.orderProcessingSetting.findUnique({ where: { key: REMINDER_RULE_SETTING } }),
    ]);
    const mappedTemplates = templates.map((template) => this.toTemplate(template));
    const activeCandidate = this.settingString(activeSetting?.value);
    const activeTemplateId = mappedTemplates.some((template) => template.id === activeCandidate) ? activeCandidate : mappedTemplates[0]?.id ?? 'weoxy';
    return {
      templates: mappedTemplates,
      activeTemplateId,
      reminderRule: this.parseReminderRule(reminderSetting?.value),
    };
  }

  private async getReminderRule() {
    const setting = await this.prisma.orderProcessingSetting.findUnique({ where: { key: REMINDER_RULE_SETTING } });
    return this.parseReminderRule(setting?.value);
  }

  private saveSetting(key: string, value: Prisma.InputJsonValue) {
    return this.prisma.orderProcessingSetting.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  private toOrderSummary(order: Pick<OrderRow, 'id' | 'customer' | 'type' | 'status' | 'shipDate' | 'source' | 'generated' | 'invoiceExported' | 'createdAt'>): OrderSummary {
    return {
      id: order.id,
      customer: order.customer,
      type: order.type as OrderSummary['type'],
      status: order.status,
      date: this.formatMonthDay(order.shipDate),
      source: order.source as OrderSource,
      generated: order.generated,
      invoiceExported: order.invoiceExported,
      createdAt: order.createdAt.toISOString(),
    };
  }

  private toOrderDetail(order: OrderRow): OrderDetail {
    const products = order.products.map((product) => this.toOrderProduct(product));
    const invoiceLines = this.toInvoiceLines(order.invoice?.metadata);
    const invoiceInfo = this.toOptionalInvoiceInfo(order.invoice?.metadata);
    return {
      id: order.id,
      customer: order.customer,
      orderId: order.id,
      date: this.formatDate(order.shipDate),
      amount: this.formatCurrency(order.invoice?.amount ? Number(order.invoice.amount) : invoiceLines.length > 0 ? this.sumInvoiceLines(invoiceLines) : this.sumProductAmount(products)),
      invoiceNo: order.invoice?.invoiceNo ?? '',
      invoiceTemplateId: order.invoice?.templateId || undefined,
      generatedAt: order.invoice?.generatedAt?.toISOString(),
      mailContent: this.toOrderMailContent(order),
      invoiceInfo,
      invoiceLines: invoiceLines.length > 0 ? invoiceLines : undefined,
      products,
    };
  }

  private toOrderMailContent(order: Pick<OrderRow, 'id' | 'customer' | 'source' | 'metadata' | 'createdAt'>): OrderDetail['mailContent'] {
    const metadata = this.toRecord(order.metadata);
    const nestedMail = this.toRecord(metadata.mailContent);
    const mailData = { ...metadata, ...nestedMail };
    const subject = this.firstString(mailData, ['mailSubject', 'emailSubject', 'subject', 'title']);
    const sender = this.firstString(mailData, ['mailSender', 'senderEmail', 'sender', 'from', 'sourceSenderEmail']);
    const receivedAt = this.firstString(mailData, ['mailReceivedAt', 'emailReceivedAt', 'receivedAt', 'date', 'sentAt']);
    const body = this.firstString(mailData, ['mailBody', 'emailBody', 'body', 'content', 'rawEmailText', 'preview', 'text', 'sourceText']);
    const isMailOrder = order.source === 'wecom_mail' || order.source === 'gmail';

    if (!subject && !sender && !receivedAt && !body && !isMailOrder) return undefined;

    return {
      subject: subject || `订货单 ${order.id}`,
      sender: sender || (isMailOrder ? '企业微信邮箱' : ''),
      receivedAt: receivedAt || this.formatDateTime(order.createdAt),
      body: body || '当前订单暂无邮件正文内容',
    };
  }

  private toOrderProduct(product: OrderProductRow): OrderProduct {
    return {
      id: product.sku,
      lineId: product.id,
      name: product.name,
      category: product.category,
      spec: product.spec,
      unit: product.unit,
      orderQty: product.orderQty,
      stockQty: product.stockQty,
      orderPrice: this.formatMoneyValue(Number(product.orderPrice)),
      sysPrice: this.formatMoneyValue(Number(product.sysPrice)),
      subtotal: this.formatMoneyValue(Number(product.subtotal)),
      status: product.status as ProductCheckStatus,
      remark: product.remark,
    };
  }

  private toInvoiceLines(value: unknown): InvoiceLine[] {
    const metadata = this.toRecord(value);
    if (!Array.isArray(metadata.lines)) return [];
    return metadata.lines.map((item) => {
      const row = this.toRecord(item);
      const quantity = Math.max(0, Number(row.quantity) || 0);
      const unitPrice = this.parseCurrency(row.unitPrice as string | number | Prisma.Decimal);
      const subtotal = this.parseCurrency(row.subtotal as string | number | Prisma.Decimal) || quantity * unitPrice;
      return {
        id: this.toString(row.id) || this.toString(row.sku),
        lineId: this.toString(row.lineId) || undefined,
        name: this.toString(row.name),
        spec: this.toString(row.spec),
        unit: this.toString(row.unit),
        quantity,
        unitPrice: this.formatMoneyValue(unitPrice),
        subtotal: this.formatMoneyValue(subtotal),
      };
    }).filter((line) => line.id && line.name && line.quantity > 0);
  }

  private toOptionalInvoiceInfo(value: unknown): InvoiceInfo | undefined {
    const metadata = this.toRecord(value);
    const info = this.toRecord(metadata.info);
    const customer = this.toString(info.customer);
    const orderId = this.toString(info.orderId);
    const date = this.toString(info.date);
    if (!customer && !orderId && !date) return undefined;
    return { customer, orderId, date };
  }

  private toInvoiceInfo(value: unknown, fallback: InvoiceInfo): InvoiceInfo {
    const info = this.toRecord(value);
    return {
      customer: this.toString(info.customer) || fallback.customer,
      orderId: this.toString(info.orderId) || fallback.orderId,
      date: this.toString(info.date) || fallback.date,
    };
  }

  private toInventoryItem(item: {
    id: string;
    name: string;
    category: string;
    spec: string;
    stock: number;
    safe: number;
    inboundPending: number;
    outboundPending: number;
    status: string;
  }): InventoryItem {
    return {
      id: item.id,
      name: item.name,
      category: item.category,
      spec: item.spec,
      stock: item.stock,
      safe: item.safe,
      in: item.inboundPending,
      out: item.outboundPending,
      status: item.status as InventoryStatus,
    };
  }

  private toStockMovement(movement: {
    id: string;
    itemId: string;
    itemName: string;
    type: string;
    qty: number;
    operator: string;
    note: string;
    relatedOrderId: string | null;
    documentNo?: string | null;
    warehouse?: string | null;
    supplier?: string | null;
    businessDate?: Date | null;
    createdAt: Date;
  }): StockMovement {
    return {
      id: movement.id,
      itemId: movement.itemId,
      itemName: movement.itemName,
      type: movement.type as StockMovement['type'],
      qty: movement.qty,
      time: this.formatDateTime(movement.createdAt),
      operator: movement.operator,
      note: movement.note,
      relatedOrderId: movement.relatedOrderId ?? undefined,
      documentNo: movement.documentNo ?? undefined,
      warehouse: movement.warehouse ?? undefined,
      supplier: movement.supplier ?? undefined,
      businessDate: movement.businessDate ? this.formatDate(movement.businessDate) : undefined,
    };
  }

  private toTemplate(template: {
    id: string;
    name: string;
    source: string;
    accentColor: string | null;
    config: Prisma.JsonValue;
    createdAt: Date;
  }): InvoiceTemplate {
    return {
      id: template.id,
      name: template.name,
      source: template.source as InvoiceTemplate['source'],
      accentColor: template.accentColor ?? undefined,
      createdAt: this.formatDate(template.createdAt),
      config: this.toRecord(template.config),
    };
  }

  private async parseUploadedOrder(file: UploadedFileLike, state: OrderProcessingState, index: number): Promise<ParsedOrderDraft> {
    const extracted = await this.extractUploadedDocument(file, '订货单');
    const catalog = this.buildCatalog(state);
    const meta = this.extractOrderMeta(extracted);
    const products = this.extractOrderProducts(extracted.rows, extracted.text, catalog);
    if (products.length === 0) {
      throw new BadRequestException(`未能从 ${file.originalname} 识别到商品明细，请上传包含商品编码、数量、单价的表格或可复制文本 PDF`);
    }

    const createdAt = new Date(Date.now() + index);
    const orderId = meta.orderId || this.orderIdFromFileName(file.originalname, createdAt, index);
    const shipDate = meta.shipDate ?? this.formatDate(new Date(createdAt.getTime() + 3 * 86400000));
    const customer = meta.customer || this.customerFromFileName(file.originalname);
    const amount = products.reduce((sum, product) => sum + this.parseCurrency(product.subtotal), 0);
    const hasIssue = this.hasBlockingIssue(products);
    const detail: OrderDetail = {
      id: orderId,
      customer,
      orderId,
      date: shipDate,
      amount: this.formatCurrency(amount),
      invoiceNo: '',
      products,
    };
    const order: OrderSummary = {
      id: orderId,
      customer,
      type: hasIssue ? 'warning' : 'success',
      status: hasIssue ? '待人工确认' : '已识别',
      date: shipDate.slice(5),
      source: 'upload',
      generated: false,
      invoiceExported: false,
      createdAt: createdAt.toISOString(),
    };
    return {
      order,
      detail,
      metadata: {
        originalFileName: file.originalname,
        parser: extracted.provider,
        extension: extracted.extension,
        parsedAt: new Date().toISOString(),
        sourceOrderId: meta.orderId,
      },
    };
  }

  private async parseStockInFiles(files: UploadedFileLike[]): Promise<ParsedStockInDraft> {
    const state = await this.getStateSnapshot();
    const catalog = this.buildCatalog(state);
    const extractedDocs = await Promise.all(files.map((file) => this.extractUploadedDocument(file, '入库单据')));
    const rows = extractedDocs.flatMap((doc) => doc.rows);
    const text = extractedDocs.map((doc) => doc.text).join('\n');
    const meta = this.extractStockInMeta(rows, text);
    const items = this.extractStockItems(rows, text, catalog);
    if (items.length === 0) {
      throw new BadRequestException('未识别到可入库商品，请确认单据中包含商品编码和入库数量');
    }
    return {
      type: meta.type || 'purchase',
      supplier: meta.supplier,
      poNumber: meta.poNumber,
      handler: meta.handler || '当前用户',
      documentNo: meta.documentNo,
      warehouse: meta.warehouse || '主仓 - 上海',
      businessDate: meta.businessDate || this.formatDate(new Date()),
      remark: meta.remark,
      items,
    };
  }

  private async extractUploadedDocument(file: UploadedFileLike, label: string): Promise<ExtractedDocument> {
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException(`${label} ${file.originalname} 没有可解析的文件内容`);
    }
    const extension = this.fileExtension(file.originalname);
    if (extension === 'csv' || extension === 'txt' || extension === 'tsv') {
      const text = this.normalizeExtractedText(file.buffer.toString('utf8'));
      return {
        fileName: file.originalname,
        extension,
        rows: this.parseDelimitedText(text, extension === 'tsv' ? '\t' : ','),
        text,
        provider: 'csv',
      };
    }
    if (extension === 'xlsx' || extension === 'xls') {
      const xlsx = (await import('xlsx')) as typeof import('xlsx');
      const workbook = xlsx.read(file.buffer, { type: 'buffer', cellDates: true });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new BadRequestException(`${label} ${file.originalname} 没有可读取的工作表`);
      const rows = xlsx.utils.sheet_to_json<string[]>(workbook.Sheets[sheetName], { header: 1, raw: false, defval: '' });
      const normalizedRows = rows.map((row) => row.map((cell) => this.toCellString(cell))).filter((row) => row.some(Boolean));
      return {
        fileName: file.originalname,
        extension,
        rows: normalizedRows,
        text: normalizedRows.map((row) => row.join(' ')).join('\n'),
        provider: 'spreadsheet',
      };
    }
    if (extension === 'pdf') {
      const parser = new PDFParse({ data: file.buffer });
      try {
        const parsed = await parser.getText();
        const text = this.normalizeExtractedText(parsed.text ?? '');
        if (!text) throw new BadRequestException(`${label} ${file.originalname} 未提取到可复制文本，请改传表格或启用 OCR 后上传图片`);
        return {
          fileName: file.originalname,
          extension,
          rows: this.rowsFromText(text),
          text,
          provider: 'pdf',
        };
      } finally {
        await parser.destroy();
      }
    }
    if (['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(extension)) {
      if (!(await this.ocrService.hasTencentConfig())) {
        throw new BadRequestException(`${label}图片需要先配置腾讯 OCR，或改传 CSV/XLSX/文本型 PDF`);
      }
      const result = await this.ocrService.recognizeImageText({
        originalname: file.originalname,
        mimetype: file.mimetype,
        buffer: file.buffer,
      });
      const text = this.normalizeExtractedText(result.text);
      return {
        fileName: file.originalname,
        extension,
        rows: this.rowsFromText(text),
        text,
        provider: 'ocr',
      };
    }
    throw new BadRequestException(`${label}暂不支持 ${extension || '未知'} 格式，请上传 CSV、XLSX、文本型 PDF 或配置 OCR 后上传图片`);
  }

  private extractOrderMeta(extracted: ExtractedDocument) {
    return {
      orderId: this.findMetaValue(extracted.rows, extracted.text, ['订单号', '订货单号', '采购单号', 'PO No', 'PO Number', 'Purchase Order']),
      customer: this.findMetaValue(extracted.rows, extracted.text, ['客户', '客户名称', '买方', '采购方', 'Bill To', 'Buyer', 'Customer']),
      shipDate: this.normalizeDateString(this.findMetaValue(extracted.rows, extracted.text, ['发货日', '发货日期', '交期', '交货日期', 'Ship Date', 'Delivery Date'])),
    };
  }

  private extractStockInMeta(rows: string[][], text: string) {
    return {
      type: this.findMetaValue(rows, text, ['入库类型', '类型', 'Type']),
      supplier: this.findMetaValue(rows, text, ['供应商', '供货商', 'Supplier', 'Vendor']),
      poNumber: this.findMetaValue(rows, text, ['采购单', '关联采购单', 'PO No', 'PO Number', 'Purchase Order']),
      handler: this.findMetaValue(rows, text, ['经办人', '操作人', 'Handler', 'Operator']),
      documentNo: this.findMetaValue(rows, text, ['入库单号', '单据号', 'Receipt No', 'Document No']),
      warehouse: this.findMetaValue(rows, text, ['入库仓库', '仓库', 'Warehouse']),
      businessDate: this.normalizeDateString(this.findMetaValue(rows, text, ['入库日期', '日期', 'Receipt Date', 'Date'])),
      remark: this.findMetaValue(rows, text, ['备注', 'Remark', 'Note']),
    };
  }

  private extractOrderProducts(rows: string[][], text: string, catalog: Map<string, CatalogItem>): OrderProduct[] {
    const headerIndex = this.findHeaderRow(rows, ['商品编码', '产品编码', '物料编码', 'sku', 'item', 'part no'], ['订货数量', '订单数量', '数量', 'qty', 'quantity']);
    const products = headerIndex >= 0 ? this.extractOrderProductsFromRows(rows, headerIndex, catalog) : this.extractOrderProductsFromText(text, catalog);
    return products.map((product, index) => ({ ...product, lineId: product.lineId ?? `line-${index + 1}` }));
  }

  private extractOrderProductsFromRows(rows: string[][], headerIndex: number, catalog: Map<string, CatalogItem>): OrderProduct[] {
    const header = rows[headerIndex];
    const skuCol = this.findColumn(header, ['商品编码', '产品编码', '物料编码', 'sku', 'item', 'part no']);
    const nameCol = this.findColumn(header, ['商品名称', '产品名称', '品名', 'description', 'desc', 'name']);
    const qtyCol = this.findColumn(header, ['订货数量', '订单数量', '数量', 'qty', 'quantity']);
    const priceCol = this.findColumn(header, ['订货单价', '订单单价', '单价', 'unit price', 'price']);
    const specCol = this.findColumn(header, ['规格', '型号', 'spec', 'model']);
    const unitCol = this.findColumn(header, ['单位', 'unit']);
    const categoryCol = this.findColumn(header, ['类目', '分类', 'category']);
    const products: OrderProduct[] = [];
    for (const row of rows.slice(headerIndex + 1)) {
      const sku = this.toCellString(row[skuCol]);
      const name = this.toCellString(row[nameCol]);
      const qty = this.parseNumber(row[qtyCol]);
      if ((!sku && !name) || !Number.isFinite(qty) || qty <= 0) continue;
      const catalogItem = this.matchCatalogItem(catalog, sku, name);
      const id = catalogItem?.id ?? sku;
      if (!id) continue;
      const orderPrice = this.parseNumber(row[priceCol]);
      products.push(this.buildOrderProduct({
        id,
        name: name || catalogItem?.name || id,
        category: this.toCellString(row[categoryCol]) || catalogItem?.category || '未分类',
        spec: this.toCellString(row[specCol]) || catalogItem?.spec || '-',
        unit: this.toCellString(row[unitCol]) || catalogItem?.unit || '件',
        orderQty: Math.trunc(qty),
        orderPrice: Number.isFinite(orderPrice) && orderPrice > 0 ? orderPrice : catalogItem?.sysPrice ?? 0,
        catalogItem,
      }));
    }
    return products;
  }

  private extractOrderProductsFromText(text: string, catalog: Map<string, CatalogItem>): OrderProduct[] {
    const products: OrderProduct[] = [];
    const skuPattern = /\b[A-Z]{2,}[-_]?\d{2,}[A-Z0-9-]*\b/i;
    for (const line of text.split('\n')) {
      const sku = line.match(skuPattern)?.[0]?.toUpperCase().replace('_', '-') ?? '';
      if (!sku) continue;
      const numbers = line.match(/(?:¥\s*)?\d+(?:,\d{3})*(?:\.\d+)?/g)?.map((value) => this.parseNumber(value)) ?? [];
      const qty = numbers.find((value) => Number.isFinite(value) && value > 0);
      if (!qty) continue;
      const catalogItem = this.matchCatalogItem(catalog, sku, '');
      const price = numbers.reverse().find((value) => Number.isFinite(value) && value > 0 && value !== qty) ?? catalogItem?.sysPrice ?? 0;
      products.push(this.buildOrderProduct({
        id: catalogItem?.id ?? sku,
        name: catalogItem?.name ?? sku,
        category: catalogItem?.category ?? '未分类',
        spec: catalogItem?.spec ?? '-',
        unit: catalogItem?.unit ?? '件',
        orderQty: Math.trunc(qty),
        orderPrice: price,
        catalogItem,
      }));
    }
    return products;
  }

  private extractStockItems(rows: string[][], text: string, catalog: Map<string, CatalogItem>): StockItemInput[] {
    const headerIndex = this.findHeaderRow(rows, ['商品编码', '产品编码', '物料编码', 'sku', 'item'], ['入库数量', '数量', 'qty', 'quantity']);
    const items = new Map<string, number>();
    if (headerIndex >= 0) {
      const header = rows[headerIndex];
      const skuCol = this.findColumn(header, ['商品编码', '产品编码', '物料编码', 'sku', 'item']);
      const nameCol = this.findColumn(header, ['商品名称', '产品名称', '品名', 'description', 'name']);
      const qtyCol = this.findColumn(header, ['入库数量', '收货数量', '数量', 'qty', 'quantity']);
      for (const row of rows.slice(headerIndex + 1)) {
        const matched = this.matchCatalogItem(catalog, this.toCellString(row[skuCol]), this.toCellString(row[nameCol]));
        const qty = this.parseNumber(row[qtyCol]);
        if (!matched || !Number.isFinite(qty) || qty <= 0) continue;
        items.set(matched.id, (items.get(matched.id) ?? 0) + Math.trunc(qty));
      }
    } else {
      const skuPattern = /\b[A-Z]{2,}[-_]?\d{2,}[A-Z0-9-]*\b/i;
      for (const line of text.split('\n')) {
        const sku = line.match(skuPattern)?.[0]?.toUpperCase().replace('_', '-') ?? '';
        const matched = this.matchCatalogItem(catalog, sku, '');
        if (!matched) continue;
        const qty = line.match(/\d+(?:,\d{3})*(?:\.\d+)?/g)?.map((value) => this.parseNumber(value)).find((value) => Number.isFinite(value) && value > 0);
        if (!qty) continue;
        items.set(matched.id, (items.get(matched.id) ?? 0) + Math.trunc(qty));
      }
    }
    return Array.from(items.entries()).map(([id, qty]) => ({ id, qty }));
  }

  private buildOrderProduct(input: {
    id: string;
    name: string;
    category: string;
    spec: string;
    unit: string;
    orderQty: number;
    orderPrice: number;
    catalogItem?: CatalogItem;
  }): OrderProduct {
    const stockQty = input.catalogItem?.stock ?? 0;
    const sysPrice = input.catalogItem?.sysPrice && input.catalogItem.sysPrice > 0 ? input.catalogItem.sysPrice : input.orderPrice;
    const status = input.catalogItem ? this.computeProductStatus({ stockQty, orderQty: input.orderQty, orderPrice: input.orderPrice, sysPrice }) : '库存不足';
    const remark = input.catalogItem ? this.computeProductRemark({ stockQty, orderQty: input.orderQty, orderPrice: input.orderPrice, sysPrice }) : '未匹配库存 SKU';
    return {
      id: input.id,
      name: input.name,
      category: input.category,
      spec: input.spec,
      unit: input.unit,
      orderQty: input.orderQty,
      stockQty,
      orderPrice: this.formatMoneyValue(input.orderPrice),
      sysPrice: this.formatMoneyValue(sysPrice),
      subtotal: this.formatMoneyValue(input.orderQty * input.orderPrice),
      status,
      remark,
    };
  }

  private buildCatalog(state: OrderProcessingState) {
    const catalog = new Map<string, CatalogItem>();
    for (const item of state.inventory) {
      catalog.set(item.id.toUpperCase(), {
        id: item.id,
        name: item.name,
        category: item.category,
        spec: item.spec,
        unit: '件',
        stock: item.stock,
        sysPrice: 0,
      });
    }
    for (const detail of Object.values(state.orderDetails)) {
      for (const product of detail.products) {
        const key = product.id.toUpperCase();
        const existing = catalog.get(key);
        catalog.set(key, {
          id: product.id,
          name: product.name,
          category: product.category,
          spec: product.spec,
          unit: product.unit,
          stock: existing?.stock ?? product.stockQty,
          sysPrice: this.parseCurrency(product.sysPrice || product.orderPrice),
        });
      }
    }
    return catalog;
  }

  private matchCatalogItem(catalog: Map<string, CatalogItem>, sku: string, name: string) {
    const normalizedSku = sku.toUpperCase().replace('_', '-');
    if (normalizedSku && catalog.has(normalizedSku)) return catalog.get(normalizedSku);
    const normalizedName = this.normalizeKey(name);
    if (!normalizedName) return undefined;
    return Array.from(catalog.values()).find((item) => {
      const itemName = this.normalizeKey(item.name);
      return itemName === normalizedName || itemName.includes(normalizedName) || normalizedName.includes(itemName);
    });
  }

  private findHeaderRow(rows: string[][], skuLabels: string[], qtyLabels: string[]) {
    return rows.findIndex((row) => this.findColumn(row, skuLabels) >= 0 && this.findColumn(row, qtyLabels) >= 0);
  }

  private findColumn(row: string[], labels: string[]) {
    const normalizedLabels = labels.map((label) => this.normalizeKey(label));
    return row.findIndex((cell) => {
      const normalized = this.normalizeKey(cell);
      return normalizedLabels.some((label) => normalized === label || normalized.includes(label));
    });
  }

  private findMetaValue(rows: string[][], text: string, labels: string[]) {
    for (const row of rows) {
      for (let index = 0; index < row.length; index += 1) {
        const cell = this.toCellString(row[index]);
        if (!cell) continue;
        const inlineValue = this.extractInlineMeta(cell, labels);
        if (inlineValue) return inlineValue;
        if (labels.some((label) => this.normalizeKey(cell) === this.normalizeKey(label) || this.normalizeKey(cell).includes(this.normalizeKey(label)))) {
          const next = row.slice(index + 1).map((value) => this.toCellString(value)).find(Boolean);
          if (next) return next;
        }
      }
    }
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const match = text.match(new RegExp(`${escaped}\\s*[:：#-]?\\s*([^\\n,，;；]+)`, 'i'));
      if (match?.[1]) return match[1].trim();
    }
    return '';
  }

  private extractInlineMeta(cell: string, labels: string[]) {
    for (const label of labels) {
      const normalizedCell = this.normalizeKey(cell);
      const normalizedLabel = this.normalizeKey(label);
      if (!normalizedCell.includes(normalizedLabel)) continue;
      const parts = cell.split(/[:：#-]/);
      if (parts.length > 1) return parts.slice(1).join('-').trim();
    }
    return '';
  }

  private parseDelimitedText(text: string, delimiter: ',' | '\t') {
    return text
      .split(/\r?\n/)
      .map((line) => (delimiter === '\t' ? line.split('\t') : this.parseCsvLine(line)).map((cell) => this.toCellString(cell)))
      .filter((row) => row.some(Boolean));
  }

  private parseCsvLine(line: string) {
    const cells: string[] = [];
    let current = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (char === '"' && quoted && next === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = !quoted;
      } else if (char === ',' && !quoted) {
        cells.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    cells.push(current);
    return cells;
  }

  private rowsFromText(text: string) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\t|,| {2,}/).map((cell) => this.toCellString(cell)).filter(Boolean));
  }

  private normalizeExtractedText(text: string) {
    return text.replace(/\r\n/g, '\n').replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }

  private normalizeKey(value: string) {
    return this.toCellString(value).toLowerCase().replace(/\s+/g, '').replace(/[：:：#_-]/g, '');
  }

  private toCellString(value: unknown) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\uFEFF/g, '').trim();
  }

  private parseNumber(value: unknown) {
    const text = this.toCellString(value).replace(/[¥￥,\s]/g, '');
    if (!text) return Number.NaN;
    return Number(text);
  }

  private normalizeDateString(value: string) {
    const text = this.toCellString(value);
    if (!text) return '';
    const normalized = text.replace(/[./]/g, '-');
    const full = normalized.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
    if (full) return `${full[1]}-${full[2].padStart(2, '0')}-${full[3].padStart(2, '0')}`;
    const short = normalized.match(/(\d{1,2})-(\d{1,2})/);
    if (short) return `${new Date().getFullYear()}-${short[1].padStart(2, '0')}-${short[2].padStart(2, '0')}`;
    const compact = normalized.match(/(20\d{2})(\d{2})(\d{2})/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
    return '';
  }

  private orderIdFromFileName(fileName: string, createdAt: Date, index: number) {
    const base = fileName.replace(/\.[^.]+$/, '').trim();
    const existing = base.match(/(?:PO|SO|ORDER)[-_]?\d{4,}[-_]?\d*/i)?.[0]?.replace(/_/g, '-').toUpperCase();
    if (existing) return existing;
    const stamp = createdAt.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    return `PO-UP-${stamp}-${index + 1}`;
  }

  private fileExtension(fileName: string) {
    return fileName.trim().toLowerCase().split('.').pop() ?? '';
  }

  private detectInvoiceTemplateFields(text: string) {
    const candidates = [
      ['invoiceNo', ['invoice', '发票号', '发票号码']],
      ['orderNo', ['purchase order', 'po no', '订单号']],
      ['customer', ['bill to', '客户', 'buyer']],
      ['seller', ['seller', '供应商', '销售方']],
      ['shipTo', ['ship to', '收货方']],
      ['date', ['date', '日期']],
      ['amount', ['total', 'amount', '金额', '合计']],
      ['bank', ['bank', 'wire', '银行']],
    ] as const;
    const normalized = text.toLowerCase();
    const fields = candidates.filter(([, labels]) => labels.some((label) => normalized.includes(label))).map(([field]) => field);
    return fields.length > 0 ? fields : ['invoiceNo', 'orderNo', 'customer', 'date', 'amount'];
  }

  private ensureStateOrderDetail(state: OrderProcessingState, orderId: string): OrderDetail {
    const existing = state.orderDetails[orderId];
    if (existing) return existing;
    const order = this.findStateOrder(state, orderId);
    const template = state.orderDetails['PO-20260524-01'];
    const products = template.products
      .slice(0, 5)
      .map((product) => ({
        ...product,
        stockQty: this.findStateInventoryItem(state, product.id).stock,
      }))
      .map((product) => ({
        ...product,
        status: this.computeProductStatus(product),
        remark: this.computeProductRemark(product),
      }));
    const amount = products.reduce((sum, product) => sum + this.parseCurrency(product.subtotal), 0);
    const detail: OrderDetail = {
      id: order.id,
      customer: order.customer,
      orderId: order.id,
      date: `${new Date(order.createdAt).getFullYear()}-${order.date}`,
      amount: this.formatCurrency(amount),
      invoiceNo: this.nextStateInvoiceNo(state),
      products,
    };
    state.orderDetails[orderId] = detail;
    return detail;
  }

  private async refreshProductChecksForSkus(skus: string[]) {
    const uniqueSkus = Array.from(new Set(skus.filter(Boolean)));
    if (uniqueSkus.length === 0) return;
    const [items, products] = await Promise.all([
      this.prisma.orderProcessingInventoryItem.findMany({ where: { id: { in: uniqueSkus } } }),
      this.prisma.orderProcessingOrderProduct.findMany({ where: { sku: { in: uniqueSkus } } }),
    ]);
    const itemMap = new Map(items.map((item) => [item.id, item]));
    const changedOrderIds = new Set<string>();

    for (const product of products) {
      const item = itemMap.get(product.sku);
      if (!item) continue;
      const next = {
        stockQty: item.stock,
        orderQty: product.orderQty,
        orderPrice: Number(product.orderPrice),
        sysPrice: Number(product.sysPrice),
      };
      await this.prisma.orderProcessingOrderProduct.update({
        where: { id: product.id },
        data: {
          stockQty: item.stock,
          status: this.computeProductStatus(next),
          remark: this.computeProductRemark(next),
        },
      });
      changedOrderIds.add(product.orderId);
    }

    for (const orderId of changedOrderIds) {
      await this.refreshOrderStatus(orderId);
    }
  }

  private nextStateInvoiceNo(state: OrderProcessingState) {
    const used = new Set(Object.values(state.orderDetails).map((detail) => detail.invoiceNo).filter(Boolean));
    let index = Object.keys(state.orderDetails).length + 1;
    const year = new Date().getFullYear();
    let next = `CI${year}-${String(index).padStart(3, '0')}`;
    while (used.has(next)) {
      index += 1;
      next = `CI${year}-${String(index).padStart(3, '0')}`;
    }
    return next;
  }

  private async refreshOrderStatus(orderId: string) {
    const order = await this.prisma.orderProcessingOrder.findUnique({
      where: { id: orderId },
      include: { products: true },
    });
    if (!order || order.generated) return;
    const products = order.products.map((product) => this.toOrderProduct(product));
    const hasIssue = this.hasBlockingIssue(products);
    await this.prisma.orderProcessingOrder.update({
      where: { id: orderId },
      data: {
        status: hasIssue ? '待人工确认' : '已识别',
        type: hasIssue ? 'warning' : 'success',
      },
    });
  }

  private buildInventorySummary(items: InventoryItem[]) {
    return {
      totalSku: items.length,
      normal: items.filter((item) => item.status === '正常').length,
      low: items.filter((item) => item.status === '偏低').length,
      shortage: items.filter((item) => item.status === '缺货').length,
    };
  }

  private paginate<T>(items: T[], page: number, pageSize: number): PageResult<T> {
    const total = items.length;
    return this.paginateRows(items.slice((page - 1) * pageSize, page * pageSize), total, page, pageSize);
  }

  private paginateRows<T>(items: T[], total: number, page: number, pageSize: number): PageResult<T> {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);
    return { items, page: safePage, pageSize, total, totalPages };
  }

  private computeProductStatus(product: { stockQty: number; orderQty: number; orderPrice: string | number | Prisma.Decimal; sysPrice: string | number | Prisma.Decimal }): ProductCheckStatus {
    if (product.stockQty < product.orderQty) return '库存不足';
    if (this.parseCurrency(product.orderPrice) !== this.parseCurrency(product.sysPrice)) return '价格差异';
    return '通过';
  }

  private computeProductRemark(product: { stockQty: number; orderQty: number; orderPrice: string | number | Prisma.Decimal; sysPrice: string | number | Prisma.Decimal }) {
    if (product.stockQty < product.orderQty) return `缺 ${product.orderQty - product.stockQty} 件`;
    const diff = this.parseCurrency(product.orderPrice) - this.parseCurrency(product.sysPrice);
    if (diff !== 0) return diff > 0 ? `订单价高 ¥${diff.toFixed(2)}` : `订单价低 ¥${Math.abs(diff).toFixed(2)}`;
    return '匹配成功';
  }

  private computeInventoryStatus(item: Pick<InventoryItem, 'stock' | 'safe'>): InventoryStatus {
    if (item.stock <= Math.max(1, Math.floor(item.safe * 0.5))) return '缺货';
    if (item.stock < item.safe) return '偏低';
    return '正常';
  }

  private hasBlockingIssue(products: OrderProduct[]) {
    return products.some((product) => product.status !== '通过');
  }

  private sumProductAmount(products: OrderProduct[]) {
    return products.reduce((sum, product) => sum + this.parseCurrency(product.subtotal), 0);
  }

  private buildInvoiceLines(products: OrderProductRow[], draftLines: InvoiceDraftLineInput[]): InvoiceLine[] {
    const productByLineId = new Map(products.map((product) => [product.id, product]));
    const productBySku = new Map(products.map((product) => [product.sku, product]));
    const sourceLines: InvoiceDraftLineInput[] =
      draftLines.length > 0 ?
        draftLines :
        products.map((product, index) => ({
          lineId: product.id,
          sku: product.sku,
          name: product.name,
          spec: product.spec,
          unit: product.unit,
          quantity: product.orderQty,
          unitPrice: Number(product.orderPrice),
          sortOrder: index,
        }));

    return sourceLines.map((line, index) => {
      const product = (line.lineId ? productByLineId.get(line.lineId) : null) ?? (line.sku ? productBySku.get(line.sku) : null);
      if (!product) throw new BadRequestException(`第 ${index + 1} 行商品不在当前订货单中`);
      const subtotal = line.subtotal ?? line.quantity * line.unitPrice;
      return {
        id: product.sku,
        lineId: product.id,
        name: line.name || product.name,
        spec: line.spec || product.spec,
        unit: line.unit || product.unit,
        quantity: line.quantity,
        unitPrice: this.formatMoneyValue(line.unitPrice),
        subtotal: this.formatMoneyValue(subtotal),
      };
    });
  }

  private sumInvoiceLines(lines: InvoiceLine[]) {
    return lines.reduce((sum, line) => sum + this.parseCurrency(line.subtotal), 0);
  }

  private async nextInvoiceNo(tx: PrismaTx) {
    const year = new Date().getFullYear();
    const counter = await tx.orderProcessingInvoiceCounter.upsert({
      where: { year },
      create: { year, nextValue: 1 },
      update: { nextValue: { increment: 1 } },
    });
    return `CI${year}-${String(counter.nextValue).padStart(3, '0')}`;
  }

  private findStateOrder(state: OrderProcessingState, orderId: string): OrderSummary {
    const order = state.orders.find((item) => item.id === orderId);
    if (!order) throw new NotFoundException('订单不存在');
    return order;
  }

  private findStateInventoryItem(state: OrderProcessingState, itemId: string): InventoryItem {
    const item = state.inventory.find((entry) => entry.id === itemId);
    if (!item) throw new NotFoundException(`商品 ${itemId} 不存在`);
    return item;
  }

  private toStockItems(value: unknown): StockItemInput[] {
    if (!Array.isArray(value)) return [];
    const aggregated = new Map<string, number>();
    value.forEach((item, index) => {
      const row = item as Record<string, unknown>;
      const id = this.toString(row.id);
      if (!id && !this.toString(row.qty)) return;
      if (!id) throw new BadRequestException(`第 ${index + 1} 行入库商品不能为空`);
      const qty = this.toPositiveInteger(row.qty, `第 ${index + 1} 行入库数量`);
      aggregated.set(id, (aggregated.get(id) ?? 0) + qty);
    });
    return Array.from(aggregated.entries()).map(([id, qty]) => ({ id, qty }));
  }

  private toInvoiceDraftLines(value: unknown): InvoiceDraftLineInput[] {
    if (!Array.isArray(value)) return [];
    return value.map((item, index) => {
      const row = this.toRecord(item);
      const lineId = this.toString(row.lineId);
      const sku = this.toString(row.id) || this.toString(row.sku);
      if (!lineId && !sku) throw new BadRequestException(`第 ${index + 1} 行商品不能为空`);

      return {
        lineId,
        sku,
        name: this.toString(row.name),
        spec: this.toString(row.spec),
        unit: this.toString(row.unit),
        quantity: this.toPositiveInteger(row.quantity ?? row.orderQty ?? row.qty, `第 ${index + 1} 行数量`),
        unitPrice: this.toNonNegativeMoney(row.unitPrice ?? row.orderPrice ?? row.price, `第 ${index + 1} 行单价`),
        subtotal: row.subtotal === undefined ? undefined : this.toNonNegativeMoney(row.subtotal, `第 ${index + 1} 行金额`),
        sortOrder: index,
      };
    });
  }

  private toString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private firstString(record: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return '';
  }

  private toRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  }

  private toBoolean(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value === 'true';
    return fallback;
  }

  private settingString(value: unknown) {
    return typeof value === 'string' ? value : '';
  }

  private toPositiveInteger(value: unknown, label: string) {
    const number = Number(value);
    if (!Number.isFinite(number) || !Number.isInteger(number) || number <= 0) {
      throw new BadRequestException(`${label}必须是大于 0 的整数`);
    }
    return number;
  }

  private toNonNegativeInteger(value: unknown, label: string) {
    const number = Number(value);
    if (!Number.isFinite(number) || !Number.isInteger(number) || number < 0) {
      throw new BadRequestException(`${label}必须是大于等于 0 的整数`);
    }
    return number;
  }

  private toNonNegativeMoney(value: unknown, label: string) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
      throw new BadRequestException(`${label}必须是大于等于 0 的金额`);
    }
    return Math.round(number * 100) / 100;
  }

  private toOptionalDate(value: unknown, label: string) {
    const text = this.toString(value);
    if (!text) return null;
    const normalized = this.normalizeDateString(text) || text;
    const date = new Date(`${normalized}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`${label}格式不正确`);
    return date;
  }

  private parseReminderRule(value: unknown): ReminderRule {
    const initial = createInitialOrderProcessingState().reminderRule;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return initial;
    const record = value as Record<string, unknown>;
    return {
      enabled: this.toBoolean(record.enabled, initial.enabled),
      daysBefore: Math.max(0, Number(record.daysBefore ?? initial.daysBefore) || initial.daysBefore),
    };
  }

  private toPage(value: unknown) {
    return Math.max(1, Number(value ?? 1) || 1);
  }

  private toPageSize(value: unknown, fallback: number) {
    return Math.min(10000, Math.max(1, Number(value ?? fallback) || fallback));
  }

  private resolveInventoryDateRange(query: Record<string, unknown>): DateRange | null {
    const filter = this.toString(query.timeFilter);
    if (!filter || filter === 'all') return null;
    const now = new Date();
    if (filter === 'today') return { start: this.startOfDay(now), end: this.endOfDay(now) };
    if (filter === 'week') {
      const start = this.startOfDay(new Date(now));
      start.setUTCDate(start.getUTCDate() - 6);
      return { start, end: this.endOfDay(now) };
    }
    if (filter === 'month') {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { start, end: this.endOfDay(now) };
    }
    if (filter === 'custom') {
      const start = this.toOptionalDate(query.startDate, '开始日期');
      const end = this.toOptionalDate(query.endDate, '结束日期');
      if (!start || !end) throw new BadRequestException('自定义时间筛选需要开始日期和结束日期');
      const range = { start: this.startOfDay(start), end: this.endOfDay(end) };
      if (range.start > range.end) throw new BadRequestException('开始日期不能晚于结束日期');
      return range;
    }
    return null;
  }

  private buildMovementDateWhere(range: DateRange | null): Prisma.OrderProcessingStockMovementWhereInput {
    if (!range) return {};
    const dateFilter = { gte: range.start, lte: range.end };
    return {
      OR: [
        { businessDate: dateFilter },
        { businessDate: null, createdAt: dateFilter },
      ],
    };
  }

  private startOfDay(date: Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }

  private endOfDay(date: Date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
  }

  private toSource(value: unknown): OrderSource | null {
    if (value === 'gmail') return 'wecom_mail';
    return value === 'wecom_mail' || value === 'upload' ? value : null;
  }

  private parseCurrency(value: string | number | Prisma.Decimal) {
    if (typeof value === 'number') return value;
    return Number(String(value).replace(/[¥,\s]/g, '')) || 0;
  }

  private formatCurrency(value: number | Prisma.Decimal) {
    return `¥${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private formatMoneyValue(value: number | Prisma.Decimal) {
    return Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private csvCell(value: unknown) {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  private buildInvoicePdf(input: { detail: OrderDetail; info: InvoiceInfo; lines: InvoiceExportLine[]; templateName: string }) {
    const rowsPerPage = 12;
    const totalPages = Math.max(1, Math.ceil(input.lines.length / rowsPerPage));
    const pages = Array.from({ length: totalPages }, (_, pageIndex) => {
      const rows = input.lines.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage);
      return this.buildInvoicePdfPage(input, rows, pageIndex + 1, totalPages);
    });
    return this.renderPdfDocument(pages);
  }

  private buildInvoicePdfPage(
    input: { detail: OrderDetail; info: InvoiceInfo; lines: InvoiceExportLine[]; templateName: string },
    rows: InvoiceExportLine[],
    pageNo: number,
    totalPages: number,
  ) {
    const commands: string[] = [];
    const tableX = 42;
    const tableWidth = 511;
    const tableTop = 586;
    const headerHeight = 30;
    const rowHeight = 30;
    const headerBottom = tableTop - headerHeight;
    const isLastPage = pageNo === totalPages;
    const columns = [
      { label: 'SKU', x: 54, w: 58, align: 'left' as const },
      { label: '商品名称', x: 114, w: 152, align: 'left' as const },
      { label: '规格', x: 270, w: 70, align: 'left' as const },
      { label: '数量', x: 342, w: 62, align: 'right' as const },
      { label: '单价', x: 414, w: 72, align: 'right' as const },
      { label: '金额', x: 492, w: 58, align: 'right' as const },
    ];

    commands.push(this.pdfFillRect(0, 0, 595, 842, '#f8fafc'));
    commands.push(this.pdfFillRect(36, 744, 523, 72, '#0f2a4a'));
    commands.push(this.pdfText(54, 786, '商业发票', 22, '#ffffff'));
    commands.push(this.pdfText(54, 765, 'Commercial Invoice', 10, '#dbeafe'));
    commands.push(this.pdfText(540, 788, input.detail.invoiceNo || '未生成', 13, '#ffffff', 'right', 190));
    commands.push(this.pdfText(540, 768, `模板：${input.templateName}`, 9, '#bfdbfe', 'right', 220));

    commands.push(this.pdfFillRect(42, 640, 511, 86, '#ffffff'));
    commands.push(this.pdfStrokeRect(42, 640, 511, 86, '#e2e8f0'));
    commands.push(this.pdfText(60, 704, '客户', 9, '#64748b'));
    commands.push(this.pdfText(116, 704, input.info.customer || '-', 11, '#0f172a', 'left', 300));
    commands.push(this.pdfText(60, 682, '订单号', 9, '#64748b'));
    commands.push(this.pdfText(116, 682, input.info.orderId || '-', 11, '#0f172a', 'left', 240));
    commands.push(this.pdfText(60, 660, '发货日', 9, '#64748b'));
    commands.push(this.pdfText(116, 660, input.info.date || '-', 11, '#0f172a', 'left', 220));
    commands.push(this.pdfText(536, 704, '金额', 9, '#64748b', 'right', 120));
    commands.push(this.pdfText(536, 676, input.detail.amount, 20, '#2563eb', 'right', 180));

    commands.push(this.pdfText(tableX, 612, totalPages > 1 ? `商品明细（第 ${pageNo} / ${totalPages} 页）` : '商品明细', 13, '#0f172a'));
    commands.push(this.pdfFillRect(tableX, headerBottom, tableWidth, headerHeight, '#eef4ff'));
    commands.push(this.pdfStrokeRect(tableX, headerBottom, tableWidth, headerHeight, '#dbe5f2'));
    columns.forEach((column) => {
      commands.push(this.pdfText(column.align === 'right' ? column.x + column.w : column.x, tableTop - 19, column.label, 9, '#334155', column.align, column.w));
    });

    rows.forEach((line, index) => {
      const rowBottom = headerBottom - (index + 1) * rowHeight;
      const textY = rowBottom + 11;
      if (index % 2 === 1) commands.push(this.pdfFillRect(tableX, rowBottom, tableWidth, rowHeight, '#fbfdff'));
      commands.push(this.pdfLine(tableX, rowBottom, tableX + tableWidth, rowBottom, '#edf2f7', 0.6));
      commands.push(this.pdfText(columns[0].x, textY, line.id, 9, '#334155', 'left', columns[0].w));
      commands.push(this.pdfText(columns[1].x, textY, line.name, 9, '#0f172a', 'left', columns[1].w));
      commands.push(this.pdfText(columns[2].x, textY, line.spec || '-', 9, '#475569', 'left', columns[2].w));
      commands.push(this.pdfText(columns[3].x + columns[3].w, textY, `${line.quantity} ${line.unit}`, 9, '#0f172a', 'right', columns[3].w));
      commands.push(this.pdfText(columns[4].x + columns[4].w, textY, line.unitPrice, 9, '#334155', 'right', columns[4].w));
      commands.push(this.pdfText(columns[5].x + columns[5].w, textY, line.subtotal, 9, '#0f172a', 'right', columns[5].w));
    });

    if (isLastPage) {
      const afterRowsBottom = headerBottom - rows.length * rowHeight;
      const totalTop = Math.max(108, afterRowsBottom - 56);
      commands.push(this.pdfLine(tableX, totalTop + 42, tableX + tableWidth, totalTop + 42, '#dbe5f2', 0.8));
      commands.push(this.pdfText(382, totalTop + 18, '合计', 13, '#0f172a'));
      commands.push(this.pdfText(540, totalTop + 18, input.detail.amount, 18, '#2563eb', 'right', 160));
    }

    commands.push(this.pdfText(42, 48, `Invoice ${input.detail.invoiceNo || input.info.orderId}`, 8, '#94a3b8'));
    commands.push(this.pdfText(298, 48, `第 ${pageNo} / ${totalPages} 页`, 8, '#94a3b8', 'center', 120));
    commands.push(this.pdfText(553, 48, 'INOGI AI Office', 8, '#94a3b8', 'right', 140));
    return commands.join('\n');
  }

  private renderPdfDocument(pageContents: string[]) {
    const objects: Array<{ number: number; body: string }> = [
      { number: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
      {
        number: 2,
        body: `<< /Type /Pages /Kids [${pageContents.map((_, index) => `${5 + index * 2} 0 R`).join(' ')}] /Count ${pageContents.length} >>`,
      },
      { number: 3, body: '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>' },
      {
        number: 4,
        body: '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 5 >> /DW 1000 >>',
      },
    ];

    pageContents.forEach((content, index) => {
      const pageObject = 5 + index * 2;
      const contentObject = pageObject + 1;
      objects.push({
        number: pageObject,
        body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`,
      });
      objects.push({
        number: contentObject,
        body: `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`,
      });
    });

    objects.sort((a, b) => a.number - b.number);
    let output = '%PDF-1.4\n% INOGI AI Office\n';
    const offsets: number[] = [0];
    for (const object of objects) {
      offsets[object.number] = Buffer.byteLength(output, 'utf8');
      output += `${object.number} 0 obj\n${object.body}\nendobj\n`;
    }

    const xrefOffset = Buffer.byteLength(output, 'utf8');
    const maxObject = Math.max(...objects.map((object) => object.number));
    output += `xref\n0 ${maxObject + 1}\n`;
    output += '0000000000 65535 f \n';
    for (let index = 1; index <= maxObject; index += 1) {
      output += `${String(offsets[index] ?? 0).padStart(10, '0')} 00000 n \n`;
    }
    output += `trailer\n<< /Size ${maxObject + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(output, 'utf8');
  }

  private pdfText(x: number, y: number, value: unknown, size: number, color = '#0f172a', align: 'left' | 'right' | 'center' = 'left', maxWidth = 220) {
    const text = this.fitPdfText(String(value ?? ''), maxWidth, size);
    const width = this.estimatePdfTextWidth(text, size);
    const textX = align === 'right' ? x - width : align === 'center' ? x - width / 2 : x;
    return `BT\n/F1 ${size} Tf\n${this.pdfColor(color)} rg\n${this.pdfNumber(textX)} ${this.pdfNumber(y)} Td\n<${this.utf16BeHex(text)}> Tj\nET`;
  }

  private pdfFillRect(x: number, y: number, width: number, height: number, color: string) {
    return `q\n${this.pdfColor(color)} rg\n${this.pdfNumber(x)} ${this.pdfNumber(y)} ${this.pdfNumber(width)} ${this.pdfNumber(height)} re f\nQ`;
  }

  private pdfStrokeRect(x: number, y: number, width: number, height: number, color: string) {
    return `q\n${this.pdfColor(color)} RG\n0.8 w\n${this.pdfNumber(x)} ${this.pdfNumber(y)} ${this.pdfNumber(width)} ${this.pdfNumber(height)} re S\nQ`;
  }

  private pdfLine(x1: number, y1: number, x2: number, y2: number, color: string, width = 1) {
    return `q\n${this.pdfColor(color)} RG\n${this.pdfNumber(width)} w\n${this.pdfNumber(x1)} ${this.pdfNumber(y1)} m ${this.pdfNumber(x2)} ${this.pdfNumber(y2)} l S\nQ`;
  }

  private pdfColor(hex: string) {
    const clean = hex.replace('#', '');
    const value = clean.length === 3 ? clean.split('').map((char) => `${char}${char}`).join('') : clean;
    const red = Number.parseInt(value.slice(0, 2), 16) / 255;
    const green = Number.parseInt(value.slice(2, 4), 16) / 255;
    const blue = Number.parseInt(value.slice(4, 6), 16) / 255;
    return [red, green, blue].map((channel) => this.pdfNumber(Number.isFinite(channel) ? channel : 0)).join(' ');
  }

  private pdfNumber(value: number) {
    return Number(value.toFixed(3)).toString();
  }

  private utf16BeHex(text: string) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    const littleEndian = Buffer.from(normalized, 'utf16le');
    const bigEndian = Buffer.alloc(littleEndian.length);
    for (let index = 0; index < littleEndian.length; index += 2) {
      bigEndian[index] = littleEndian[index + 1];
      bigEndian[index + 1] = littleEndian[index];
    }
    return bigEndian.toString('hex').toUpperCase();
  }

  private fitPdfText(text: string, maxWidth: number, size: number) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (this.estimatePdfTextWidth(normalized, size) <= maxWidth) return normalized;
    let result = '';
    for (const char of Array.from(normalized)) {
      if (this.estimatePdfTextWidth(`${result}${char}...`, size) > maxWidth) break;
      result += char;
    }
    return result ? `${result}...` : '';
  }

  private estimatePdfTextWidth(text: string, size: number) {
    return Array.from(text).reduce((width, char) => {
      const code = char.codePointAt(0) ?? 0;
      if (code > 0xff) return width + size;
      if (/[MW@#%]/.test(char)) return width + size * 0.75;
      if (/[ilI1.,:;|]/.test(char)) return width + size * 0.32;
      return width + size * 0.56;
    }, 0);
  }

  private parseDate(value: string) {
    return new Date(`${value}T00:00:00.000Z`);
  }

  private parseShipDate(value: string, fallbackYear = new Date().getFullYear()) {
    const normalized = value.length === 5 ? `${fallbackYear}-${value}` : value;
    return this.parseDate(normalized);
  }

  private parseDateTime(value: string) {
    return new Date(`${value.replace(' ', 'T')}:00.000Z`);
  }

  private formatDate(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private formatMonthDay(date: Date) {
    return date.toISOString().slice(5, 10);
  }

  private formatDateTime(date: Date) {
    const iso = date.toISOString();
    return `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
  }

  private formatFileSize(size: number) {
    if (!size) return '模拟文件';
    if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }

  private customerFromFileName(fileName: string) {
    const base = fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
    return base && !/^manual order$/i.test(base) ? `${base.slice(0, 18)}有限公司` : '手动上传客户有限公司';
  }
}
