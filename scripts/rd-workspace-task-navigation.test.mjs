import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/app/RDMyWorkspacePage.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('RDMyWorkspacePage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const workspace = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'RDMyWorkspacePage');
assert.ok(workspace?.body, '真实研发工作台组件存在');

function matchingNodes(root, predicate) {
  const found = [];
  function visit(node) {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(root);
  return found;
}

function compileExpression(expression, scope) {
  const code = ts.transpileModule(`return (${expression.getText(ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText;
  return new Function(...Object.keys(scope), code)(...Object.values(scope));
}

function binding(name, scope) {
  const nodes = matchingNodes(workspace.body, node => ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name);
  assert.equal(nodes.length, 1, `${name} 必须唯一，避免测试提取了其他组件的同名实现`);
  return compileExpression(nodes[0].initializer, scope);
}

// Execute the shipped handler, supplying only router, state and read-cursor effects.
// No API module, browser session or business database is loaded by these tests.
function navigationHarness(area = 'rd', search = '?status=in_progress&role=collaborator') {
  const calls = { navigations: [], panels: [], notesRead: [], unreadRefreshes: 0, searchUpdates: [] };
  const pathname = area === 'us-collab' ? '/us-collab-my-workspace' : area === 'production' ? '/production-my-workspace' : '/rd-my-workspace';
  const scope = {
    isUsCollabWorkspace: () => area === 'us-collab',
    isProductionWorkspace: () => area === 'production',
    location: { pathname, search, hash: '', state: null },
    searchParams: new URLSearchParams(search),
    navigate: (path, options) => calls.navigations.push({ path, options }),
    setActivePanel: panel => calls.panels.push(panel),
    markRdTaskNotesRead: async taskId => { calls.notesRead.push(taskId); },
    refreshNoteUnread: async () => { calls.unreadRefreshes++; },
    setSearchParams: (params, options) => calls.searchUpdates.push({ search: params.toString(), options }),
  };
  scope.openTask = binding('openTask', scope);
  return { calls, scope };
}

const localTask = { task_id: 'RD/2026 A', title: '阀体验证', source_workspace: 'rd', status: 'in_progress' };
const drainPromises = () => new Promise(resolve => setImmediate(resolve));

test('本地研发详情和讨论打开正式详情页，保留工作台来源与筛选参数', () => {
  for (const [tab, suffix] of [['detail', ''], ['discussion', '?tab=conversation']]) {
    const { calls, scope } = navigationHarness();
    scope.openTask(localTask, tab);
    assert.deepEqual(calls.navigations, [{
      path: `/rd-task/RD%2F2026%20A${suffix}`,
      options: { state: { task: localTask, rdWorkspaceReturn: '/rd-my-workspace?status=in_progress&role=collaborator' }, replace: false },
    }]);
    assert.deepEqual(calls.panels, [], `${tab} 不应再次打开工作台任务抽屉`);
  }
});

test('未标 source_workspace 的本地研发任务沿用正式详情入口', () => {
  const { source_workspace: _, ...task } = localTask;
  const { calls, scope } = navigationHarness('rd', '');
  scope.openTask(task, 'detail');
  assert.equal(calls.navigations[0]?.path, '/rd-task/RD%2F2026%20A');
  assert.equal(calls.navigations[0]?.options.state.rdWorkspaceReturn, '/rd-my-workspace');
  assert.deepEqual(calls.panels, []);
});

test('进度、协同、完成和工作项设置仍打开对应独立操作，保留留痕已读刷新', async () => {
  for (const tab of ['progress', 'handoff', 'submit', 'settings']) {
    const { calls, scope } = navigationHarness();
    scope.openTask(localTask, tab);
    await drainPromises();
    assert.deepEqual(calls.navigations, []);
    assert.equal(calls.panels.length, 1);
    assert.equal(calls.panels[0].kind, 'task');
    assert.equal(calls.panels[0].task, localTask);
    assert.equal(calls.panels[0].tab, tab);
    assert.equal(typeof calls.panels[0].openedAt, 'number');
    assert.deepEqual(calls.notesRead, [localTask.task_id]);
    assert.equal(calls.unreadRefreshes, 1);
  }
});

test('转采购和放弃选项优先于详情导航，仍携带原操作意图打开抽屉', () => {
  for (const opts of [{ transfer: true }, { abandon: true }]) {
    const { calls, scope } = navigationHarness();
    scope.openTask(localTask, 'detail', opts);
    assert.deepEqual(calls.navigations, []);
    assert.equal(calls.panels.length, 1);
    assert.equal(calls.panels[0].task, localTask);
    for (const [key, value] of Object.entries(opts)) assert.equal(calls.panels[0][key], value);
  }
});

test('中美协同和生产的详情/讨论保持原操作抽屉', () => {
  for (const area of ['us-collab', 'production']) {
    for (const tab of ['detail', 'discussion']) {
      const { calls, scope } = navigationHarness(area);
      const task = { ...localTask, source_workspace: area === 'us-collab' ? 'us-collab' : 'rd' };
      scope.openTask(task, tab);
      assert.deepEqual(calls.navigations, [], `${area}/${tab}`);
      assert.equal(calls.panels.length, 1);
      assert.equal(calls.panels[0].tab, tab);
    }
  }
});

test('跨池任务始终进入来源任务页，不把本地操作或返回来源注入另一工作区', () => {
  for (const [area, sourceWorkspace, detailPath] of [['rd', 'us-collab', '/us-collab-task'], ['us-collab', 'rd', '/rd-task']]) {
    for (const [tab, opts] of [['detail'], ['discussion'], ['progress'], ['detail', { transfer: true }]]) {
      const { calls, scope } = navigationHarness(area);
      const task = { ...localTask, source_workspace: sourceWorkspace };
      scope.openTask(task, tab, opts);
      assert.deepEqual(calls.navigations, [{ path: `${detailPath}/RD%2F2026%20A`, options: { state: { task } } }]);
      assert.deepEqual(calls.panels, []);
    }
  }
});

test('通知的任务按钮复用统一分派，详情导航和进度抽屉均不绕过 openTask', () => {
  const notification = matchingNodes(workspace.body, node => (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(ast) === 'NotificationDrawer');
  assert.equal(notification.length, 1);
  const attribute = notification[0].attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(ast) === 'onOpenTask');
  assert.ok(attribute?.initializer && ts.isJsxExpression(attribute.initializer));
  for (const tab of ['detail', 'discussion', 'progress']) {
    const { calls, scope } = navigationHarness();
    const forwarded = [];
    const handler = compileExpression(attribute.initializer.expression, { ...scope, openTask: (...args) => { forwarded.push(args); scope.openTask(...args); } });
    handler(localTask, tab);
    assert.deepEqual(forwarded, [[localTask, tab]], '通知必须经过统一路由/抽屉分派');
    assert.equal(calls.navigations.length, Number(tab !== 'progress'));
    assert.equal(calls.panels.length, Number(tab === 'progress'));
  }
});

function taskDeepLinkEffect(scope) {
  const effects = matchingNodes(workspace.body, node => ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('searchParams.get("task")'));
  assert.equal(effects.length, 1, '任务深链 effect 必须唯一');
  return compileExpression(effects[0].arguments[0], scope);
}

test('研发 ?task= 深链只导航一次，避免清 query 把详情导航覆盖回工作台', () => {
  const { calls, scope } = navigationHarness('rd', '?task=RD%2F2026+A&status=in_progress&role=collaborator');
  taskDeepLinkEffect({ ...scope, allTasks: [localTask] })();
  assert.equal(calls.navigations.length, 1);
  assert.equal(calls.navigations[0].path, '/rd-task/RD%2F2026%20A');
  assert.equal(calls.navigations[0].options.replace, true, '浏览器后退不应再次经过同一任务深链');
  assert.deepEqual(calls.searchUpdates, [], '详情跳转后不能再执行工作台 setSearchParams');
  assert.deepEqual(calls.panels, []);
  const returnPath = new URL(calls.navigations[0].options.state.rdWorkspaceReturn, 'https://local.invalid');
  assert.equal(returnPath.pathname, '/rd-my-workspace');
  assert.equal(returnPath.searchParams.get('task'), null, '返回工作台不应再次触发同一任务深链');
  assert.equal(returnPath.searchParams.get('status'), 'in_progress');
  assert.equal(returnPath.searchParams.get('role'), 'collaborator');
});

test('协同深链仍打开抽屉并仅清 task，未知任务或未加载数据不触发操作', () => {
  const task = { ...localTask, source_workspace: 'us-collab' };
  const { calls, scope } = navigationHarness('us-collab', '?task=RD%2F2026+A&status=in_progress');
  taskDeepLinkEffect({ ...scope, allTasks: [task] })();
  assert.deepEqual(calls.navigations, []);
  assert.equal(calls.panels[0]?.task, task);
  assert.deepEqual(calls.searchUpdates, [{ search: 'status=in_progress', options: { replace: true } }]);
  for (const search of ['', '?task=unknown', '?task=RD%2F2026+A']) {
    const idle = navigationHarness('rd', search);
    taskDeepLinkEffect({ ...idle.scope, allTasks: [] })();
    assert.deepEqual(idle.calls.navigations, []);
    assert.deepEqual(idle.calls.panels, []);
    assert.deepEqual(idle.calls.searchUpdates, []);
  }
});

test('主责/协助筛选保留独立集合，显示排序不改变原任务数组', () => {
  const primary = [{ task_id: 'RD-2' }, { task_id: 'RD-1' }];
  const assisting = [{ task_id: 'RD-4' }, { task_id: 'RD-3' }];
  for (const [taskRoleTab, expected] of [['primary', ['RD-1', 'RD-2']], ['collaborator', ['RD-3', 'RD-4']]]) {
    const actual = binding('filteredRoleTasks', {
      taskRoleTab, filteredMyTasks: primary, filteredCollabTasks: assisting,
      compareWorkspaceTasks: (a, b) => a.task_id.localeCompare(b.task_id),
      useMemo: compute => compute(),
    });
    assert.deepEqual(actual.map(task => task.task_id), expected);
  }
  assert.deepEqual(primary.map(task => task.task_id), ['RD-2', 'RD-1']);
  assert.deepEqual(assisting.map(task => task.task_id), ['RD-4', 'RD-3']);
});

const drawer = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'TaskOperationDrawer');
assert.ok(drawer?.body);
const jsx = (type, props, ...children) => ({ type, props: { ...props, children } });
const renderedNodes = tree => Array.isArray(tree) ? tree.flatMap(renderedNodes) : tree && typeof tree === 'object' ? [tree, ...renderedNodes(tree.props?.children)] : [];
const renderedText = tree => Array.isArray(tree) ? tree.map(renderedText).join('') : typeof tree === 'string' ? tree : tree && typeof tree === 'object' ? renderedText(tree.props?.children) : '';

function drawerHeader(area, tab, completed = false) {
  const changes = [];
  const scope = {
    React: { createElement: jsx, Fragment: 'Fragment' },
    t: value => value,
    cn: (...classes) => classes.filter(Boolean).join(' '),
    Button: 'Button', FlowSteps: 'FlowSteps', CheckCircle2: 'CheckCircle2',
    FileText: 'FileText', MessageSquare: 'MessageSquare', RefreshCw: 'RefreshCw', GitBranch: 'GitBranch', Send: 'Send',
    directTaskChanges: area === 'rd', directChangePending: false,
    isTaskCompleted: completed, discussionUnread: 2, tab, flowSteps: [], task: localTask,
    setTab: value => changes.push(['tab', value]),
    setReceipt: value => changes.push(['receipt', value]),
  };
  const configs = matchingNodes(drawer.body, node => ts.isVariableDeclaration(node) && node.name.getText(ast) === 'tabConfig');
  assert.equal(configs.length, 1);
  scope.tabConfig = compileExpression(configs[0].initializer, scope);
  const headers = matchingNodes(drawer.body, node => ts.isJsxExpression(node) && node.expression && ts.isConditionalExpression(node.expression) && node.expression.condition.getText(ast) === 'isTaskCompleted');
  assert.equal(headers.length, 1, '提取真实抽屉操作头部，避免另写一份显示算法');
  const shell = matchingNodes(drawer.body, node => ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === 'DrawerShell');
  assert.equal(shell.length, 1);
  const title = shell[0].attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(ast) === 'title');
  return { tree: compileExpression(headers[0].expression, scope), title: compileExpression(title.initializer.expression, scope), changes };
}

test('研发操作抽屉显示当前操作标题，不渲染重复的五个切换按钮', () => {
  for (const [tab, title] of [['progress', '更新进度'], ['handoff', '移交协作'], ['submit', '提交结果'], ['settings', '任务设置']]) {
    const header = drawerHeader('rd', tab);
    assert.equal(header.title, title);
    assert.deepEqual(renderedNodes(header.tree).filter(node => node.type === 'Button'), []);
    assert.equal(renderedNodes(header.tree).some(node => node.type === 'FlowSteps'), tab !== 'settings');
  }
});

test('中美协同仍显示五个操作入口，切换讨论保留原点击行为', () => {
  const header = drawerHeader('us-collab', 'progress');
  assert.equal(header.title, localTask.title);
  const buttons = renderedNodes(header.tree).filter(node => node.type === 'Button');
  assert.deepEqual(buttons.map(renderedText), ['任务详情', '任务讨论', '更新进度', '移交协作', '提交结果']);
  buttons[1].props.onClick();
  assert.deepEqual(header.changes, [['tab', 'discussion'], ['receipt', null]]);
});

test('已完成任务头部保留只读提示并隐藏操作切换', () => {
  for (const area of ['rd', 'us-collab']) {
    const header = drawerHeader(area, 'settings', true);
    assert.match(renderedText(header.tree), /任务已完成，以下内容仅供回看。/);
    assert.deepEqual(renderedNodes(header.tree).filter(node => node.type === 'Button'), []);
  }
});

const filterReader = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'readWorkspaceTaskFilters');
assert.ok(filterReader, '使用正式 URL 筛选解析器');
const readWorkspaceTaskFilters = compileExpression(filterReader, {});
const defaultFilters = { keyword: '', priority: 'all', status: 'all', due: 'all', role: 'primary' };

test('URL 筛选恢复有效关键词、优先级、状态、截止日期与协助角色', () => {
  const values = {
    priority: ['high', 'medium', 'low'],
    status: ['in_progress', 'pending_review', 'paused_blocked', 'paused_leave', 'completed'],
    due: ['overdue', 'today', '3d', '7d', 'no_due'],
  };
  for (const [key, options] of Object.entries(values)) {
    for (const value of options) {
      const params = new URLSearchParams({ keyword: '阀体 / A+B', role: 'collaborator', [key]: value, sampleTest: 'proc/2' });
      assert.deepEqual(readWorkspaceTaskFilters(params), { ...defaultFilters, keyword: '阀体 / A+B', role: 'collaborator', [key]: value });
    }
  }
});

test('缺省和非法 URL 筛选使用安全默认值，不接受未知枚举或相似角色名', () => {
  for (const query of ['', 'priority=all&status=all&due=all&role=primary', 'priority=urgent&status=deleted&due=30d&role=collab', 'priority=HIGH&status=COMPLETED&due=TODAY&role=admin', 'priority=&status=&due=&role=']) {
    assert.deepEqual(readWorkspaceTaskFilters(new URLSearchParams(query)), defaultFilters, query);
  }
});

function filterHarness(area, search) {
  const calls = { search: [], local: [] };
  let params = new URLSearchParams(search);
  let local = { ...defaultFilters, keyword: '本地关键词', priority: 'medium' };
  const scope = {
    nativeResearchWorkspace: area === 'rd', searchParams: params, localTaskFilters: local, readWorkspaceTaskFilters,
    setSearchParams: (next, options) => {
      params = typeof next === 'function' ? next(params) : new URLSearchParams(next);
      calls.search.push({ params: new URLSearchParams(params), options });
    },
    setLocalTaskFilters: next => {
      local = typeof next === 'function' ? next(local) : next;
      calls.local.push(local);
    },
  };
  scope.updateTaskFilters = binding('updateTaskFilters', scope);
  return { calls, scope, params: () => params, local: () => local };
}

test('两个清空筛选入口一次清除全部筛选，保留协助角色和样品测试深链', () => {
  const buttons = matchingNodes(workspace.body, node => ts.isJsxOpeningElement(node) && node.tagName.getText(ast) === 'Button');
  const handlers = buttons.flatMap(button => button.attributes.properties.filter(node => ts.isJsxAttribute(node) && node.name.getText(ast) === 'onClick'))
    .map(attribute => attribute.initializer?.expression)
    .filter(expression => expression && matchingNodes(expression, node => ts.isCallExpression(node) && node.expression.getText(ast) === 'updateTaskFilters').length > 0);
  assert.equal(handlers.length, 2, '筛选栏和空态的两个真实清空按钮');
  for (const expression of handlers) {
    const f = filterHarness('rd', 'keyword=%E9%98%80%E4%BD%93&priority=high&status=paused_blocked&due=3d&role=collaborator&sampleTest=proc%2F2');
    compileExpression(expression, { ...f.scope, taskFiltersActive: true, loadWorkspace: () => assert.fail('清空筛选不重新拉取业务数据') })();
    assert.equal(f.calls.search.length, 1, '一次合并更新，避免多个 setSearchParams 相互覆盖');
    assert.deepEqual(f.calls.search[0].options, { replace: true });
    assert.deepEqual([...f.params()], [['role', 'collaborator'], ['sampleTest', 'proc/2']]);
    assert.deepEqual(readWorkspaceTaskFilters(f.params()), { ...defaultFilters, role: 'collaborator' });
    assert.deepEqual(f.calls.local, []);
  }
});

test('研发筛选来自 URL，协同和生产仍使用本地筛选且不修改 URL', () => {
  const search = 'keyword=URL&priority=high&role=collaborator&sampleTest=proc%2F2';
  for (const area of ['rd', 'us-collab', 'production']) {
    const f = filterHarness(area, search);
    assert.deepEqual(binding('taskFilters', f.scope), area === 'rd'
      ? { ...defaultFilters, keyword: 'URL', priority: 'high', role: 'collaborator' }
      : { ...defaultFilters, keyword: '本地关键词', priority: 'medium' });
    f.scope.updateTaskFilters({ keyword: '', priority: 'all', status: 'all', due: 'all' });
    if (area === 'rd') {
      assert.equal(f.calls.search.length, 1);
      assert.deepEqual(f.calls.local, []);
    } else {
      assert.deepEqual(f.calls.search, []);
      assert.deepEqual(f.local(), defaultFilters);
      assert.equal(f.params().toString(), search);
    }
  }
});

test('设置内查看正式详情复用 openTask，保留同一工作台和全部有效筛选', () => {
  const invocation = matchingNodes(workspace.body, node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'TaskOperationDrawer');
  assert.equal(invocation.length, 1);
  const attribute = invocation[0].attributes.properties.find(node => ts.isJsxAttribute(node) && node.name.getText(ast) === 'onViewDetail');
  assert.ok(attribute?.initializer?.expression);
  const handlers = matchingNodes(drawer.body, node => ts.isJsxAttribute(node) && node.name.getText(ast) === 'onClick' && node.initializer?.expression && matchingNodes(node.initializer.expression, child => ts.isCallExpression(child) && child.expression.getText(ast) === 'onViewDetail').length > 0);
  assert.equal(handlers.length, 1, '使用设置内真实查看详情按钮');
  const { calls, scope } = navigationHarness('rd', '?keyword=%E9%98%80%E4%BD%93&priority=high&status=in_progress&due=3d&role=collaborator');
  const onViewDetail = compileExpression(attribute.initializer.expression, { ...scope, activePanel: { kind: 'task', task: localTask, tab: 'settings' } });
  compileExpression(handlers[0].initializer.expression, { onViewDetail, navigate: () => assert.fail('不得绕过工作台导航丢失返回来源'), task: localTask })();
  assert.equal(calls.navigations[0]?.path, '/rd-task/RD%2F2026%20A');
  assert.equal(calls.navigations[0]?.options.state.rdWorkspaceReturn, '/rd-my-workspace?keyword=%E9%98%80%E4%BD%93&priority=high&status=in_progress&due=3d&role=collaborator');
  assert.deepEqual(calls.panels, []);
});
