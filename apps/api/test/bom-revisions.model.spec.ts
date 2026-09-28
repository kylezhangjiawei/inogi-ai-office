import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { assertBomSelection, buildBomSnapshot } from '../src/modules/procurement/bom-revisions.model';

const draft = () => ({ deviceId: 'device-A', productRootId: 'root-A',
  structure: [{ id: 'device-A', parentId: null, name: '设备' }, { id: 'a', parentId: 'device-A', name: '阀' }, { id: 'b', parentId: 'device-A', name: '阀2' }],
  leaves: ['a', 'b'].map(nodeId => ({ nodeId, parentId: 'device-A', deviceId: 'device-A', materialId: 'material-1', code: 'V01', name: '阀', unit: '件', qtyPer: 0.1 })),
});
test('禁止产品 A 使用设备 B 的版本和停用版本', () => {
  assert.throws(() => assertBomSelection('root-A', 'device-B', { productRootId: 'root-B', deviceId: 'device-B', retiredAt: null }), /不属于/);
  assert.throws(() => assertBomSelection('root-A', 'device-A', { productRootId: 'root-A', deviceId: 'device-A', retiredAt: new Date() }), /停用/);
});
test('同编码同单位精确汇总并保留来源；顺序不影响指纹', () => {
  const input = draft(), result = buildBomSnapshot(input);
  assert.deepEqual(result.items, [{ id: 'material-1', code: 'V01', name: '阀', unit: '件', qtyPer: 0.2 }]);
  assert.equal(result.leaves.length, 2);
  input.structure.reverse(); input.leaves.reverse();
  assert.equal(buildBomSnapshot(input).fingerprint, result.fingerprint);
  input.leaves[0].qtyPer = 0.2;
  assert.notEqual(buildBomSnapshot(input).fingerprint, result.fingerprint);
});
test('拒绝缺少身份、编码、单位和不可执行的用量', () => {
  for (const patch of [{ materialId: '' }, { code: '' }, { unit: '' }, { qtyPer: 0 }, { qtyPer: -1 }, { qtyPer: NaN }, { qtyPer: 0.0001 }, { qtyPer: 100000000000 }]) {
    const input = draft(); Object.assign(input.leaves[0], patch);
    assert.throws(() => buildBomSnapshot(input), /物料|用量|单位|编码|精度/);
  }
  assert.throws(() => buildBomSnapshot({ ...draft(), productRootId: '' }), /归属/);
  assert.throws(() => buildBomSnapshot({ ...draft(), leaves: [] }), /物料/);
});
test('拒绝同编码不同单位或不同物料身份', () => {
  for (const patch of [{ unit: '套' }, { materialId: 'other' }]) {
    const input = draft(); Object.assign(input.leaves[1], patch);
    assert.throws(() => buildBomSnapshot(input), /冲突/);
  }
});
test('发布用量及同编码汇总不得超过现有生产执行的十亿上限', () => {
  const input = draft(); input.leaves[0].qtyPer = 1000000001;
  assert.throws(() => buildBomSnapshot(input), /用量|范围/);
  input.leaves.forEach(row => row.qtyPer = 600000000);
  assert.throws(() => buildBomSnapshot(input), /用量|范围/);
});
test('拒绝孤儿、环、跨设备、重复节点和遗漏的叶子', () => {
  const cases = [
    (v: ReturnType<typeof draft>) => { v.structure[1].parentId = 'missing'; },
    (v: ReturnType<typeof draft>) => { v.structure[1].parentId = 'b'; v.structure[2].parentId = 'a'; },
    (v: ReturnType<typeof draft>) => { v.leaves[0].deviceId = 'device-B'; },
    (v: ReturnType<typeof draft>) => { v.structure.push({ ...v.structure[1] }); },
    (v: ReturnType<typeof draft>) => { v.leaves.pop(); },
    (v: ReturnType<typeof draft>) => { v.leaves[0].parentId = 'other'; },
  ];
  for (const mutate of cases) { const input = draft(); mutate(input); assert.throws(() => buildBomSnapshot(input), /结构|节点|设备|物料/); }
});
