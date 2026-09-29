import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import ts from 'typescript';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
function load(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('exports', 'require', code)(exports, key => {
    assert.ok(key in dependencies, `Unexpected dependency: ${key}`);
    return dependencies[key];
  });
  return exports;
}
const { navGroups, routeTitleMap } = load('src/app/routesConfig.tsx', {
  'lucide-react': new Proxy({}, { get: (_, key) => key }),
  './lib/routePaths': load('src/app/lib/routePaths.ts'),
});
const { DEFAULT_PERMISSION_CATALOG: catalog } = load('apps/api/src/modules/permission-catalog/permission-catalog.defaults.ts');
const { buildVisibleNavigation } = load('src/app/lib/useVisibleNavigation.ts', {
  react: {}, '../auth': {}, '../routesConfig': {}, './permissionCatalogApi': {},
  './permissions': { hasPermission: (permissions, code) => permissions.includes('*') || permissions.includes(code) },
});
const { initialCollapsedGroups } = load('src/app/lib/navigationGroupState.ts');
const metadata = catalog.filter(item => item.type === 'page');

test('all 74 menu entries retain unique paths and agree with route/role catalog groups', () => {
  const items = navGroups.flatMap(group => group.items);
  assert.equal(items.length, 74);
  assert.equal(new Set(items.map(item => item.path)).size, 74);
  for (const group of navGroups) for (const item of group.items) {
    const codes = item.requiredPermission ? [item.requiredPermission] : item.requiredPermissionAny;
    assert.ok(codes?.length, item.path);
    for (const code of codes) {
      const entry = catalog.find(entry => entry.code === code);
      assert.ok(entry, code);
      assert.equal(entry.groupLabel, `页面访问 · ${group.label}`, code);
    }
  }
  assert.deepEqual(buildVisibleNavigation(navGroups, ['*'], metadata).map(group => group.label), navGroups.map(group => group.label));
  assert.equal(routeTitleMap['/proc-my-workspace'], '采购工作台');
  assert.equal(routeTitleMap['/rd-my-workspace'], '研发工作台');
});

test('moved pages retain permission, hidden and cross-module warehouse access boundaries', () => {
  const visible = permissions => buildVisibleNavigation(navGroups, permissions, metadata);
  assert.deepEqual(visible(['page:purchase-orders']).map(group => [group.label, group.items.map(item => item.path)]), [['供应链管理', ['/purchase-orders']]]);
  assert.deepEqual(visible(['page:device-inspection-records']).map(group => [group.label, group.items.map(item => item.path)]), [['生产与质量', ['/device-inspection-records']]]);
  assert.deepEqual(visible(['page:manual']).map(group => group.label), ['帮助与教程']);
  assert.deepEqual(visible(['page:rd-knowledge-base']).map(group => group.label), ['知识库']);
  assert.deepEqual(visible(['page:production-execution']).map(group => group.label), ['订单与仓储', '生产与质量']);
  assert.deepEqual(visible([]), []);
  const hidden = metadata.map(item => item.code === 'page:purchase-orders' ? { ...item, navHidden: true } : item);
  assert.deepEqual(buildVisibleNavigation(navGroups, ['page:purchase-orders'], hidden), []);
  assert.equal(catalog.find(item => item.code === 'page:purchase-order-detail').groupLabel, '页面访问 · 供应链管理');
});

test('renamed collapsed categories retain preferences and obsolete labels are removed', () => {
  const labels = navGroups.map(group => group.label);
  assert.deepEqual([...initialCollapsedGroups(labels, '生产与质量', JSON.stringify(['质量与生产', '文件与知识', '订单与库存', '信息流转', '不存在']))], ['生产与质量', '注册与关务', '订单与仓储', '客户服务']);
  assert.deepEqual([...initialCollapsedGroups(labels, '生产与质量', '[]')], []);
  assert.equal(initialCollapsedGroups(labels, '生产与质量', null).has('生产与质量'), false);
});

test('role permission tree uses new modules and retains every grant without treating actions as pages', () => {
  const source = read('src/app/RoleManagement.tsx');
  const start = source.indexOf('function moduleOf(');
  const end = source.indexOf('// ── 中美协同');
  const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const build = new Function(`${code}\nreturn buildPermissionModules;`)();
  const groups = new Map();
  for (const item of catalog) {
    if (!groups.has(item.groupLabel)) groups.set(item.groupLabel, { label: item.groupLabel, permissions: [] });
    groups.get(item.groupLabel).permissions.push(item);
  }
  const modules = build([...groups.values()]);
  const page = code => modules.find(module => module.pages.some(node => node.page.code === code));
  assert.equal(page('page:purchase-orders').name, '供应链管理');
  assert.equal(page('page:electronic-gate').name, '生产与质量');
  assert.equal(page('page:rd-knowledge-base').name, '知识库');
  assert.equal(page('page:manual').name, '帮助与教程');
  assert.equal(page('attendance:import'), undefined);
  const owner = code => modules.find(module => module.sharedActions.some(item => item.code === code) || module.pages.some(node => node.actions.some(item => item.code === code)));
  for (const code of ['warehouse:issue', 'warehouse:receive', 'warehouse:count']) assert.equal(owner(code).name, '订单与仓储');
  assert.equal(owner('after-sales:create').name, '客户服务');
  assert.equal(owner('attendance:import').name, '人事与行政');
  const grants = modules.flatMap(module => [...module.sharedActions, ...module.pages.flatMap(node => [node.page, ...node.actions])]).map(item => item.code);
  assert.deepEqual([...new Set(grants)].sort(), catalog.map(item => item.code).sort());
  assert.equal(grants.length, catalog.length);
});

test('catalog migration updates old entries, preserves grants/custom fields and is repeatable', () => {
  // Execute the portable UPDATE/CASE SQL against an isolated SQLite database.
  // Production uses PostgreSQL; this validates data effects without contacting it.
  const sql = read('apps/api/prisma/migrations/20260929120000_reclassify_navigation_catalog/migration.sql');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE PermissionCatalogItem (code TEXT PRIMARY KEY, groupLabel TEXT, label TEXT, sortOrder INTEGER, routePath TEXT, enabled INTEGER, navHidden INTEGER, updatedAt TEXT); CREATE TABLE Role (id TEXT, permissions TEXT);');
    const insert = db.prepare('INSERT INTO PermissionCatalogItem VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const rows = [
      ['page:purchase-orders', '页面访问 · 订单与库存', '采购订单', 265, '/custom-purchases', 0, 1, 'before'],
      ['page:electronic-gate', '页面访问 · 系统管理', '电子闸门', 975, '/electronic-gate', 1, 0, 'before'],
      ['page:rd-my-workspace', '页面访问 · 研发任务管理', '个人工作台', 60, '/rd-my-workspace', 1, 0, 'before'],
      ['page:proc-my-workspace', '页面访问 · 供应链管理', '供应链个人工作台', 46, '/proc-my-workspace', 1, 0, 'before'],
      ['page:manual', '页面访问 · 系统管理', '企业自定义手册', 17, '/custom-manual', 1, 1, 'before'],
      ['custom:page', '页面访问 · 系统管理', '客户自建', 11, '/custom', 1, 0, 'before'],
    ];
    rows.forEach(row => insert.run(...row));
    const grants = JSON.stringify(['page:purchase-orders', 'page:electronic-gate', 'proc-purchase-order:receive']);
    db.prepare('INSERT INTO Role VALUES (?, ?)').run('existing-role', grants);
    db.exec(sql);
    const get = code => ({ ...db.prepare('SELECT * FROM PermissionCatalogItem WHERE code = ?').get(code) });
    for (const code of ['page:purchase-orders', 'page:electronic-gate', 'page:rd-my-workspace', 'page:proc-my-workspace']) {
      const expected = catalog.find(item => item.code === code);
      assert.equal(get(code).groupLabel, expected.groupLabel);
      assert.equal(get(code).label, expected.label);
      assert.equal(get(code).sortOrder, expected.sortOrder);
    }
    assert.equal(get('page:purchase-orders').routePath, '/custom-purchases');
    assert.equal(get('page:purchase-orders').enabled, 0);
    assert.equal(get('page:purchase-orders').navHidden, 1);
    assert.equal(get('page:manual').label, '企业自定义手册');
    assert.equal(get('page:manual').sortOrder, 17);
    assert.equal(get('custom:page').updatedAt, 'before');
    assert.equal(db.prepare('SELECT permissions FROM Role').get().permissions, grants);
    const snapshot = () => db.prepare('SELECT code, groupLabel, label, sortOrder, routePath, enabled, navHidden FROM PermissionCatalogItem ORDER BY code').all();
    const first = snapshot(); db.exec(sql); assert.deepEqual(snapshot(), first);
  } finally { db.close(); }
});
