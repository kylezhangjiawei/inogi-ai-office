import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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
function routes(overrides = {}) {
  const routePath = (code, fallback) => overrides[code] ?? (code === 'page:purchase-order-detail' ? '/orders/:id' : fallback);
  return load('src/app/routesConfig.tsx', { 'lucide-react': new Proxy({}, { get: (_, key) => key }), './lib/routePaths': { routePath, subRoutePath: (code, fallback, suffix) => `${routePath(code, fallback)}/${suffix}` } });
}
function navigation(user, hidden = [], overrides = {}) {
  const { navGroups } = routes(overrides);
  const { useVisibleNavigation } = load('src/app/lib/useVisibleNavigation.ts', { react: { useMemo: (fn) => fn() }, '../auth': { useAuth: () => ({ user }) }, '../routesConfig': { navGroups }, './permissions': permissions, './permissionCatalogApi': { useNavMeta: () => hidden.map(code => ({ code, navHidden: true })) } });
  return useVisibleNavigation().flatMap(group => group.items);
}
test('供应链导航保留独立权限与路径，所有角色均移除仓管质量任务入口', () => {
  for (const user of [warehouse, quality, manager, role('*')]) assert.equal(navigation(user).some(item => item.path === path), false);
  assert.equal(navigation(warehouse, ['page:purchase-order-detail']).some(item => item.path === path), false);
  const expected = [
    ['供应链管理', 'page:proc-cockpit', '/proc-cockpit', '供应链任务驾驶舱'],
    ['供应链管理', 'page:proc-my-workspace', '/proc-my-workspace', '采购工作台'],
    ['研发任务管理', 'page:rd-my-workspace', '/rd-my-workspace', '研发工作台'],
  ];
  const { DEFAULT_PERMISSION_CATALOG } = load('apps/api/src/modules/permission-catalog/permission-catalog.defaults.ts');
  for (const overrides of [{}, { 'page:proc-cockpit': '/supply/tasks', 'page:proc-my-workspace': '/supply/mine', 'page:rd-my-workspace': '/research/mine' }]) {
    const { navGroups, routeTitleMap, routePermissionMap } = routes(overrides);
    for (const [group, code, fallback, label] of expected) {
      const target = overrides[code] ?? fallback;
      const item = navGroups.find(entry => entry.label === group).items.find(entry => entry.requiredPermission === code);
      assert.deepEqual([item.label, item.path, routeTitleMap[target], routePermissionMap[target]], [label, target, label, code]);
      assert.equal(navigation(role(code), [], overrides).find(entry => entry.requiredPermission === code)?.path, target);
      assert.equal(navigation(role(code), [code], overrides).some(entry => entry.requiredPermission === code), false);
      const catalog = DEFAULT_PERMISSION_CATALOG.find(entry => entry.code === code);
      assert.deepEqual([catalog.label, catalog.routePath], [label, fallback]);
    }
    assert.deepEqual(navigation(role('page:proc-my-workspace'), [], overrides).filter(item => item.label === '采购工作台').map(item => item.requiredPermission), ['page:proc-my-workspace']);
    assert.deepEqual(navigation(role('page:rd-my-workspace'), [], overrides).filter(item => item.label === '研发工作台').map(item => item.requiredPermission), ['page:rd-my-workspace']);
  }
});
test('缺任一权限前提时菜单隐藏，既有知识库任一权限规则保留', () => {
  for (const user of [null, role(), role('page:purchase-order-detail'), role('proc-purchase-order:receive'), role('proc-purchase-order:inspect'), role('page:proc-cockpit'), role('proc-operations:assign')]) assert.equal(navigation(user).some(item => item.path === path), false);
  assert.ok(navigation(role('page:dept-kb-quality')).some(item => item.requiredPermissionAny?.includes('page:dept-kb-quality')));
});
test('岗位页面与专用面板已删除，人员管理仍保留', () => {
  const app = read('src/app/App.tsx');
  assert.doesNotMatch(app, /OperationalTasksPage|path:\s*"proc-operational-tasks"/);
  for (const file of ['OperationalTasksPage.tsx', 'OperationalTasksPanel.tsx']) {
    assert.equal(existsSync(new URL('../src/app/procurement/people/' + file, import.meta.url)), false);
  }
  assert.match(app, /path:\s*"proc-people-management",\s*element:\s*makeLazyProtected\(<ProcPeopleManagementPage\s*\/>,\s*"page:proc-cockpit"\)/);
});

test('电脑和手机打开已删除页面均回首页，未登录仍进登录页', () => {
  const app = read('src/app/App.tsx'); const start = app.indexOf('function ProtectedLayout()'); const end = app.indexOf('/** Guards a route', start);
  const exported = compile('export ' + app.slice(start, end).replaceAll('import.meta.env.DEV', 'false'));
  for (const isMobile of [false, true]) for (const user of [warehouse, quality, manager, role('*'), null]) {
    const out = {}; new Function('exports', 'require', 'useAuth', 'useLocation', 'useIsMobileViewport', 'routePath', 'subRoutePath', 'matchPath', 'Root', 'Navigate', exported)(out, () => jsxRuntime,
      () => ({ user, hydrated: true }), () => ({ pathname: path, search: '', hash: '', state: null }), () => isMobile, (_, fallback) => fallback,
      (_, fallback, suffix) => `${fallback}/${suffix}`, matchPath, 'Root', 'Navigate');
    const view = out.ProtectedLayout(); assert.equal(view.type, 'Navigate'); assert.equal(view.props.to, user ? '/' : '/login'); assert.equal(view.props.replace, true);
  }
});
