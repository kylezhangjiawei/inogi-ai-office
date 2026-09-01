import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { OrderProcessingService } from '../src/modules/order-processing/order-processing.service';

function orderRow() {
  const now = new Date('2026-08-31T00:00:00.000Z');
  return {
    id: 'PO-SAFE-001',
    customer: 'Configured Customer',
    type: 'warning',
    status: '待处理',
    shipDate: new Date('2026-09-10T00:00:00.000Z'),
    source: 'upload',
    generated: false,
    invoiceExported: false,
    originalFileName: 'safe-order.xlsx',
    metadata: {},
    createdAt: now,
    updatedAt: now,
    products: [
      {
        id: 'line-1',
        orderId: 'PO-SAFE-001',
        sku: 'SKU-1',
        name: 'Safe Product',
        category: 'General',
        spec: 'Standard',
        unit: 'pcs',
        orderQty: 2,
        stockQty: 10,
        orderPrice: 10,
        sysPrice: 10,
        subtotal: 20,
        status: '通过',
        remark: '匹配成功',
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
    invoice: {
      id: 'INV-PO-SAFE-001',
      orderId: 'PO-SAFE-001',
      invoiceNo: 'CI2026-001',
      amount: 20,
      generatedAt: now,
      exportedAt: null,
      templateId: 'weoxy',
      metadata: {},
      createdAt: now,
      updatedAt: now,
    },
  };
}

function createService() {
  const order = orderRow();
  const invoiceWrites: Array<Record<string, unknown>> = [];
  const orderWrites: Array<Record<string, unknown>> = [];
  const tx = {
    orderProcessingOrder: {
      findUnique: async () => order,
      update: async (args: { data: Record<string, unknown> }) => {
        orderWrites.push(args.data);
        Object.assign(order, args.data);
        return order;
      },
    },
    orderProcessingInvoice: {
      upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const data = args.update;
        invoiceWrites.push(data);
        Object.assign(order.invoice, data);
        return order.invoice;
      },
    },
  };
  const prisma = {
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
  };
  const service = new OrderProcessingService(prisma as never, {} as never, {} as never, {} as never);
  const internals = service as unknown as {
    ensureInitialized: () => Promise<void>;
    getTemplatesAndSettings: () => Promise<Record<string, unknown>>;
  };
  internals.ensureInitialized = async () => undefined;
  internals.getTemplatesAndSettings = async () => ({
    templates: [{ id: 'weoxy', name: 'Safe Template', source: 'builtin', config: { pdfLayout: 'weoxy' } }],
    activeTemplateId: 'weoxy',
    reminderRule: { enabled: false, daysBefore: 0 },
  });
  return { service, order, invoiceWrites, orderWrites };
}

function invoiceLine(overrides: Record<string, unknown> = {}) {
  return {
    lineId: 'line-1',
    id: 'SKU-1',
    name: 'Safe Product',
    spec: 'Standard',
    unit: 'pcs',
    quantity: 2,
    unitPrice: 10,
    subtotal: 20,
    ...overrides,
  };
}

test('生成发票拒绝与数量乘单价不一致的小计，且不会写入订单', async () => {
  const { service, invoiceWrites, orderWrites } = createService();

  await assert.rejects(
    service.generateInvoice('PO-SAFE-001', { lines: [invoiceLine({ subtotal: 19.99 })] }),
    /第 1 行金额必须等于数量乘以单价/,
  );
  assert.equal(invoiceWrites.length, 0);
  assert.equal(orderWrites.length, 0);
});

test('生成发票按分派生小计并保存服务端计算结果', async () => {
  const { service, invoiceWrites } = createService();

  await service.generateInvoice('PO-SAFE-001', {
    lines: [invoiceLine({ quantity: 3, unitPrice: 10.015, subtotal: undefined })],
  });

  assert.equal(invoiceWrites.length, 1);
  assert.equal(invoiceWrites[0].amount, 30.06);
  const metadata = invoiceWrites[0].metadata as { lines: Array<{ unitPrice: string; subtotal: string }> };
  assert.equal(metadata.lines[0].unitPrice, '10.02');
  assert.equal(metadata.lines[0].subtotal, '30.06');
});

test('生成发票拒绝非有限值、空值、非标量与超出安全范围的金额或数量', async () => {
  const invalidLines = [
    invoiceLine({ unitPrice: 'Infinity' }),
    invoiceLine({ subtotal: 'NaN' }),
    invoiceLine({ unitPrice: null }),
    invoiceLine({ quantity: true }),
    invoiceLine({ quantity: Number.MAX_SAFE_INTEGER, unitPrice: 10 }),
  ];

  for (const line of invalidLines) {
    const { service, invoiceWrites, orderWrites } = createService();
    await assert.rejects(service.generateInvoice('PO-SAFE-001', { lines: [line] }));
    assert.equal(invoiceWrites.length, 0);
    assert.equal(orderWrites.length, 0);
  }
});

test('生成发票拒绝非数组商品明细，而不是静默回退到订单商品', async () => {
  const { service, invoiceWrites, orderWrites } = createService();

  await assert.rejects(
    service.generateInvoice('PO-SAFE-001', { lines: invoiceLine() }),
    /发票商品明细格式不正确/,
  );
  assert.equal(invoiceWrites.length, 0);
  assert.equal(orderWrites.length, 0);
});

test('读取历史发票时也按数量与单价重新派生小计，并丢弃非法行', () => {
  const service = createService().service as unknown as {
    toInvoiceLines: (metadata: Record<string, unknown>) => Array<{ subtotal: string }>;
  };

  const lines = service.toInvoiceLines({
    lines: [
      invoiceLine({ subtotal: 999 }),
      invoiceLine({ id: 'SKU-2', lineId: 'line-2', unitPrice: 'Infinity' }),
    ],
  });

  assert.equal(lines.length, 1);
  assert.equal(lines[0].subtotal, '20.00');
});

test('导出历史发票会纠正旧的小计与总额，不沿用客户端曾写入的金额', async () => {
  const { service, order, invoiceWrites } = createService();
  order.generated = true;
  order.invoice.amount = 999;
  order.invoice.metadata = { lines: [invoiceLine({ subtotal: 999 })] };

  await service.exportInvoice('PO-SAFE-001');

  assert.equal(invoiceWrites.length, 1);
  assert.equal(invoiceWrites[0].amount, 20);
});

function pdfInput(layout: 'weoxy' | 'inogi', config: Record<string, unknown> = {}) {
  return {
    detail: {
      id: 'PO-SAFE-001',
      customer: 'Configured Customer',
      orderId: 'PO-SAFE-001',
      date: '2026-09-10',
      amount: '¥20.00',
      invoiceNo: 'CI2026-001',
      products: [],
    },
    info: { customer: 'Configured Customer', orderId: 'PO-SAFE-001', date: '2026-09-10' },
    lines: [],
    templateName: 'Configured Template',
    templateId: layout,
    templateConfig: { pdfLayout: layout, ...config },
  };
}

function hasPdfAscii(pdf: Buffer, value: string) {
  const hex = Buffer.from(value, 'latin1').toString('hex').toUpperCase();
  return pdf.toString('utf8').includes(`<${hex}> Tj`);
}

test('内置发票版式未配置时省略客户地址、收款账户与固定付款说明', () => {
  const service = createService().service as unknown as {
    buildInvoicePdf: (input: ReturnType<typeof pdfInput>) => Buffer;
  };

  for (const layout of ['weoxy', 'inogi'] as const) {
    const pdf = service.buildInvoicePdf(pdfInput(layout));
    assert.equal(hasPdfAscii(pdf, 'PAYMENT INSTRUCTIONS'), false);
    assert.equal(hasPdfAscii(pdf, '110 Cedar Street, STE 105,'), false);
    assert.equal(hasPdfAscii(pdf, 'Bank of America, N.A.'), false);
    assert.equal(hasPdfAscii(pdf, 'BANK OF CHINA JIANGSU BRANCH'), false);
    assert.equal(hasPdfAscii(pdf, 'BOFAUS3N'), false);
    assert.equal(hasPdfAscii(pdf, 'BKCHCNBJ940'), false);
    assert.equal(hasPdfAscii(pdf, 'Full Payment Due upon Receipt'), false);
  }
});

test('发票版式仅展示模板中明确保存的地址与收款信息', () => {
  const service = createService().service as unknown as {
    buildInvoicePdf: (input: ReturnType<typeof pdfInput>) => Buffer;
  };
  const configuredPdf = {
    customer: { billingAddress: ['Configured Billing Address'] },
    payment: {
      bank: {
        bankName: 'Configured Bank',
        accountNumber: 'SAFE-123',
        swiftCode: 'SAFE-SWIFT',
      },
    },
  };

  for (const layout of ['weoxy', 'inogi'] as const) {
    const pdf = service.buildInvoicePdf(pdfInput(layout, { pdf: configuredPdf }));
    assert.equal(hasPdfAscii(pdf, 'Configured Billing Address'), true);
    assert.equal(hasPdfAscii(pdf, 'PAYMENT INSTRUCTIONS'), true);
    assert.equal(hasPdfAscii(pdf, 'Bank Name: Configured Bank'), true);
    assert.equal(hasPdfAscii(pdf, 'Account Number: SAFE-123'), true);
    assert.equal(hasPdfAscii(pdf, 'SWIFT Code: SAFE-SWIFT'), true);
  }
});
