import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/procurement/InventoryMonthlyReadiness.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes) : tree?.props ? [tree, ...nodes(tree.props.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join(' ') : tree?.props ? text(tree.props.children) : tree == null ? '' : String(tree);
const flush = () => new Promise(resolve => setImmediate(resolve));
const plan = { id: 'p1', version: 3, month: '2026-09', productLine: 'Q7', productName: '设备 Q7', targetQty: 1000, bomFingerprint: 'bom-3', batches: [{ id: 'b1', code: 'B-1', quantity: 300, dueDate: '2026-09-15' }], summary: { completedQty: 216 } };
const readiness = { planId: 'p1', planVersion: 3, month: '2026-09', date: '2026-09-30', targetQty: 1000, completedQty: 216, remainingQty: 784, currentSets: null, projectedSets: null, bomFingerprint: 'bom-3', sourceToken: 'basis-3', lines: [{ code: 'M1', name: '阀体', problems: ['线边未确认'] }], history: [{ id: 's1', at: '2026-09-08T06:00:00Z', date: '2026-09-15', currentSets: 240, projectedSets: 300, planVersion: 2 }] };

function fixture({ permissions = ['page:production-execution', 'production:plan'], lists = async () => [plan], read = async () => readiness } = {}) {
  let active;
  const reads = [], writes = [], listCalls = [];
  const t = (key, values = {}) => key.replace(/\{(\w+)\}/g, (all, name) => values[name] ?? all);
  const exports = {};
  new Function('require', 'exports', code)(name => {
    if (name === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
    if (name === 'react') return {
      useState(initial) { const context = active, index = context.slot++; if (!(index in context.slots)) context.slots[index] = typeof initial === 'function' ? initial() : initial; return [context.slots[index], value => { context.slots[index] = typeof value === 'function' ? value(context.slots[index]) : value; }]; },
      useEffect(run, deps) { const context = active, index = context.slot++, old = context.slots[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) { old?.cleanup?.(); context.slots[index] = { deps }; context.pending.push(() => { context.slots[index].cleanup = run(); }); } },
    };
    if (name === '../auth') return { useAuth: () => ({ user: { id: 'user-1' } }) };
    if (name.includes('usePermission')) return { usePermission: key => permissions.includes(key), useAnyPermission: (...keys) => keys.some(key => permissions.includes(key)) };
    if (name.includes('/i18n')) return { useI18n: () => ({ t }), i18nLocale: () => 'zh-CN' };
    if (name.includes('productionExecutionApi')) return { listExecutionPlans: (...args) => { listCalls.push(args); return lists(...args); } };
    if (name.includes('productionLifecycleApi')) return { getProductionReadiness: (...args) => { reads.push(args); return read(...args); }, commandProductionLifecycle: async (...args) => { writes.push(args); } };
    if (name.includes('/utils')) return { cn: (...args) => args.filter(Boolean).join(' ') };
    if (name === 'react-router') return { useNavigate: () => () => {} };
    if (name.includes('routePaths')) return { routePath: (_, fallback) => fallback };
    return new Proxy({}, { get: (_, key) => key });
  }, exports);
  function mount(component = exports.InventoryMonthlyReadiness, props = { month: '2026-09', productLine: 'Q7', refreshVersion: 0 }) {
    const context = { slot: 0, slots: [], pending: [] };
    return { render(next = props) { props = next; active = context; context.slot = 0; const tree = component(props); context.pending.splice(0).forEach(run => run()); return tree; }, destroy() { context.slots.forEach(value => value?.cleanup?.()); } };
  }
  function inner(tree, name) { const node = nodes(tree).find(node => node.type?.name === name); assert.ok(node, name); return mount(node.type, node.props); }
  const root = mount();
  return { root, inner, reads, writes, listCalls };
}
const button = (tree, label) => nodes(tree).find(node => node.type === 'Button' && text(node).trim() === label);
const field = (tree, label) => nodes(tree).find(node => node.props?.['aria-label'] === label);

test('月度数据沿用生产查看权限；没有权限不发起请求', () => {
  const f = fixture({ permissions: ['page:production-execution'] });
  assert.match(text(f.root.render()), /需要生产计划或全局查看权限/);
  assert.equal(f.listCalls.length, 0);
  assert.equal(f.reads.length, 0);
});

test('只匹配所选月份与型号；跨月结转不进入本月计划，下月无计划显示未确认', async () => {
  const f = fixture({ lists: async month => month === '2026-09' ? [{ ...plan, id: 'old', month: '2026-08' }, { ...plan, id: 'other', productLine: 'Q5' }, plan] : [] });
  const plans = f.inner(f.root.render(), 'MonthlyPlans'); plans.render(); await flush();
  const tree = plans.render();
  const options = nodes(tree).filter(node => node.type === 'option');
  assert.deepEqual(options.map(node => node.props.value), ['p1']);
  assert.match(text(tree), /未确认/);
  assert.ok(nodes(tree).find(node => node.type?.name === 'MonthlyAssessment' && node.props.plan.id === 'p1'));
  plans.destroy();
});

test('核算保留未知值，历史快照只读并按原日期重算，不覆盖快照', async () => {
  const f = fixture({ read: async (_id, date, _signal, snapshot) => snapshot ? { ...readiness, date: '2026-09-15', planVersion: 2, currentSets: 240, projectedSets: 300, history: [] } : { ...readiness, date } });
  const plans = f.inner(f.root.render(), 'MonthlyPlans'); plans.render(); await flush();
  const assessment = f.inner(plans.render(), 'MonthlyAssessment'); assessment.render(); await flush();
  let tree = assessment.render();
  assert.match(text(tree), /待核对/);
  assert.match(text(tree), /线边未确认/);
  assert.equal(f.reads[0][1], '2026-09-30');
  button(tree, '查看快照').props.onClick(); assessment.render(); await flush(); tree = assessment.render();
  assert.equal(f.reads.at(-1)[3], 's1');
  assert.equal(button(tree, '保存快照'), undefined);
  assert.equal(field(tree, '月度需求日期').props.disabled, true);
  button(tree, '按当前数据重算').props.onClick(); assessment.render(); await flush();
  assert.equal(f.reads.at(-1)[1], '2026-09-15');
  assert.equal(f.reads.at(-1)[3], '');
  assert.equal(f.writes.length, 0);
  assessment.destroy(); plans.destroy();
});

test('保存快照使用打开确认框时的版本和来源，不影响库存', async () => {
  const f = fixture(); const plans = f.inner(f.root.render(), 'MonthlyPlans'); plans.render(); await flush();
  const assessment = f.inner(plans.render(), 'MonthlyAssessment'); assessment.render(); await flush();
  button(assessment.render(), '保存快照').props.onClick();
  const editor = nodes(assessment.render()).find(node => node.type === 'OperationalDialog').props.editor;
  await editor.submit({ reason: '月度核对' }, 'request-1');
  assert.deepEqual(f.writes[0], ['p1', 'readiness', { action: 'snapshot', version: 3, requestId: 'request-1', data: { reason: '月度核对', date: '2026-09-30', batchId: '', sourceToken: 'basis-3' } }]);
  assessment.destroy(); plans.destroy();
});

test('只读人员不可保存；批次切换使用同一计划及批次交期，加载失败不保留旧结论', async () => {
  const f = fixture({ permissions: ['page:production-execution', 'production:view-all'], read: async (...args) => {
    if (args[4]) throw new Error('批次加载失败');
    return readiness;
  } });
  const plans = f.inner(f.root.render(), 'MonthlyPlans'); plans.render(); await flush();
  const assessment = f.inner(plans.render(), 'MonthlyAssessment'); assessment.render(); await flush();
  assert.equal(button(assessment.render(), '保存快照'), undefined);
  field(assessment.render(), '月度评估范围').props.onChange({ target: { value: 'b1' } }); assessment.render(); await flush();
  assert.equal(f.reads.at(-1)[4], 'b1'); assert.equal(f.reads.at(-1)[1], '2026-09-15');
  assert.match(text(assessment.render()), /批次加载失败/);
  assert.equal(nodes(assessment.render()).find(node => node.type?.name === 'Metric'), undefined);
  assessment.destroy(); plans.destroy();
});

test('下月请求失败与未建计划区分，12 月正确进入次年 1 月', async () => {
  const f = fixture({ lists: async month => { if (month === '2027-01') throw new Error('offline'); return [{ ...plan, month: '2026-12' }]; } });
  const plans = f.inner(f.root.render({ month: '2026-12', productLine: 'Q7', refreshVersion: 0 }), 'MonthlyPlans'); plans.render(); await flush();
  assert.match(text(plans.render()), /暂不可用/); assert.doesNotMatch(text(plans.render()), /未确认/);
  assert.deepEqual(f.listCalls.map(args => args[0]), ['2026-12', '2027-01']); plans.destroy();
});

test('新增月度齐套文案有内置和服务端英文兜底', () => {
  const keys = [...new Set([...source.matchAll(/\bt\('([^']+)'/g)].map(match => match[1]))];
  for (const file of ['src/app/lib/i18n.ts', 'apps/api/scripts/seed-i18n-en.mjs']) {
    const dictionary = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    for (const key of keys) assert.ok(dictionary.includes(JSON.stringify(key) + ':'), `${file}: ${key}`);
  }
});

test('切换需求日期立即隐藏旧结论，迟到的请求不能覆盖新结果', async () => {
  const pending = []; const f = fixture({ read: (...args) => new Promise(resolve => pending.push({ args, resolve })) });
  const plans = f.inner(f.root.render(), 'MonthlyPlans'); plans.render(); await flush();
  const assessment = f.inner(plans.render(), 'MonthlyAssessment'); assessment.render();
  field(assessment.render(), '月度需求日期').props.onChange({ target: { value: '2026-09-15' } }); assessment.render();
  assert.equal(pending[0].args[2].aborted, true);
  pending[1].resolve({ ...readiness, date: '2026-09-15', currentSets: 25 }); await flush();
  pending[0].resolve({ ...readiness, currentSets: 999 }); await flush();
  assert.doesNotMatch(text(assessment.render()), /999/);
  assessment.destroy(); plans.destroy();
});
