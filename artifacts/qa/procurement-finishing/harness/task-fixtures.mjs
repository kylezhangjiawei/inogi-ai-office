const pad = (value) => String(value).padStart(2, '0');
export const localDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const today = new Date();
const relativeDay = (offset) => { const date = new Date(today); date.setDate(date.getDate() + offset); return localDate(date); };
const monthDay = (monthOffset, day) => localDate(new Date(today.getFullYear(), today.getMonth() + monthOffset, day));
export const fixtureDate = localDate(today);
export const user = {
  id: 'qa-s01-buyer', name: '李采购（隔离验证）', englishName: '', username: 's01-fixture', email: '',
  roleId: 'qa-s01', roleName: '隔离验证采购员',
  permissions: ['page:proc-my-workspace', 'page:proc-cockpit', 'page:rd-task', 'page:rd-my-workspace', 'proc-task:confirm', 'proc-task:inquiry', 'proc-task:select-quote', 'proc-task:order', 'proc-task:receive'],
  department: '采购部', departmentCode: 'procurement', avatarUrl: null,
};
export const products = [
  { id: 'prod-portable-o2', name: '便携式制氧机', status: 'active' },
  { id: 'prod-5l-dc-o2', name: '5L直流式制氧机', status: 'developing' },
  { id: 'prod-positive-pressure-respirator', name: '正压式呼吸器', status: 'developing' },
];
const now = today.toISOString();
const base = {
  productId: 'prod-portable-o2', spec: '按研发确认资料采购', unit: '件', quantity: 100,
  method: 'inquiry', source: 'rd', businessLine: 'rd', status: 'pending_confirm', priority: 'medium',
  needSample: false, buyer: user.name, buyerUserId: user.id, rdContact: '张工（隔离验证）', rdContactUserId: 'qa-s01-rd',
  requester: '张工（隔离验证）', requesterDept: '研发部', paymentStatus: 'unpaid', paymentNote: '',
  arrivedQty: 0, businessDone: false, attachments: 0, attachmentList: [], purchaseOrders: [], criticalMaterials: [],
  needDate: monthDay(0, Math.max(1, today.getDate())), deadline: relativeDay(3),
  logs: [], createdAt: now, updatedAt: now, rdTransferSnapshots: [], sampleTest: null,
};
const task = (number, name, overrides = {}) => ({ ...structuredClone(base), id: `s01-${number}`, code: `CG-S01-QA-${pad(number)}`, materialName: `${name}（隔离验证）`, ...overrides });
const order = (id, overrides = {}) => ({ id, tpOrderNo: `PO-QA-${id}`, tpLineNo: '1', supplierName: '供应商甲（隔离验证）', orderedQty: 100, receivedQty: 0, unitPrice: 18, orderDate: relativeDay(-5), etaDate: relativeDay(2), ...overrides });
const file = { fileName: '阀体结构图-V1.pdf', fileUrl: '/__qa/sample.pdf', fileKey: 'qa/s01/v1.pdf', fileSize: 14000, mimeType: 'application/pdf', kind: 'drawing', technicalDocumentVersionId: 'qa-s01-v1', documentId: 'qa-s01-document', version: 'V1', category: 'drawing', title: '阀体结构图', attachmentId: 'qa-s01-attachment', sourceNoteId: null, versionCreatedAt: now };

export function createTasks() {
  const current = task(1, '当月阀体需求', { rdTaskId: 'RD-S01-QA-001', rdTaskTitle: '阀体结构验证（隔离验证）', spec: '6061 铝合金 · 密封面 Ø24 mm', quantity: 20, unit: '套', attachments: 1, attachmentList: [{ id: 'qa-s01-attachment', fileName: file.fileName, fileUrl: file.fileUrl, fileSize: file.fileSize, mimeType: file.mimeType, kind: 'drawing' }] });
  current.rdTransferSnapshots = [{ id: 'qa-s01-transfer', submittedAt: now, submittedBy: 'qa-s01-rd', submittedByName: '张工（隔离验证）', rdTaskId: current.rdTaskId, rdTaskTitle: current.rdTaskTitle, requirement: { productId: current.productId, materialName: current.materialName, spec: current.spec, unit: current.unit, quantity: current.quantity, purchaseLink: null, needDate: current.needDate, deadline: current.deadline, note: '按确认版制作，重点验证尺寸与装配。此为隔离验证资料。' }, attachments: [file] }];
  return [
    current,
    task(2, '高优先级逾期密封圈', { priority: 'high', deadline: relativeDay(-3), status: 'pending_inquiry' }),
    task(3, '跨月未完减震支架', { needDate: monthDay(-1, 18), deadline: monthDay(-1, 16), status: 'pending_confirm', productId: 'prod-5l-dc-o2' }),
    task(4, '需求日期待确认电源线', { needDate: undefined, deadline: relativeDay(6), status: 'pending_confirm', productId: 'prod-positive-pressure-respirator' }),
    task(5, '未来月份端盖需求', { needDate: monthDay(1, 15), deadline: monthDay(1, 12), priority: 'low', status: 'pending_confirm' }),
    task(6, '双供应商订单行滤芯', { status: 'partial_arrival', quantity: 100, arrivedQty: 25, expectedArrivalDate: relativeDay(2), purchaseOrders: [order('MULTI', { id: 'qa-s01-order-line-1', tpLineNo: '1', orderedQty: 60, receivedQty: 20 }), order('MULTI', { id: 'qa-s01-order-line-2', tpLineNo: '2', supplierName: '供应商乙（隔离验证）', orderedQty: 40, receivedQty: 5, etaDate: relativeDay(5) })] }),
    task(7, '免费样品硅胶垫', { needSample: true, status: 'pending_sample', quantity: 5, expectedArrivalDate: relativeDay(1), rdTaskId: 'RD-S01-QA-007', rdTaskTitle: '硅胶垫样品测试（隔离验证）', purchaseOrders: [order('FREE', { freeSample: true, tpOrderNo: '', tpLineNo: '', orderedQty: 5, receivedQty: 0, unitPrice: null, etaDate: relativeDay(1), supplierName: '样品供应商（隔离验证）' })] }),
    task(8, '到货日期待确认电磁阀', { status: 'in_transit', expectedArrivalDate: relativeDay(4), productId: 'prod-5l-dc-o2', purchaseOrders: [order('NO-ETA', { etaDate: undefined, supplierName: '供应商乙（隔离验证）' })] }),
    task(9, '收货数量异常旋钮', { status: 'partial_arrival', expectedArrivalDate: relativeDay(-1), quantity: 10, arrivedQty: 12, purchaseOrders: [order('OVER-RECEIVED', { orderedQty: 10, receivedQty: 12, etaDate: relativeDay(-1) })] }),
    task(10, '不属于本人任务请勿显示', { buyerUserId: 'qa-s01-other-buyer', buyer: user.name, priority: 'high', deadline: relativeDay(-10), quantity: 9999, purchaseOrders: [order('OUTSIDE', { supplierName: '外部任务供应商（应排除）', orderedQty: 9999 })] }),
  ];
}

export function createPaginationTasks() {
  return Array.from({ length: 15 }, (_, index) => {
    const number = index + 1;
    const last = number === 15;
    return task(100 + number, last ? '分页末项验证件' : `多页验证物料 ${pad(number)}`, {
      id: `s01-page-${pad(number)}`,
      code: `CG-S01-QA-P${pad(number)}`,
      priority: 'low',
      quantity: number,
      deadline: relativeDay(last ? 365 : 90 + number),
      status: last ? 'in_transit' : 'pending_confirm',
      expectedArrivalDate: last ? relativeDay(365) : undefined,
      purchaseOrders: last ? [order('PAGE-LAST', {
        id: 'qa-s01-page-last-order', tpOrderNo: 'PO-QA-PAGE-LAST', tpLineNo: '1',
        supplierName: '分页验证供应商（隔离验证）', orderedQty: 15, receivedQty: 0, etaDate: relativeDay(7),
      })] : [],
    });
  });
}
