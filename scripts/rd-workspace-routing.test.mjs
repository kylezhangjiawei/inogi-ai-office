import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { posix } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { matchPath } from 'react-router';

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Run the real route cache, API client and approval cache; only HTTP and browser
// storage are replaced. No requests or writes leave this in-memory fixture.
function fixture(overrides = {}, pathname = '/rd-task-management') {
  const storage = new Map([['route-paths-v1', JSON.stringify(overrides)]]);
  const localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  const window = { location: { pathname }, dispatchEvent() {} };
  const requests = [], modules = new Map();
  let response = [];
  const stubs = {
    'src/app/lib/authSession.ts': {
      authFetch: async (path, init) => { requests.push({ path, init }); return Response.json(response); },
      readErrorMessage: async () => 'request failed',
      addAuthClearedListener: () => () => {},
    },
    'src/app/lib/resourceImage.ts': {},
  };
  function load(path) {
    if (path in stubs) return stubs[path];
    if (modules.has(path)) return modules.get(path);
    const exports = {};
    modules.set(path, exports);
    const code = ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function('exports', 'require', 'window', 'localStorage', code)(exports, (id) => {
      if (id === 'react-router') return { matchPath };
      assert.ok(id.startsWith('.'), `Unexpected dependency ${id}`);
      return load(posix.join(posix.dirname(path), `${id}.ts`));
    }, window, localStorage);
    return exports;
  }
  return {
    storage, window, requests, load,
    api: load('src/app/lib/rdApi.ts'),
    routes: load('src/app/lib/routePaths.ts'),
    flows: load('src/app/lib/approvalFlowConfig.ts'),
    respond: (payload) => { response = payload; },
  };
}

function cockpitActions(view, permissions) {
  const ast = ts.createSourceFile('RDTaskManagementPage.tsx', source('src/app/RDTaskManagementPage.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const page = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'RDTaskManagementPage');
  assert.ok(page?.body, 'Missing cockpit component');
  const names = ['usCollab', 'productionWorkspace', 'nativeRdCockpit', 'peopleManagementPath', 'canManagePeople', 'canReassignTasks', 'canViewCombinedMemberTasks', 'canSyncProductionPermission', 'canSyncProduction'];
  const declarations = page.body.statements.filter(ts.isVariableStatement)
    .flatMap((node) => [...node.declarationList.declarations])
    .filter((node) => names.includes(node.name.getText(ast)));
  assert.equal(declarations.length, names.length, 'Missing cockpit action dependency');
  let peopleAction;
  const visit = (node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'onOpenPeople') {
      assert.equal(peopleAction, undefined, 'Expected one people-management entry');
      assert.ok(node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression);
      peopleAction = node.initializer.expression.getText(ast);
    }
    ts.forEachChild(node, visit);
  };
  visit(page);
  assert.ok(peopleAction, 'Missing people-management entry');
  // Execute the real page's derived actions and navigation callback, with the
  // same route/API fixture as above; no rendering or business logic is copied.
  const code = ts.transpileModule(`${declarations.map((node) => `const ${node.getText(ast)};`).join('\n')}
    return { nativeRdCockpit, canViewCombinedMemberTasks, canSyncProduction, onOpenPeople: ${peopleAction} };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const navigation = [];
  const dependencies = {
    location: view.window.location,
    isUsCollabWorkspace: view.api.isUsCollabWorkspace,
    isProductionWorkspace: view.api.isProductionWorkspace,
    PERMISSIONS: view.load('src/app/lib/permissions.ts').PERMISSIONS,
    usePermission: (code) => permissions.includes(code),
    navigate: (path) => navigation.push(path),
  };
  return { ...new Function(...Object.keys(dependencies), code)(...Object.values(dependencies)), navigation };
}

for (const scenario of [
  { label: '默认研发', path: '/rd-task-management', workspace: null, peoplePath: '/rd-people-management', rdActions: true },
  { label: '默认协同', path: '/us-collab-cockpit', workspace: 'us-collab', peoplePath: '/us-collab-people-management', rdActions: false },
  { label: '自定义协同', path: '/collaboration/cockpit', overrides: { 'page:us-collab-cockpit': '/collaboration/cockpit' }, workspace: 'us-collab', peoplePath: '/us-collab-people-management', rdActions: false },
  { label: '生产', path: '/production-dashboard', workspace: 'production', peoplePath: '/production-people-management', rdActions: false },
]) {
  test(`${scenario.label}驾驶舱人员跳转和研发专属动作跟随真实工作区，并保留权限限制`, () => {
    const view = fixture(scenario.overrides, scenario.path);
    const permissions = view.load('src/app/lib/permissions.ts').PERMISSIONS;
    const granted = [permissions.RD_PEOPLE_MANAGE, permissions.RD_TASK_REASSIGN, permissions.RD_TASK_SYNC_PRODUCTION];
    assert.equal(view.api.currentRdWorkspace(), scenario.workspace);
    const actions = cockpitActions(view, granted);
    assert.equal(typeof actions.onOpenPeople, 'function');
    actions.onOpenPeople();
    assert.deepEqual(actions.navigation, [scenario.peoplePath]);
    assert.equal(actions.nativeRdCockpit, scenario.rdActions);
    assert.equal(actions.canViewCombinedMemberTasks, scenario.rdActions);
    assert.equal(actions.canSyncProduction, scenario.rdActions);
    const denied = cockpitActions(view, []);
    assert.equal(denied.onOpenPeople, undefined);
    assert.deepEqual(denied.navigation, []);
    assert.equal(denied.canViewCombinedMemberTasks, false);
    assert.equal(denied.canSyncProduction, false);
  });
}

test('已保存的自定义协同审批流地址读取、保存均请求协同池，离线缓存不读写研发池', async () => {
  const view = fixture({ 'page:us-collab-approval-flow': '/collaboration-flow' }, '/collaboration-flow');
  view.storage.set('rd-approval-flows-v1', JSON.stringify([{ id: 'rd-only' }]));
  view.storage.set('rd-approval-flows-v1.us-collab', JSON.stringify([{ id: 'us-only' }]));
  await view.api.fetchRdApprovalFlows();
  assert.equal(view.requests.at(-1).path, '/api/research-development/approval-flows?workspace=us-collab');
  assert.deepEqual(view.flows.loadFlows(), [{ id: 'us-only' }]);
  view.respond([{ id: 'us-updated' }]);
  await view.flows.saveFlows([{ id: 'us-updated' }], [{ id: 'us-only' }]);
  assert.equal(view.requests.at(-1).path, '/api/research-development/approval-flows?workspace=us-collab');
  assert.equal(view.requests.at(-1).init.method, 'PUT');
  assert.deepEqual(JSON.parse(view.requests.at(-1).init.body), { flows: [{ id: 'us-updated' }], base_flows: [{ id: 'us-only' }] });
  assert.deepEqual(JSON.parse(view.storage.get('rd-approval-flows-v1')), [{ id: 'rd-only' }]);
  assert.deepEqual(view.flows.loadFlows(), [{ id: 'us-updated' }]);
});

test('四个可配置协同页面随当前路由表识别，查询参数和工作区功能保持一致', async () => {
  const overrides = {
    'page:us-collab-cockpit': '/collaboration/cockpit',
    'page:us-collab-workspace': '/team-work',
    'page:us-collab-approval-flow': '/collaboration-flow',
    'page:us-collab-ai-settings': '/ai-policy',
  };
  const view = fixture(overrides);
  for (const path of Object.values(overrides)) {
    view.window.location.pathname = path;
    assert.equal(view.api.currentRdWorkspace(), 'us-collab', path);
    assert.equal(view.api.isUsCollabWorkspace(), true);
    assert.equal(view.api.workItemsFeatureEnabled(), true);
    await view.api.fetchRdApprovalPools(['rd-project:review-l1']);
    assert.equal(view.requests.at(-1).path, '/api/research-development/approval-pools?permissions=rd-project%3Areview-l1&workspace=us-collab');
  }
  await view.api.fetchRdWorkspace({ includeCollaboration: true });
  assert.equal(view.requests.at(-1).path, '/api/research-development/workspace?workspace=us-collab');
});

test('默认协同页面及固定详情、人员、知识库和移动子路径仍使用协同池', () => {
  const view = fixture();
  for (const path of ['/us-collab-cockpit', '/us-collab-workspace', '/us-collab-approval-flow', '/us-collab-ai-settings/', '/us-collab-task/task-1', '/us-collab-people-management', '/us-collab-kb', '/us-collab-rd-discussion/task-1', '/us-collab-m', '/us-collab-m/task/task-1', '/us-collab-m/discussion/task-1']) {
    view.window.location.pathname = path;
    assert.equal(view.api.currentRdWorkspace(), 'us-collab', path);
  }
});

test('研发、生产及相似前缀页面不会被误分入协同池，已改名的旧地址不再代表原页面', async () => {
  const view = fixture({ 'page:us-collab-cockpit': '/collaboration' });
  for (const path of ['/rd-task-management', '/m/task/rd-1', '/rd-task/rd-1', '/us-collaboration', '/us-collab-cockpit', '/us-collab-cockpit-backup', '/collaboration-backup', '/collaboration/other', '/production-report']) {
    view.window.location.pathname = path;
    assert.equal(view.api.currentRdWorkspace(), null, path);
  }
  await view.api.fetchRdWorkspace({ includeCollaboration: true });
  assert.equal(view.requests.at(-1).path, '/api/research-development/workspace/combined');
  for (const path of ['/production-dashboard', '/production-task/task-1', '/production-people-management', '/production-m/task/task-1']) {
    view.window.location.pathname = path;
    assert.equal(view.api.currentRdWorkspace(), 'production', path);
    await view.api.fetchRdApprovalFlows();
    assert.equal(view.requests.at(-1).path, '/api/research-development/approval-flows?workspace=production');
  }
});

test('导航切回研发后使用研发接口和研发缓存；后台目录刷新不改变当前已挂载路由的身份', async () => {
  const view = fixture({ 'page:us-collab-approval-flow': '/collaboration-flow' }, '/collaboration-flow');
  view.storage.set('rd-approval-flows-v1', JSON.stringify([{ id: 'rd-only' }]));
  view.storage.set('rd-approval-flows-v1.us-collab', JSON.stringify([{ id: 'us-only' }]));
  view.routes.cacheRoutePaths([{ code: 'page:us-collab-approval-flow', routePath: '/new-flow' }]);
  assert.equal(view.api.currentRdWorkspace(), 'us-collab');
  assert.equal(view.routes.routePath('page:us-collab-approval-flow', '/us-collab-approval-flow'), '/collaboration-flow');
  view.window.location.pathname = '/rd-approval-flow';
  assert.deepEqual(view.flows.loadFlows(), [{ id: 'rd-only' }]);
  await view.api.fetchRdApprovalFlows();
  assert.equal(view.requests.at(-1).path, '/api/research-development/approval-flows');
});

test('工作区匹配与实际路由一致，支持编码中文、尾斜杠和不区分大小写', () => {
  const view = fixture({ 'page:us-collab-cockpit': '/协同看板', 'page:us-collab-approval-flow': '/TeamFlow' });
  for (const path of ['/%E5%8D%8F%E5%90%8C%E7%9C%8B%E6%9D%BF', '/协同看板/', '/teamflow', '/TEAMFLOW/']) {
    view.window.location.pathname = path;
    assert.equal(view.api.currentRdWorkspace(), 'us-collab', path);
  }
});

function appFunctions(view) {
  const app = source('src/app/App.tsx');
  const ast = ts.createSourceFile('App.tsx', app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ['ProtectedLayout', 'desktopTargetFromMobileLocation'];
  const functions = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map((node) => node.getText(ast)).join('\n');
  const code = ts.transpileModule(`${functions}\nreturn { ${names.join(', ')} };`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const dependencies = {
    React: { createElement: (type, props) => ({ type, props }) },
    Navigate: 'Navigate', Root: 'Root',
    useAuth: () => ({ user: { id: 'test' }, hydrated: true }),
    useLocation: () => ({ ...view.window.location, search: '?tab=mine', hash: '#task' }),
    useIsMobileViewport: () => true,
    routePath: view.routes.routePath, subRoutePath: view.routes.subRoutePath,
    rdWorkspaceForPath: (path) => view.load('src/app/lib/rdWorkspace.ts').rdWorkspaceForPath(path),
    matchPath: () => null,
    procurementWorkspaceReturnPath: () => null,
  };
  return new Function(...Object.keys(dependencies), code)(...Object.values(dependencies));
}

test('真实移动守卫把自定义协同页转到协同移动页，恢复宽屏仍回配置后的驾驶舱', () => {
  const view = fixture({ 'page:us-collab-cockpit': '/team-board', 'page:us-collab-approval-flow': '/collaboration-flow' }, '/collaboration-flow');
  const app = appFunctions(view);
  assert.equal(app.ProtectedLayout().props.to, '/us-collab-m?tab=mine#task');
  assert.equal(app.desktopTargetFromMobileLocation('/us-collab-m', '?tab=mine', '#task'), '/team-board?tab=mine#task');
  for (const [path, target] of [['/rd-task-management', '/m'], ['/production-dashboard', '/production-m'], ['/rd-director-dashboard', '/production-m']]) {
    view.window.location.pathname = path;
    assert.equal(app.ProtectedLayout().props.to, `${target}?tab=mine#task`);
  }
});
