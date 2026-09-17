import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as jsxRuntime from 'react/jsx-runtime';
import { matchPath } from 'react-router';
import ts from 'typescript';

const path = '/proc-operational-tasks';
const read = (file) => readFileSync(new URL('../' + file, import.meta.url), 'utf8');
const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function load(file, deps = {}) { const out = {}; new Function('exports', 'require', compile(read(file)))(out, (id) => { if (/\/ui\/(?:button|input|native-select|textarea|checkbox|radio-group|slider)$/.test(id)) return { Button: "Button", Input: "Input", NativeSelect: "NativeSelect", Textarea: "Textarea", Checkbox: "Checkbox", RadioGroup: "RadioGroup", RadioGroupItem: "RadioGroupItem", Slider: "Slider" };  assert.ok(id in deps, id); return deps[id]; }); return out; }
const permissions = load('src/app/lib/permissions.ts');
const role = (...codes) => ({ id: 'worker-a', permissions: codes });
const warehouse = role('page:purchase-order-detail', 'proc-purchase-order:receive');
const quality = role('page:purchase-order-detail', 'proc-purchase-order:inspect');
const manager = role('page:purchase-order-detail', 'page:proc-cockpit', 'proc-operations:assign');
function navigation(user, hidden = []) {
  const { navGroups } = load('src/app/routesConfig.tsx', { 'lucide-react': new Proxy({}, { get: (_, key) => key }), './lib/routePaths': { routePath: (code, fallback) => code === 'page:purchase-order-detail' ? '/orders/:id' : fallback } });
  const { useVisibleNavigation } = load('src/app/lib/useVisibleNavigation.ts', { react: { useMemo: (fn) => fn() }, '../auth': { useAuth: () => ({ user }) }, '../routesConfig': { navGroups }, './permissions': permissions, './permissionCatalogApi': { useNavHiddenCodes: () => new Set(hidden) } });
  return useVisibleNavigation().flatMap(group => group.items);
}
function page(user) {
  const { OperationalTasksPage } = load('src/app/procurement/people/OperationalTasksPage.tsx', { 'react/jsx-runtime': jsxRuntime, '../../auth': { useAuth: () => ({ user }) }, '../../lib/permissions': permissions, '../../lib/i18n': { useI18n: () => ({ t: value => value }) }, './OperationalTasksPanel': { OperationalTasksPanel: 'OperationalTasksPanel' }, '../horizon.css': {} });
  return OperationalTasksPage();
}
function find(tree, predicate) { if (!tree || typeof tree !== 'object') return undefined; if (predicate(tree)) return tree; const children = tree.props?.children; for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) { const result = find(child, predicate); if (result) return result; } }

test('仓管和质量普通人员具有可见独立入口，详情主路径改名不覆盖岗位入口', () => {
  for (const user of [warehouse, quality, manager, role('*')]) assert.ok(navigation(user).some(item => item.path === path));
  assert.ok(navigation(warehouse, ['page:purchase-order-detail']).some(item => item.path === path), '详情不是侧栏主入口，其隐藏配置不吞掉岗位任务入口');
});
test('缺任一权限前提时菜单隐藏，既有知识库任一权限规则保留', () => {
  for (const user of [null, role(), role('page:purchase-order-detail'), role('proc-purchase-order:receive'), role('proc-purchase-order:inspect'), role('page:proc-cockpit'), role('proc-operations:assign')]) assert.equal(navigation(user).some(item => item.path === path), false);
  assert.ok(navigation(role('page:dept-kb-quality')).some(item => item.requiredPermissionAny?.includes('page:dept-kb-quality')));
});
test('直接打开独立页仍组合校验权限，仅渲染本人任务；不挂团队页', () => {
  for (const user of [warehouse, quality, manager, role('*')]) assert.equal(find(page(user), node => node.type === 'OperationalTasksPanel')?.props.personal, true);
  for (const user of [null, role(), role('page:purchase-order-detail'), role('proc-purchase-order:receive'), role('page:proc-cockpit')]) assert.equal(find(page(user), node => node.type === 'OperationalTasksPanel'), undefined);
});
test('App 独立岗位路由保留详情外门，团队管理仍只归驾驶舱权限', () => {
  const app = read('src/app/App.tsx');
  assert.match(app, /path:\s*"proc-operational-tasks",\s*element:\s*makeLazyProtected\(<OperationalTasksPage\s*\/>,\s*"page:purchase-order-detail"\)/);
  assert.match(app, /path:\s*"proc-people-management",\s*element:\s*makeLazyProtected\(<ProcPeopleManagementPage\s*\/>,\s*"page:proc-cockpit"\)/);
});
test('手机访问岗位任务保留原入口，未登录仍进登录页', () => {
  const app = read('src/app/App.tsx'); const start = app.indexOf('function ProtectedLayout()'); const end = app.indexOf('/** Guards a route', start);
  const exported = compile('export ' + app.slice(start, end));
  for (const user of [warehouse, null]) {
    const out = {}; new Function('exports', 'require', 'useAuth', 'useLocation', 'useIsMobileViewport', 'routePath', 'subRoutePath', 'matchPath', 'Root', 'Navigate', exported)(out, () => jsxRuntime,
      () => ({ user, hydrated: true }), () => ({ pathname: path, search: '', hash: '', state: null }), () => true, (_, fallback) => fallback,
      (_, fallback, suffix) => `${fallback}/${suffix}`, matchPath, 'Root', 'Navigate');
    const view = out.ProtectedLayout(); assert.equal(view.type, user ? 'Root' : 'Navigate'); if (!user) assert.equal(view.props.to, '/login');
  }
});

test('真实面板个人模式按本人查询，经理也不显示团队分派；质量人员默认进入质量任务', async () => {
  for (const [user, personal, expectedOwner, expectedKind, canViewAll = true] of [[warehouse, true, 'worker-a', 'warehouse'], [quality, true, 'worker-a', 'quality'], [manager, true, 'worker-a', 'warehouse'], [manager, false, 'all', 'warehouse'], [warehouse, false, 'worker-a', 'warehouse', false]]) {
    const slots = [], effects = [], queries = []; let cursor = 0, changed = false, candidateReads = 0;
    const hooks = {
      useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
      useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { const value = typeof next === 'function' ? next(slots[index]) : next; if (!Object.is(value, slots[index])) { slots[index] = value; changed = true; } }]; },
      useEffect(fn, deps) { const index = cursor++, previous = slots[index]; if (!previous || deps.some((value, i) => !Object.is(value, previous.deps[i]))) { const effect = { deps }; slots[index] = effect; effects.push(() => { previous?.cleanup?.(); effect.cleanup = fn(); }); } },
    };
    const response = { items: [{ id: 'line-a', lineId: 'line-a', kind: expectedKind, orderNo: 'PO', lineNo: '1', materialName: '零件', state: '待处理', dueDate: null, quantity: 3, unit: '件', assignment: { userId: user.id, name: '本人', history: [] } }], people: [{ id: 'someone-else', name: '其他员工' }], nextCursor: null, canViewAll, canAssign: true };
    const mod = load('src/app/procurement/people/OperationalTasksPanel.tsx', { react: hooks, 'react/jsx-runtime': jsxRuntime, 'react-router': { useNavigate: () => () => {} }, '../../auth': { useAuth: () => ({ user }) }, '../../hooks/usePermission': { usePermission: code => permissions.hasPermission(user.permissions, code) }, '../../lib/purchaseOrderLineNavigation': { buildPurchaseOrderLinePath: () => '/orders/PO?line=line-a' }, '../../lib/operationalTasksApi': {
      fetchOperationalTasks: async query => { queries.push(query); return response; }, fetchOperationalCandidates: async () => { candidateReads++; return []; }, assignOperationalTask: () => { throw new Error('read-only test'); },
    }, '../../components/ui/dialog': new Proxy({}, { get: (_, key) => key }) });
    const render = () => { let tree; for (let i = 0; i < 20; i++) { changed = false; cursor = 0; const element = mod.OperationalTasksPanel({ personal }); tree = element.type(element.props); while (effects.length) effects.shift()(); if (!changed) return tree; } assert.fail('render loop'); };
    render(); await new Promise(resolve => setImmediate(resolve)); const tree = render();
    assert.equal(queries.length, 2); assert.ok(queries.every(query => query.owner === expectedOwner && query.kind === expectedKind));
    const management = !personal && user === manager;
    assert.equal(candidateReads, management ? 1 : 0);
    const owner = find(tree, node => node.props?.['aria-label'] === '任务负责人');
    assert.equal(Boolean(find(owner, node => node.type === 'option' && node.props.value === 'all')), !personal && canViewAll);
    assert.equal(Boolean(find(owner, node => node.type === 'option' && node.props.value === 'someone-else')), !personal && canViewAll);
    assert.equal(Boolean(find(tree, node => node.type === "Button" && node.props.children === '保存分派')), management);
  }
});
