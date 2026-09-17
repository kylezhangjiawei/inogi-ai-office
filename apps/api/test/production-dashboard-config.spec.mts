import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

import { DEFAULT_PERMISSION_CATALOG } from '../src/modules/permission-catalog/permission-catalog.defaults.ts';

test('production cockpit is visible in Quality & Production without invalidating existing roles', async () => {
  const permission = DEFAULT_PERMISSION_CATALOG.find(
    (item) => item.code === 'page:rd-director-dashboard',
  );

  assert.ok(permission);
  assert.equal(permission.label, '生产驾驶舱');
  assert.equal(permission.groupLabel, '页面访问 · 质量与生产');
  assert.equal(permission.routePath, '/production-dashboard');
  assert.notEqual(permission.navHidden, true);

  const [routesSource, appSource, migrationSource] = await Promise.all([
    readFile(new URL('../../../src/app/routesConfig.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../../src/app/App.tsx', import.meta.url), 'utf8'),
    readFile(
      new URL(
        '../prisma/migrations/20260731174500_align_production_dashboard_navigation/migration.sql',
        import.meta.url,
      ),
      'utf8',
    ),
  ]);

  const productionGroup = routesSource.match(
    /label: "质量与生产",\s*items: \[([\s\S]*?)\r?\n\s*\],\r?\n\s*\},/,
  );
  assert.ok(productionGroup, '质量与生产分组必须存在');
  assert.match(
    productionGroup[1],
    /label: "生产驾驶舱", path: "\/production-dashboard"[\s\S]*requiredPermission: "page:rd-director-dashboard"/,
  );
  assert.doesNotMatch(routesSource, /label: "生产部门"/);
  assert.match(
    appSource,
    /\{ path: "production-dashboard", element: makeLazyProtected\(<ProductionDashboardRoute \/>, "page:rd-director-dashboard"\) \}/,
  );
  assert.match(
    appSource,
    /\{ path: "rd-director-dashboard", element: makeLazyProtected\(<Navigate to="\/production-dashboard" replace \/>/,
  );
  assert.match(migrationSource, /"navHidden" = false/);
  assert.match(migrationSource, /"routePath" = '\/production-dashboard'/);
  assert.match(migrationSource, /"groupLabel" = '页面访问 · 质量与生产'/);
});

test('production cockpit defaults to the formal overview and keeps the existing production workspace behind its legacy entry', async () => {
  const appSource = await readFile(
    new URL('../../../src/app/App.tsx', import.meta.url),
    'utf8',
  );

  const rdRoute = appSource.match(
    /\{ path: asChildPath\(routePath\("page:rd-task-management", "\/rd-task-management"\)\), element: makeLazyProtected\(<RDTaskManagementPage key="([^"]+)" \/>, "page:rd-task-management"\) \}/,
  );
  assert.ok(rdRoute, '研发任务驾驶舱路由必须使用标准驾驶舱页面');
  assert.equal(rdRoute[1], 'ws-rd');

  // Execute the actual route switch with lightweight JSX and location adapters.
  const source = ts.createSourceFile('App.tsx', appSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const route = source.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name?.text === 'ProductionDashboardRoute');
  assert.ok(route, '正式总览与旧协同入口的路由切换必须存在');
  const code = ts.transpileModule(route.getText(source), { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
  const renderRoute = new Function('React', 'useLocation', 'RDTaskManagementPage', 'ProductionDashboardPage', `${code}\nreturn ProductionDashboardRoute();`);
  const react = { createElement: (type: string, props: Record<string, unknown> | null) => ({ type, props }) };
  for (const search of ['', '?month=2026-09', '?view=unknown']) {
    assert.equal(renderRoute(react, () => ({ search }), 'workspace', 'overview').type, 'overview');
  }
  const legacy = renderRoute(react, () => ({ search: '?month=2026-09&view=legacy' }), 'workspace', 'overview');
  assert.equal(legacy.type, 'workspace');
  assert.equal(legacy.props.key, 'ws-production');
  assert.notEqual(legacy.props.key, rdRoute[1], '跨工作区路由必须强制重挂载，避免复用上一工作区的任务 state');
  const overviewSource = await readFile(new URL('../../../src/app/production/execution/ProductionDashboardPage.tsx', import.meta.url), 'utf8');
  assert.match(overviewSource, /<Link to="\/production-dashboard\?view=legacy">其他生产协同任务<\/Link>/, '正式总览必须保留可见的旧协同入口');
  assert.doesNotMatch(
    appSource,
    /path: "production-dashboard"[^\n]*RDDirectorDashboardPage/,
  );
  assert.doesNotMatch(appSource, /<RDDirectorDashboardPage\s*\/>/);
});
