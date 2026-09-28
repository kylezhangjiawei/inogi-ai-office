import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { exactMaterial, mappingFingerprint } from '../src/modules/order-processing/order-material-mapping';
const line = { id: 'l', orderId: 'o', sku: 'ERP-V1', name: '阀体', spec: '', unit: '件', orderQty: 10 };
const material = { id: 'm', code: 'ERP-V1', unit: '件', active: true };
test('only unambiguous exact ERP code and unit match, never customer or similar SKU', () => {
  assert.deepEqual(exactMaterial(line, [material]), material);
  for (const sku of ['CUSTOMER-X', 'erp-v1', 'ERPV1']) assert.equal(exactMaterial({ ...line, sku }, [material]), null);
  assert.equal(exactMaterial(line, [material, { ...material, id: 'other' }]), null);
  assert.equal(exactMaterial(line, [{ ...material, active: false }]), null);
  assert.equal(exactMaterial({ ...line, unit: '箱' }, [material]), null);
});
test('evidence includes source identity and material validity, not quantity', () => {
  const fingerprint = mappingFingerprint(line, material);
  assert.equal(fingerprint, mappingFingerprint({ ...line, orderQty: 20 }, material));
  for (const change of [{ id: 'new' }, { orderId: 'another-customer' }, { sku: 'OTHER' }, { name: '改名' }, { unit: '箱' }, { spec: 'new' }]) assert.notEqual(fingerprint, mappingFingerprint({ ...line, ...change }, material));
  for (const change of [{ id: 'other' }, { code: 'changed' }, { unit: '箱' }, { active: false }]) assert.notEqual(fingerprint, mappingFingerprint(line, { ...material, ...change }));
});
