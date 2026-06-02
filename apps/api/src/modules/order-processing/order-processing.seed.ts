import { OrderProcessingState } from './order-processing.types';

export function createInitialOrderProcessingState(): OrderProcessingState {
  const now = '2026-06-01T00:00:00.000Z';

  return {
    orders: [
      { id: 'PO-20260524-01', customer: '上海星辉贸易有限公司', type: 'warning', status: '发货临近', date: '05-30', source: 'upload', generated: true, invoiceExported: false, createdAt: '2026-05-24T09:30:00.000Z' },
      { id: 'PO-20260523-08', customer: '杭州优品电子有限公司', type: 'error', status: '价格差异', date: '06-02', source: 'upload', generated: false, invoiceExported: false, createdAt: '2026-05-23T11:20:00.000Z' },
      { id: 'PO-20260523-07', customer: '广东宏达科技有限公司', type: 'success', status: '正常', date: '06-05', source: 'upload', generated: false, invoiceExported: false, createdAt: '2026-05-23T10:10:00.000Z' },
      { id: 'PO-20260522-11', customer: '深圳市捷通实业有限公司', type: 'error', status: '库存不足', date: '06-01', source: 'upload', generated: false, invoiceExported: false, createdAt: '2026-05-22T15:00:00.000Z' },
      { id: 'PO-20260521-16', customer: '南京耀华供应链有限公司', type: 'success', status: '已生成', date: '06-04', source: 'upload', generated: true, invoiceExported: true, createdAt: '2026-05-21T12:40:00.000Z' },
      { id: 'PO-20260520-03', customer: '苏州晨光电子商务有限公司', type: 'warning', status: '待识别', date: '06-06', source: 'upload', generated: false, invoiceExported: false, createdAt: '2026-05-20T08:20:00.000Z' },
    ],
    orderDetails: {
      'PO-20260524-01': {
        id: 'PO-20260524-01',
        customer: '上海星辉贸易有限公司',
        orderId: 'PO-20260524-01',
        date: '2026-05-30',
        amount: '¥28,650.00',
        invoiceNo: 'CI2026-004',
        generatedAt: '2026-05-24T09:36:00.000Z',
        mailContent: {
          subject: '订货单 PO-20260524-01 / 上海星辉贸易有限公司',
          sender: 'sales@xinghui.example.com',
          receivedAt: '2026-05-24 09:30',
          body: '您好，附件为本次订货单，请按 PO-20260524-01 安排发货并开具商业发票。客户：上海星辉贸易有限公司；预计发货日：2026-05-30；如库存或价格有差异请及时反馈。'
        },
        products: [
          { id: 'BT-001', name: '无线蓝牙耳机', category: '数码配件', spec: '黑色', unit: '个', orderQty: 10, stockQty: 25, orderPrice: '¥89.00', sysPrice: '¥89.00', subtotal: '¥890.00', status: '通过', remark: '匹配成功' },
          { id: 'TC-002', name: 'Type-C 数据线', category: '线材', spec: '1m 白色', unit: '条', orderQty: 20, stockQty: 80, orderPrice: '¥12.00', sysPrice: '¥12.00', subtotal: '¥240.00', status: '通过', remark: '匹配成功' },
          { id: 'PB-100', name: '移动电源 10000mAh', category: '数码配件', spec: '黑色', unit: '个', orderQty: 30, stockQty: 12, orderPrice: '¥65.00', sysPrice: '¥65.00', subtotal: '¥1,950.00', status: '库存不足', remark: '缺 18 件' },
          { id: 'CH-018', name: 'USB充电器 18W', category: '充电器', spec: '白色', unit: '个', orderQty: 50, stockQty: 120, orderPrice: '¥19.00', sysPrice: '¥19.00', subtotal: '¥950.00', status: '通过', remark: '匹配成功' },
          { id: 'SP-002', name: '蓝牙音箱', category: '音频设备', spec: '灰色', unit: '台', orderQty: 5, stockQty: 18, orderPrice: '¥120.00', sysPrice: '¥118.00', subtotal: '¥600.00', status: '价格差异', remark: '系统价低 ¥2' },
          { id: 'HS-005', name: '手机支架', category: '手机配件', spec: '铝合金', unit: '个', orderQty: 15, stockQty: 33, orderPrice: '¥25.00', sysPrice: '¥25.00', subtotal: '¥375.00', status: '通过', remark: '匹配成功' },
          { id: 'HD-010', name: 'HDMI高清线', category: '线材', spec: '2m', unit: '条', orderQty: 20, stockQty: 40, orderPrice: '¥28.00', sysPrice: '¥28.00', subtotal: '¥560.00', status: '通过', remark: '匹配成功' },
          { id: 'BOX-022', name: '包装纸箱', category: '包装耗材', spec: '中号', unit: '个', orderQty: 60, stockQty: 200, orderPrice: '¥5.00', sysPrice: '¥5.00', subtotal: '¥300.00', status: '通过', remark: '匹配成功' },
        ],
      },
    },
    inventory: [
      { id: 'BT-001', name: '无线蓝牙耳机', category: '数码配件', spec: '黑色', stock: 25, safe: 20, in: 0, out: 10, status: '正常' },
      { id: 'TC-002', name: 'Type-C 数据线', category: '线材', spec: '1m 白色', stock: 80, safe: 100, in: 450, out: 20, status: '偏低' },
      { id: 'PB-100', name: '移动电源 10000mAh', category: '数码配件', spec: '黑色', stock: 12, safe: 30, in: 0, out: 30, status: '缺货' },
      { id: 'CH-018', name: 'USB充电器 18W', category: '充电器', spec: '白色', stock: 120, safe: 50, in: 0, out: 50, status: '正常' },
      { id: 'SP-002', name: '蓝牙音箱', category: '音频设备', spec: '灰色', stock: 18, safe: 15, in: 0, out: 5, status: '正常' },
      { id: 'HS-005', name: '手机支架', category: '手机配件', spec: '铝合金', stock: 33, safe: 20, in: 0, out: 15, status: '正常' },
      { id: 'HD-010', name: 'HDMI高清线', category: '线材', spec: '2m', stock: 40, safe: 60, in: 120, out: 20, status: '偏低' },
      { id: 'BOX-022', name: '包装纸箱', category: '包装耗材', spec: '中号', stock: 200, safe: 80, in: 0, out: 60, status: '正常' },
      { id: 'KB-008', name: '机械键盘', category: '外设', spec: '87键', stock: 5, safe: 25, in: 0, out: 12, status: '缺货' },
      { id: 'MS-006', name: '无线鼠标', category: '外设', spec: '静音', stock: 45, safe: 35, in: 0, out: 18, status: '正常' },
      { id: 'CL-020', name: '屏幕清洁套装', category: '清洁耗材', spec: '100ml', stock: 150, safe: 60, in: 0, out: 30, status: '正常' },
      { id: 'AD-011', name: '多功能转换器', category: '数码配件', spec: '7合1', stock: 18, safe: 40, in: 60, out: 22, status: '偏低' },
    ],
    movements: [
      { id: 'MV-001', itemId: 'BT-001', itemName: '无线蓝牙耳机', type: 'in', qty: 50, time: '2026-05-26 14:32', operator: '李华', note: '采购入库 · 关联 PO-20260524-01', relatedOrderId: 'PO-20260524-01' },
      { id: 'MV-002', itemId: 'BT-001', itemName: '无线蓝牙耳机', type: 'out', qty: 10, time: '2026-05-25 10:15', operator: '王芳', note: '销售出库 · 上海星辉贸易', relatedOrderId: 'PO-20260524-01' },
      { id: 'MV-003', itemId: 'TC-002', itemName: 'Type-C 数据线', type: 'in', qty: 100, time: '2026-05-24 09:08', operator: '李华', note: '采购入库 · 东莞市嘉鸿科技' },
      { id: 'MV-004', itemId: 'PB-100', itemName: '移动电源 10000mAh', type: 'out', qty: 30, time: '2026-05-23 16:42', operator: '王芳', note: '销售出库 · 杭州优品电子' },
    ],
    templates: [
      { id: 'weoxy', name: '标准发票 (WEOXY)', source: 'builtin' },
      { id: 'inogi', name: '结算发票 (INOGI)', source: 'builtin' },
      { id: 'custom', name: '自定义模板', source: 'builtin' },
    ],
    activeTemplateId: 'weoxy',
    reminderRule: { enabled: true, daysBefore: 3 },
    updatedAt: now,
  };
}
