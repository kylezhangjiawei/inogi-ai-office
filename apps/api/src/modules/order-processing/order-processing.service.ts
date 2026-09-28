import { InventoryStockService } from '../inventory-stock/inventory-stock.service';
import { OrderStockService } from './order-stock.service';
import { retiredInventoryWrite } from './retired-inventory';
import type { ProcActor } from '../procurement/procurement.types';
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PDFParse } from 'pdf-parse';

import { PrismaService } from '../../prisma/prisma.service';
import { OcrService } from '../ocr';
import { MailCredentials, MailIngestionService } from '../resume-screening/mail-ingestion.service';
import { IngestedMail } from '../resume-screening/resume-screening.types';
import { SecureConfigService } from '../security/secure-config.service';
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
  PurchaseOrder,
  PurchaseOrderLine,
  PurchaseOrderStats,
  PurchaseOrderStatus,
  ReminderRule,
  StockMovement,
} from './order-processing.types';

const STATE_KEY = 'order-processing:state:v1';
const ACTIVE_TEMPLATE_SETTING = 'active-template-id';
const REMINDER_RULE_SETTING = 'reminder-rule';
const DEMO_SEED_CLEARED_SETTING = 'demo-seed-cleared';
const DEFAULT_PAGE_SIZE = 12;
const PRODUCT_PAGE_SIZE = 8;
const ORDER_MAIL_LAST_UID_PREFIX = 'order-processing:wecom-mail:last-uid';
const ORDER_MAIL_REQUIRED_SUBJECT = 'PO';
const ORDER_MAIL_REQUIRED_SENDER = 'Paul Zhang';
const ORDER_MAIL_DEFAULT_SINCE_HOURS = 168;
const ORDER_MAIL_DEFAULT_LIMIT = 20;

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
type InvoicePdfLayout = 'weoxy' | 'inogi' | 'generic';
type InvoicePdfInput = {
  detail: OrderDetail;
  info: InvoiceInfo;
  lines: InvoiceExportLine[];
  templateName: string;
  templateId?: string;
  templateConfig?: Record<string, unknown>;
};
type InvoicePdfProfile = {
  sellerName: string;
  sellerEmail: string;
  billingAddress: string[];
  shippingAddress: string[];
  incoterm: string;
  paymentTerms: string;
  paymentInstructions: string[];
  additionalNotes: string[];
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
type PurchaseOrderImportDraft = Omit<PurchaseOrder, 'items'> & { items: PurchaseOrderLine[] };
type ExtractedDocument = {
  fileName: string;
  extension: string;
  rows: string[][];
  text: string;
  provider: 'spreadsheet' | 'csv' | 'pdf' | 'ocr' | 'mail';
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
type PurchaseOrderRow = Prisma.OrderProcessingPurchaseOrderGetPayload<{
  include: { lines: true };
}>;

@Injectable()
export class OrderProcessingService {
  private readonly logger = new Logger(OrderProcessingService.name);
  private initializationPromise: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ocrService: OcrService,
    private readonly mailIngestionService: MailIngestionService,
    private readonly secureConfigService: SecureConfigService,
    private readonly inventoryStock: InventoryStockService = new InventoryStockService(prisma),
    private readonly orderStock: OrderStockService = new OrderStockService(prisma, inventoryStock),
  ) {}

  async getWorkbench(query: Record<string, unknown>, actor: ProcActor) {
    this.orderStock.access(actor);
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
    const rawWarehouses = query.warehouses;
    if (rawWarehouses !== undefined && (typeof rawWarehouses !== 'string' || rawWarehouses.length > 5000)) throw new BadRequestException('仓库范围无效');
    const warehouses = typeof rawWarehouses === 'string' ? rawWarehouses.split('|').map(value => value.trim()).filter(Boolean) : [];
    if (orderDetails && selectedOrder) {
      const checks = await this.orderStock.check(selectedOrder.products, { kind: 'selected', warehouses });
      orderDetails.products = orderDetails.products.map(product => ({ ...product, stockCheck: checks.find(row => row.lineId === product.lineId) }));
    }
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

  async syncWecomMailOrders(payload: Record<string, unknown> = {}) {
    await this.ensureInitialized();
    const mailboxId = this.toString(payload.mailboxId);
    const credentials = await this.resolveOrderMailCredentials(mailboxId);
    const state = await this.getStateSnapshot();
    const runtimeKey = `${ORDER_MAIL_LAST_UID_PREFIX}:${credentials.configId}:${credentials.credentials.mailbox}`;
    const runtimeState = await this.prisma.runtimeState.findUnique({ where: { key: runtimeKey } });
    const ignoreLastUid = this.toBoolean(payload.ignoreLastUid, false);
    const lastUid = ignoreLastUid ? null : runtimeState ? Number(runtimeState.value) : null;
    const sinceHours = this.toMailSyncPositiveInt(payload.sinceHours, ORDER_MAIL_DEFAULT_SINCE_HOURS);
    const limit = this.toMailSyncPositiveInt(payload.limit, ORDER_MAIL_DEFAULT_LIMIT);

    const { mails, latestUid, scannedCount } = await this.mailIngestionService.fetchCandidateEmails({
      sinceHours,
      limit,
      lastUid,
      credentials: credentials.credentials,
      includeAttachments: true,
    });
    const matchedMails = mails.filter((mail) => this.isOrderMailCandidate(mail));
    const created: OrderSummary[] = [];
    const skipped: Array<{ subject: string; sender: string; reason: string }> = [];
    const retryBoundaryUids: number[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const [index, mail] of matchedMails.entries()) {
        const parsed = await this.parseOrderMail(mail, state, index);
        if (!parsed) {
          skipped.push({ subject: mail.subject, sender: this.mailSenderLabel(mail), reason: '未识别到商品明细' });
          if (mail.imapUid) retryBoundaryUids.push(mail.imapUid);
          continue;
        }

        const existing = await tx.orderProcessingOrder.findFirst({
          where: {
            OR: [
              { id: parsed.order.id },
              { metadata: { path: ['mailUniqueKey'], equals: mail.uniqueKey } },
            ],
          },
        });
        if (existing) {
          skipped.push({ subject: mail.subject, sender: this.mailSenderLabel(mail), reason: `已存在订货单 ${existing.id}` });
          continue;
        }

        await this.insertOrderDetail(tx, parsed.order, parsed.detail, `mail:${mail.messageId}`, parsed.metadata as Prisma.InputJsonValue);
        created.push(parsed.order);
        state.orders.unshift(parsed.order);
        state.orderDetails[parsed.detail.id] = parsed.detail;
      }

      const persistedLatestUid = ignoreLastUid ? null : this.resolveSafeMailCursor(latestUid, retryBoundaryUids);
      if (persistedLatestUid) {
        await tx.runtimeState.upsert({
          where: { key: runtimeKey },
          create: { key: runtimeKey, value: String(persistedLatestUid) },
          update: { value: String(persistedLatestUid) },
        });
      }
    });
    const persistedLatestUid = ignoreLastUid ? latestUid : this.resolveSafeMailCursor(latestUid, retryBoundaryUids);

    return {
      scannedCount,
      matchedCount: matchedMails.length,
      created,
      skipped,
      latestUid: persistedLatestUid,
      filter: {
        subject: `主题包含 ${ORDER_MAIL_REQUIRED_SUBJECT}`,
        sender: `发件人 ${ORDER_MAIL_REQUIRED_SENDER}（含转发原始发件人）`,
      },
      message:
        created.length > 0
          ? `邮箱同步完成，已按 PO + Paul Zhang 规则新增 ${created.length} 张订货单。`
          : `本次已检查 ${scannedCount} 封邮件，未新增符合 PO + Paul Zhang 规则的订货单。`,
    };
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
    const selectedTemplateId = detail.invoiceTemplateId ?? settings.activeTemplateId;
    const selectedTemplate = settings.templates.find((template) => template.id === selectedTemplateId);
    const templateName = selectedTemplate?.name ?? '商业发票模板';
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
        subtotal: this.formatMoneyValue(product.orderQty * this.parseCurrency(product.orderPrice)),
        status: product.status,
      }));
    const pdf = this.buildInvoicePdf({
      detail,
      info: exportInfo,
      lines: exportLines,
      templateName,
      templateId: selectedTemplateId,
      templateConfig: selectedTemplate?.config ?? {},
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
    const templateText = extractedDocs.map((doc) => doc.text).join('\n');
    const detectedFields = this.detectInvoiceTemplateFields(templateText);
    const pdfLayout = this.detectInvoicePdfLayout(templateText);
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
            pdfLayout,
            pdf: {
              title: pdfLayout === 'inogi' ? 'Final Consolidated Balance Invoice' : 'Commercial Invoice',
              subtitle: pdfLayout === 'inogi' ? 'INOGI Invoice Service' : 'AI Generated Invoice Template',
              primaryColor: pdfLayout === 'inogi' ? '#0a2342' : '#4f46e5',
              accentColor: '#8b5cf6',
              tableHeaderColor: '#eef2ff',
              footerNote: 'Generated from the selected AI invoice template.',
            },
            headerStyle:
              pdfLayout === 'inogi'
                ? 'final-consolidated-balance-invoice'
              : pdfLayout === 'weoxy'
                ? 'standard-commercial-invoice'
                : 'compact-commercial-invoice',
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

  async getInventory(query: Record<string, unknown>, actor: ProcActor) {
    this.inventoryAccess(actor);
    return this.inventoryStock.inventory(query);
  }

  async getInventoryDetail(itemId: string, actor: ProcActor) {
    this.inventoryAccess(actor);
    const view = await this.inventoryStock.inventory({ q: itemId, pageSize: 10000 });
    const item = view.inventory.items.find(row => row.id === itemId);
    if (!item) throw new NotFoundException('库存物料不存在');
    return { item, movements: view.ledgerMovements.filter(row => row.itemId === itemId), relatedOrders: [], source: 'tplus', readOnly: true };
  }

  async recognizeStockIn(files: UploadedFileLike[] = []) {
    return retiredInventoryWrite();
  }

  async createStockIn(payload: Record<string, unknown>) {
    return retiredInventoryWrite();
  }

  async createStockOut(itemId: string, payload: Record<string, unknown>) {
    return retiredInventoryWrite();
  }

  async adjustInventory(itemId: string, payload: Record<string, unknown>) {
    return retiredInventoryWrite();
  }

  private inventoryAccess(actor: ProcActor) {
    if (!actor?.id || !actor.permissions.some(code => code === '*' || code === 'page:inventory-management')) throw new ForbiddenException('没有查看库存管理的权限');
  }

  async exportInventory(query: Record<string, unknown>, actor: ProcActor) {
    const result = await this.getInventory({ ...query, page: 1, pageSize: 10000 }, actor);
    const lines = [
      'SKU,Name,Category,Spec,Stock,Available,Safe,Inbound,Status,Issues',
      ...result.inventory.items.map((item) => [item.id, item.name, item.category, item.spec, item.stock ?? '待核对', item.available ?? '待核对', item.safe, item.in, item.status, item.ledgerIssues.join('；')].map((cell) => this.csvCell(cell)).join(',')),
    ];
    return {
      fileName: `inventory-${new Date().toISOString().slice(0, 10)}.csv`,
      mimeType: 'text/csv;charset=utf-8',
      content: lines.join('\n'),
    };
  }

  async getPurchaseOrders(query: Record<string, unknown>) {
    const page = this.toPage(query.page);
    const pageSize = this.toPageSize(query.pageSize, 50);
    const where = this.buildPurchaseOrderWhere(query);

    const [total, rows, suppliers, stats] = await Promise.all([
      this.prisma.orderProcessingPurchaseOrder.count({ where }),
      this.prisma.orderProcessingPurchaseOrder.findMany({
        where,
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
        orderBy: [{ etaDate: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.orderProcessingPurchaseOrder.findMany({
        select: { supplier: true },
        distinct: ['supplier'],
        orderBy: { supplier: 'asc' },
      }),
      this.getPurchaseOrderStats(),
    ]);

    return {
      orders: this.paginateRows(rows.map((row) => this.toPurchaseOrder(row)), total, page, pageSize),
      suppliers: suppliers.map((item) => item.supplier).filter(Boolean),
      stats,
    };
  }

  async getPurchaseOrder(idOrPoNo: string) {
    const decoded = decodeURIComponent(idOrPoNo);
    const order = await this.prisma.orderProcessingPurchaseOrder.findFirst({
      where: { OR: [{ id: decoded }, { poNo: decoded }] },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!order) throw new NotFoundException('采购订单不存在');
    return { order: this.toPurchaseOrder(order) };
  }

  async importPurchaseOrders(files: UploadedFileLike[] = []) {
    await this.ensureInitialized();
    if (files.length === 0) throw new BadRequestException('请上传采购订单文件');

    const drafts = await this.parsePurchaseOrderFiles(files);
    if (drafts.length === 0) throw new BadRequestException('文件中没有可导入的采购订单');

    const saved = await this.prisma.$transaction(async (tx) => {
      const result: PurchaseOrderRow[] = [];
      for (const draft of drafts) {
        const row = await this.upsertPurchaseOrder(tx, draft);
        result.push(row);
      }
      return result;
    });

    return {
      created: saved.map((row) => this.toPurchaseOrder(row)),
      message: `已导入 ${saved.length} 条采购订单`,
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
    // 仅确保发票模板与系统设置存在；不再注入任何演示业务数据。
    const templateCount = await this.prisma.orderProcessingInvoiceTemplate.count();
    if (templateCount === 0) {
      await this.seedTemplatesAndSettings(createInitialOrderProcessingState());
    } else {
      await this.ensureSettings();
    }

    // Historical data cleanup is deliberately not part of any request initialization.
  }

  private async clearLegacyDemoSeedDataV2() {
    const cleared = await this.prisma.orderProcessingSetting.findUnique({
      where: { key: `${DEMO_SEED_CLEARED_SETTING}-v2` },
    });
    if (cleared) return;

    const demoOrderIds = [
      'PO-20260524-01',
      'PO-20260523-08',
      'PO-20260523-07',
      'PO-20260522-15',
      'PO-20260522-11',
      'PO-20260521-16',
      'PO-20260521-03',
      'PO-20260520-03',
    ];
    const demoInventoryIds = [
      'BT-001', 'TC-002', 'PB-100', 'CH-018', 'SP-002', 'HS-005',
      'HD-010', 'BOX-022', 'KB-008', 'MS-006', 'CL-020', 'AD-011',
    ];
    const demoMovementIds = ['MV-001', 'MV-002', 'MV-003', 'MV-004'];
    const demoPurchaseOrderIds = [
      'po-20260601-001',
      'po-20260531-014',
      'po-20260530-009',
      'po-20260529-017',
      'po-20260525-003',
    ];

    const result = await this.prisma.$transaction(async (tx) => {
      const movements = await tx.orderProcessingStockMovement.deleteMany({
        where: { id: { in: demoMovementIds } },
      });
      const orders = await tx.orderProcessingOrder.deleteMany({
        where: { id: { in: demoOrderIds } },
      });
      const inventory = await tx.orderProcessingInventoryItem.deleteMany({
        where: { id: { in: demoInventoryIds } },
      });
      const purchaseOrders = await tx.orderProcessingPurchaseOrder.deleteMany({
        where: { id: { in: demoPurchaseOrderIds } },
      });
      await tx.orderProcessingSetting.create({
        data: { key: `${DEMO_SEED_CLEARED_SETTING}-v2`, value: true },
      });
      return { movements: movements.count, orders: orders.count, inventory: inventory.count, purchaseOrders: purchaseOrders.count };
    });
    const total = result.movements + result.orders + result.inventory + result.purchaseOrders;
    if (total > 0) {
      this.logger.log(
        `演示数据清理 v2：出入库 ${result.movements}、订货单 ${result.orders}、库存 ${result.inventory}、采购单 ${result.purchaseOrders}`,
      );
    }
  }

  /**
   * 清除历史版本通过种子数据写入的演示业务数据（订单 / 库存 / 出入库 / 采购订单）。
   * 通过设置项标记保证每个数据库仅执行一次，且只删除已知的演示固定 ID，
   * 不会影响任何真实上传 / 邮件识别 / 手动录入的数据。
   */
  private async clearLegacyDemoSeedData() {
    const cleared = await this.prisma.orderProcessingSetting.findUnique({
      where: { key: DEMO_SEED_CLEARED_SETTING },
    });
    if (cleared) return;

    const demoOrderIds = [
      'PO-20260524-01',
      'PO-20260523-08',
      'PO-20260523-07',
      'PO-20260522-11',
      'PO-20260521-16',
      'PO-20260520-03',
    ];
    const demoInventoryIds = [
      'BT-001',
      'TC-002',
      'PB-100',
      'CH-018',
      'SP-002',
      'HS-005',
      'HD-010',
      'BOX-022',
      'KB-008',
      'MS-006',
      'CL-020',
      'AD-011',
    ];
    const demoMovementIds = ['MV-001', 'MV-002', 'MV-003', 'MV-004'];
    const demoPurchaseOrderIds = [
      'po-20260601-001',
      'po-20260531-014',
      'po-20260530-009',
      'po-20260529-017',
      'po-20260525-003',
    ];

    // 安全护栏：仅清理「本次发布之前」由旧种子写入的演示数据。发布后新建 / 邮件识别 / 手动录入的真实
    // 数据 createdAt 必然 ≥ 此时间点，即使其 id 偶然与下列演示 ID 相同，也不会被这次一次性清理误删。
    const LEGACY_SEED_CUTOFF = new Date('2026-06-03T00:00:00.000Z');

    await this.prisma.$transaction(async (tx) => {
      // 先删出入库记录（itemId 外键级联，此处显式删除更稳妥）
      await tx.orderProcessingStockMovement.deleteMany({
        where: { id: { in: demoMovementIds }, createdAt: { lt: LEGACY_SEED_CUTOFF } },
      });
      // 删订单时会级联删除其明细与发票
      await tx.orderProcessingOrder.deleteMany({
        where: { id: { in: demoOrderIds }, createdAt: { lt: LEGACY_SEED_CUTOFF } },
      });
      // 删库存项会级联删除其剩余的出入库记录
      await tx.orderProcessingInventoryItem.deleteMany({
        where: { id: { in: demoInventoryIds }, createdAt: { lt: LEGACY_SEED_CUTOFF } },
      });
      // 删采购订单会级联删除其明细行
      await tx.orderProcessingPurchaseOrder.deleteMany({
        where: { id: { in: demoPurchaseOrderIds }, createdAt: { lt: LEGACY_SEED_CUTOFF } },
      });
      // 写入标记，保证清理仅执行一次
      await tx.orderProcessingSetting.create({
        data: { key: DEMO_SEED_CLEARED_SETTING, value: true },
      });
    });
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

  private async seedPurchaseOrders(orders: PurchaseOrder[]) {
    await this.prisma.$transaction(async (tx) => {
      for (const order of orders) {
        await this.upsertPurchaseOrder(tx, {
          ...order,
          items: order.items ?? [],
        });
      }
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

  private async resolveOrderMailCredentials(configId: string) {
    const config = configId
      ? await this.prisma.integrationConfig.findFirst({ where: { id: configId, kind: 'mail' } })
      : await this.prisma.integrationConfig.findFirst({
          where: { kind: 'mail', isActive: true },
          orderBy: { updatedAt: 'desc' },
        });
    if (configId && !config) throw new NotFoundException('所选企业微信邮箱配置不存在');
    if (!config) throw new BadRequestException('请先在邮箱管理启用企业微信邮箱');
    if (!config.isActive) throw new BadRequestException('所选企业微信邮箱未启用');

    const metadata = this.toRecord(config.metadata);
    const pass = this.decryptStoredMailSecret(config.encryptedSecret);
    const credentials: MailCredentials = {
      host: this.toString(metadata.host) || process.env.MAIL_IMAP_HOST || '',
      port: Number(metadata.port ?? process.env.MAIL_IMAP_PORT ?? 993),
      user: config.accountIdentifier ?? config.name,
      pass,
      mailbox: this.toString(metadata.mailbox) || process.env.MAIL_FOLDER || 'INBOX',
      keywords: [ORDER_MAIL_REQUIRED_SUBJECT.toLowerCase()],
    };

    return {
      configId: config.id,
      credentials,
    };
  }

  private decryptStoredMailSecret(payload: string) {
    try {
      return this.secureConfigService.decryptFromStorage(payload);
    } catch {
      throw new BadRequestException('当前企业微信邮箱配置已失效，请重新保存邮箱密码后再试');
    }
  }

  private resolveSafeMailCursor(latestUid: number | null, retryBoundaryUids: number[]) {
    if (!latestUid) return null;
    if (retryBoundaryUids.length === 0) return latestUid;
    const retryFromUid = Math.min(...retryBoundaryUids);
    return retryFromUid > 1 ? Math.min(latestUid, retryFromUid - 1) : null;
  }

  private isOrderMailCandidate(mail: IngestedMail) {
    return this.hasRequiredPoSubject(mail.subject) && this.hasRequiredSender(mail);
  }

  private hasRequiredPoSubject(subject: string) {
    return /(^|[^a-z])po($|[^a-z]|[0-9])/i.test(subject);
  }

  private hasRequiredSender(mail: IngestedMail) {
    const actual = this.normalizeMailParty(this.mailSenderLabel(mail));
    const expected = this.normalizeMailParty(ORDER_MAIL_REQUIRED_SENDER);
    if (actual.includes(expected) || actual.replace(/\s+/g, '').includes(expected.replace(/\s+/g, ''))) return true;

    return this.extractForwardedSenderLabels(mail.contentText)
      .map((sender) => this.normalizeMailParty(sender))
      .some((sender) => sender.includes(expected) || sender.replace(/\s+/g, '').includes(expected.replace(/\s+/g, '')));
  }

  private extractForwardedSenderLabels(text: string) {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .map((line) => line.match(/^(?:发件人|From)\s*[:：]\s*(.+)$/i)?.[1]?.trim() ?? '')
      .filter(Boolean);
  }

  private normalizeMailParty(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  private mailSenderLabel(mail: Pick<IngestedMail, 'senderName' | 'senderEmail'>) {
    const name = mail.senderName.trim();
    const email = mail.senderEmail.trim();
    if (name && email) return `${name} <${email}>`;
    return name || email || '未知发件人';
  }

  private toMailSyncPositiveInt(value: unknown, fallback: number) {
    const number = Number(value ?? fallback);
    return Number.isFinite(number) && Number.isInteger(number) && number > 0 ? number : fallback;
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
    const [templates, activeSetting, reminderSetting] = await Promise.all([
      this.prisma.orderProcessingInvoiceTemplate.findMany({ orderBy: { createdAt: 'asc' } }),
      this.prisma.orderProcessingSetting.findUnique({ where: { key: ACTIVE_TEMPLATE_SETTING } }),
      this.prisma.orderProcessingSetting.findUnique({ where: { key: REMINDER_RULE_SETTING } }),
    ]);
    const mappedTemplates = templates.length ? templates.map((template) => this.toTemplate(template)) : createInitialOrderProcessingState().templates;
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
      amount: this.formatCurrency(invoiceLines.length > 0 ? this.sumInvoiceLines(invoiceLines) : order.invoice?.amount ? Number(order.invoice.amount) : this.sumProductAmount(products)),
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
    return metadata.lines.map((item): InvoiceLine | null => {
      const row = this.toRecord(item);
      const quantity = Number(row.quantity);
      const unitPriceText = String(row.unitPrice ?? '').replace(/[¥￥$, \s]/g, '');
      const unitPrice = unitPriceText ? Number(unitPriceText) : Number.NaN;
      const unitPriceCents = Math.round((unitPrice + Number.EPSILON) * 100);
      const subtotalCents = quantity * unitPriceCents;
      if (
        !Number.isSafeInteger(quantity) ||
        quantity <= 0 ||
        !Number.isFinite(unitPrice) ||
        unitPrice < 0 ||
        !Number.isSafeInteger(unitPriceCents) ||
        !Number.isSafeInteger(subtotalCents)
      ) {
        return null;
      }
      return {
        id: this.toString(row.id) || this.toString(row.sku),
        lineId: this.toString(row.lineId) || undefined,
        name: this.toString(row.name),
        spec: this.toString(row.spec),
        unit: this.toString(row.unit),
        quantity,
        unitPrice: this.formatMoneyValue(unitPriceCents / 100),
        subtotal: this.formatMoneyValue(subtotalCents / 100),
      };
    }).filter((line): line is InvoiceLine => Boolean(line?.id && line.name));
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

  private toPurchaseOrder(order: PurchaseOrderRow): PurchaseOrder {
    return {
      id: order.id,
      poNo: order.poNo,
      supplier: order.supplier,
      supplierContact: order.supplierContact ?? undefined,
      supplierPhone: order.supplierPhone ?? undefined,
      supplierEmail: order.supplierEmail ?? undefined,
      buyer: order.buyer,
      status: order.status as PurchaseOrderStatus,
      orderDate: this.formatDate(order.orderDate),
      etaDate: this.formatDate(order.etaDate),
      itemCount: order.itemCount,
      amount: Number(order.amount),
      currency: order.currency === 'USD' ? 'USD' : 'CNY',
      warehouse: order.warehouse,
      owner: order.owner,
      paymentTerm: order.paymentTerm ?? undefined,
      deliveryTerm: order.deliveryTerm ?? undefined,
      invoiceType: order.invoiceType ?? undefined,
      approvalStatus: order.approvalStatus ?? undefined,
      remark: order.remark ?? undefined,
      sourceFile: order.sourceFile ?? undefined,
      items: order.lines.map((line) => ({
        sku: line.sku,
        name: line.name,
        spec: line.spec,
        unit: line.unit,
        qty: line.qty,
        receivedQty: line.receivedQty,
        unitPrice: Number(line.unitPrice),
      })),
    };
  }

  private buildPurchaseOrderWhere(query: Record<string, unknown>): Prisma.OrderProcessingPurchaseOrderWhereInput {
    const q = this.toString(query.q);
    const status = this.toString(query.status);
    const supplier = this.toString(query.supplier);
    const dateFrom = this.toOptionalDate(query.dateFrom ?? query.startDate, '开始日期');
    const dateTo = this.toOptionalDate(query.dateTo ?? query.endDate, '结束日期');

    return {
      ...(q
        ? {
            OR: [
              { poNo: { contains: q, mode: 'insensitive' } },
              { supplier: { contains: q, mode: 'insensitive' } },
              { buyer: { contains: q, mode: 'insensitive' } },
              { warehouse: { contains: q, mode: 'insensitive' } },
              { owner: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(status && status !== 'all' ? { status } : {}),
      ...(supplier && supplier !== 'all' ? { supplier } : {}),
      ...(dateFrom || dateTo
        ? {
            etaDate: {
              ...(dateFrom ? { gte: this.startOfDay(dateFrom) } : {}),
              ...(dateTo ? { lte: this.endOfDay(dateTo) } : {}),
            },
          }
        : {}),
    };
  }

  private async getPurchaseOrderStats(): Promise<PurchaseOrderStats> {
    const [total, open, inbound, abnormal, amount] = await Promise.all([
      this.prisma.orderProcessingPurchaseOrder.count(),
      this.prisma.orderProcessingPurchaseOrder.count({ where: { status: { in: ['待确认', '已下单'] } } }),
      this.prisma.orderProcessingPurchaseOrder.count({ where: { status: '部分到货' } }),
      this.prisma.orderProcessingPurchaseOrder.count({ where: { status: '异常' } }),
      this.prisma.orderProcessingPurchaseOrder.aggregate({ _sum: { amount: true } }),
    ]);

    return {
      total,
      open,
      inbound,
      abnormal,
      amount: Number(amount._sum.amount ?? 0),
    };
  }

  private async parsePurchaseOrderFiles(files: UploadedFileLike[]): Promise<PurchaseOrderImportDraft[]> {
    const extractedDocs = await Promise.all(files.map((file) => this.extractUploadedDocument(file, '采购订单')));
    const grouped = new Map<string, PurchaseOrderImportDraft>();
    let rowIndex = 0;

    for (const doc of extractedDocs) {
      const records = this.purchaseRowsToRecords(doc.rows, doc.fileName);
      for (const record of records) {
        const draft = this.normalizePurchaseOrderRecord(record, rowIndex, doc.fileName);
        rowIndex += 1;
        const current = grouped.get(draft.poNo);
        if (!current) {
          grouped.set(draft.poNo, draft);
          continue;
        }

        current.items.push(...draft.items);
        current.amount = current.amount || draft.amount;
        current.itemCount = Math.max(current.itemCount, draft.itemCount);
        current.remark = current.remark || draft.remark;
      }
    }

    return Array.from(grouped.values()).map((draft) => {
      const items = draft.items.length > 0 ? draft.items : [this.buildPurchaseOrderFallbackLine(draft)];
      const amount = items.length > 0 ? items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0) : draft.amount;
      return {
        ...draft,
        items,
        amount: amount || draft.amount,
        itemCount: items.length || draft.itemCount,
      };
    });
  }

  private purchaseRowsToRecords(rows: string[][], fileName: string) {
    const headerIndex = rows.findIndex((row) =>
      this.findColumn(row, ['采购单号', '采购订单号', 'PO号', 'PO No', 'PO', 'poNo']) >= 0 ||
      this.findColumn(row, ['供应商', '供应商名称', 'Supplier', 'Vendor']) >= 0
    );
    if (headerIndex < 0) throw new BadRequestException(`采购订单 ${fileName} 未识别到表头`);

    const header = rows[headerIndex].map((cell, index) => this.toCellString(cell) || `column-${index + 1}`);
    return rows
      .slice(headerIndex + 1)
      .filter((row) => row.some((cell) => this.toCellString(cell)))
      .map((row) => Object.fromEntries(header.map((key, index) => [key, this.toCellString(row[index])])));
  }

  private normalizePurchaseOrderRecord(record: Record<string, unknown>, index: number, fileName: string): PurchaseOrderImportDraft {
    const today = this.formatDate(new Date());
    const poNo = this.readRecordField(record, ['采购单号', '采购订单号', 'PO号', 'PO No', 'PO', '单号', 'poNo']) || `PO-IMPORT-${Date.now()}-${index + 1}`;
    const qty = this.toSafeInteger(this.readRecordField(record, ['采购数量', '订购数量', '数量', 'Qty', 'Quantity']), 0);
    const receivedQty = this.toSafeInteger(this.readRecordField(record, ['已到货', '到货数量', '已收货', 'Received']), 0);
    const lineSubtotal = this.toSafeMoney(this.readRecordField(record, ['行金额', '明细金额', '小计', 'Line Amount']));
    const rawUnitPrice = this.toSafeMoney(this.readRecordField(record, ['单价', '采购单价', 'Unit Price', 'Price']));
    const unitPrice = rawUnitPrice || (qty > 0 && lineSubtotal > 0 ? lineSubtotal / qty : 0);
    const sku = this.readRecordField(record, ['SKU', '商品编码', '产品编码', '物料编码', 'Item', 'Part No']);
    const name = this.readRecordField(record, ['商品名称', '产品名称', '品名', 'Description', 'Name']);
    const amount = this.toSafeMoney(this.readRecordField(record, ['金额', '采购金额', '总金额', 'Amount', 'Total']));
    const itemCount = this.toSafeInteger(this.readRecordField(record, ['SKU数', '商品数', '明细数', 'Item Count']), 0);
    const hasLine = Boolean(sku || name || qty > 0 || unitPrice > 0);

    return {
      id: `po-import-${Date.now()}-${index + 1}`,
      poNo,
      supplier: this.readRecordField(record, ['供应商', '供应商名称', 'Supplier', 'Vendor']) || '未命名供应商',
      supplierContact: this.readRecordField(record, ['供应商联系人', '联系人', 'Contact']) || undefined,
      supplierPhone: this.readRecordField(record, ['供应商电话', '联系电话', 'Phone']) || undefined,
      supplierEmail: this.readRecordField(record, ['供应商邮箱', '邮箱', 'Email']) || undefined,
      buyer: this.readRecordField(record, ['采购员', '采购负责人', 'Buyer']) || '未指定',
      status: this.normalizePurchaseOrderStatus(this.readRecordField(record, ['状态', '订单状态', 'Status'])),
      orderDate: this.normalizePurchaseOrderDate(this.readRecordField(record, ['下单日期', '订单日期', '采购日期', 'Order Date'])) || today,
      etaDate: this.normalizePurchaseOrderDate(this.readRecordField(record, ['预计到货日', '预计到货', '交期', 'ETA', '到货日期'])) || today,
      itemCount,
      amount,
      currency: this.readRecordField(record, ['币种', 'Currency']).toUpperCase() === 'USD' ? 'USD' : 'CNY',
      warehouse: this.readRecordField(record, ['仓库', '到货仓', 'Warehouse']) || '主仓 - 上海',
      owner: this.readRecordField(record, ['采购组', '部门', 'Owner']) || '采购一组',
      paymentTerm: this.readRecordField(record, ['付款条件', '账期', 'Payment Term']) || undefined,
      deliveryTerm: this.readRecordField(record, ['交付方式', '运输方式', 'Delivery Term']) || undefined,
      invoiceType: this.readRecordField(record, ['发票类型', 'Invoice Type']) || undefined,
      approvalStatus: this.readRecordField(record, ['审批状态', 'Approval']) || undefined,
      remark: this.readRecordField(record, ['备注', '说明', 'Remark']) || undefined,
      sourceFile: fileName,
      items: hasLine
        ? [
            {
              sku: sku || `ITEM-${index + 1}`,
              name: name || '未命名商品',
              spec: this.readRecordField(record, ['规格', '型号', 'Spec']) || '-',
              unit: this.readRecordField(record, ['单位', 'Unit']) || '件',
              qty: qty || 1,
              receivedQty: Math.max(0, Math.min(receivedQty, qty || receivedQty)),
              unitPrice,
            },
          ]
        : [],
    };
  }

  private async upsertPurchaseOrder(tx: PrismaTx, order: PurchaseOrderImportDraft | PurchaseOrder): Promise<PurchaseOrderRow> {
    const items = order.items?.length ? order.items : [this.buildPurchaseOrderFallbackLine(order)];
    const amount = items.length > 0 ? items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0) : order.amount;
    const itemCount = items.length || order.itemCount;
    const row = await tx.orderProcessingPurchaseOrder.upsert({
      where: { poNo: order.poNo },
      create: {
        id: order.id,
        poNo: order.poNo,
        supplier: order.supplier,
        supplierContact: order.supplierContact,
        supplierPhone: order.supplierPhone,
        supplierEmail: order.supplierEmail,
        buyer: order.buyer,
        status: order.status,
        orderDate: this.parseDate(order.orderDate),
        etaDate: this.parseDate(order.etaDate),
        itemCount,
        amount,
        currency: order.currency,
        warehouse: order.warehouse,
        owner: order.owner,
        paymentTerm: order.paymentTerm,
        deliveryTerm: order.deliveryTerm,
        invoiceType: order.invoiceType,
        approvalStatus: order.approvalStatus,
        remark: order.remark,
        sourceFile: order.sourceFile,
        metadata: {} as Prisma.InputJsonValue,
      },
      update: {
        supplier: order.supplier,
        supplierContact: order.supplierContact,
        supplierPhone: order.supplierPhone,
        supplierEmail: order.supplierEmail,
        buyer: order.buyer,
        status: order.status,
        orderDate: this.parseDate(order.orderDate),
        etaDate: this.parseDate(order.etaDate),
        itemCount,
        amount,
        currency: order.currency,
        warehouse: order.warehouse,
        owner: order.owner,
        paymentTerm: order.paymentTerm,
        deliveryTerm: order.deliveryTerm,
        invoiceType: order.invoiceType,
        approvalStatus: order.approvalStatus,
        remark: order.remark,
        sourceFile: order.sourceFile,
      },
    });

    await tx.orderProcessingPurchaseOrderLine.deleteMany({ where: { purchaseOrderId: row.id } });
    await tx.orderProcessingPurchaseOrderLine.createMany({
      data: items.map((item, index) => ({
        purchaseOrderId: row.id,
        sku: item.sku,
        name: item.name,
        spec: item.spec,
        unit: item.unit,
        qty: item.qty,
        receivedQty: item.receivedQty,
        unitPrice: item.unitPrice,
        sortOrder: index,
      })),
    });

    const saved = await tx.orderProcessingPurchaseOrder.findUnique({
      where: { id: row.id },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!saved) throw new NotFoundException('采购订单保存失败');
    return saved;
  }

  private buildPurchaseOrderFallbackLine(order: Pick<PurchaseOrder, 'itemCount' | 'amount' | 'sourceFile'>): PurchaseOrderLine {
    const qty = Math.max(order.itemCount || 1, 1);
    return {
      sku: 'IMPORT-SUMMARY',
      name: '导入汇总明细',
      spec: order.sourceFile ? `来源文件：${order.sourceFile}` : '未提供明细行',
      unit: '批',
      qty,
      receivedQty: 0,
      unitPrice: qty > 0 ? Math.round((order.amount / qty) * 100) / 100 : 0,
    };
  }

  private readRecordField(record: Record<string, unknown>, keys: string[]) {
    const entries = Object.entries(record);
    for (const key of keys) {
      const normalizedKey = this.normalizeKey(key);
      const match = entries.find(([candidate, value]) => this.normalizeKey(candidate) === normalizedKey && this.toCellString(value));
      if (match) return this.toCellString(match[1]);
    }
    for (const key of keys) {
      const normalizedKey = this.normalizeKey(key);
      const match = entries.find(([candidate, value]) => this.normalizeKey(candidate).includes(normalizedKey) && this.toCellString(value));
      if (match) return this.toCellString(match[1]);
    }
    return '';
  }

  private normalizePurchaseOrderStatus(value: string): PurchaseOrderStatus {
    const text = this.toCellString(value);
    if (['待确认', '已下单', '部分到货', '已完成', '异常'].includes(text)) return text as PurchaseOrderStatus;
    if (/异常|取消|逾期|错误/i.test(text)) return '异常';
    if (/完成|关闭|已入库/i.test(text)) return '已完成';
    if (/部分|到货中/i.test(text)) return '部分到货';
    if (/下单|已发|采购中/i.test(text)) return '已下单';
    return '待确认';
  }

  private normalizePurchaseOrderDate(value: string) {
    const text = this.toCellString(value);
    if (!text) return '';
    const numeric = Number(text);
    if (Number.isFinite(numeric) && numeric > 25569) {
      return this.formatDate(new Date((numeric - 25569) * 86400000));
    }
    return this.normalizeDateString(text);
  }

  private toSafeInteger(value: unknown, fallback: number) {
    const number = this.parseNumber(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : fallback;
  }

  private toSafeMoney(value: unknown) {
    const number = this.parseNumber(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : 0;
  }

  private async parseUploadedOrder(file: UploadedFileLike, state: OrderProcessingState, index: number): Promise<ParsedOrderDraft> {
    const extracted = await this.extractUploadedDocument(file, '订货单');
    const catalog = await this.buildCatalog(state);
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

  private async parseOrderMail(mail: IngestedMail, state: OrderProcessingState, index: number): Promise<ParsedOrderDraft | null> {
    const text = this.normalizeExtractedText([
      `Subject: ${mail.subject}`,
      `Sender: ${this.mailSenderLabel(mail)}`,
      mail.contentText,
    ].filter(Boolean).join('\n'));
    const documents: ExtractedDocument[] = [{
      fileName: `mail-${mail.imapUid ?? index + 1}.txt`,
      extension: 'mail',
      rows: this.rowsFromText(text),
      text,
      provider: 'mail',
    }];
    const attachmentErrors: string[] = [];
    const parseableAttachments = this.selectOrderMailAttachments(mail.attachments ?? []);
    for (const attachment of parseableAttachments) {
      if (!this.isSupportedOrderAttachment(attachment.fileName)) continue;
      try {
        documents.push(await this.extractUploadedDocument({
          originalname: attachment.fileName,
          mimetype: attachment.contentType,
          size: attachment.size,
          buffer: attachment.content,
        }, '订货单附件'));
      } catch (error) {
        attachmentErrors.push(`${attachment.fileName}: ${error instanceof Error ? error.message : '附件解析失败'}`);
      }
    }
    const extracted: ExtractedDocument = {
      fileName: documents.map((document) => document.fileName).join(', '),
      extension: documents.map((document) => document.extension).join('+'),
      rows: documents.flatMap((document) => document.rows),
      text: documents.map((document) => document.text).filter(Boolean).join('\n'),
      provider: documents.some((document) => document.provider !== 'mail') ? documents.find((document) => document.provider !== 'mail')?.provider ?? 'mail' : 'mail',
    };
    const catalog = await this.buildCatalog(state);
    const meta = this.extractOrderMeta(extracted);
    const products = this.extractOrderProducts(extracted.rows, extracted.text, catalog);
    if (products.length === 0) return null;

    const createdAt = new Date(mail.receivedAt.getTime() + index);
    const orderId = meta.orderId || this.orderIdFromMail(mail, createdAt, index);
    const shipDate = meta.shipDate || this.formatDate(new Date(createdAt.getTime() + 3 * 86400000));
    const customer = meta.customer || ORDER_MAIL_REQUIRED_SENDER;
    const amount = products.reduce((sum, product) => sum + this.parseCurrency(product.subtotal), 0);
    const hasIssue = this.hasBlockingIssue(products);
    const detail: OrderDetail = {
      id: orderId,
      customer,
      orderId,
      date: shipDate,
      amount: this.formatCurrency(amount),
      invoiceNo: '',
      mailContent: {
        subject: mail.subject,
        sender: this.mailSenderLabel(mail),
        receivedAt: this.formatDateTime(mail.receivedAt),
        body: mail.contentText || '当前邮件暂无正文内容',
      },
      products,
    };
    const order: OrderSummary = {
      id: orderId,
      customer,
      type: hasIssue ? 'warning' : 'success',
      status: hasIssue ? '待人工确认' : '已识别',
      date: shipDate.slice(5),
      source: 'wecom_mail',
      generated: false,
      invoiceExported: false,
      createdAt: createdAt.toISOString(),
    };

    return {
      order,
      detail,
      metadata: {
        parser: extracted.provider,
        parsedAt: new Date().toISOString(),
        mailUniqueKey: mail.uniqueKey,
        mailMessageId: mail.messageId,
        mailImapUid: mail.imapUid,
        mailSenderName: mail.senderName,
        mailSenderEmail: mail.senderEmail,
        mailAttachmentCount: mail.attachments?.length ?? 0,
        mailAttachmentErrors: attachmentErrors,
        sourceFiles: documents.map((document) => document.fileName),
        sourceOrderId: meta.orderId,
      },
    };
  }

  private orderIdFromMail(mail: IngestedMail, createdAt: Date, index: number) {
    const candidate = [mail.subject, mail.contentText]
      .join('\n')
      .match(/(?:PO)[-_]?\d{4,}[-_]?\d*/i)?.[0]?.replace(/_/g, '-').toUpperCase();
    if (candidate) return candidate;
    const stamp = createdAt.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    return `PO-MAIL-${stamp}-${index + 1}`;
  }

  private isSupportedOrderAttachment(fileName: string) {
    return ['csv', 'txt', 'tsv', 'xlsx', 'xls', 'pdf', 'png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(this.fileExtension(fileName));
  }

  private selectOrderMailAttachments(attachments: NonNullable<IngestedMail['attachments']>) {
    const supported = attachments.filter((attachment) => this.isSupportedOrderAttachment(attachment.fileName));
    const documentAttachments = supported.filter((attachment) => !this.isImageAttachment(attachment.fileName));
    return documentAttachments.length > 0 ? documentAttachments : supported;
  }

  private isImageAttachment(fileName: string) {
    return ['png', 'jpg', 'jpeg', 'webp', 'bmp'].includes(this.fileExtension(fileName));
  }

  private async parseStockInFiles(files: UploadedFileLike[]): Promise<ParsedStockInDraft> {
    const state = await this.getStateSnapshot();
    const catalog = await this.buildCatalog(state);
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
      customer: this.findMetaValue(extracted.rows, extracted.text, ['客户', '客户名称', 'Shipping address', 'Bill To', 'Customer', '买方', '采购方', 'Buyer']),
      shipDate: this.normalizeDateString(this.findMetaValue(extracted.rows, extracted.text, ['发货日', '发货日期', '交期', '交货日期', 'Ship Date', 'Delivery Date', 'Expected Arrival'])),
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
    const bracketedPoProducts = this.extractBracketedPoProductsFromText(text, catalog);
    if (bracketedPoProducts.length > 0) {
      return bracketedPoProducts.map((product, index) => ({ ...product, lineId: product.lineId ?? `line-${index + 1}` }));
    }

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
    const blockProducts = this.extractBracketedPoProductsFromText(text, catalog);
    if (blockProducts.length > 0) return blockProducts;

    const products: OrderProduct[] = [];
    const skuPattern = /\b[A-Z0-9][A-Z0-9_-]{2,}\b/i;
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

  private extractBracketedPoProductsFromText(text: string, catalog: Map<string, CatalogItem>): OrderProduct[] {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const products: OrderProduct[] = [];

    for (let index = 0; index < lines.length; index += 1) {
      const header = lines[index].match(/^\[([A-Z0-9][A-Z0-9_-]{1,})\]\s+(.+)$/i);
      if (!header) continue;

      const rawSku = header[1].toUpperCase().replace(/_/g, '-');
      const name = header[2].trim();
      const block: string[] = [];
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        if (/^\[[A-Z0-9][A-Z0-9_-]{1,}\]\s+/i.test(lines[cursor])) break;
        if (/^(untaxed amount|total|payment terms|weoxy health llc|page \d+|-- \d+ of \d+ --)$/i.test(lines[cursor])) break;
        if (/^(description|price)\b/i.test(lines[cursor])) continue;
        block.push(lines[cursor]);
      }

      const qtyIndex = block.findIndex((line) => this.isStandalonePositiveNumber(line));
      if (qtyIndex < 0) continue;
      const orderQty = this.parseNumber(block[qtyIndex]);
      if (!Number.isFinite(orderQty) || orderQty <= 0) continue;

      const priceLine = block.slice(qtyIndex + 1).find((line) => this.moneyNumbersFromLine(line).length >= 2);
      const priceNumbers = priceLine ? this.moneyNumbersFromLine(priceLine) : [];
      const orderPrice = priceNumbers.find((value) => Number.isFinite(value) && value > 0) ?? 0;
      if (!Number.isFinite(orderPrice) || orderPrice <= 0) continue;

      const unit = this.normalizeOrderUnit(block[qtyIndex + 1]);
      const catalogItem = this.matchCatalogItem(catalog, rawSku, name);
      products.push(this.buildOrderProduct({
        id: catalogItem?.id ?? rawSku,
        name: name || catalogItem?.name || rawSku,
        category: catalogItem?.category || '采购商品',
        spec: catalogItem?.spec || rawSku,
        unit: unit || catalogItem?.unit || '件',
        orderQty: Math.trunc(orderQty),
        orderPrice,
        catalogItem,
      }));
    }

    return products;
  }

  private isStandalonePositiveNumber(line: string) {
    const value = this.parseNumber(line);
    return /^[¥￥$]?\s*\d+(?:,\d{3})*(?:\.\d+)?\s*$/.test(line) && Number.isFinite(value) && value > 0;
  }

  private moneyNumbersFromLine(line: string) {
    return line
      .match(/[¥￥$]?\s*\d+(?:,\d{3})*(?:\.\d+)?/g)
      ?.map((value) => this.parseNumber(value))
      .filter((value) => Number.isFinite(value)) ?? [];
  }

  private normalizeOrderUnit(line: string | undefined) {
    const value = this.toCellString(line);
    if (!value || this.isStandalonePositiveNumber(value) || this.moneyNumbersFromLine(value).length >= 2) return '';
    return value.replace(/,$/, '');
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
    const status: ProductCheckStatus = Math.abs(input.orderPrice - sysPrice) > 0.01 ? '价格差异' : '库存待核对';
    const remark = '库存需按正式物料和明确出货仓库即时核对，识别结果不构成库存预留';
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

  private async buildCatalog(state: OrderProcessingState) {
    const catalog = new Map<string, CatalogItem>();
    const materials = await this.prisma.procMaterial.findMany({ where: { reviewStatus: 'approved', tpInventoryCode: { not: null } }, select: { id: true, tpInventoryCode: true, name: true, category: true, spec: true, unit: true } });
    for (const material of materials) {
      if (!material.tpInventoryCode?.trim()) continue;
      const previous = Object.values(state.orderDetails).flatMap(detail => detail.products).find(product => product.id.trim() === material.tpInventoryCode!.trim() && product.unit.trim() === material.unit.trim());
      catalog.set(material.tpInventoryCode.trim(), { id: material.tpInventoryCode, name: material.name, category: material.category, spec: material.spec, unit: material.unit, stock: 0, sysPrice: previous ? this.parseCurrency(previous.sysPrice || previous.orderPrice) : 0 });
    }
    return catalog;
  }

  private matchCatalogItem(catalog: Map<string, CatalogItem>, sku: string, name: string) {
    // Name similarity is never identity evidence for a customer order.
    return sku.trim() ? catalog.get(sku.trim()) : undefined;
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
    const monthFirst = normalized.match(/\b(\d{1,2})-(\d{1,2})-(20\d{2})\b/);
    if (monthFirst) return `${monthFirst[3]}-${monthFirst[1].padStart(2, '0')}-${monthFirst[2].padStart(2, '0')}`;
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

  private detectInvoicePdfLayout(text: string): InvoicePdfLayout {
    const normalized = text.toLowerCase();
    if (
      [
        'final consolidated balance invoice',
        'consolidated balance invoice',
        'balance due',
        'total payment received',
        'nan jing yinuoji',
        'nanjing yinuoji',
        'inogi',
        '结算发票',
        '余款',
      ].some((keyword) => normalized.includes(keyword))
    ) {
      return 'inogi';
    }
    if (['weoxy.co', 'weoxy co', 'weoxy health', 'standard invoice'].some((keyword) => normalized.includes(keyword))) {
      return 'weoxy';
    }
    return 'generic';
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
      const quantity = this.toInvoiceQuantity(line.quantity, `第 ${index + 1} 行数量`);
      const unitPriceCents = this.toMoneyCents(line.unitPrice, `第 ${index + 1} 行单价`);
      const subtotalCents = quantity * unitPriceCents;
      if (!Number.isSafeInteger(subtotalCents)) {
        throw new BadRequestException(`第 ${index + 1} 行金额超出可处理范围`);
      }
      if (line.subtotal !== undefined) {
        const suppliedSubtotalCents = this.toMoneyCents(line.subtotal, `第 ${index + 1} 行金额`);
        if (suppliedSubtotalCents !== subtotalCents) {
          throw new BadRequestException(`第 ${index + 1} 行金额必须等于数量乘以单价`);
        }
      }
      const subtotal = subtotalCents / 100;
      return {
        id: product.sku,
        lineId: product.id,
        name: line.name || product.name,
        spec: line.spec || product.spec,
        unit: line.unit || product.unit,
        quantity,
        unitPrice: this.formatMoneyValue(unitPriceCents / 100),
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
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw new BadRequestException('发票商品明细格式不正确');
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
    if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) {
      throw new BadRequestException(`${label}必须是大于 0 的整数`);
    }
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number <= 0) {
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
    return this.toMoneyCents(value, label) / 100;
  }

  private toInvoiceQuantity(value: unknown, label: string) {
    return this.toPositiveInteger(value, label);
  }

  private toMoneyCents(value: unknown, label: string) {
    if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) {
      throw new BadRequestException(`${label}必须是大于等于 0 的金额`);
    }
    const number = Number(value);
    const cents = Math.round((number + Number.EPSILON) * 100);
    if (!Number.isFinite(number) || number < 0 || !Number.isSafeInteger(cents)) {
      throw new BadRequestException(`${label}必须是大于等于 0 且未超出范围的金额`);
    }
    return cents;
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

  private buildInvoicePdf(input: InvoicePdfInput) {
    const layout = this.resolveInvoicePdfLayout(input.templateId, input.templateConfig);
    const rowsPerPage = layout === 'inogi' ? 7 : layout === 'weoxy' ? 7 : 12;
    const totalPages = Math.max(1, Math.ceil(input.lines.length / rowsPerPage));
    const pages = Array.from({ length: totalPages }, (_, pageIndex) => {
      const rows = input.lines.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage);
      if (layout === 'weoxy') {
        return this.buildWeoxyInvoicePdfPage(input, rows, pageIndex + 1, totalPages);
      }
      if (layout === 'inogi') {
        return this.buildInogiInvoicePdfPage(input, rows, pageIndex + 1, totalPages);
      }
      return this.buildInvoicePdfPage(input, rows, pageIndex + 1, totalPages);
    });
    return this.renderPdfDocument(pages);
  }

  private resolveInvoicePdfLayout(templateId: string | undefined, config: Record<string, unknown> = {}): InvoicePdfLayout {
    const configured = this.toString(config.pdfLayout);
    if (configured === 'weoxy' || configured === 'inogi' || configured === 'generic') return configured;
    if (templateId === 'weoxy') return 'weoxy';
    if (templateId === 'inogi') return 'inogi';
    return 'generic';
  }

  private resolveInvoicePdfProfile(input: InvoicePdfInput): InvoicePdfProfile {
    const config = this.toRecord(input.templateConfig);
    const pdf = this.toRecord(config.pdf);
    const merged = { ...config, ...pdf };
    const seller = { ...this.toRecord(config.seller), ...this.toRecord(pdf.seller) };
    const customer = { ...this.toRecord(config.customer), ...this.toRecord(pdf.customer) };
    const payment = { ...this.toRecord(config.payment), ...this.toRecord(pdf.payment) };
    const bank = {
      ...this.toRecord(config.bank),
      ...this.toRecord(pdf.bank),
      ...this.toRecord(payment.bank),
    };
    const paymentInstructions = this.toPdfTextLines(payment.instructions ?? merged.paymentInstructions);
    const configuredBankLines = [
      this.configuredPdfLine('Beneficiary Name', bank.beneficiaryName ?? payment.beneficiaryName),
      this.configuredPdfLine('Bank Name', bank.bankName ?? payment.bankName),
      this.configuredPdfLine('Bank Branch', bank.branchName ?? bank.bankBranch ?? payment.bankBranch),
      this.configuredPdfLine('Account Name', bank.accountName ?? payment.accountName),
      this.configuredPdfLine('Company Address', bank.companyAddress ?? payment.companyAddress),
      this.configuredPdfLine('Account Number', bank.accountNumber ?? payment.accountNumber),
      this.configuredPdfLine('SWIFT Code', bank.swiftCode ?? bank.swift ?? payment.swiftCode),
      this.configuredPdfLine('Bank Address', bank.bankAddress ?? payment.bankAddress),
    ].filter((line): line is string => Boolean(line));

    return {
      sellerName: this.toString(seller.name) || this.toString(merged.sellerName),
      sellerEmail: this.toString(seller.email) || this.toString(merged.sellerEmail),
      billingAddress: this.toPdfTextLines(
        customer.billingAddress ?? customer.address ?? merged.billingAddress ?? merged.customerAddress,
      ),
      shippingAddress: this.toPdfTextLines(customer.shippingAddress ?? merged.shippingAddress),
      incoterm: this.toString(merged.incoterm),
      paymentTerms: this.toString(payment.terms) || this.toString(merged.paymentTerms),
      paymentInstructions: [...paymentInstructions, ...configuredBankLines],
      additionalNotes: this.toPdfTextLines(payment.notes ?? merged.additionalNotes),
    };
  }

  private configuredPdfLine(label: string, value: unknown) {
    const text = this.toString(value);
    return text ? `${label}: ${text}` : '';
  }

  private toPdfTextLines(value: unknown) {
    const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : [];
    return values.map((line) => this.toString(line)).filter(Boolean);
  }

  private buildWeoxyInvoicePdfPage(
    input: InvoicePdfInput,
    rows: InvoiceExportLine[],
    pageNo: number,
    totalPages: number,
  ) {
    const commands: string[] = [];
    const profile = this.resolveInvoicePdfProfile(input);
    const pageMargin = 48;
    const darkBlue = '#0a2342';
    const tableTop = 494;
    const tableWidth = 499;
    const rowHeight = 46;
    const isLastPage = pageNo === totalPages;

    commands.push(this.pdfFillRect(0, 0, 595, 842, '#ffffff'));
    commands.push(this.pdfText(pageMargin, 780, profile.sellerName || input.templateName, 28, darkBlue, 'left', 260));
    commands.push(this.pdfText(547, 784, 'INVOICE', 18, darkBlue, 'right', 160));
    if (profile.sellerEmail) commands.push(this.pdfText(547, 766, profile.sellerEmail, 9, darkBlue, 'right', 180));

    if (profile.sellerName) {
      commands.push(this.pdfText(pageMargin, 714, 'Seller:', 10, darkBlue, 'left', 90));
      commands.push(this.pdfText(pageMargin, 696, profile.sellerName, 10, darkBlue, 'left', 230));
    }
    commands.push(this.pdfText(pageMargin, 662, 'Bill To:', 10, darkBlue, 'left', 90));
    commands.push(this.pdfText(pageMargin, 644, input.info.customer || '-', 10, darkBlue, 'left', 230));
    profile.billingAddress.slice(0, 2).forEach((line, index) => {
      commands.push(this.pdfText(pageMargin, 626 - index * 18, line, 9, darkBlue, 'left', 230));
    });
    if (profile.shippingAddress.length > 0) {
      commands.push(this.pdfText(pageMargin, 574, 'Ship To:', 10, darkBlue, 'left', 90));
      commands.push(this.pdfText(pageMargin, 556, input.info.customer || '-', 10, darkBlue, 'left', 230));
      profile.shippingAddress.slice(0, 1).forEach((line, index) => {
        commands.push(this.pdfText(pageMargin, 538 - index * 18, line, 9, darkBlue, 'left', 230));
      });
    }

    const labelX = 352;
    const valueX = 547;
    commands.push(this.pdfKeyValue(labelX, 714, valueX, 'Invoice:', `#${input.detail.invoiceNo || '未生成'}`, darkBlue));
    commands.push(this.pdfKeyValue(labelX, 694, valueX, 'Date:', input.info.date || '-', darkBlue));
    commands.push(this.pdfKeyValue(labelX, 674, valueX, 'Purchase Order:', input.info.orderId || '-', darkBlue));
    if (profile.incoterm) commands.push(this.pdfKeyValue(labelX, 654, valueX, 'Incoterm:', profile.incoterm, darkBlue));
    if (profile.paymentTerms) commands.push(this.pdfKeyValue(labelX, 634, valueX, 'Terms:', profile.paymentTerms, darkBlue));

    commands.push(this.pdfLine(pageMargin, tableTop + 8, pageMargin + tableWidth, tableTop + 8, darkBlue, 3));
    commands.push(this.pdfText(pageMargin, tableTop - 10, 'DESCRIPTION', 9, darkBlue, 'left', 240));
    commands.push(this.pdfText(pageMargin + tableWidth, tableTop - 10, 'AMOUNT', 9, darkBlue, 'right', 120));
    commands.push(this.pdfLine(pageMargin, tableTop - 22, pageMargin + tableWidth, tableTop - 22, darkBlue, 3));

    rows.forEach((line, index) => {
      const y = tableTop - 45 - index * rowHeight;
      const description = `${line.name}${line.spec && line.spec !== '-' ? ` (${line.spec})` : ''}`;
      commands.push(this.pdfText(pageMargin, y, description, 10, darkBlue, 'left', 360));
      commands.push(this.pdfText(pageMargin, y - 16, `${line.quantity} ${line.unit} x ${this.formatPdfMoney(line.unitPrice)}`, 9, '#475569', 'left', 280));
      commands.push(this.pdfText(pageMargin + tableWidth, y, this.formatPdfMoney(line.subtotal), 10, darkBlue, 'right', 120));
      commands.push(this.pdfLine(pageMargin, y - 25, pageMargin + tableWidth, y - 25, '#e2e8f0', 0.8));
    });

    const afterRowsY = tableTop - 45 - rows.length * rowHeight - 8;
    if (isLastPage) {
      const totalY = Math.max(184, afterRowsY);
      commands.push(this.pdfLine(pageMargin, totalY, pageMargin + tableWidth, totalY, darkBlue, 3));
      commands.push(this.pdfText(pageMargin, totalY - 28, 'Invoice Total', 12, darkBlue, 'left', 180));
      commands.push(this.pdfText(pageMargin + tableWidth, totalY - 28, this.formatPdfMoney(input.detail.amount), 12, darkBlue, 'right', 140));
      commands.push(this.pdfLine(pageMargin, totalY - 44, pageMargin + tableWidth, totalY - 44, darkBlue, 3));

      if (profile.paymentInstructions.length > 0) {
        commands.push(this.pdfText(pageMargin, 116, 'PAYMENT INSTRUCTIONS', 9, darkBlue, 'left', 180));
        profile.paymentInstructions.slice(0, 3).forEach((line, index) => {
          commands.push(this.pdfText(pageMargin, 96 - index * 16, line, 8, darkBlue, 'left', 260));
        });
      }
      if (profile.additionalNotes.length > 0) {
        commands.push(this.pdfText(330, 116, 'ADDITIONAL NOTES', 9, darkBlue, 'left', 180));
        profile.additionalNotes.slice(0, 2).forEach((line, index) => {
          commands.push(this.pdfText(330, 96 - index * 18, line, 8, darkBlue, 'left', 210));
        });
      }
    }

    commands.push(this.pdfText(pageMargin, 32, `Invoice ${input.detail.invoiceNo || input.info.orderId}`, 8, '#94a3b8'));
    commands.push(this.pdfText(298, 32, `Page ${pageNo} / ${totalPages}`, 8, '#94a3b8', 'center', 120));
    return commands.join('\n');
  }

  private buildInogiInvoicePdfPage(
    input: InvoicePdfInput,
    rows: InvoiceExportLine[],
    pageNo: number,
    totalPages: number,
  ) {
    const commands: string[] = [];
    const profile = this.resolveInvoicePdfProfile(input);
    const pageMargin = 42;
    const darkBlue = '#0a2342';
    const footerGray = '#e2e2e2';
    const contentWidth = 511;
    const darkBottom = 230;
    const tableTop = 544;
    const rowStart = 484;
    const rowHeight = 30;
    const isLastPage = pageNo === totalPages;
    const invoiceNo = input.detail.invoiceNo || '未生成';
    const amount = this.formatPdfMoney(input.detail.amount);

    commands.push(this.pdfFillRect(0, 0, 595, 842, '#ffffff'));
    commands.push(this.pdfFillRect(36, darkBottom, 523, 596, darkBlue));
    commands.push(this.pdfFillRect(36, 42, 523, darkBottom - 42, footerGray));

    commands.push(this.pdfText(pageMargin + 6, 778, profile.sellerName || input.templateName, 28, '#ffffff', 'left', 260));
    commands.push(this.pdfText(540, 786, 'INVOICE', 13, '#ffffff', 'right', 170));
    if (profile.sellerEmail) commands.push(this.pdfText(540, 766, profile.sellerEmail, 9, '#dbeafe', 'right', 190));

    commands.push(this.pdfText(pageMargin + 6, 704, totalPages > 1 ? `Invoice (${pageNo}/${totalPages})` : 'Invoice', 20, '#ffffff', 'left', 420));

    commands.push(this.pdfText(pageMargin + 6, 658, 'CLIENT NAME', 10, '#ffffff', 'left', 150));
    commands.push(this.pdfText(pageMargin + 6, 636, input.info.customer || '-', 11, '#ffffff', 'left', 235));
    profile.billingAddress.slice(0, 3).forEach((line, index) => {
      commands.push(this.pdfText(pageMargin + 6, 616 - index * 16, line, 8, '#dbeafe', 'left', 235));
    });

    const labelX = 354;
    const valueX = 540;
    commands.push(this.pdfKeyValue(labelX, 658, valueX, 'Invoice:', `#${invoiceNo}`, '#ffffff'));
    commands.push(this.pdfKeyValue(labelX, 638, valueX, 'Date:', input.info.date || '-', '#ffffff'));
    commands.push(this.pdfKeyValue(labelX, 618, valueX, 'Purchase Order:', input.info.orderId || '-', '#ffffff'));
    if (profile.incoterm) commands.push(this.pdfKeyValue(labelX, 598, valueX, 'Incoterm:', profile.incoterm, '#ffffff'));

    commands.push(this.pdfLine(pageMargin + 6, tableTop, pageMargin + contentWidth, tableTop, '#ffffff', 2.5));
    commands.push(this.pdfText(pageMargin + 6, tableTop - 24, 'ORIGINAL INVOICE AMOUNT', 9, '#ffffff', 'left', 280));
    commands.push(this.pdfText(pageMargin + contentWidth, tableTop - 24, 'AMOUNT', 9, '#ffffff', 'right', 120));
    commands.push(this.pdfLine(pageMargin + 6, tableTop - 34, pageMargin + contentWidth, tableTop - 34, '#ffffff', 2.5));

    rows.forEach((line, index) => {
      const y = rowStart - index * rowHeight;
      const invoiceLabel = line.id ? `WH-${line.id}-INOGI` : line.name;
      commands.push(this.pdfText(pageMargin + 6, y, invoiceLabel, 9, '#ffffff', 'left', 320));
      commands.push(this.pdfText(pageMargin + contentWidth, y, this.formatPdfMoney(line.subtotal), 9, '#ffffff', 'right', 140));
      commands.push(this.pdfLine(pageMargin + 6, y - 10, pageMargin + contentWidth, y - 10, '#31506e', 0.6));
    });

    if (isLastPage) {
      const afterRowsY = rowStart - rows.length * rowHeight - 10;
      const totalTop = Math.max(darkBottom + 66, afterRowsY);
      commands.push(this.pdfLine(pageMargin + 6, totalTop, pageMargin + contentWidth, totalTop, '#ffffff', 2.5));
      commands.push(this.pdfText(pageMargin + 6, totalTop - 32, 'Invoice Total:', 12, '#ffffff', 'left', 220));
      commands.push(this.pdfText(pageMargin + contentWidth, totalTop - 32, amount, 12, '#ffffff', 'right', 150));
    } else {
      commands.push(this.pdfText(pageMargin + 6, darkBottom + 36, 'Continued on next page', 9, '#dbeafe', 'left', 220));
    }

    if (profile.paymentInstructions.length > 0) {
      commands.push(this.pdfText(pageMargin + 6, 190, 'PAYMENT INSTRUCTIONS', 9, darkBlue, 'left', 180));
      profile.paymentInstructions.slice(0, 7).forEach((line, index) => {
        commands.push(this.pdfText(pageMargin + 6, 170 - index * 16, line, 7, darkBlue, 'left', 270));
      });
    }
    if (profile.additionalNotes.length > 0) {
      commands.push(this.pdfText(356, 190, 'ADDITIONAL NOTES', 9, darkBlue, 'left', 168));
      profile.additionalNotes.slice(0, 4).forEach((line, index) => {
        commands.push(this.pdfText(356, 170 - index * 20, line, 7, darkBlue, 'left', 180));
      });
    }
    if (profile.sellerName) commands.push(this.pdfText(548, 72, profile.sellerName, 8, darkBlue, 'right', 260));

    commands.push(this.pdfText(pageMargin, 24, `Invoice ${invoiceNo}`, 8, '#94a3b8'));
    commands.push(this.pdfText(298, 24, `Page ${pageNo} / ${totalPages}`, 8, '#94a3b8', 'center', 120));
    return commands.join('\n');
  }

  private buildInvoicePdfPage(
    input: InvoicePdfInput,
    rows: InvoiceExportLine[],
    pageNo: number,
    totalPages: number,
  ) {
    const commands: string[] = [];
    const theme = this.resolveGenericInvoicePdfTheme(input);
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

    commands.push(this.pdfFillRect(0, 0, 595, 842, theme.pageBg));
    commands.push(this.pdfFillRect(36, 744, 523, 72, theme.primaryColor));
    commands.push(this.pdfText(54, 786, theme.title, 22, '#ffffff'));
    commands.push(this.pdfText(54, 765, theme.subtitle, 10, '#dbeafe'));
    commands.push(this.pdfText(540, 788, input.detail.invoiceNo || '未生成', 13, '#ffffff', 'right', 190));
    commands.push(this.pdfText(540, 768, `模板：${input.templateName}`, 9, '#bfdbfe', 'right', 220));

    commands.push(this.pdfFillRect(42, 640, 511, 86, '#ffffff'));
    commands.push(this.pdfStrokeRect(42, 640, 511, 86, '#e2e8f0'));
    commands.push(this.pdfText(60, 704, theme.customerLabel, 9, '#64748b'));
    commands.push(this.pdfText(116, 704, input.info.customer || '-', 11, '#0f172a', 'left', 300));
    commands.push(this.pdfText(60, 682, theme.orderLabel, 9, '#64748b'));
    commands.push(this.pdfText(116, 682, input.info.orderId || '-', 11, '#0f172a', 'left', 240));
    commands.push(this.pdfText(60, 660, theme.dateLabel, 9, '#64748b'));
    commands.push(this.pdfText(116, 660, input.info.date || '-', 11, '#0f172a', 'left', 220));
    commands.push(this.pdfText(536, 704, theme.amountLabel, 9, '#64748b', 'right', 120));
    commands.push(this.pdfText(536, 676, input.detail.amount, 20, theme.accentColor, 'right', 180));

    commands.push(this.pdfText(tableX, 612, totalPages > 1 ? `${theme.itemsTitle}（第 ${pageNo} / ${totalPages} 页）` : theme.itemsTitle, 13, '#0f172a'));
    commands.push(this.pdfFillRect(tableX, headerBottom, tableWidth, headerHeight, theme.tableHeaderColor));
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
      commands.push(this.pdfText(382, totalTop + 18, theme.totalLabel, 13, '#0f172a'));
      commands.push(this.pdfText(540, totalTop + 18, input.detail.amount, 18, theme.accentColor, 'right', 160));
    }

    commands.push(this.pdfText(42, 48, `Invoice ${input.detail.invoiceNo || input.info.orderId}`, 8, '#94a3b8'));
    commands.push(this.pdfText(298, 48, `第 ${pageNo} / ${totalPages} 页`, 8, '#94a3b8', 'center', 120));
    commands.push(this.pdfText(553, 48, theme.footerNote, 8, '#94a3b8', 'right', 180));
    return commands.join('\n');
  }

  private resolveGenericInvoicePdfTheme(input: InvoicePdfInput) {
    const config = this.toRecord(input.templateConfig);
    const pdf = this.toRecord(config.pdf);
    const labels = this.toRecord(pdf.labels);
    return {
      title: this.toString(pdf.title) || this.toString(config.title) || '商业发票',
      subtitle: this.toString(pdf.subtitle) || 'Commercial Invoice',
      primaryColor: this.normalizePdfHexColor(this.toString(pdf.primaryColor) || this.toString(config.primaryColor), '#0f2a4a'),
      accentColor: this.normalizePdfHexColor(this.toString(pdf.accentColor) || this.toString(config.accentColor), '#2563eb'),
      tableHeaderColor: this.normalizePdfHexColor(this.toString(pdf.tableHeaderColor), '#eef4ff'),
      pageBg: this.normalizePdfHexColor(this.toString(pdf.pageBg), '#f8fafc'),
      customerLabel: this.toString(labels.customer) || '客户',
      orderLabel: this.toString(labels.orderNo) || '订单号',
      dateLabel: this.toString(labels.date) || '发货日',
      amountLabel: this.toString(labels.amount) || '金额',
      itemsTitle: this.toString(labels.itemsTitle) || '商品明细',
      totalLabel: this.toString(labels.total) || '合计',
      footerNote: this.toString(pdf.footerNote) || 'INOGI AI Office',
    };
  }

  private renderPdfDocument(pageContents: string[]) {
    const objects: Array<{ number: number; body: string }> = [
      { number: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' },
      {
        number: 2,
        body: `<< /Type /Pages /Kids [${pageContents.map((_, index) => `${6 + index * 2} 0 R`).join(' ')}] /Count ${pageContents.length} >>`,
      },
      { number: 3, body: '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>' },
      {
        number: 4,
        body: '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 5 >> /DW 1000 >>',
      },
      { number: 5, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>' },
    ];

    pageContents.forEach((content, index) => {
      const pageObject = 6 + index * 2;
      const contentObject = pageObject + 1;
      objects.push({
        number: pageObject,
        body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 5 0 R >> >> /Contents ${contentObject} 0 R >>`,
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
    if (this.canUseWinAnsi(text)) {
      return `BT\n/F2 ${size} Tf\n${this.pdfColor(color)} rg\n${this.pdfNumber(textX)} ${this.pdfNumber(y)} Td\n<${this.winAnsiHex(text)}> Tj\nET`;
    }
    return `BT\n/F1 ${size} Tf\n${this.pdfColor(color)} rg\n${this.pdfNumber(textX)} ${this.pdfNumber(y)} Td\n<${this.utf16BeHex(text)}> Tj\nET`;
  }

  private pdfKeyValue(labelX: number, y: number, valueX: number, label: string, value: unknown, color: string) {
    return [
      this.pdfText(labelX, y, label, 9, color, 'left', 104),
      this.pdfText(valueX, y, value, 9, color, 'right', 172),
    ].join('\n');
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

  private normalizePdfHexColor(value: string, fallback: string) {
    const clean = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(clean)) return clean;
    if (/^#[0-9a-f]{3}$/i.test(clean)) return clean;
    return fallback;
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

  private canUseWinAnsi(text: string) {
    return Array.from(text).every((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 0x20 && code <= 0xff;
    });
  }

  private winAnsiHex(text: string) {
    return Buffer.from(text.replace(/\s+/g, ' ').trim(), 'latin1').toString('hex').toUpperCase();
  }

  private formatPdfMoney(value: unknown) {
    const text = String(value ?? '').trim();
    const numeric = text.replace(/[¥￥$,\s]/g, '');
    const number = Number(numeric);
    if (Number.isFinite(number)) return `¥${number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    return text.replace(/[￥]/g, '¥');
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
