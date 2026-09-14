import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (name) => readFileSync(new URL(`../src/app/${name}`, import.meta.url), 'utf8');
const base = 'production/batch-archives/';
const compile = (source) => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
const primitives = new Proxy({}, { get: (_, key) => key });
const translate = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, key) => params[key] ?? match);
const noExternal = () => assert.fail('档案预览不得访问正式接口或持久化存储');
const noStorage = new Proxy({}, { get: noExternal, set: noExternal });
function evaluate(code, dependencies = {}, env = {}) {
  const exports = {};
  new Function('exports', 'require', 'window', 'URL', 'fetch', 'localStorage', 'sessionStorage', 'indexedDB', code)(exports, (name) => {
    assert.ok(Object.hasOwn(dependencies, name), `未审查的依赖 ${name}`); return dependencies[name];
  }, env.window ?? {}, env.URL ?? URL, noExternal, noStorage, noStorage, noStorage);
  return exports;
}
const types = evaluate(compile(read(`${base}batchArchiveTypes.ts`)));
const model = evaluate(compile(read(`${base}batchArchiveModel.ts`)));
const pageCode = compile(read(`${base}BatchArchivePreviewPage.tsx`));
const shared = {
  'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, 'lucide-react': primitives,
  '../../lib/i18n': { useI18n: () => ({ t: translate }), i18nLocale: () => 'zh-CN' },
  '../../components/ui/utils': { cn: (...values) => values.filter(Boolean).join(' ') },
  './batchArchiveModel': model, './batchArchiveTypes': types,
};
const section = evaluate(compile(read(`${base}BatchArchiveSections.tsx`)), { ...shared, '../../components/ui/button': primitives, './batch-archive-sections.css': {} });
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(nodes)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  if (!tree || typeof tree !== 'object') return '';
  return [tree.props?.children, tree.props?.title, tree.props?.description, tree.props?.actions, tree.props?.action].map(text).join(' ');
}
const normalized = (tree) => text(tree).replace(/\s+/g, ' ').trim();
function fixture(initialSearch = '') {
  const slots = [], effects = [], listeners = new Map(), downloads = [], blobs = [], revoked = [], navigations = [], scrolls = [];
  let cursor = 0, tree, predicate, pending, location = { pathname: '/__preview/batch-archives', search: initialSearch }, exportFails = false;
  const blocker = { state: 'unblocked', reset() { pending = undefined; blocker.state = 'unblocked'; }, proceed() { assert.ok(pending); location = pending; pending = undefined; blocker.state = 'unblocked'; } };
  const navigate = (next) => { navigations.push(next); if (predicate?.({ currentLocation: location, nextLocation: next })) { pending = next; blocker.state = 'blocked'; } else location = next; };
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(callback, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) slots[index] = { callback, deps }; return slots[index].callback; },
    useEffect(effect, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) { slots[index] = { deps, cleanup: old?.cleanup }; effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = effect(); }); } },
  };
  const dependencies = { ...shared, react: hooks,
    'react-router': { useSearchParams: () => [new URLSearchParams(location.search), (params) => navigate({ ...location, search: `?${params}` })], useBlocker: (next) => { predicate = next; return blocker; }, Link: 'Link' },
    '../../order-processing/components/HorizonPage': primitives,
    './BatchArchiveSections': { BatchArchiveSections: 'BatchArchiveSections' }, './VersionEvidenceForm': { VersionEvidenceForm: 'VersionEvidenceForm' },
    '../../order-processing/horizon.css': {}, './batch-archive-preview.css': {},
  };
  for (const name of ['alert-dialog', 'button', 'input', 'label', 'select', 'sheet', 'tabs']) dependencies[`../../components/ui/${name}`] = primitives;
  const exports = evaluate(pageCode, dependencies, { window: {
    addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: (name, handler) => { if (listeners.get(name) === handler) listeners.delete(name); },
    document: { createElement(name) { assert.equal(name, 'a'); const link = { click() { downloads.push({ href: link.href, download: link.download }); }, remove() {} }; return link; }, body: { appendChild() {} }, getElementById(id) { assert.ok(nodes(tree).some((node) => node.props.id === id), `滚动目标 ${id} 存在`); return { scrollIntoView(options) { scrolls.push({ id, options }); } }; } },
    setTimeout(callback) { callback(); },
    requestAnimationFrame(callback) { callback(); },
  }, URL: { createObjectURL(blob) { if (exportFails) throw new Error('download unavailable'); blobs.push(blob); return `blob:archive-${blobs.length}`; }, revokeObjectURL(url) { revoked.push(url); } } });
  const view = {
    render() { cursor = 0; tree = exports.BatchArchivePreviewPage(); while (effects.length) effects.shift()(); return tree; },
    nodes: () => nodes(tree), text: () => normalized(tree), byType: (type) => nodes(tree).find((node) => node.type === type), byId: (id) => nodes(tree).find((node) => node.props.id === id),
    section: () => view.byType('BatchArchiveSections'), form: () => view.byType('VersionEvidenceForm'), state: () => slots.find((value) => value?.batches && value?.revisions),
    content() { return view.section() ? section.BatchArchiveSections(view.section().props) : null; }, contentText() { return normalized(view.content()); },
    sheet: () => view.byType('Sheet'), params: () => new URLSearchParams(location.search), location: () => ({ ...location }), downloads, blobs, revoked, navigations, scrolls,
    button(label) { return view.nodes().find((node) => ['Button', 'button', 'AlertDialogAction', 'AlertDialogCancel'].includes(node.type) && (node.props['aria-label'] === label || normalized(node) === label)); },
    click(label) { const node = view.button(label); assert.ok(node, `${label} exists`); assert.equal(Boolean(node.props.disabled), false, `${label} enabled`); node.props.onClick(); return view.render(); },
    input(value) { view.byId('bap-query').props.onChange({ target: { value } }); return view.render(); },
    select(id) { view.nodes().find((node) => node.type === 'Select').props.onValueChange(id); return view.render(); },
    tab(tab) { view.byType('Tabs').props.onValueChange(tab); return view.render(); },
    edit(id = 'scope-b2-second') { view.section().props.onEditScope(id); return view.render(); },
    dirty(value = true) { view.form().props.onDirtyChange(value); return view.render(); },
    discardDialog: () => view.nodes().find((node) => node.type === 'AlertDialog' && /放弃尚未保存/.test(normalized(node))),
    cancelDiscard() { view.discardDialog().props.onOpenChange(false); return view.render(); },
    discard() { view.click('放弃并继续'); return view.render(); },
    failNext() { view.nodes().find((node) => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } }); return view.render(); },
    failExport(value = true) { exportFails = value; },
    amendment(patch = {}) { const props = view.form().props, batch = view.state().batches.find((item) => item.id === props.batchId), scope = batch.versionScopes.find((item) => item.id === props.scopeId); return { scopeId: props.scopeId, name: scope?.name ?? '剩余 16 台', quantity: scope?.quantity ?? 16, versions: { software: 'V1.0.8', hardware: 'HW-B', bom: 'BOM-V3.2', drawing: 'DW-V1', sop: 'SOP-V1', sip: 'SIP-V1' }, serialNumbers: scope?.serialNumbers ?? [], evidenceIds: ['b2-technical-partial'], actor: '演示核对人', reason: '按历史烧录和受控图纸补齐实际版本', ...patch }; },
    async save(patch = {}) { try { await view.form().props.onSubmit(view.amendment(patch)); } finally { view.render(); } },
    navigate(search, pathname = location.pathname) { navigate({ pathname, search }); return view.render(); },
    unload() { const event = { prevented: false, preventDefault() { this.prevented = true; } }; listeners.get('beforeunload')?.(event); return event.prevented; },
    metric(label) { const dl = view.nodes().find((node) => node.type === 'dl' && node.props.className === 'bap-metrics'); const pair = nodes(dl).find((node) => node.type === 'div' && normalized(node.props.children?.[0]) === label); return normalized(pair?.props.children?.[1]); },
  };
  view.render(); return view;
}

test('默认批次包含七标签、真实范围缺口与四个独立数量', () => {
  const page = fixture(); assert.equal(page.section().props.batch.id, 'batch-02'); assert.equal(page.section().props.tab, 'versions');
  assert.equal(page.nodes().filter((node) => node.type === 'TabsTrigger').length, 7);
  assert.equal(page.metric('本批整机完工'), '116 台'); assert.equal(page.metric('终检合格'), '116 台'); assert.equal(page.metric('已授权放行'), '100 台'); assert.equal(page.metric('已实际出货'), '80 台');
  assert.match(page.contentText(), /完整版本范围 60 台.*待确认 56 台/); assert.match(page.text(), /16 台尚未划分/); assert.match(page.contentText(), /材料批次待补齐/);
});

test('整机 SN、材料 SN 和物料批次检索选中关联批次，未知标识没有静态假结果', () => {
  const page = fixture(), sn = page.state().batches[0].serials[0].sn; page.input(sn); assert.equal(page.section().props.batch.id, 'batch-01');
  page.input('不存在的 SN 999'); assert.equal(page.section(), undefined); assert.equal(page.button('导出批次档案').props.disabled, true); assert.match(page.text(), /没有匹配的批次或 SN/);
  page.click('返回演示批次'); assert.equal(page.section().props.batch.id, 'batch-02');
  page.input('PCB-260828-A'); assert.equal(page.section().props.batch.id, 'batch-01');
  const materialSn = page.state().batches[1].materials[0].serialNumbers[0]; assert.ok(materialSn); page.input(materialSn); assert.equal(page.section().props.batch.id, 'batch-02');
  page.tab('overview'); assert.match(page.contentText(), /已有整机 SN 5 个.*整机 SN 待补齐 111 台/); assert.doesNotMatch(page.section().props.batch.serials.map((item) => item.sn).join(','), new RegExp(materialSn));
});

test('批次切换保留标签，未知批次链接可恢复且未知标签安全回到版本', () => {
  const page = fixture('?batch=unknown&tab=inspections'); assert.equal(page.section(), undefined); assert.match(page.text(), /未找到这个批次/); page.click('返回演示批次');
  assert.equal(page.section().props.tab, 'inspections'); page.select('batch-03'); assert.equal(page.params().get('batch'), 'batch-03'); assert.equal(page.section().props.tab, 'inspections');
  assert.equal(fixture('?tab=bad').section().props.tab, 'versions');
});

test('各标签呈现对应原单，初检复验放行分区且无伪造空记录', () => {
  const page = fixture();
  const expected = { overview: '批次基本资料', versions: '批内版本范围', production: '现场报工', inspections: '质量授权放行', exceptions: '不良处置记录', materials: '领料记录', shipments: '实际出货原单' };
  for (const [tab, title] of Object.entries(expected)) { page.tab(tab); assert.equal(page.section().props.tab, tab); assert.match(page.contentText(), new RegExp(title)); }
  page.tab('inspections'); assert.match(page.contentText(), /首次检验.*复验记录.*质量授权放行/); assert.match(page.contentText(), /后续复验不回填首次合格率/);
  page.select('batch-03'); page.tab('shipments'); assert.match(page.contentText(), /暂无关联记录/); assert.doesNotMatch(page.contentText(), /SHIP-0908-01/);
});

test('修订正确范围保留旧版本快照且不改变生产质量出货事实', async () => {
  const page = fixture(), before = structuredClone(page.state()); page.edit(); await page.save(); const after = page.state();
  assert.equal(page.form(), undefined); assert.equal(page.params().get('batch'), 'batch-02'); assert.equal(after.version, before.version + 1); assert.equal(after.revisions.length, before.revisions.length + 1);
  const batch = after.batches.find((item) => item.id === 'batch-02'), original = before.batches.find((item) => item.id === 'batch-02');
  assert.deepEqual(batch.documents, original.documents); assert.deepEqual(batch.versionScopes[0], original.versionScopes[0]); assert.equal(batch.versionScopes[1].versions.software, 'V1.0.8');
  assert.equal(after.revisions.at(-1).before[1].versions.software, ''); assert.equal(after.revisions.at(-1).after[1].versions.software, 'V1.0.8');
  assert.equal(page.metric('本批整机完工'), '116 台'); assert.equal(page.metric('已实际出货'), '80 台'); assert.match(page.contentText(), /完整版本范围 100 台.*待确认 16 台/);
});

test('新增剩余范围保留已有两段，关联原单且留档', async () => {
  const page = fixture(); page.click('补充版本范围'); await page.save(); const batch = page.section().props.batch;
  assert.equal(batch.versionScopes.length, 3); assert.equal(batch.versionScopes[2].quantity, 16); assert.equal(batch.versionScopes[2].name, '剩余 16 台');
  assert.deepEqual(batch.versionScopes[2].evidenceIds, ['b2-technical-partial']); assert.equal(page.state().revisions.at(-1).before.length, 2); assert.equal(page.state().revisions.at(-1).after.length, 3);
});

test('保存失败不丢表单，重试一次只生成一条修订', async () => {
  const page = fixture(); page.edit(); page.dirty(); page.failNext(); const state = page.state(), key = page.form().key;
  await assert.rejects(page.save(), /填写内容已保留/); assert.equal(page.state(), state); assert.equal(page.form().key, key); assert.equal(page.unload(), true);
  await page.save(); assert.equal(page.state().revisions.length, state.revisions.length + 1); assert.equal(page.unload(), false);
});

test('旧保存回调及范围串单被拒绝，不覆盖其他修订', async () => {
  const page = fixture(); page.edit(); const callback = page.form().props.onSubmit, input = page.amendment();
  await assert.rejects(page.save({ scopeId: 'scope-b2-first' }), /范围已变化/); assert.equal(page.state().version, 1);
  await callback(input); page.render(); const saved = page.state(); await assert.rejects(callback(input), /档案已变化/); page.render(); assert.equal(page.state(), saved);
});

test('切换批次、标签、筛选与预览状态均先保护未保存表单', () => {
  for (const [change, verify] of [
    [(p) => p.select('batch-01'), (p) => assert.equal(p.section().props.batch.id, 'batch-01')],
    [(p) => p.tab('materials'), (p) => assert.equal(p.section().props.tab, 'materials')],
    [(p) => p.input('B-FG-0901'), (p) => assert.equal(p.section().props.batch.id, 'batch-01')],
    [(p) => p.click('只读'), (p) => assert.equal(p.section().props.readOnly, true)],
  ]) { const page = fixture(); page.edit(); page.dirty(); const key = page.form().key; change(page); assert.equal(page.discardDialog().props.open, true); assert.equal(page.form().key, key); page.cancelDiscard(); assert.equal(page.unload(), true); change(page); page.discard(); assert.equal(page.form(), undefined); verify(page); }
});

test('路由离开和刷新有草稿保护，取消保留，放弃继续原目标', () => {
  const page = fixture(); page.edit(); page.dirty(); assert.equal(page.unload(), true); page.navigate('', '/__preview/shipments'); assert.equal(page.discardDialog().props.open, true);
  page.cancelDiscard(); assert.equal(page.location().pathname, '/__preview/batch-archives'); page.navigate('', '/__preview/shipments'); page.discard(); assert.equal(page.location().pathname, '/__preview/shipments'); assert.equal(page.unload(), false);
});

test('页面内两个区域跳转仅滚动，不产生路由导航或触发未保存保护', () => {
  const page = fixture('?batch=batch-02&tab=versions'); page.edit(); page.dirty();
  const location = page.location(), formKey = page.form().key, navigationCount = page.navigations.length;
  for (const [label, id] of [['前往核对与修订', 'bap-actions'], ['查看当前资料', 'bap-content'], ['返回当前资料', 'bap-content']]) {
    const button = page.button(label); assert.ok(button); assert.equal(button.type, 'button'); assert.equal(button.props.type, 'button'); assert.equal(button.props.href, undefined);
    page.click(label); assert.equal(page.scrolls.at(-1)?.id, id); assert.equal(page.scrolls.at(-1)?.options.block, 'start');
    assert.equal(page.navigations.length, navigationCount); assert.deepEqual(page.location(), location); assert.equal(page.discardDialog().props.open, false); assert.equal(page.form().key, formKey); assert.equal(page.unload(), true);
  }
});

test('原单摘要按当前批次打开，可继续沿原检验关联查看', () => {
  const page = fixture(); const batch = page.section().props.batch, doc = batch.documents.find((item) => item.relatedIds.length);
  page.section().props.onViewDocument(doc.id); page.render(); assert.equal(page.sheet().props.open, true); assert.match(normalized(page.sheet()), new RegExp(doc.code));
  const linked = batch.documents.find((item) => item.id === doc.relatedIds[0]); assert.ok(linked); page.click(linked.code); assert.match(normalized(page.sheet()), new RegExp(linked.code));
  page.sheet().props.onOpenChange(false); page.render(); assert.equal(page.sheet().props.open, false);
});

test('从相关 ECN 侧栏按钮打开原单并准确进入变更预览，其他原单无错链且离开保护草稿', () => {
  const page = fixture(), batch = page.section().props.batch, ecn = batch.documents.find((item) => item.kind === 'ecn' && item.code === 'ECN-202609-003'); assert.ok(ecn);
  assert.match(page.text(), /相关 ECN/); assert.equal(page.sheet().props.open, false); page.click(ecn.code); assert.equal(page.sheet().props.open, true); assert.match(normalized(page.sheet()), new RegExp(ecn.code));
  const link = nodes(page.sheet()).find((node) => node.type === 'Link'); assert.ok(link); assert.equal(link.props.to, '/__preview/ecn?ecn=ecn-01'); assert.match(normalized(link), /打开 ECN 变更与执行确认/);
  page.sheet().props.onOpenChange(false); page.render(); const sourceButton = nodes(page.content()).find((node) => node.type === 'Button' && /^查看原单 /.test(node.props['aria-label'] ?? '') && normalized(node) !== ecn.code); assert.ok(sourceButton); sourceButton.props.onClick(); page.render(); assert.equal(page.sheet().props.open, true); assert.equal(nodes(page.sheet()).some((node) => node.type === 'Link'), false);
  page.sheet().props.onOpenChange(false); page.render(); page.edit(); page.dirty(); const target = new URL(link.props.to, 'http://localhost'); page.navigate(target.search, target.pathname); assert.equal(page.discardDialog().props.open, true); page.cancelDiscard(); assert.equal(page.location().pathname, '/__preview/batch-archives');
  page.navigate(target.search, target.pathname); page.discard(); assert.equal(page.location().pathname, '/__preview/ecn'); assert.equal(page.location().search, '?ecn=ecn-01'); assert.equal(page.unload(), false);
  const readOnly = fixture(); readOnly.click('只读'); readOnly.click(ecn.code); assert.equal(readOnly.sheet().props.open, true); assert.equal(nodes(readOnly.sheet()).find((node) => node.type === 'Link')?.props.to, link.props.to);
});

test('修订抽屉显示当前批次前后历史，其他批次不串档', async () => {
  const page = fixture(); page.edit(); await page.save(); page.click('修订记录'); assert.match(normalized(page.sheet()), /演示核对人.*查看修订前/); assert.match(normalized(page.sheet()), /V1.0.8/);
  page.sheet().props.onOpenChange(false); page.render(); page.select('batch-03'); page.click('修订记录'); assert.match(normalized(page.sheet()), /暂无档案修订/); assert.doesNotMatch(normalized(page.sheet()), /演示核对人/);
});

test('本地导出包含本批已保存事实、范围、缺口和修订，不混入其他批次', async () => {
  const page = fixture(); page.edit(); await page.save(); page.click('导出批次档案'); assert.equal(page.downloads.length, 1); assert.equal(page.downloads[0].download, 'B-FG-0902-批次档案-演示.csv');
  const csv = await page.blobs[0].text(); assert.match(csv, /B-FG-0902/); assert.match(csv, /V1.0.8/); assert.match(csv, /演示核对人/); assert.match(csv, /SHIP-0908-01/); assert.match(csv, /待补齐|待确认/); assert.match(csv, /演示/); assert.doesNotMatch(csv, /SHIP-0906-01/); assert.deepEqual(page.revoked, ['blob:archive-1']);
});

test('未保存填写不进入导出，导出失败保留草稿并可重试', async () => {
  const page = fixture(); page.edit(); page.dirty(); const state = page.state(); page.failExport(); page.click('导出批次档案'); assert.match(page.text(), /档案导出失败/); assert.ok(page.form()); assert.equal(page.unload(), true); assert.equal(page.state(), state);
  page.failExport(false); page.click('导出批次档案'); const csv = await page.blobs[0].text(); assert.doesNotMatch(csv, /演示核对人/); assert.ok(page.form()); assert.equal(page.unload(), true);
});

test('只读允许查看原单、历史、导出，同时禁止修订入口', () => {
  const page = fixture(); page.click('只读'); assert.equal(page.section().props.readOnly, true); assert.equal(page.button('补充版本范围'), undefined);
  const editButtons = nodes(page.content()).filter((node) => node.type === 'Button' && /^修订范围/.test(node.props['aria-label'] ?? '')); assert.ok(editButtons.length); assert.ok(editButtons.every((node) => node.props.disabled));
  page.click('修订记录'); assert.equal(page.sheet().props.open, true); page.sheet().props.onOpenChange(false); page.render(); page.click('导出批次档案'); assert.equal(page.downloads.length, 1);
  page.select('batch-03'); assert.match(page.contentText(), /当前为只读查看，实际版本与适用数量尚待归集/); assert.doesNotMatch(page.contentText(), /可通过右侧补充版本范围/);
});

test('空态和读取失败恢复已保存档案，不重新创建初始记录', async () => {
  const page = fixture(); page.edit(); await page.save(); const state = page.state(); page.click('空数据'); assert.equal(page.section(), undefined); assert.equal(page.button('导出批次档案').props.disabled, true); page.click('返回演示批次'); assert.equal(page.state(), state);
  page.click('读取失败'); assert.equal(page.section(), undefined); assert.match(page.text(), /批次档案读取失败/); page.click('重新读取'); assert.equal(page.state(), state); assert.match(page.contentText(), /V1.0.8/);
});

test('重置须确认；取消保留修订，确认恢复原范围和记录', async () => {
  const page = fixture(); page.edit(); await page.save(); page.click('重置演示'); const reset = () => page.nodes().find((node) => node.type === 'AlertDialog' && /恢复初始演示档案/.test(normalized(node)));
  assert.equal(reset().props.open, true); reset().props.onOpenChange(false); page.render(); assert.match(page.contentText(), /V1.0.8/); page.click('重置演示'); page.click('重置演示数据'); assert.equal(page.state().version, 1); assert.equal(page.state().revisions.length, 1); assert.match(page.contentText(), /完整版本范围 60 台.*待确认 56 台/);
});

test('未关联的材料 SN 不计入整机已知 SN，原单按钮均指向本批', () => {
  const page = fixture(); page.tab('overview'); assert.match(page.contentText(), /已有整机 SN 5 个.*整机 SN 待补齐 111 台/); assert.match(page.contentText(), /材料 SN 不计入整机数量/);
  for (const tab of ['overview', 'versions', 'materials', 'inspections']) { page.tab(tab); for (const node of nodes(page.content()).filter((n) => n.type === 'Button' && /^查看原单 /.test(n.props['aria-label'] ?? ''))) { node.props.onClick(); page.render(); assert.equal(page.sheet().props.open, true); assert.doesNotMatch(normalized(page.sheet()), /原单据尚未归集/); } }
});

test('生产模式既不注册 P09 预览路由也不创建预览懒加载', () => {
  const source = ts.createSourceFile('App.tsx', read('App.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let declaration, spread;
  function visit(node) { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'BatchArchivePreviewPage') declaration = node; if (ts.isSpreadElement(node) && node.getText(source).includes('/__preview/batch-archives')) spread = node; ts.forEachChild(node, visit); }
  visit(source); assert.ok(declaration); assert.ok(spread); const fragment = `const ${declaration.getText(source)}; export const routes = [${spread.getText(source)}];`.replaceAll('import.meta.env.DEV', '__DEV__');
  for (const development of [false, true]) { const exports = {}, loads = []; new Function('exports', 'require', '__DEV__', 'lazyNamed', 'lazyWrap', compile(fragment))(exports, () => ({ jsx, jsxs: jsx }), development, (loader, name) => { loads.push(loader); return name; }, (element) => element); assert.equal(loads.length, development ? 1 : 0); assert.deepEqual(exports.routes.map((route) => route.path), development ? ['/__preview/batch-archives'] : []); }
});
