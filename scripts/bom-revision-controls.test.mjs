import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const compile = () => ts.transpileModule(readFileSync(new URL('../src/app/procurement/components/BomRevisionControls.tsx', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const elements = tree => Array.isArray(tree) ? tree.flatMap(elements) : tree && typeof tree === 'object' ? [tree, ...elements(tree.props?.children)] : [];
const text = tree => Array.isArray(tree) ? tree.map(text).join(' ') : tree && typeof tree === 'object' ? text(tree.props?.children) : String(tree ?? '');
async function fixture(canPublish, failure = false) {
  let slots = [], cursor = 0, pending = [], tree; const calls = [];
  const react = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], v => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || deps.some((v,j) => v !== slots[i][j])) { slots[i] = deps; pending.push(fn); } },
  };
  const data = { deviceId: 'd', productRootId: 'p', draftFingerprint: 'draft-fingerprint', snapshotFingerprint: 's', issue: null, revisions: [], products: [{ id: 'p', name: '产品' }] };
  const api = { readBomRevisions: async () => data, publishBomRevision: async (id, body) => { calls.push({ id, body }); if (failure) throw Error('BOM 已更新，请刷新'); }, bindBomDevice: async () => {}, retireBomRevision: async () => {} };
  const dependencies = { react, 'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }, '../../lib/procurementApi': api, '../../lib/i18n': { useI18n: () => ({ t: v => v }) } };
  const result = {}; new Function('exports', 'require', compile())(result, name => dependencies[name] ?? new Proxy({}, { get: (_,key) => key }));
  const render = () => { cursor = 0; return tree = result.BomRevisionControls({ deviceId: 'd', canPublish }); };
  const f = { calls, render, find: predicate => elements(tree).find(predicate), click(label) { const button = elements(tree).find(n => text(n).trim() === label && n.props?.onClick); assert.ok(button,label); button.props.onClick(); render(); }, async settle() { const effects = pending; pending = []; effects.forEach(fn => fn()); await new Promise(setImmediate); render(); } };
  render(); await f.settle(); return f;
}
test('只读用户能看依据状态，不能发布或绑定', async () => {
  const f = await fixture(false); assert.match(text(f.render()), /工作稿/);
  assert.equal(f.find(n => n.props?.onClick && text(n).trim() === '发布新版本'), undefined);
});
test('发布提交服务器读取的工作稿指纹，冲突保留依据不自动重试', async () => {
  const f = await fixture(true, true); f.click('发布新版本');
  const input = f.find(n => n.props?.['aria-label'] === '核对依据'); input.props.onChange({ target: { value: '工程核对完成' } }); f.render();
  f.click('确认发布'); await f.settle();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].body.expectedFingerprint, 'draft-fingerprint');
  assert.equal(f.calls[0].body.reason, '工程核对完成');
  assert.match(text(f.render()), /BOM 已更新/); assert.equal(f.find(n => n.props?.['aria-label'] === '核对依据').props.value, '工程核对完成');
});
