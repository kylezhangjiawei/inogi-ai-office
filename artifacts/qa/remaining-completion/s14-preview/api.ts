const initialLedger = {
  line: { id: 'qa-line-1', orderNo: 'PO-20260914-012', lineNo: '3', name: '氧气阀体 · Q5 装配', unit: '件', updatedAt: '2026-09-14T01:00:00.000Z' }, version: 4, canPropose: true, canApprove: true, canReadAffectedPlans: true,
  entries: [{ id: 'a-1', kind: 'return', status: 'approved', quantity: 2, receiptId: 'r-1', bucket: 'qualified', reason: '按退货单 TH-20260914-01 退回 2 件外观损伤产品，供应商确认补交。', createdByName: '采购甲', createdAt: '2026-09-14T01:00:00.000Z', reflectedEntryIds: [], history: [{ action: 'proposed', reason: '核对退货单及现场实物', actorName: '仓管甲', at: '2026-09-14T01:00:00.000Z' }, { action: 'approved', reason: '确认 2 件退货并保留补交要求', actorName: '采购主管', at: '2026-09-14T02:00:00.000Z' }] }],
  summary: { erpOrderedQty: 20, erpReceivedQty: 10, effectiveOrderedQty: null, effectiveReceivedQty: null, remainingQty: null, localGrossReceivedQty: 10, localNetReceivedQty: 8, localQualifiedQty: 4, qualifiedAvailableQty: null, cancelledQty: 0, returnedQty: 2, reversedQty: 0, coverageComplete: false, coverageCurrent: false, issues: ['退货或冲销尚未完成 ERP 与本地收货覆盖确认'], receipts: [{ id: 'r-1', qualifiedQty: 4, defectiveQty: 1, pendingJudgmentQty: 2, pendingQty: 1, netReceivedQty: 8 }] },
  receiptOptions: [{ id: 'r-1', deliveryNo: 'DELIVERY-0913-01', receivedDate: '2026-09-13' }], affectedPlans: [{ id: 'sp-1', code: 'SP-20260914-001', name: 'Q5 备货阀体', unit: '件', targetQty: 20, orderedQty: null, receivedQty: null, qualifiedQty: null, remainingToPurchaseQty: null, remainingToReceiveQty: null, provisional: true, issues: ['ERP 与本地收货覆盖待确认'] }],
};
let mode = 'success';
export function useAuth() { return { user: { id: 'qa-user', name: '隔离验证员', permissions: ['*'] } }; }
let ledger: any = structuredClone(initialLedger);
export function setScenario(value: string) { mode = value; ledger = structuredClone(initialLedger); ledger.canPropose = value !== 'readonly'; ledger.canApprove = value !== 'readonly'; sample = structuredClone(initialSample); sample.canRecordArrival = value !== 'readonly'; sample.canRecordTesting = value !== 'readonly'; }
export async function getPurchaseFulfillment() { return structuredClone(ledger); }
function check(input: any) { if (mode === 'conflict' || input.expectedVersion !== ledger.version) throw new Error('409 版本冲突：隔离夹具模拟他人已修改，请重新核对来源'); if (mode === 'readonly') throw new Error('只读夹具禁止保存'); }
export async function proposePurchaseFulfillment(_lineId: string, input: any) {
  check(input); const at = new Date().toISOString(); ledger.version++;
  ledger.entries.push({ ...input, id: crypto.randomUUID(), status: 'pending', createdByName: '隔离采购员', createdAt: at, history: [{ action: 'proposed', reason: input.reason, actorName: '隔离采购员', at }] });
  return getPurchaseFulfillment();
}
export async function decidePurchaseFulfillment(_lineId: string, id: string, action: string, input: any) {
  check(input); const entry = ledger.entries.find((row: any) => row.id === id); if (!entry) throw new Error('隔离记录不存在');
  entry.status = action === 'approve' ? 'approved' : 'revoked'; ledger.version++; entry.history.push({ action: entry.status, reason: input.reason, actorName: '隔离审批员', at: new Date().toISOString() });
  const approved = ledger.entries.filter((e: any) => e.status === 'approved');
  const reductions = approved.filter((e: any) => ['return', 'reversal'].includes(e.kind)).reduce((sum: number, e: any) => sum + e.quantity, 0);
  const cancelled = approved.filter((e: any) => e.kind === 'cancel').reduce((sum: number, e: any) => sum + e.quantity, 0);
  const covered = approved.some((e: any) => e.kind === 'coverage');
  Object.assign(ledger.summary, { localNetReceivedQty: 10 - reductions, localQualifiedQty: 6 - reductions, coverageCurrent: covered, coverageComplete: covered, effectiveOrderedQty: covered ? 20 - cancelled : null, effectiveReceivedQty: covered ? 10 - reductions : null, remainingQty: covered ? 10 - cancelled + reductions : null, qualifiedAvailableQty: covered ? 6 - reductions : null, issues: covered ? [] : ['请重新核对 ERP 与本地收货覆盖'] });
  return getPurchaseFulfillment();
}
const conditions = { priceUnit: 'CNY / 件', taxBasis: 'inclusive', taxRate: 13, paymentTerms: '验收后 30 天', freightTerms: '供应商承担运费', leadTimeStart: 'approval', leadTimeStartDate: null, note: '以图纸 V3 确认日为起算点' };
const initialSample: any = { task: { id: 'sample-qa-1', code: 'PR-20260914-021', materialName: '氧气阀体样品', spec: 'Q5 / V3', quantity: 2, unit: '件', buyer: '采购甲', status: 'testing', updatedAt: '2026-09-14T03:00:00.000Z', needSample: true, logs: [], attachmentList: [], rdTransferSnapshots: [] }, canRecordArrival: true, canRecordTesting: true, canReadCommercial: true, canConfirm: true,
  sampleTest: { roundId: 'sample-round-2', testerUserId: 'rd-a', testerName: '研发甲', assignedAt: '2026-09-13T02:00:00.000Z', assignedByName: '采购甲', recordsVersion: 1, arrivedAt: '2026-09-13T00:00:00.000Z', startedAt: null, finishedAt: null, result: null, note: null, confirmedAt: null, confirmedByName: null, commercial: conditions, revisions: [] },
  history: [{ roundId: 'sample-round-1', testerUserId: 'rd-a', testerName: '研发甲', assignedAt: '2026-09-08T02:00:00.000Z', assignedByName: '采购甲', recordsVersion: 1, arrivedAt: '2026-09-08T00:00:00.000Z', startedAt: '2026-09-08T03:00:00.000Z', finishedAt: '2026-09-09T03:00:00.000Z', result: 'failed_resample', note: '尺寸公差不合格，按 V3 重新送样。', confirmedAt: '2026-09-09T04:00:00.000Z', confirmedByName: '研发甲', archivedAt: '2026-09-13T02:00:00.000Z', archiveReason: 'new_sample', commercial: conditions, revisions: [] }],
};
let sample: any = structuredClone(initialSample);
export function getSampleDetail() { return structuredClone(sample); }
export async function updateProcSampleRecords(_id: string, input: any) {
  if (mode === 'conflict') throw new Error('409：隔离夹具模拟本轮登记已更新，请重新载入');
  if (mode === 'readonly') throw new Error('只读夹具禁止保存');
  sample.sampleTest.revisions.push({ ...sample.sampleTest, recordedAt: new Date().toISOString(), recordedByName: '隔离登记员' });
  for (const key of ['arrivedAt', 'startedAt', 'finishedAt', 'commercial']) if (key in input) sample.sampleTest[key] = input[key];
  sample.task.updatedAt = new Date().toISOString(); return getSampleDetail();
}
