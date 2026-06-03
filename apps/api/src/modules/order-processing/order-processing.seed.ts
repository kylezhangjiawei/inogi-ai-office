import { OrderProcessingState, PurchaseOrder } from './order-processing.types';

// 订货单处理模块仅保留发票模板与系统设置作为初始数据，
// 不再注入任何演示用的订单 / 库存 / 出入库 / 采购订单业务数据。
// 业务数据应全部来自真实上传 / 邮件识别 / 手动录入。
export function createInitialOrderProcessingState(): OrderProcessingState {
  const now = '2026-06-01T00:00:00.000Z';

  return {
    orders: [],
    orderDetails: {},
    inventory: [],
    movements: [],
    templates: [
      { id: 'weoxy', name: '标准发票 (WEOXY)', source: 'builtin', config: { pdfLayout: 'weoxy' } },
      { id: 'inogi', name: '结算发票 (INOGI)', source: 'builtin', config: { pdfLayout: 'inogi' } },
      { id: 'custom', name: '自定义模板', source: 'builtin', config: { pdfLayout: 'generic' } },
    ],
    activeTemplateId: 'weoxy',
    reminderRule: { enabled: true, daysBefore: 3 },
    updatedAt: now,
  };
}

export function createInitialPurchaseOrders(): PurchaseOrder[] {
  return [];
}
