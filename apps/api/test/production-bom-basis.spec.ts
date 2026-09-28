import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { legacyBasisAllows, legacyBasisFingerprint, type ExecutionPlan } from '../src/modules/procurement/production-execution.model';
const oldPlan = () => ({ productId: 'A', deviceId: 'device', targetQty: 10, shipmentTargetQty: 8,
  bom: [{ id: 'm', code: 'V', name: '阀', unit: '件', qtyPer: 1 }], tasks: [{ id: 't', quantity: 5 }],
} as ExecutionPlan);
test('历史计划待核对可收尾但不能扩大执行', () => {
  const plan = oldPlan();
  for (const action of ['task', 'dispatch']) assert.equal(legacyBasisAllows(plan, action, {}), false);
  for (const action of ['report', 'inspect', 'cancel', 'disposition', 'reply-quality']) assert.equal(legacyBasisAllows(plan, action, {}), true);
  assert.equal(legacyBasisAllows(plan, 'targets', { targetQty: 11 }), false);
  assert.equal(legacyBasisAllows(plan, 'targets', { targetQty: 9 }), true);
  assert.equal(legacyBasisAllows(plan, 'adjust', { taskId: 't', quantity: 6 }), false);
  assert.equal(legacyBasisAllows(plan, 'adjust', { taskId: 't', quantity: 5 }), true);
});
test('原快照及产品设备身份改变后核对失效，版本号不会伪造为 V1', () => {
  const plan = oldPlan();
  plan.legacyBasisReview = { deviceId: 'device', productRootId: 'root', sourceFingerprint: legacyBasisFingerprint(plan, 'root', 'device'), actorId: 'u', actorName: '核对人', at: '2026-09-22', reason: '原始依据已核对' };
  assert.equal(legacyBasisAllows(plan, 'dispatch', {}), true);
  plan.bom[0].qtyPer = 2; assert.equal(legacyBasisAllows(plan, 'dispatch', {}), false);
  plan.bom[0].qtyPer = 1; plan.productId = 'other'; assert.equal(legacyBasisAllows(plan, 'dispatch', {}), false);
  assert.equal(plan.bomRevisionId, undefined);
});

test('空或不完整的历史快照即使留过核对记录也不能扩大执行', () => {
  for (const bom of [[], [{ id: 'm', code: 'V', name: '阀', unit: '', qtyPer: 1 }], [{ id: 'm', code: 'V', name: '阀', unit: '件', qtyPer: 0.0001 }]]) {
    const plan = oldPlan(); plan.bom = bom;
    plan.legacyBasisReview = { deviceId: 'device', productRootId: 'root', sourceFingerprint: legacyBasisFingerprint(plan, 'root', 'device'), actorId: 'u', actorName: '核对人', at: '2026-09-22', reason: '旧记录' };
    assert.equal(legacyBasisAllows(plan, 'dispatch', {}), false);
    assert.equal(legacyBasisAllows(plan, 'inspect', {}), true);
  }
});
