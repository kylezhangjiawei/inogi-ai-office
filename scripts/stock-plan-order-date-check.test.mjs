import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compile = (path) => ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const componentCode = compile('src/app/procurement/components/StockPlanOrderDateCheck.tsx');
const apiCode = compile('src/app/lib/procurementApi.ts');
const t = (value, params = {}) => value.replace(/\{(\w+)\}/g, (match, name) => params[name] ?? match);
const components = new Proxy({}, { get: (_target, name) => name });
const jsx = (type, props) => typeof type === 'function' ? type(props) : { type, props };
function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  if (!tree || typeof tree !== 'object') return [];
  return [...(tree.type ? [tree] : []), ...Object.values(tree.props ?? {}).flatMap(elements)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join(' ');
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return tree && typeof tree === 'object' ? [tree.type === 'AutoTranslatedText' ? tree.props.text : '', text(tree.props?.children)].join(' ') : '';
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const batchSource = { kind: 'batch', id: 'batch-1', label: '第 1 批 · 供应商甲' };
const taskSource = { kind: 'task', id: 'task-1', label: 'PR-2026-001' };
function confirmation(overrides = {}) {
  return { availableDate: '2026-09-15', note: '检验需要两天', confirmedByName: '采购经办', confirmedAt: '2026-09-10T09:00:00Z', version: 2, needsReconfirmation: false, ...overrides };
}
function row(id = 'mirror-1', overrides = {}) {
  return { kind: 'line', key: `line:${id}`, lineId: id, orderNo: `PO-${id}`, lineNo: '1', inventoryCode: 'A08-072', inventoryName: '分子筛原料', unit: 'kg',
    etaDate: '2026-09-13', supplierName: '订单供应商', approvalStatus: '已审核', orderStatus: '已关闭', syncedAt: '2026-09-10T08:00:00Z',
    availability: confirmation(), dateCheck: 'on_or_before_target', sources: [batchSource], ...overrides };
}
function unresolved(overrides = {}) {
  return { kind: 'unresolved', key: 'unresolved:task-1', orderNo: 'PO-unresolved', lineNo: null, reason: '订单有多行，尚未明确关联行号', sources: [taskSource], ...overrides };
}
function response(planId = 'plan-1', items = [row()], pages = {}, plan = {}) {
  return { readOnly: true, plan: { id: planId, code: 'SP-2026-001', targetDate: '2026-09-16', updatedAt: '2026-09-10T08:00:00Z', ...plan },
    rows: { items, page: 1, pageSize: 10, total: items.length, totalPages: 1, ...pages } };
}

function fixture({ planId = 'plan-1', permissions = ['page:proc-cockpit', 'page:purchase-order-detail'], reply = async (id) => response(id) } = {}) {
  const requests = [], opened = [], slots = [];
  let slot = 0, pendingEffects = [], tree;
  const same = (first, second) => Boolean(first && second && first.length === second.length && first.every((value, index) => Object.is(value, second[index])));
  const react = {
    useState(initial) { const index = slot++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = slot++; return slots[index] ??= { current: initial }; },
    useCallback(callback, deps) { const index = slot++; if (!same(slots[index]?.deps, deps)) slots[index] = { callback, deps }; return slots[index].callback; },
    useEffect(callback, deps) { const index = slot++; const previous = slots[index];
      if (!same(previous?.deps, deps)) pendingEffects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; }); },
  };
  const hasPermission = (name) => permissions.includes('*') || permissions.includes(name);
  const dependencies = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '../../lib/i18n': { useI18n: () => ({ t }), i18nLocale: () => 'zh-CN' },
    '../../hooks/usePermission': { usePermission: hasPermission, useAnyPermission: (...names) => names.some(hasPermission) },
    '../../components/ui/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') },
    '../../lib/procurementApi': { getProcStockPlanOrderDateCheck: async (id, params, signal) => { requests.push({ id, params, signal }); return reply(id, params, signal); } },
  };
  const exports = {};
  new Function('exports', 'require', componentCode)(exports, (name) => {
    if (name in dependencies) return dependencies[name];
    if (name === './StockPlanOrderDateCheck.css') return {};
    assert.ok(name === 'lucide-react' || name.startsWith('../../components/'), `Unexpected dependency ${name}`);
    return components;
  });
  const api = {
    requests, opened,
    render() { slot = 0; pendingEffects = []; tree = exports.StockPlanOrderDateCheck({ planId, onOpenOrderLine: (...args) => opened.push(args) });
      const effects = pendingEffects; pendingEffects = []; effects.forEach((effect) => effect()); return tree; },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); return api.render(); },
    tree: () => tree, text: () => text(tree),
    button(label) { return elements(tree).find((node) => node.type === 'Button' && (node.props['aria-label'] === label || text(node).trim() === label)); },
    actions: () => elements(tree).filter((node) => node.type === 'Button' && node.props['aria-label']?.startsWith('查看采购订单')),
    click(label) { const button = api.button(label); assert.ok(button, `${label} should exist`); assert.equal(Boolean(button.props.disabled), false); button.props.onClick(); return api.render(); },
    setPlan(next) { planId = next; return api.render(); },
    setPermissions(next) { permissions = next; return api.render(); },
    setReply(next) { reply = next; },
    unmount() { for (const entry of slots) entry?.cleanup?.(); },
  };
  api.render();
  return api;
}

test('计划权限和任一订单读取权限同时具备才读取，缺计划不读取', async () => {
  for (const permissions of [[], ['page:proc-cockpit'], ['page:purchase-orders'], ['page:purchase-order-detail'], ['proc-purchase-order:confirm-availability']]) {
    const panel = fixture({ permissions }); await panel.settle();
    assert.equal(panel.requests.length, 0); assert.match(panel.text(), /暂无计划或采购订单查看权限/);
    assert.equal(panel.actions().length, 0); assert.equal(panel.button('下一页关联订单日期'), undefined);
  }
  const missing = fixture({ planId: '  ' }); await missing.settle();
  assert.equal(missing.requests.length, 0); assert.match(missing.text(), /计划信息缺失/);
  const admin = fixture({ permissions: ['*'] }); await admin.settle();
  assert.equal(admin.requests.length, 1); assert.equal(admin.actions().length, 1);
});

test('列表权限可看日期与确认历史，仅详情权限可触发精确订单行回调', async () => {
  for (const permission of ['page:purchase-orders', 'page:purchase-order-detail']) {
    const panel = fixture({ permissions: ['page:proc-cockpit', permission], reply: async () => response('plan-1', [row('mirror/%2F1', { orderNo: 'PO/%2F?中文', lineNo: '13' })]) });
    await panel.settle();
    assert.match(panel.text(), /采购经办/); assert.match(panel.text(), /检验需要两天/);
    assert.equal(panel.actions().length, permission === 'page:purchase-order-detail' ? 1 : 0);
    if (panel.actions().length) { panel.actions()[0].props.onClick(); assert.deepEqual(panel.opened, [['PO/%2F?中文', 'mirror/%2F1']]); }
  }
});

test('呈现六种日期状态和三种日期，不把日期核对表述为达标或数量分配', async () => {
  const rows = [
    row('before'), row('after', { dateCheck: 'after_target', availability: confirmation({ availableDate: '2026-09-19' }) }),
    row('missing-target', { dateCheck: 'target_missing' }), row('unconfirmed', { dateCheck: 'unconfirmed', availability: null }),
    row('cleared', { dateCheck: 'cleared', availability: confirmation({ availableDate: null, note: '供应商改期' }) }),
    row('stale', { dateCheck: 'needs_reconfirmation', availability: confirmation({ needsReconfirmation: true }) }),
  ];
  const panel = fixture({ reply: async () => response('plan-1', rows) }); await panel.settle();
  for (const label of ['可用日期不晚于计划日期', '可用日期晚于计划日期', '计划日期未设置', '可用日期未确认', '可用日期已撤销', '可用日期需重确认', '预计到货', '人工预计检验后可用', '计划完成日期', '2026-09-13', '2026-09-15', '2026-09-16', '订单来源已变化', '仅核对关联订单日期，不代表已分配数量或按期齐套。']) assert.ok(panel.text().includes(label), label);
  assert.doesNotMatch(panel.text(), /已达标|按期可齐套|采购量|已到货量|剩余量|建议新增量/);
  const beforeStatus = elements(panel.tree()).find((node) => node.type === 'span' && text(node).trim() === '可用日期不晚于计划日期');
  assert.match(beforeStatus.props.className, /bg-slate-100/); assert.doesNotMatch(beforeStatus.props.className, /emerald|green/);
});

test('目标日期缺失仍独立展示未设置，取消及未知 ERP 状态原样显示', async () => {
  const panel = fixture({ reply: async () => response('plan-1', [row('cancelled', { orderStatus: 'ERP_CANCEL_99', approvalStatus: '作废', availability: null, dateCheck: 'unconfirmed' }), row('unknown', { orderStatus: null, approvalStatus: null, dateCheck: 'target_missing', etaDate: null, syncedAt: null })], {}, { targetDate: null }) });
  await panel.settle();
  for (const label of ['ERP_CANCEL_99', '作废', '可用日期未确认', '计划日期未设置', '未提供']) assert.ok(panel.text().includes(label), label);
  assert.doesNotMatch(panel.text(), /已达标|已分配\s*[0-9]/);
});

test('批次和任务来源均可呈现，异常关联仅显示原因与来源，不制造可点击目标', async () => {
  const panel = fixture({ reply: async () => response('plan-1', [row('shared', { sources: [batchSource, taskSource] }), unresolved(), unresolved({ key: 'unresolved:batch-2', orderNo: null, lineNo: null, sources: [{ kind: 'batch', id: 'batch-2', label: '第 2 批' }], reason: '采购批次尚未关联 ERP 订单行' })]) });
  await panel.settle();
  for (const label of ['采购批次', '采购任务', '第 1 批', 'PR-2026-001', '第 2 批', '订单有多行，尚未明确关联行号', '采购批次尚未关联 ERP 订单行']) assert.ok(panel.text().includes(label), label);
  assert.equal(panel.actions().length, 1);
  assert.equal(elements(panel.tree()).filter((node) => node.type === 'li').length, 3);
  assert.match(panel.text(), /共 3 条/);
  panel.actions()[0].props.onClick(); assert.deepEqual(panel.opened, [['PO-shared', 'shared']]);
  const taskOnly = fixture({ reply: async () => response('plan-1', [row('task-only', { sources: [taskSource] })]) }); await taskOnly.settle();
  assert.equal(taskOnly.requests.length, 1); assert.equal(taskOnly.actions().length, 1);
});

test('初次与刷新加载不展示旧入口，捕获的旧事件也不能跳转', async () => {
  const initial = deferred(); const panel = fixture({ reply: () => initial.promise });
  assert.match(panel.text(), /正在读取关联订单日期/); assert.equal(panel.button('刷新本计划关联订单日期').props.disabled, true);
  assert.equal(panel.button('下一页关联订单日期'), undefined);
  initial.resolve(response()); await panel.settle();
  const oldAction = panel.actions()[0];
  const pending = deferred(); panel.setReply(() => pending.promise); panel.click('刷新本计划关联订单日期');
  assert.equal(panel.actions().length, 0); oldAction.props.onClick(); assert.equal(panel.opened.length, 0);
  pending.resolve(response('plan-1', [row('updated')])); await panel.settle(); assert.match(panel.text(), /PO-updated/);
});

test('切换计划即隐藏旧数据与入口，旧成功响应不能覆盖新计划', async () => {
  const initial = deferred(); const panel = fixture({ reply: () => initial.promise });
  panel.setReply(async (id) => response(id, [row('new-plan')])); panel.setPlan('plan-2'); await panel.settle();
  assert.equal(panel.requests[0].signal.aborted, true);
  assert.deepEqual({ id: panel.requests[1].id, params: panel.requests[1].params }, { id: 'plan-2', params: { page: 1, pageSize: 10 } });
  initial.resolve(response('plan-1', [row('old-plan')])); await panel.settle();
  assert.match(panel.text(), /PO-new-plan/); assert.doesNotMatch(panel.text(), /PO-old-plan/);
});

test('顶部只有一组分页，总数包含异常关联；翻页清旧行并在换计划后回第一页', async () => {
  const panel = fixture({ reply: async () => response('plan-1', [row(), unresolved()], { total: 11, totalPages: 2 }) }); await panel.settle();
  assert.match(panel.text(), /第 1 \/ 2 页，共 11 条/);
  const all = elements(panel.tree());
  const next = all.findIndex((node) => node.type === 'Button' && node.props['aria-label'] === '下一页关联订单日期');
  const list = all.findIndex((node) => node.type === 'ul' && node.props['aria-label'] === '本计划关联订单日期');
  assert.ok(next < list); assert.equal(all.filter((node) => node.type === 'Button' && node.props['aria-label'] === '下一页关联订单日期').length, 1);
  assert.equal(panel.button('上一页关联订单日期').props.disabled, true);
  const pending = deferred(); panel.setReply(() => pending.promise); panel.click('下一页关联订单日期');
  assert.equal(panel.actions().length, 0); assert.equal(panel.requests.at(-1).params.page, 2);
  pending.resolve(response('plan-1', [row('page-two')], { page: 2, total: 11, totalPages: 2 })); await panel.settle();
  assert.equal(panel.button('下一页关联订单日期').props.disabled, true);
  panel.setReply(async (id) => response(id, [])); panel.setPlan('plan-2'); await panel.settle();
  assert.equal(panel.requests.at(-1).params.page, 1);
});

test('后端钳制超末页时使用实际页码，空结果不留下无效分页', async () => {
  const panel = fixture({ reply: async () => response('plan-1', [row()], { total: 11, totalPages: 2 }) }); await panel.settle();
  panel.setReply(async () => response('plan-1', [row('last')], { page: 1, total: 1, totalPages: 1 }));
  panel.click('下一页关联订单日期'); await panel.settle();
  assert.match(panel.text(), /第 1 \/ 1 页，共 1 条/);
  assert.equal(panel.button('下一页关联订单日期').props.disabled, true);
  panel.setReply(async () => response('plan-1', [])); panel.click('刷新本计划关联订单日期'); await panel.settle();
  assert.match(panel.text(), /暂无可核对的订单关联/); assert.match(panel.text(), /采购批次或采购任务/);
  assert.equal(panel.button('下一页关联订单日期'), undefined); assert.equal(panel.actions().length, 0);
});

test('并发刷新时旧失败和 finally 不能清掉新请求结果', async () => {
  const panel = fixture(); await panel.settle();
  const old = deferred(); const current = deferred();
  const refresh = panel.button('刷新本计划关联订单日期');
  panel.setReply(() => old.promise); refresh.props.onClick();
  panel.setReply(() => current.promise); refresh.props.onClick(); panel.render();
  current.resolve(response('plan-1', [row('current')])); await panel.settle();
  old.reject(new Error('过期请求失败')); await panel.settle();
  assert.match(panel.text(), /PO-current/); assert.doesNotMatch(panel.text(), /过期请求失败/);
  assert.equal(panel.button('刷新本计划关联订单日期').props.disabled, false);
});

test('响应计划不一致显示局部错误，不允许打开错误计划的订单', async () => {
  const panel = fixture({ reply: async () => response('other-plan') }); await panel.settle();
  assert.match(panel.text(), /返回的计划与当前计划不一致/); assert.equal(panel.actions().length, 0);
  assert.ok(panel.button('重新读取关联订单日期'));
});

test('读取失败清掉旧入口，重试恢复；取消或失效计划保持错误而非空结果', async () => {
  const panel = fixture(); await panel.settle();
  panel.setReply(async () => { throw new Error('计划不存在或已移除'); }); panel.click('刷新本计划关联订单日期'); await panel.settle();
  assert.match(panel.text(), /计划不存在或已移除/); assert.equal(panel.actions().length, 0);
  assert.doesNotMatch(panel.text(), /暂无可核对/);
  panel.setReply(async () => response('plan-1', [row('recovered')])); panel.click('重新读取关联订单日期'); await panel.settle();
  assert.match(panel.text(), /PO-recovered/); assert.doesNotMatch(panel.text(), /计划不存在或已移除/);
});

test('收回读取权限和卸载会中止请求，收回详情权限使旧按钮事件失效', async () => {
  const pending = deferred(); const panel = fixture({ reply: () => pending.promise });
  panel.setPermissions(['page:proc-cockpit']); assert.equal(panel.requests[0].signal.aborted, true);
  pending.resolve(response()); await panel.settle(); assert.equal(panel.actions().length, 0); assert.match(panel.text(), /暂无计划或采购订单查看权限/);
  const detail = fixture(); await detail.settle(); const old = detail.actions()[0];
  detail.setPermissions(['page:proc-cockpit', 'page:purchase-orders']); old.props.onClick();
  assert.equal(detail.opened.length, 0); assert.equal(detail.actions().length, 0);
  const closing = deferred(); const closed = fixture({ reply: () => closing.promise }); closed.unmount();
  assert.equal(closed.requests[0].signal.aborted, true); closing.resolve(response()); await closed.settle(); assert.equal(closed.actions().length, 0);
});

test('真实接口按计划 ID 安全编码，只传分页和取消信号且不执行写入', async () => {
  const requests = []; const exports = {};
  new Function('exports', 'require', apiCode)(exports, (name) => {
    if (name === './resourceUpload') return {};
    assert.equal(name, './authSession');
    return { authFetch: async (path, init) => { requests.push({ path, init }); return { ok: true, json: async () => response() }; }, readErrorMessage: async () => '读取失败' };
  });
  const controller = new AbortController();
  await exports.getProcStockPlanOrderDateCheck('plan/%2F?中文', { page: 2, pageSize: 10 }, controller.signal);
  assert.equal(requests[0].path, '/api/procurement/stock-plans/plan%2F%252F%3F%E4%B8%AD%E6%96%87/order-date-check?page=2&pageSize=10');
  assert.equal(requests[0].init.signal, controller.signal); assert.equal(requests[0].init.body, undefined); assert.equal(requests[0].init.method, undefined);
  await exports.getProcStockPlanOrderDateCheck('plan-1');
  assert.equal(requests[1].path, '/api/procurement/stock-plans/plan-1/order-date-check');
});
