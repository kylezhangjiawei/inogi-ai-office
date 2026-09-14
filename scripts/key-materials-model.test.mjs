import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const source = readFileSync(new URL('../src/app/procurement/key-materials/keyMaterialsModel.ts', import.meta.url), 'utf8');
const api = {};
const forbidden = () => assert.fail('关键物料演示不得读写真实接口或持久化');
new Function('exports', 'fetch', 'localStorage', 'sessionStorage', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(api, forbidden, new Proxy({}, { get: forbidden }), new Proxy({}, { get: forbidden }));
const seed = api.createKeyMaterialsState;
const options = (patch = {}) => ({ month: '2026-09', product: 'all', scope: 'all', filter: 'all', query: '', ...patch });
function csv(patch = {}) {
  const [header, row] = api.csvTemplate().split('\n'); const keys = header.split(',');
  const data = { ...Object.fromEntries(keys.map((key, i) => [key, row.split(',')[i]])), ...patch };
  return `${header}\n${keys.map((key) => String(data[key]).includes(',') ? `"${data[key].replaceAll('"', '""')}"` : data[key]).join(',')}`;
}
const confirm = (state, text) => api.confirmImport(state, api.previewImport(state, text), '演示采购', 'ERP 导出逐行核对', '2026-09-14 10:00');
test('31 条会议记录精确保留，K29 待定，K30/K31 为明细范围而非 SKU', () => {
  const state = seed(); assert.deepEqual(state.clues.map((row) => row.id), Array.from({ length: 31 }, (_, i) => `K${String(i + 1).padStart(2, '0')}`));
  assert.equal(state.clues.filter((row) => row.kind === 'key').length, 28); assert.equal(state.clues[28].inclusion, 'pending');
  assert.ok(state.clues.slice(29).every((row) => row.kind === 'range' && row.materialIds.length > 1));
  assert.deepEqual(api.ambiguousTerms, ['CFO', '西安美']);
  for (const phrase of ['“矿板PCB”', '“第二版PCB”', '“704”电池', '“408”电池', '“金色包”']) assert.ok(state.clues.some((row) => row.name === phrase && !row.materialIds.length));
  assert.match(state.clues[16].check, /无压传感器/); assert.match(state.clues[28].check, /网格包不需要/);
});
test('全部物料仍显示零需求、无缺料和缺数据；未知月份不制造零库存', () => {
  const state = seed(), rows = api.selectMaterials(state, options());
  assert.ok(rows.some((row) => api.materialNumbers(row, '2026-09', 'all').demand === 0));
  assert.ok(rows.some((row) => api.materialNumbers(row, '2026-09', 'all').gap === 0));
  assert.ok(rows.some((row) => api.materialNumbers(row, '2026-09', 'all').missing));
  const unknown = api.materialNumbers(rows[0], '2027-01', 'Q7'); assert.equal(unknown.current, null); assert.equal(unknown.onTimeGap, null); assert.equal(unknown.needsBuy, false);
});
test('同料多供应商与重复会议线索不重复累计库存', () => {
  let state = seed(); const before = api.selectMaterials(state, options());
  state = api.confirmClue(state, 1, 'K14', { materialIds: ['DEMO-PCB-Q7', 'DEMO-PCB-Q7'], inclusion: 'included', actor: '演示研发', note: '仅验证多线索映射结构' }, '2026-09-14');
  const after = api.selectMaterials(state, options()); assert.equal(after.length, before.length); assert.equal(after.filter((row) => row.id === 'DEMO-V210').length, 1);
  assert.deepEqual(state.clues[13].materialIds, ['DEMO-PCB-Q7']);
});
test('库存状态互斥，在途不叠加订单，待检不良不增加可用', () => {
  const material = seed().materials[0]; const stock = material.monthly['2026-09'];
  const result = api.materialNumbers(material, '2026-09', 'Q7'); assert.equal(result.current, 240); assert.equal(result.gap, 60); assert.equal(result.onTimeOrder, 60); assert.equal(result.onTimeGap, 0);
  stock.inTransit = 60; stock.quarantine = 300; stock.defective = 300;
  assert.equal(api.materialNumbers(material, '2026-09', 'Q7').current, 240); assert.equal(api.materialNumbers(material, '2026-09', 'Q7').onTimeOrder, 60);
});
test('延期订单与缺可用日期不计按期供给，缺日期不自动确认为需新购', () => {
  const material = seed().materials[0]; material.monthly['2026-09'].usableDate = '2026-09-30';
  assert.equal(api.materialNumbers(material, '2026-09', 'Q7').onTimeGap, 60); assert.equal(api.materialNumbers(material, '2026-09', 'Q7').needsBuy, true);
  material.monthly['2026-09'].usableDate = null; const missing = api.materialNumbers(material, '2026-09', 'Q7');
  assert.equal(missing.onTimeOrder, 0); assert.equal(missing.missing, true); assert.equal(missing.needsBuy, false);
});
test('非重点 BOM 缺料不会被当成重点料，完整来源可另行发现缺口', () => {
  const state = seed(); assert.equal(api.selectMaterials(state, options()).some((row) => row.id === 'DEMO-BOM-SCREW'), false);
  const full = api.selectMaterials(state, options({ criticalOnly: false, filter: 'shortage' })); assert.equal(api.materialNumbers(full.find((row) => row.id === 'DEMO-BOM-SCREW'), '2026-09', 'Q7').gap, 100);
});
test('产品、经办、物料编号、原话和供应商搜索可组合且数量不按供应商扩展', () => {
  const state = seed(); assert.ok(api.selectMaterials(state, options({ scope: 'owned' })).every((row) => row.owner === '王晴'));
  assert.ok(api.selectMaterials(state, options({ product: 'Q5' })).every((row) => row.products.includes('Q5')));
  assert.deepEqual(api.selectMaterials(state, options({ query: 'K01' })).map((row) => row.id), ['DEMO-V210']);
  assert.ok(api.selectMaterials(state, options({ query: '供应商 B' })).some((row) => row.id === 'DEMO-V210'));
  assert.equal(api.materialNumbers(state.materials.find((row) => row.id === 'DEMO-V310'), '2026-09', 'all').demand, 220);
});
test('未知上下文保留原产品，不伪映射其他型号；跨年月份有效', () => {
  const context = api.parseContext(new URLSearchParams('product=IN-100&month=2027-01&scope=owned'));
  assert.equal(context.rawProduct, 'IN-100'); assert.equal(context.productKnown, false); assert.equal(context.month, '2027-01');
  assert.equal(api.parseContext(new URLSearchParams('month=2026-13&scope=fake')).monthKnown, false);
  assert.equal(api.parseContext(new URLSearchParams('scope=fake')).scopeKnown, false);
  for (const date of ['2026-02-30', '2026-13-01', 'nonsense']) assert.equal(api.validDate(date), false);
});
test('人工核对保留历史并检查依据、版本、料号和明细类型', () => {
  const state = seed(), input = { materialIds: ['DEMO-PL-COVER'], inclusion: 'included', actor: '演示研发', note: '图纸 A 版核对' };
  const next = api.confirmClue(state, 1, 'K30', input, '2026-09-14'); assert.equal(next.history.length, 1); assert.equal(state.history.length, 0); assert.deepEqual(next.history[0].before, state.clues[29].materialIds);
  for (const patch of [{ actor: '' }, { note: '' }, { materialIds: ['missing'] }, { materialIds: [] }, { materialIds: ['DEMO-V210'] }, { inclusion: 'excluded' }]) assert.throws(() => api.confirmClue(state, 1, 'K30', { ...input, ...patch }, '2026-09-14'));
  assert.throws(() => api.confirmClue(next, 1, 'K30', input, '2026-09-14'), /版本/);
});
test('网格包可以单独确认不纳入，目录记录仍存在且不产生采购物料', () => {
  const next = api.confirmClue(seed(), 1, 'K29', { materialIds: [], inclusion: 'excluded', actor: '演示采购', note: '业务确认本阶段不纳入' }, '2026-09-14');
  assert.equal(next.clues.length, 31); assert.equal(next.clues[28].inclusion, 'excluded'); assert.equal(next.materials.length, seed().materials.length);
});
test('CSV 校验先于人工确认，确认后才导入，重复文件不累计', () => {
  const state = seed(), preview = api.previewImport(state, csv()); assert.equal(preview.errors.length, 0); assert.equal(state.materials.some((row) => row.id === 'ERP-PL-1001'), false);
  const next = api.confirmImport(state, preview, '演示采购', '逐行核对', '2026-09-14'); assert.equal(next.materials.length, state.materials.length + 1); assert.equal(next.clues[29].materialIds.length, 3);
  assert.equal(api.confirmImport(next, api.previewImport(next, csv()), '演示采购', '再次核对', '2026-09-15'), next);
});
test('CSV 多供应商同料行合并，不重复数量；冲突行明确报错', () => {
  const first = csv(), second = csv({ supplierIds: 'SUP-DEMO-B', clueIds: 'K03|K30' }).split('\n')[1];
  const preview = api.previewImport(seed(), `${first}\n${second}`); assert.equal(preview.errors.length, 0); assert.equal(preview.rows.length, 1); assert.equal(preview.rows[0].material.monthly['2026-09'].qualified, 280); assert.equal(preview.rows[0].material.supplierIds.length, 2);
  assert.deepEqual(preview.rows[0].clueIds, ['K30', 'K03']);
  const conflict = api.previewImport(seed(), `${first}\n${csv({ qualified: '999' }).split('\n')[1]}`); assert.match(conflict.errors[0].message, /冲突快照/);
});
test('CSV 未知数量不转零，非法数量/日期/单位/供应商/人员逐行报错', () => {
  const empty = api.previewImport(seed(), csv({ qualified: '' })); assert.equal(empty.rows[0].material.monthly['2026-09'].qualified, null);
  for (const patch of [{ qualified: '-1' }, { qualified: 'NaN' }, { inTransit: '21' }, { neededDate: '2026-02-30' }, { usableDate: '2026-13-02' }, { supplierIds: 'unknown' }, { owner: '未匹配' }, { unit: '' }, { clueIds: 'K32' }, { products: 'IN-100' }, { category: 'silicone', clueIds: 'K30' }]) {
    const preview = api.previewImport(seed(), csv(patch)); assert.equal(preview.errors.length, 1, JSON.stringify(patch)); assert.equal(preview.errors[0].line, 2);
  }
});
test('CSV 支持引用逗号、UTF8 BOM 与列顺序映射，错误引号/表头拒绝', () => {
  const quoted = api.previewImport(seed(), '\uFEFF' + csv({ name: '塑料侧盖, Q7' })); assert.equal(quoted.errors.length, 0); assert.equal(quoted.rows[0].material.name, '塑料侧盖, Q7');
  const reordered = csv().split('\n').map((row) => row.split(',').reverse().join(',')).join('\n'); assert.equal(api.previewImport(seed(), reordered).errors.length, 0);
  assert.ok(api.previewImport(seed(), 'materialId,name\nx,y').errors.length); assert.ok(api.previewImport(seed(), csv() + '\n"oops').errors.length);
});
test('覆盖同月快照保留数量、交期前后历史；其他月份不受影响', () => {
  let state = confirm(seed(), csv()); const before = state.materials.find((row) => row.id === 'ERP-PL-1001').monthly['2026-09'];
  state = confirm(state, csv({ qualified: '290', usableDate: '2026-09-25' })); const history = state.importHistory.at(-1);
  assert.deepEqual(history.before, before); assert.equal(history.after.qualified, 290); assert.equal(history.after.usableDate, '2026-09-25'); assert.equal(history.actor, '演示采购');
  assert.equal(state.materials.find((row) => row.id === 'ERP-PL-1001').monthly['2026-09'].qualified, 290);
  assert.throws(() => confirm(state, csv({ unit: 'kg' })), /修复/);
});
test('过期导入草稿及缺确认依据被拒绝，不改变成功时间或历史', () => {
  const state = seed(), preview = api.previewImport(state, csv()); assert.throws(() => api.confirmImport({ ...state, version: 2 }, preview, '核对人', '依据', '2026-09-14'), /版本/);
  assert.throws(() => api.confirmImport(state, preview, '', '依据', '2026-09-14'), /核对人/); assert.equal(state.lastSuccess, null); assert.equal(state.importHistory.length, 0);
});
test('历史文件作为新修订可回退当前快照，只有当前值相同的重试不重复记账', () => {
  let state = confirm(seed(), csv()); state = confirm(state, csv({ qualified: '290' }));
  const reverted = confirm(state, csv()); assert.notEqual(reverted, state); assert.equal(reverted.materials.find((row) => row.id === 'ERP-PL-1001').monthly['2026-09'].qualified, 280);
  assert.equal(reverted.importHistory.length, 3); assert.equal(reverted.importHistory.at(-1).before.qualified, 290); assert.equal(reverted.importHistory.at(-1).after.qualified, 280);
  assert.equal(confirm(reverted, csv()), reverted);
  assert.throws(() => api.confirmImport(reverted, api.previewImport(state, csv()), '核对人', '依据', '2026-09-14'), /版本/);
});
test('跨月CSV不能覆盖产品或经办归属使历史月份消失，合法新月保留旧快照', () => {
  const state = confirm(seed(), csv());
  const invalid = api.previewImport(state, csv({ month: '2026-10', products: 'Q5', demandQ7: '0', demandQ5: '100', neededDate: '2026-10-20' })); assert.match(invalid.errors[0].message, /适用产品或经办/);
  const owner = api.previewImport(state, csv({ owner: '陈敏' })); assert.match(owner.errors[0].message, /适用产品或经办/);
  const next = api.confirmImport(state, api.previewImport(state, csv({ month: '2026-10', demandQ7: '100', neededDate: '2026-10-20' })), '十月核对人', '十月原始文件', '2026-10-01'); const material = next.materials.find((row) => row.id === 'ERP-PL-1001');
  assert.equal(material.monthly['2026-09'].demandQ7, 300); assert.equal(material.monthly['2026-10'].demandQ7, 100); assert.deepEqual(material.products, ['Q7']);
  assert.ok(api.selectMaterials(next, options({ product: 'Q7' })).some((row) => row.id === 'ERP-PL-1001'));
  assert.match(material.monthlySources['2026-09'].source, /ERP 导出逐行核对/); assert.match(material.monthlySources['2026-10'].source, /十月原始文件/);
});
