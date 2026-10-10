import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { matchPath } from 'react-router';
import ts from 'typescript';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function load(file, dependencies = {}, globals = {}) {
  const exports = {};
  new Function('exports', 'require', ...Object.keys(globals), compile(read(file)))(exports, id => {
    assert.ok(id in dependencies, `Unexpected dependency: ${id}`);
    return dependencies[id];
  }, ...Object.values(globals));
  return exports;
}
function loadRoutes(overrides = {}) {
  const paths = load('src/app/lib/routePaths.ts', {}, {
    localStorage: { getItem: () => JSON.stringify(overrides) },
  });
  return load('src/app/routesConfig.tsx', {
    'lucide-react': new Proxy({}, { get: (_target, name) => name }),
    './lib/routePaths': paths,
  });
}
const routes = loadRoutes();
const { navGroups, HR_PREVIEW_PERMISSIONS, withHrPreviewNavigation, isNavItemActive } = routes;
const { hrModules } = load('src/mocks/hrPreview.ts');
const permissionsApi = load('src/app/lib/permissions.ts');
const { buildVisibleNavigation } = load('src/app/lib/useVisibleNavigation.ts', {
  react: {}, '../auth': {}, '../routesConfig': routes, './permissionCatalogApi': {}, './permissions': permissionsApi,
});
const allItems = groups => groups.flatMap(group => group.items);
const isHrPreview = item => item.path === '/__preview/hr' || item.path.startsWith('/__preview/hr/');
const previewItems = groups => allItems(groups).filter(isHrPreview);
const previewGroups = withHrPreviewNavigation(navGroups);
const previewPaths = ['/__preview/hr', ...hrModules.map(module => `/__preview/hr/${module.id}`)];
const originalHr = navGroups.find(group => group.label === '人事与行政');

test('HR 工作台与 25 个业务入口对应真实模块，生产 74 项及原 HR 入口保持不变', () => {
  const before = JSON.stringify(navGroups);
  const augmented = withHrPreviewNavigation(navGroups);
  assert.equal(hrModules.length, 25);
  assert.equal(allItems(navGroups).length, 74);
  assert.equal(previewItems(navGroups).length, 0);
  assert.equal(allItems(augmented).length, 100);
  assert.equal(new Set(allItems(augmented).map(item => item.path)).size, 100);
  assert.equal(JSON.stringify(navGroups), before, 'adding local navigation must not mutate production definitions');
  assert.deepEqual(augmented.map(group => group.label), navGroups.map(group => group.label));
  assert.deepEqual(previewItems(augmented).map(item => item.path), previewPaths);
  assert.equal(previewItems(augmented)[0].label, '人事工作台');
  assert.equal(previewItems(augmented)[0].exact, true);
  for (const module of hrModules) {
    const item = previewItems(augmented).find(item => item.path === `/__preview/hr/${module.id}`);
    assert.equal(item.label, module.title, module.id);
    assert.ok(item.section, `${module.id} retains a readable HR category`);
  }
  const hr = augmented.find(group => group.label === '人事与行政');
  assert.equal(previewItems([hr]).length, 26, 'all local pages belong to the existing HR group');
  assert.equal(originalHr.items.length, 5);
  assert.deepEqual(HR_PREVIEW_PERMISSIONS, originalHr.items.map(item => item.requiredPermission));
  for (const original of allItems(navGroups)) {
    const { section: _section, ...retained } = allItems(augmented).find(item => item.path === original.path);
    assert.deepEqual(retained, original, original.path);
  }
});

test('页面路由管理的五个 HR 自定义地址保留，演示入口不覆盖既有地址', () => {
  const overrides = Object.fromEntries(originalHr.items.map((item, index) => [item.requiredPermission, `/custom-hr/page-${index}`]));
  const custom = loadRoutes(overrides);
  const augmented = custom.withHrPreviewNavigation(custom.navGroups);
  assert.deepEqual(previewItems(augmented).map(item => item.path), previewPaths);
  for (const original of originalHr.items) {
    const customPath = overrides[original.requiredPermission];
    const item = allItems(augmented).find(item => item.requiredPermission === original.requiredPermission);
    assert.equal(item.path, customPath);
    assert.equal(item.label, original.label);
    assert.equal(custom.routePermissionMap[customPath], original.requiredPermission);
    assert.equal(custom.routeTitleMap[customPath], original.label);
    assert.ok(custom.isNavItemActive(item, `${customPath}/detail-1`));
    assert.equal(allItems(augmented).some(item => item.path === original.path), false);
  }
});

test('任一 HR 页面权限显示全套演示页，无 HR 权限时不显示', () => {
  for (const permission of HR_PREVIEW_PERMISSIONS) {
    const visible = buildVisibleNavigation(previewGroups, [permission], []);
    assert.deepEqual(previewItems(visible).map(item => item.path), previewPaths, permission);
    assert.deepEqual(allItems(visible).filter(item => !isHrPreview(item)).map(item => item.requiredPermission), [permission]);
  }
  assert.deepEqual(previewItems(buildVisibleNavigation(previewGroups, [], [])), []);
  assert.deepEqual(previewItems(buildVisibleNavigation(previewGroups, ['page:meeting'], [])), []);
  assert.equal(previewItems(buildVisibleNavigation(previewGroups, ['*'], [])).length, 26);
});

test('目录隐藏与已授予权限共同约束 HR 聚合入口，全部隐藏时管理员也不展示', () => {
  const hidden = HR_PREVIEW_PERMISSIONS.map(code => ({ code, navHidden: true }));
  for (const grants of [HR_PREVIEW_PERMISSIONS, ['*']]) {
    assert.equal(previewItems(buildVisibleNavigation(previewGroups, grants, hidden)).length, 0);
  }
  const oneVisible = hidden.map((item, index) => ({ ...item, navHidden: index !== 1 }));
  assert.equal(previewItems(buildVisibleNavigation(previewGroups, [HR_PREVIEW_PERMISSIONS[0]], oneVisible)).length, 0,
    'an unhidden permission that the user lacks cannot expose the aggregate');
  assert.equal(previewItems(buildVisibleNavigation(previewGroups, [HR_PREVIEW_PERMISSIONS[1]], oneVisible)).length, 26);
  assert.equal(previewItems(buildVisibleNavigation(previewGroups, ['*'], oneVisible)).length, 26);
});

test('每个 HR 地址只激活一个入口，首页不抢占子页且相似前缀不误匹配', () => {
  const items = allItems(previewGroups);
  const activePaths = pathname => items.filter(item => isNavItemActive(item, pathname)).map(item => item.path);
  for (const path of previewPaths) {
    assert.deepEqual(activePaths(path), [path], path);
    assert.deepEqual(activePaths(`${path}/`), [path], `${path}/`);
  }
  for (const path of previewPaths.slice(1)) {
    assert.deepEqual(activePaths(`${path}/detail-1`), [path]);
    assert.deepEqual(activePaths(`${path}-other`), []);
  }
  assert.deepEqual(activePaths('/__preview/hr-other'), []);
  assert.deepEqual(activePaths('/__preview/hr/unknown-module'), []);
});

test('自定义入口及别名尾斜杠不影响高亮，精确入口不匹配子页', () => {
  const item = { label: '自定义档案', path: '/custom-archive/', matchPaths: ['/archive-alias/'] };
  for (const path of ['/custom-archive', '/custom-archive/', '/custom-archive/detail-1', '/archive-alias/', '/archive-alias/detail-1']) {
    assert.equal(isNavItemActive(item, path), true, path);
  }
  assert.equal(isNavItemActive(item, '/custom-archive-other'), false);
  assert.equal(isNavItemActive({ ...item, exact: true }, '/custom-archive/'), true);
  assert.equal(isNavItemActive({ ...item, exact: true }, '/custom-archive/detail-1'), false);
  assert.equal(isNavItemActive({ path: '/', exact: true }, '/'), true);
  assert.equal(isNavItemActive({ path: '/', exact: true }, '/custom-archive'), false);
});

test('导航 hook 默认使用生产菜单，仅显式开启 HR 后加入并继续执行权限隐藏', () => {
  let user = { id: 'hr-demo', permissions: [HR_PREVIEW_PERMISSIONS[0]] };
  let metadata = [];
  const { useVisibleNavigation } = load('src/app/lib/useVisibleNavigation.ts', {
    react: { useMemo: callback => callback() },
    '../auth': { useAuth: () => ({ user }) },
    '../routesConfig': routes,
    './permissions': permissionsApi,
    './permissionCatalogApi': { useNavMeta: () => metadata },
  });
  assert.equal(previewItems(useVisibleNavigation()).length, 0);
  assert.equal(previewItems(useVisibleNavigation(false)).length, 0);
  assert.equal(previewItems(useVisibleNavigation(true)).length, 26);
  metadata = [{ code: HR_PREVIEW_PERMISSIONS[0], navHidden: true }];
  assert.equal(previewItems(useVisibleNavigation(true)).length, 0);
  metadata = [];
  user = { id: 'other', permissions: ['page:meeting'] };
  assert.equal(previewItems(useVisibleNavigation(true)).length, 0);
  user = null;
  assert.deepEqual(useVisibleNavigation(true), []);
});

const appSource = read('src/app/App.tsx');
const appAst = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function descendants(node, predicate) {
  const found = [];
  function visit(current) { if (predicate(current)) found.push(current); ts.forEachChild(current, visit); }
  visit(node);
  return found;
}
const property = (node, name) => node.properties.find(item => ts.isPropertyAssignment(item) && item.name.getText(appAst).replace(/^['"]|['"]$/g, '') === name);

test('HR 路由嵌入 ProtectedLayout 子路由并保留页面权限保护', () => {
  const hrRoutes = descendants(appAst, node => {
    if (!ts.isObjectLiteralExpression(node)) return false;
    const path = property(node, 'path')?.initializer;
    return path && ts.isStringLiteral(path) && /^\/?__preview\/hr(?:\/|$)/.test(path.text);
  });
  assert.equal(hrRoutes.length, 1, 'only one HR route should be registered');
  const hrRoute = hrRoutes[0];
  let parent = hrRoute.parent;
  while (parent && !(ts.isObjectLiteralExpression(parent) && property(parent, 'Component')?.initializer.getText(appAst) === 'ProtectedLayout')) parent = parent.parent;
  assert.ok(parent, 'HR must inherit the authenticated application shell instead of being a top-level route');
  const children = property(parent, 'children')?.initializer;
  assert.ok(children && hrRoute.pos >= children.pos && hrRoute.end <= children.end);
  const element = property(hrRoute, 'element')?.initializer;
  assert.ok(element && ts.isCallExpression(element));
  assert.equal(element.expression.getText(appAst), 'makeLazyProtected');
  assert.equal(element.arguments[1]?.getText(appAst), 'HR_PREVIEW_PERMISSIONS');
  assert.ok(descendants(element.arguments[0], node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(appAst) === 'HrPreview').length);
});

test('手机 HR 深链使用同一 Root，且登录与登录恢复守卫仍优先执行', () => {
  const declaration = appAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ProtectedLayout');
  assert.ok(declaration);
  // Execute the real guard; replace only React mounting, environmental hooks and the build-time flag.
  const code = compile(`${declaration.getText(appAst).replaceAll('import.meta.env.DEV', '__DEV__')}\nexports.layout = ProtectedLayout;`);
  const state = { user: { id: 'hr-demo', permissions: HR_PREVIEW_PERMISSIONS }, hydrated: true, mobile: true, dev: true, pathname: '/__preview/hr' };
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    useAuth: () => ({ user: state.user, hydrated: state.hydrated }),
    useLocation: () => ({ pathname: state.pathname, search: '?source=menu', hash: '#record' }),
    useIsMobileViewport: () => state.mobile,
    Root: 'Root', Navigate: 'Navigate',
    ...load('src/app/lib/routePaths.ts', {}, { localStorage: { getItem: () => null } }),
    matchPath, procurementWorkspaceReturnPath: () => undefined, rdWorkspaceForPath: () => 'rd',
  };
  function render() {
    const exports = {};
    new Function('exports', 'require', '__DEV__', ...Object.keys(dependencies), code)(exports, id => {
      assert.equal(id, 'react/jsx-runtime'); return { jsx, jsxs: jsx };
    }, state.dev, ...Object.values(dependencies));
    return exports.layout();
  }
  for (const path of previewPaths) { state.pathname = path; assert.equal(render().type, 'Root', path); }
  state.mobile = false;
  assert.equal(render().type, 'Root');
  state.mobile = true;
  state.dev = false;
  assert.equal(render().type, 'Navigate', 'the development exception must not change production mobile routing');
  state.dev = true;
  state.user = null;
  const login = render();
  assert.equal(login.type, 'Navigate');
  assert.equal(login.props.to, '/login');
  assert.equal(login.props.state.from, `${state.pathname}?source=menu#record`);
  state.hydrated = false;
  assert.equal(render().type, 'div', 'restoring authentication must not briefly expose Root');
});
