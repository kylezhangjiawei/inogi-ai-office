import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

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
    /\{ path: "production-dashboard", element: makeLazyProtected\(<RDTaskManagementPage key="ws-production" \/>, "page:rd-director-dashboard"\) \}/,
  );
  assert.match(
    appSource,
    /\{ path: "rd-director-dashboard", element: makeLazyProtected\(<Navigate to="\/production-dashboard" replace \/>/,
  );
  assert.match(migrationSource, /"navHidden" = false/);
  assert.match(migrationSource, /"routePath" = '\/production-dashboard'/);
  assert.match(migrationSource, /"groupLabel" = '页面访问 · 质量与生产'/);
});

test('production cockpit renders the same page implementation as the R&D task cockpit', async () => {
  const appSource = await readFile(
    new URL('../../../src/app/App.tsx', import.meta.url),
    'utf8',
  );

  const rdRoute = appSource.match(
    /\{ path: "rd-task-management", element: makeLazyProtected\(<RDTaskManagementPage key="([^"]+)" \/>, "page:rd-task-management"\) \}/,
  );
  const productionRoute = appSource.match(
    /\{ path: "production-dashboard", element: makeLazyProtected\(<RDTaskManagementPage key="([^"]+)" \/>, "page:rd-director-dashboard"\) \}/,
  );

  assert.ok(rdRoute, '研发任务驾驶舱路由必须使用标准驾驶舱页面');
  assert.ok(productionRoute, '生产驾驶舱必须复用研发任务驾驶舱页面');
  assert.equal(rdRoute[1], 'ws-rd');
  assert.equal(productionRoute[1], 'ws-production');
  assert.notEqual(productionRoute[1], rdRoute[1], '跨工作区路由必须强制重挂载，避免复用上一工作区的任务 state');
  assert.doesNotMatch(
    appSource,
    /path: "production-dashboard"[^\n]*RDDirectorDashboardPage/,
  );
});
