import type {
  DispositionInput,
  DispositionLimits,
  DispositionPreviewState,
  DispositionReceipt,
  DispositionRecord,
} from './receiptDispositionTypes';

// Temporary, in-memory examples for reviewing the screen. Each order line has one
// example receipt; these limits do not represent confirmed production rules.
export function createDispositionPreviewState(): DispositionPreviewState {
  const receipts: DispositionReceipt[] = [
    {
      id: 'demo-receipt-001', version: 0, orderNo: 'DEMO-PO-001', lineNo: '10', deliveryNo: 'DEMO-DN-001',
      materialCode: 'DEMO-MAT-001', materialName: '阀体', spec: '演示规格 A', unit: '件', supplierName: '演示供应商 A',
      orderedQty: 80, originalReceivedQty: 60, receivedQty: 60, receivedDate: '2026-09-08',
      qualifiedQty: 56, defectiveQty: 4, pendingJudgmentQty: 0, inboundQty: 36, isolatedQty: 0, returnPlannedQty: 0,
    },
    {
      id: 'demo-receipt-002', version: 0, orderNo: 'DEMO-PO-002', lineNo: '20', deliveryNo: 'DEMO-DN-002',
      materialCode: 'DEMO-MAT-002', materialName: '压缩机', spec: '演示规格 B', unit: '台', supplierName: '演示供应商 B',
      orderedQty: 100, originalReceivedQty: 40, receivedQty: 40, receivedDate: '2026-09-08',
      qualifiedQty: 0, defectiveQty: 0, pendingJudgmentQty: 0, inboundQty: 0, isolatedQty: 0, returnPlannedQty: 0,
    },
    {
      id: 'demo-receipt-003', version: 2, orderNo: 'DEMO-PO-003', lineNo: '30', deliveryNo: 'DEMO-DN-003',
      materialCode: 'DEMO-MAT-003', materialName: '筛筒', spec: '演示规格 C', unit: '件', supplierName: '演示供应商 C',
      orderedQty: 120, originalReceivedQty: 100, receivedQty: 100, receivedDate: '2026-09-08',
      qualifiedQty: 90, defectiveQty: 6, pendingJudgmentQty: 4, inboundQty: 90, isolatedQty: 6, returnPlannedQty: 2,
    },
  ];
  const records: DispositionRecord[] = [
    {
      id: 'demo-record-return-001', receiptId: 'demo-receipt-003', kind: 'return', quantity: 2,
      date: '2026-09-09', reason: '演示：对已隔离的 2 件不良品登记换货安排。',
      warehouse: '', location: '', documentNo: 'DEMO-RT-001', owner: '演示经办人',
      returnMethod: 'replacement', expectedDate: '2026-09-15',
      note: '仅记录安排，尚未退回，也未收取补货；原实收、检验与入库数量不变。',
      createdAt: '2026-09-09T03:00:00.000Z', createdByName: '演示操作员', beforeQty: 0, afterQty: 2,
    },
    {
      id: 'demo-record-isolation-001', receiptId: 'demo-receipt-003', kind: 'isolation', quantity: 6,
      date: '2026-09-09', reason: '演示：将已明确判为不良的 6 件筛筒登记隔离。',
      warehouse: '演示隔离仓', location: 'DEMO-Q-01', documentNo: '', owner: '演示保管人',
      returnMethod: 'return', expectedDate: '',
      note: '演示期初：本批实收 100 件、合格 90 件、不良 6 件、待判定 4 件、已入库 90 件；阀体已入库 36 件也来自演示期初。',
      createdAt: '2026-09-09T02:00:00.000Z', createdByName: '演示操作员', beforeQty: 0, afterQty: 6,
    },
  ];
  return { receipts, records };
}

const milli = (value: number) => Math.round(value * 1000);
const quantity = (value: number) => value / 1000;
const remaining = (total: number, used: number) => quantity(Math.max(0, milli(total) - milli(used)));

export function dispositionLimits(receipt: DispositionReceipt): DispositionLimits {
  return {
    correctionMin: quantity(milli(receipt.qualifiedQty) + milli(receipt.defectiveQty) + milli(receipt.pendingJudgmentQty)),
    correctionMax: receipt.orderedQty,
    inbound: remaining(receipt.qualifiedQty, receipt.inboundQty),
    isolation: remaining(receipt.defectiveQty, receipt.isolatedQty),
    return: Math.min(remaining(receipt.defectiveQty, receipt.returnPlannedQty), remaining(receipt.isolatedQty, receipt.returnPlannedQty)),
  };
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

function required(value: string, label: string): void {
  if (!value.trim()) throw new Error(`请填写${label}。`);
}

function maxLength(value: string, length: number, label: string): void {
  if (value.trim().length > length) throw new Error(`${label}不能超过 ${length} 个字符。`);
}

export function applyDisposition(
  state: DispositionPreviewState,
  receiptId: string,
  expectedVersion: number,
  input: DispositionInput,
  nowIso = new Date().toISOString(),
): DispositionPreviewState {
  const receipt = state.receipts.find((item) => item.id === receiptId);
  if (!receipt) throw new Error('未找到演示收货批次，请重新选择。');
  if (receipt.version !== expectedVersion) throw new Error('演示数据版本已变化，请重新打开操作并核对数量。');
  if (!['correction', 'inbound', 'isolation', 'return'].includes(input.kind)) throw new Error('请选择有效的演示处理类型。');
  if (!Number.isFinite(input.quantity) || input.quantity <= 0 || !Number.isSafeInteger(milli(input.quantity)) || Number(input.quantity.toFixed(3)) !== input.quantity) {
    throw new Error('数量必须大于 0，且最多保留三位小数。');
  }
  required(input.reason, '处理原因');
  maxLength(input.reason, 1000, '处理原因');
  maxLength(input.note, 1000, '备注');
  if (!validDate(input.date)) throw new Error('请填写有效的操作日期。');
  if (input.date < receipt.receivedDate) throw new Error('操作日期不能早于本批收货日期。');
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) throw new Error('当前演示时间无效，请重试。');
  const beijingToday = new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  if (input.date > beijingToday) throw new Error('操作日期不能晚于北京今天。');

  const limits = dispositionLimits(receipt);
  const updated = { ...receipt, version: receipt.version + 1 };
  let beforeQty: number;
  let afterQty: number;
  switch (input.kind) {
    case 'correction': {
      if (input.quantity < limits.correctionMin || input.quantity > limits.correctionMax) {
        throw new Error(`纠错后的总实收须在 ${limits.correctionMin} 至 ${limits.correctionMax} ${receipt.unit}之间（演示范围）。`);
      }
      if (input.quantity === receipt.receivedQty) throw new Error('纠错后的总实收与当前数量相同，请填写需要调整的数量。');
      beforeQty = receipt.receivedQty;
      afterQty = input.quantity;
      updated.receivedQty = afterQty;
      break;
    }
    case 'inbound': {
      if (input.quantity > limits.inbound) throw new Error(`本次入库不能超过待入库合格量 ${limits.inbound} ${receipt.unit}。`);
      required(input.warehouse, '入库仓库');
      required(input.location, '入库库位');
      required(input.documentNo, '入库单号');
      maxLength(input.documentNo, 120, '入库单号');
      beforeQty = receipt.inboundQty;
      afterQty = quantity(milli(beforeQty) + milli(input.quantity));
      updated.inboundQty = afterQty;
      break;
    }
    case 'isolation': {
      if (input.quantity > limits.isolation) throw new Error(`本次隔离不能超过未隔离不良量 ${limits.isolation} ${receipt.unit}。`);
      required(input.warehouse, '隔离仓库');
      required(input.location, '隔离库位');
      required(input.owner, '隔离负责人');
      maxLength(input.owner, 80, '隔离负责人');
      beforeQty = receipt.isolatedQty;
      afterQty = quantity(milli(beforeQty) + milli(input.quantity));
      updated.isolatedQty = afterQty;
      break;
    }
    case 'return': {
      if (input.quantity > limits.return) throw new Error(`本次退换安排不能超过已隔离且未安排的不良量 ${limits.return} ${receipt.unit}，请先登记隔离。`);
      required(input.documentNo, '退换关联单号');
      required(input.owner, '退换跟进人');
      maxLength(input.documentNo, 120, '退换关联单号');
      maxLength(input.owner, 80, '退换跟进人');
      if (!['return', 'replacement'].includes(input.returnMethod)) throw new Error('请选择退货或换货补货安排。');
      if (input.returnMethod === 'replacement') {
        if (!validDate(input.expectedDate)) throw new Error('请填写有效的预计补货日期。');
        if (input.expectedDate < input.date) throw new Error('预计补货日期不能早于操作日期。');
      }
      beforeQty = receipt.returnPlannedQty;
      afterQty = quantity(milli(beforeQty) + milli(input.quantity));
      updated.returnPlannedQty = afterQty;
      break;
    }
  }

  const record: DispositionRecord = {
    ...input,
    reason: input.reason.trim(), note: input.note.trim(),
    warehouse: input.kind === 'inbound' || input.kind === 'isolation' ? input.warehouse.trim() : '',
    location: input.kind === 'inbound' || input.kind === 'isolation' ? input.location.trim() : '',
    documentNo: input.kind === 'inbound' || input.kind === 'return' ? input.documentNo.trim() : '',
    owner: input.kind === 'isolation' || input.kind === 'return' ? input.owner.trim() : '',
    returnMethod: input.kind === 'return' ? input.returnMethod : 'return',
    expectedDate: input.kind === 'return' && input.returnMethod === 'replacement' ? input.expectedDate : '',
    id: crypto.randomUUID(), receiptId, createdAt: new Date(now).toISOString(), createdByName: '演示操作员', beforeQty, afterQty,
  };
  return {
    receipts: state.receipts.map((item) => item.id === receiptId ? updated : item),
    records: [record, ...state.records],
  };
}
