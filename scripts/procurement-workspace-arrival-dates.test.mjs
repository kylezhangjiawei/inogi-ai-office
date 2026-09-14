import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const compile = (path) => ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
const componentCode = compile('src/app/procurement/components/ProcWorkspaceArrivals.tsx');
const apiCode = compile('src/app/lib/procurementApi.ts');
const model = {};
new Function('exports', 'require', compile('src/app/procurement/procurementWorkspaceModel.ts'))(model, () => ({}));
const calendarModel = {};
new Function('exports', 'require', compile('src/app/procurement/arrivals/arrivalCalendarModel.ts'))(calendarModel, () => ({}));
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
function order(id, patch = {}) {
  return { id, tpOrderNo: `PO-${id}`, tpOrderId: `erp-${id}`, tpLineNo: '1', supplierName: '供应商甲', orderedQty: 30, receivedQty: 3,
    unitPrice: 12, etaDate: '2026-09-13', status: '已下单', ...patch };
}
function task(id = 'task-1', patch = {}) {
  return { id, code: `PR-${id}`, materialId: 'material-1', materialName: '阀体', spec: '标准型', unit: '件', status: 'in_transit',
    buyerUserId: 'buyer-1', buyer: '经办人', updatedAt: '2026-09-10T00:00:00Z', purchaseOrders: [order('ref-1')], ...patch };
}
function confirmation(patch = {}) {
  return { availableDate: '2026-09-15', note: '检验两天后可用', confirmedByName: '经办人', confirmedAt: '2026-09-10T09:00:00Z', version: 2, needsReconfirmation: false, ...patch };
}
function dateFor(ref, source, patch = {}) {
  return { refId: ref.id, kind: 'line', taskId: source.id, lineId: `mirror-${ref.id}`, tpOrderId: ref.tpOrderId, orderNo: ref.tpOrderNo, lineNo: ref.tpLineNo,
    inventoryCode: 'QA-VALVE-01', inventoryName: source.materialName, unit: source.unit, supplierName: ref.supplierName, etaDate: ref.etaDate,
    syncedAt: '2026-09-10T08:00:00Z', orderStatus: '已下单', approvalStatus: '已审核', availability: confirmation(), ...patch };
}
function responseFor(tasks, refs, patch = {}) {
  return { readOnly: true, items: refs.map((id) => {
    const source = tasks.find((value) => value.purchaseOrders.some((ref) => ref.id === id));
    const ref = source.purchaseOrders.find((value) => value.id === id);
    return dateFor(ref, source, typeof patch === 'function' ? patch(ref, source) : patch);
  }) };
}
function fixture({ tasks = [task()], permissions = ['page:proc-my-workspace', 'page:purchase-order-detail'], reply,
  open = true, page = 1, scopeKey = 'my-tasks', focusKey, disabled = false } = {}) {
  const requests = [], opened = [], selected = [], focused = [], handled = [], restored = [], slots = [];
  let slot = 0, pendingEffects = [], tree, user = { id: 'buyer-1', name: '经办人' };
  const props = { tasks, open, page, scopeKey, focusKey, disabled,
    onOpenChange(value) { props.open = value; }, onPageChange(value) { props.page = value; },
    onRestorePage(value) { restored.push(value); props.page = value; },
    onSelect(value) { selected.push(value); }, onOpenOrderLine(row, target) { opened.push({ row, target }); },
    onFocusHandled(key) { handled.push(key); props.focusKey = undefined; },
  };
  const same = (a, b) => Boolean(a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index])));
  const react = {
    useState(initial) { const index = slot++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial;
      return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef(initial) { const index = slot++; return slots[index] ??= { current: initial }; },
    useMemo(factory, deps) { const index = slot++; if (!same(slots[index]?.deps, deps)) slots[index] = { value: factory(), deps }; return slots[index].value; },
    useCallback(callback, deps) { const index = slot++; if (!same(slots[index]?.deps, deps)) slots[index] = { callback, deps }; return slots[index].callback; },
    useEffect(callback, deps) { const index = slot++; const previous = slots[index]; if (!same(previous?.deps, deps)) pendingEffects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; }); },
  };
  const hasPermission = (name) => permissions.includes('*') || permissions.includes(name);
  const deps = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' }, '../../auth': { useAuth: () => ({ user }) },
    '../../lib/i18n': { useI18n: () => ({ t }), i18nLocale: () => 'zh-CN' },
    '../../hooks/usePermission': { usePermission: hasPermission, useAnyPermission: (...names) => names.some(hasPermission) },
    '../../components/ui/utils': { cn: (...parts) => parts.filter(Boolean).join(' ') },
    '../procurementWorkspaceModel': model,
    '../arrivals/arrivalCalendarModel': calendarModel,
    '../arrivals/ArrivalCalendar': { ArrivalCalendar: 'ArrivalCalendar' },
    '../../lib/procurementApi': { getProcWorkspaceArrivalDates: async (refs, signal) => { requests.push({ refs, signal }); return reply ? reply(refs, signal) : responseFor(props.tasks, refs); } },
  };
  const exports = {};
  new Function('exports', 'require', componentCode)(exports, (name) => {
    if (name in deps) return deps[name];
    assert.ok(name === 'lucide-react' || name.startsWith('../../components/'), `Unexpected dependency ${name}`);
    return components;
  });
  const api = {
    props, requests, opened, selected, focused, handled, restored,
    render() {
      slot = 0; pendingEffects = []; tree = exports.ProcWorkspaceArrivals(props);
      for (const element of elements(tree)) if (element.props?.ref) element.props.ref.current = {
        querySelectorAll: () => elements(tree).filter((node) => node.props?.['data-workspace-arrival-key']).map((node) => ({
          dataset: { workspaceArrivalKey: node.props['data-workspace-arrival-key'] },
          focus() { focused.push(node.props['data-workspace-arrival-key']); }, scrollIntoView() {},
        })),
      };
      const effects = pendingEffects; pendingEffects = []; effects.forEach((effect) => effect()); return tree;
    },
    async settle() { await new Promise((resolve) => setImmediate(resolve)); return api.render(); },
    tree: () => tree, text: () => text(tree),
    rows: () => elements(tree).filter((node) => node.type === 'li'),
    actions: () => elements(tree).filter((node) => node.type === 'Button' && node.props['aria-label']?.startsWith('查看采购订单')),
    button(label) { return elements(tree).find((node) => node.type === 'Button' && (node.props['aria-label'] === label || text(node).trim() === label)); },
    click(label) { const node = api.button(label); assert.ok(node, `${label} should exist`); assert.equal(Boolean(node.props.disabled), false); node.props.onClick(); return api.render(); },
    set(patch) { Object.assign(props, patch); return api.render(); },
    setPermissions(next) { permissions = next; return api.render(); },
    setUser(next) { user = next; return api.render(); },
    setReply(next) { reply = next; },
    unmount() { for (const value of slots) value?.cleanup?.(); },
  };
  api.render(); return api;
}

test('折叠、空列表、任务刷新中或缺工作台与订单读取组合权限时不查询', async () => {
  for (const options of [{ open: false }, { tasks: [] }, { disabled: true }, { permissions: [] }, { permissions: ['page:proc-my-workspace'] }, { permissions: ['page:purchase-order-detail'] }, { permissions: ['page:proc-cockpit', 'page:purchase-order-detail'] }]) {
    const view = fixture(options); await view.settle(); assert.equal(view.requests.length, 0); assert.equal(view.actions().length, 0);
  }
  const view = fixture({ open: false }); view.set({ open: true }); await view.settle(); assert.equal(view.requests.length, 1);
  const wildcard = fixture({ permissions: ['*'] }); await wildcard.settle(); assert.equal(wildcard.requests.length, 1);
});

test('本页一次查询最多十个代表ref，顶部单组分页；折叠后重新展开读取最新日期', async () => {
  const tasks = [task('many', { purchaseOrders: Array.from({ length: 23 }, (_, index) => order(`ref-${String(index).padStart(2, '0')}`)) })];
  const arrivals = model.workspaceArrivals(tasks);
  const view = fixture({ tasks }); await view.settle();
  assert.deepEqual(view.requests[0].refs, arrivals.slice(0, 10).map((row) => row.orderId)); assert.equal(view.rows().length, 10);
  assert.match(view.text(), /第 1 \/ 3 页，共 23 行/);
  const all = elements(view.tree()); assert.ok(all.findIndex((n) => n.props?.['aria-label'] === '下一页到货安排') < all.findIndex((n) => n.type === 'li'));
  assert.equal(all.filter((n) => n.props?.['aria-label'] === '下一页到货安排').length, 1);
  view.click('下一页到货安排'); await view.settle(); assert.deepEqual(view.requests.at(-1).refs, arrivals.slice(10, 20).map((row) => row.orderId));
  view.click('下一页到货安排'); await view.settle(); assert.equal(view.requests.at(-1).refs.length, 3); assert.equal(view.rows().length, 3);
  view.set({ open: false }); await view.settle(); const count = view.requests.length;
  view.set({ open: true }); await view.settle(); assert.equal(view.requests.length, count + 1);
});

test('日期并列保留原 ETA 排序和数量，最新订单 ETA 不同单独说明，不改写需求或补库存', async () => {
  const tasks = [task('original', { purchaseOrders: [order('later', { etaDate: '2026-09-20', receivedQty: 30 }), order('first', { etaDate: '2026-09-12', orderedQty: 10, receivedQty: 12 })] })];
  const view = fixture({ tasks, reply: async (refs) => responseFor(tasks, refs, { etaDate: '2026-09-25', orderStatus: 'ERP_CLOSED', approvalStatus: '历史状态' }) }); await view.settle();
  assert.ok(text(view.rows()[0]).includes('PO-first')); assert.ok(text(view.rows()[1]).includes('PO-later'));
  for (const label of ['2026-09-12', '2026-09-20', '2026-09-25', '订单最新预计到货', '与任务关联日期不同', '人工预计检验后可用', '待核对', 'ERP_CLOSED', '历史状态', '经办人', '检验两天后可用']) assert.ok(view.text().includes(label), label);
  assert.doesNotMatch(view.text(), /按期可齐套|已分配|未验收|建议新增|到期可用数量/);
  assert.match(text(view.rows()[1]), /未收数量\s+0 件/);
});

test('展示未确认、已撤销、需重确认和确认记录；无法精确关联的引用只保留原因与查看任务', async () => {
  const tasks = [task('states', { purchaseOrders: ['unknown', 'cleared', 'stale', 'sample'].map((id) => order(id)) })];
  const view = fixture({ tasks, reply: async (refs) => ({ readOnly: true, items: refs.map((id) => {
    const ref = tasks[0].purchaseOrders.find((r) => r.id === id);
    return id === 'sample' ? { refId: id, kind: 'unresolved', reason: '免费样品没有正式采购订单行' } : dateFor(ref, tasks[0], { availability: id === 'unknown' ? null : confirmation(id === 'cleared' ? { availableDate: null, note: '原交期失效' } : { needsReconfirmation: true }) });
  }) }) }); await view.settle();
  for (const label of ['可用日期未确认', '可用日期已撤销', '可用日期需重确认', '原交期失效', '订单来源已变化', '免费样品没有正式采购订单行']) assert.ok(view.text().includes(label), label);
  assert.equal(view.actions().length, 3);
  assert.equal(elements(view.tree()).filter((n) => n.props?.['aria-label']?.startsWith('查看到货任务：')).length, 4);
});

test('任务按钮和订单按钮独立且没有嵌套交互，只给详情权限精确下钻', async () => {
  const tasks = [task('special', { purchaseOrders: [order('ref/%2F?中', { tpOrderNo: ' PO/%2F?中 ', tpOrderId: 'erp special', tpLineNo: ' 13 ' })] })];
  const view = fixture({ tasks }); await view.settle();
  view.actions()[0].props.onClick(); assert.deepEqual(view.opened[0].target, { orderNo: ' PO/%2F?中 ', lineId: 'mirror-ref/%2F?中' });
  const select = elements(view.tree()).find((n) => n.props?.['aria-label']?.startsWith('查看到货任务：')); select.props.onClick(); assert.deepEqual(view.selected, ['special']);
  for (const button of elements(view.tree()).filter((n) => n.type === 'Button' || n.type === 'button')) assert.equal(elements(button.props.children).some((n) => n.type === 'Button' || n.type === 'button'), false);
  const readonly = fixture({ permissions: ['page:proc-my-workspace', 'page:purchase-orders'] }); await readonly.settle(); assert.match(readonly.text(), /2026-09-15/); assert.equal(readonly.actions().length, 0);
});

test('刷新、折叠、切页、改筛选、任务刷新和账号变更立即使旧导航失效', async () => {
  const cases = [view => view.click('刷新当前到货页的订单可用日期'), view => view.set({ open: false }), view => view.set({ scopeKey: 'different-filter' }), view => view.set({ disabled: true }), view => view.setUser({ id: 'buyer-2', name: '另一经办人' })];
  for (const change of cases) {
    const view = fixture(); await view.settle(); const stale = view.actions()[0]; const pending = deferred(); view.setReply(() => pending.promise); change(view);
    stale.props.onClick(); assert.equal(view.opened.length, 0); assert.equal(view.actions().length, 0); view.unmount();
  }
});

test('切换页后晚到的旧响应不得覆盖当前页，折叠及卸载取消请求', async () => {
  const tasks = [task('many', { purchaseOrders: Array.from({ length: 11 }, (_, index) => order(`ref-${String(index).padStart(2, '0')}`)) })];
  const pending = deferred(); const view = fixture({ tasks, reply: () => pending.promise });
  const firstRefs = view.requests[0].refs; view.setReply(async (refs) => responseFor(tasks, refs, { availability: confirmation({ availableDate: '2026-09-19' }) }));
  view.set({ page: 2 }); await view.settle(); assert.equal(view.requests[0].signal.aborted, true);
  pending.resolve(responseFor(tasks, firstRefs, { availability: confirmation({ availableDate: '2026-09-11' }) })); await view.settle();
  assert.match(view.text(), /2026-09-19/); assert.doesNotMatch(view.text(), /2026-09-11/); assert.equal(view.actions().length, 1);
  const closed = fixture({ reply: () => deferred().promise }); closed.set({ open: false }); assert.equal(closed.requests[0].signal.aborted, true);
  const unmounted = fixture({ reply: () => deferred().promise }); unmounted.unmount(); assert.equal(unmounted.requests[0].signal.aborted, true);
});

test('权限撤销使现存日期与捕获按钮失效，重新取得读取权限才重查', async () => {
  const view = fixture(); await view.settle(); const old = view.actions()[0];
  view.setPermissions(['page:proc-my-workspace']); old.props.onClick(); assert.equal(view.opened.length, 0); assert.equal(view.actions().length, 0);
  assert.doesNotMatch(view.text(), /2026-09-15/); assert.match(view.text(), /暂无工作台或采购订单查看权限/);
  view.setPermissions(['page:proc-my-workspace', 'page:purchase-orders']); await view.settle(); assert.match(view.text(), /2026-09-15/); assert.equal(view.actions().length, 0);
});

test('读取失败保留任务事实和重试，完整恢复前不提供旧订单入口', async () => {
  const view = fixture(); await view.settle(); const old = view.actions()[0];
  view.setReply(async () => { throw new Error('关联读取失败'); }); view.click('刷新当前到货页的订单可用日期'); await view.settle();
  old.props.onClick(); assert.equal(view.opened.length, 0); assert.match(view.text(), /关联读取失败/); assert.match(view.text(), /未收数量\s+27 件/); assert.equal(view.actions().length, 0);
  view.setReply(undefined); view.click('重新读取订单可用日期'); await view.settle(); assert.equal(view.actions().length, 1);
});

test('响应缺ref、额外ref或重复ref整页拒绝，不将跨范围结果误认为当前行', async () => {
  for (const items of [[], [{ refId: 'not-requested', kind: 'unresolved', reason: '其他范围' }], [{ refId: 'ref-1', kind: 'unresolved', reason: 'a' }, { refId: 'ref-1', kind: 'unresolved', reason: 'b' }]]) {
    const view = fixture({ reply: async () => ({ readOnly: true, items }) }); await view.settle(); assert.match(view.text(), /返回的订单关联与当前到货列表不一致/); assert.equal(view.actions().length, 0);
  }
});

test('同ref改任务、订单、行号或ERP内部身份以及缺历史身份都不接受日期与入口', async () => {
  for (const patch of [{ taskId: 'other' }, { orderNo: ' PO-ref-1' }, { lineNo: ' 1 ' }, { tpOrderId: 'recreated-erp' }]) {
    const tasks = [task()]; const view = fixture({ tasks, reply: async (refs) => responseFor(tasks, refs, patch) }); await view.settle();
    assert.match(view.text(), /订单关联已变化/); assert.doesNotMatch(view.text(), /2026-09-15/); assert.equal(view.actions().length, 0);
  }
  const tasks = [task('legacy', { purchaseOrders: [order('ref-1', { tpOrderId: undefined })] })];
  const view = fixture({ tasks, reply: async (refs) => responseFor(tasks, refs, { tpOrderId: 'current-erp' }) }); await view.settle(); assert.match(view.text(), /订单关联已变化/); assert.equal(view.actions().length, 0);
});

test('准确相同订单身份跨任务只读一个代表ref并保留所有来源，不因重复数造成无限批请求', async () => {
  const tasks = Array.from({ length: 75 }, (_, index) => task(`source-${String(index).padStart(2, '0')}`, { purchaseOrders: [order(`ref-${index}`, { tpOrderNo: 'SHARED', tpOrderId: 'shared-erp' })] }));
  const view = fixture({ tasks }); await view.settle(); assert.equal(view.rows().length, 1); assert.equal(view.requests.length, 1); assert.equal(view.requests[0].refs.length, 1);
  assert.equal(view.actions().length, 1); assert.match(view.text(), /PR-source-74/); assert.equal(view.opened.length, 0);
});

test('同准确身份但关联物料或单位冲突不套用代表日期、不查询该冲突行', async () => {
  for (const patch of [{ materialId: 'another' }, { unit: 'kg' }, { spec: '不同规格' }]) {
    const tasks = [task('A', { purchaseOrders: [order('first', { tpOrderNo: 'SAME', tpOrderId: 'same' })] }), task('B', { ...patch, purchaseOrders: [order('second', { tpOrderNo: 'SAME', tpOrderId: 'same' })] })];
    const view = fixture({ tasks }); await view.settle(); assert.equal(view.requests.length, 0); assert.equal(view.rows().length, 1);
    assert.match(view.text(), /关联物料或单位不一致/); assert.equal(view.actions().length, 0);
  }
});

test('返回来源用稳定key定位聚焦；移至其他页有明确跳页，失效包括空列表均说明', async () => {
  const tasks = [task('many', { purchaseOrders: Array.from({ length: 12 }, (_, index) => order(`ref-${String(index).padStart(2, '0')}`)) })];
  const rows = model.workspaceArrivals(tasks); const key = rows[10].key;
  const current = fixture({ tasks, page: 2, focusKey: key }); await current.settle(); assert.deepEqual(current.focused, [key]); assert.deepEqual(current.handled, [key]);
  const moved = fixture({ tasks, page: 1, focusKey: key }); await moved.settle(); assert.match(moved.text(), /原到货记录已移至第 2 页/); assert.equal(moved.focused.length, 0);
  moved.click('前往原到货记录'); await moved.settle(); assert.deepEqual(moved.restored, [2]); assert.deepEqual(moved.focused, [key]);
  for (const values of [tasks, []]) { const missing = fixture({ tasks: values, focusKey: 'deleted-record' }); await missing.settle(); assert.match(missing.text(), /原到货记录不在当前筛选中/); assert.equal(missing.focused.length, 0); }
});

test('接口使用重复refId参数安全编码且去重，保留标识原文及取消信号，无写入参数', async () => {
  const requests = [], exports = {};
  new Function('exports', 'require', apiCode)(exports, (name) => {
    if (name === './resourceUpload') return {};
    assert.equal(name, './authSession');
    return { authFetch: async (path, init) => { requests.push({ path, init }); return { ok: true, json: async () => ({ readOnly: true, items: [] }) }; }, readErrorMessage: async () => '读取失败' };
  });
  const controller = new AbortController();
  await exports.getProcWorkspaceArrivalDates(['ref/%2F?中', ' second ', 'ref/%2F?中'], controller.signal);
  const parsed = new URL(requests[0].path, 'http://localhost'); assert.equal(parsed.pathname, '/api/procurement/workspace-arrival-dates');
  assert.deepEqual(parsed.searchParams.getAll('refId'), ['ref/%2F?中', ' second ']);
  assert.equal(requests[0].init.signal, controller.signal); assert.equal(requests[0].init.body, undefined); assert.equal(requests[0].init.method, undefined);
});

test('订单三元组含空格/百分号或同号重建不合并，缺内部身份保留独立并标记数量歧义', () => {
  const rows = model.workspaceArrivals([task('keys', { purchaseOrders: [
    order('a', { tpOrderNo: 'PO/%2F', tpOrderId: 'erp', tpLineNo: '1' }), order('b', { tpOrderNo: ' PO/%2F', tpOrderId: 'erp', tpLineNo: '1' }),
    order('c', { tpOrderNo: 'PO/%2F', tpOrderId: 'erp', tpLineNo: ' 1 ' }), order('d', { tpOrderNo: 'PO/%2F', tpOrderId: 'new-erp', tpLineNo: '1' }),
    order('e', { tpOrderNo: 'PO-OLD', tpOrderId: undefined }), order('f', { tpOrderNo: 'PO-OLD', tpOrderId: undefined }),
  ] })]);
  assert.equal(rows.length, 6); assert.equal(new Set(rows.map((row) => row.key)).size, 6);
  assert.equal(rows.find((row) => row.orderId === 'b').orderNo, ' PO/%2F'); assert.equal(rows.find((row) => row.orderId === 'c').lineNo, ' 1 ');
  assert.ok(rows.filter((row) => ['e', 'f'].includes(row.orderId)).every((row) => row.quantityIssue && row.remainingQty === null));
});


test('日历使用全部关联计数，选日后分页和日期API只读取该日期范围', async () => {
  const tasks=[task('calendar',{purchaseOrders:Array.from({length:23},(_,i)=>order('day-'+String(i).padStart(2,'0'),{etaDate:i<12?'2026-09-13':i<22?'2026-09-20':''}))})];
  const view=fixture({tasks}); await view.settle();
  const change=patch=>Object.assign(view.props,{...(patch.view?{view:patch.view}:{}),...(patch.month?{calendarMonth:patch.month}:{}),...(patch.selection?{selection:patch.selection}:{}),page:1});
  view.set({view:'calendar',calendarMonth:'2026-09',selection:'2026-09-20',onViewChange:change}); await view.settle();
  const calendar=elements(view.tree()).find(n=>n.type==='ArrivalCalendar');
  assert.equal(calendar.props.rows.length,23); assert.equal(view.rows().length,10);
  assert.ok(view.requests.at(-1).refs.every(id=>id.startsWith('day-')&&Number(id.slice(4))>=12));
  const old=view.actions()[0];
  calendar.props.onSelect('undated'); view.render(); await view.settle();
  old.props.onClick(); assert.equal(view.opened.length,0); assert.equal(view.rows().length,1);
  assert.deepEqual(view.requests.at(-1).refs,['day-22']);
  elements(view.tree()).find(n=>n.type==='ArrivalCalendar').props.onSelect('2026-09-01'); view.render(); await view.settle();
  assert.equal(view.rows().length,0); assert.match(view.text(),/当前日期范围/);
  view.click('到货列表'); await view.settle(); assert.equal(view.rows().length,10); assert.equal(view.props.selection,'all');
});

test('原行日期变更后可清除日历筛选并定位精确原行，不误开其他日期行', async () => {
  const tasks=[task('focus',{purchaseOrders:[order('moved',{etaDate:'2026-09-20'}),order('kept',{etaDate:'2026-09-13'})]})];
  const row=model.workspaceArrivals(tasks).find(r=>r.orderId==='moved');
  const view=fixture({tasks,focusKey:row.key});
  view.set({view:'calendar',calendarMonth:'2026-09',selection:'2026-09-13',focusKey:row.key,onRestoreRange(page){Object.assign(view.props,{selection:'all',page});}}); await view.settle();
  assert.match(view.text(),/原到货记录的日期已变化/); assert.equal(view.focused.length,1,'首次未筛选渲染会定位一次');
  view.props.focusKey=row.key; view.render();
  view.click('清除日期筛选并定位原记录'); await view.settle();
  assert.equal(view.props.selection,'all'); assert.equal(view.focused.at(-1),row.key); assert.equal(view.opened.length,0);
});
