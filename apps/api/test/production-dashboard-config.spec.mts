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
    /\{ path: "production-dashboard", element: makeLazyProtected\(<RDDirectorDashboardPage \/>/,
  );
  assert.match(
    appSource,
    /\{ path: "rd-director-dashboard", element: makeLazyProtected\(<Navigate to="\/production-dashboard" replace \/>/,
  );
  assert.match(migrationSource, /"navHidden" = false/);
  assert.match(migrationSource, /"routePath" = '\/production-dashboard'/);
  assert.match(migrationSource, /"groupLabel" = '页面访问 · 质量与生产'/);
});

test('production cockpit follows the R&D cockpit attachment loading strategy', async () => {
  const source = await readFile(
    new URL('../../../src/app/RDDirectorDashboardPage.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /const PERSON_TASK_PAGE_SIZE = 6;/);
  assert.match(source, /fetchRdTaskAttachmentPreviews\(taskIds/);
  assert.match(source, /personTasks\.slice\(0, personVisibleCount\)/);
  assert.doesNotMatch(source, /fetchRdTaskProgressNoteMap/);
});
